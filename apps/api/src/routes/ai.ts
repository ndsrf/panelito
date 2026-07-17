/**
 * AI invoke route — graph.astream()-driven SSE streaming via the Phase 6 StateGraph.
 *
 * POST /api/sessions/:id/invoke
 *
 * ORCH-01: Each user message runs the full OrchestratorNode → AgentNode → MutationGateNode
 *          pipeline via graph.astream(), replacing the v1 direct adapter.stream() call.
 * AI-06: Branch-isolated context — message query filters by path_id
 * AI-07: Bot-activation matrix — returns 429 typing_hold while anyoneTyping=true (D-17)
 * AI-08: Sliding window — last 8 messages raw; older messages compressed via compressHistory
 * D-01: V1 sessions (no blueprint_id) rejected with 400 no_blueprint before any AI call
 * D-03: Session SELECT expanded to include blueprint_id + current_phase
 * D-04: loadBlueprint() called before opening SSE stream
 * D-05: Text tokens reach SSE via streamWriter seam in config.configurable
 * D-06: Promise.all([runGraph, drainQueue]) coordinates concurrent graph + SSE piping
 * D-14: Client disconnect propagates via c.req.raw.signal → config.signal → graph.astream()
 * D-15: LANGFUSE_TRACE_LEVEL controls per-request trace depth
 * D-16: Early-exit paths (400/409/429) are NOT traced
 *
 * T-02-05: Session ownership gate (creator_id === user.id → else 403)
 * T-02-06: API key decrypted server-side only — never written to any SSE event
 * T-02-07: Cap check before every invoke (429 if cap reached); cap increments only after stream
 * T-02-08: path_id filter prevents cross-branch context leakage
 * T-07-04: AbortError caught in runGraph → logs [ai] client_disconnected, no orphaned work
 * T-07-06: Outer catch emits generic stream_failed — no provider-specific detail leaked (T-04-15)
 * T-07-07: no_blueprint 400 gate rejects v1 sessions before any graph call
 * T-07-08: Empty accumulatedText + no canvasOps → skip INSERT (respects messages_content_check)
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { createServiceClient } from '../lib/supabase'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { assemblePromptArray, compressHistory, type Message } from '../lib/anthropic'
import { checkCap, incrementCount } from '../lib/cap-guard'
import { createAdapter } from '../lib/adapter-factory'
import { TASK_MODELS } from '../lib/model-config'
import { decryptKey } from '../lib/crypto'
import { env } from '../lib/env'
import { PERSONA_LIBRARY, ProviderSchema } from '@panelito/types'
import type { ProviderName } from '@panelito/types'
import { createGraph } from '../graph/graph'
import { getCheckpointer } from '../lib/langgraph-checkpointer'
import { loadBlueprint } from '../lib/blueprint-loader'
import { CallbackHandler } from '@langfuse/langchain'
import { flushLangfuse } from '../lib/langfuse-otel'
import type { Blueprint } from '@panelito/types'

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const aiRouter = new Hono<{ Variables: AuthVariables }>()

aiRouter.use('/*', requireAuth)

/**
 * POST /api/sessions/:id/invoke
 *
 * Streams AI tokens (text_delta SSE events) via the Phase 6 StateGraph.
 * After the stream completes, inserts the AI message row with canvas_snapshot_state = null.
 * Canvas DB writes are deferred to Phase 8.
 */
aiRouter.post('/:id/invoke', async (c) => {
  const user = c.get('user')
  const sessionId = c.req.param('id')
  const supabase = createServiceClient()

  // -------------------------------------------------------------------------
  // 1. Session ownership check — fetch session (T-02-05)
  //    D-03: expanded SELECT to include blueprint_id + current_phase
  // -------------------------------------------------------------------------
  // F2/D-12/D-13: bot_overrides is selected here so it can be threaded into
  // graphConfig.configurable below — it is the same column the "Analistas activos"
  // toggle writes via POST /api/sessions/:id/bots (routes/bots.ts).
  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .select('id, creator_id, active_personas, blueprint_id, current_phase, bot_overrides')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !session) {
    return c.json({ error: 'session_not_found' }, 404)
  }

  // T-02-05: Ownership gate — reject any authenticated user who does not own the session
  if (session.creator_id !== user.id) {
    return c.json({ error: 'forbidden' }, 403)
  }

  // -------------------------------------------------------------------------
  // Step 1.5: Blueprint gate — V1 sessions without blueprint_id are rejected (D-01)
  // Must run BEFORE cap check and any AI call (T-07-07)
  // -------------------------------------------------------------------------
  if (!session.blueprint_id) {
    return c.json({ error: 'no_blueprint' }, 400)
  }

  // -------------------------------------------------------------------------
  // 2. Cap check (T-02-07) — 429 if cap reached
  // -------------------------------------------------------------------------
  const capCheck = await checkCap(supabase, sessionId)
  if (!capCheck.ok) {
    return c.json({ error: capCheck.reason }, 429)
  }

  // -------------------------------------------------------------------------
  // 3. Parse body — anyoneTyping gate (AI-07 / D-17)
  // -------------------------------------------------------------------------
  const body = await c.req.json().catch(() => ({})) as {
    userMessage?: string
    anyoneTyping?: boolean
    branchId?: string
  }

  // D-17: Return 429 typing_hold BEFORE any AI call when a human is typing
  // Cap is NOT incremented on this path (T-02-07)
  // WR-03: Use strict boolean check (=== true) to reject truthy non-boolean values
  // such as the string "false" (a common client serialisation mistake), which would
  // silently block all AI responses under a plain `if (body.anyoneTyping)` check.
  if (body.anyoneTyping === true) {
    return c.json({ error: 'typing_hold' }, 429)
  }

  const userMessage = body.userMessage ?? ''

  // Resolve branch and ancestor paths for branch isolation
  let activeBranchId = body.branchId || null
  let activePathId = 'main'
  let ancestorPaths = ['main']

  if (activeBranchId) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeBranchId)
    if (isUuid) {
      const { data: branch } = await supabase
        .from('branches')
        .select('id, path_id')
        .eq('id', activeBranchId)
        .eq('session_id', sessionId)
        .single()
      if (branch) {
        activePathId = branch.path_id
        const pathSegments = branch.path_id.split('.')
        ancestorPaths = pathSegments.map((_: string, i: number) => pathSegments.slice(0, i + 1).join('.'))
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Resolve active persona system prompt (PERSONA-02 server-side gate)
  //    D-02: no_active_persona 409 gate preserved, runs after no_blueprint (D-01)
  //    D-13: active_personas still work in Blueprint sessions
  // -------------------------------------------------------------------------
  const activePersonas = (session.active_personas as string[] | null) ?? []
  const matchedPersonas = PERSONA_LIBRARY.filter(p => activePersonas.includes(p.id))

  if (matchedPersonas.length === 0) {
    // PERSONA-02: AI does not respond when no persona is toggled on
    return c.json({ error: 'no_active_persona' }, 409)
  }

  // D-10: active persona systemPromptAddition strings passed to graph via config.configurable.activePersonas
  const activePersonaInstructions = matchedPersonas.map(p => p.systemPromptAddition)

  // -------------------------------------------------------------------------
  // 5. Fetch creator's active provider + plaintext key (D-03, D-05, T-02-06)
  // -------------------------------------------------------------------------
  const { data: creatorSettings, error: settingsErr } = await supabase
    .from('creator_settings')
    .select('anthropic_api_key, openai_api_key, gemini_api_key, active_provider')
    .eq('user_id', session.creator_id)
    .maybeSingle()

  if (settingsErr) {
    console.error('[ai] settings fetch error', settingsErr)
    return c.json({ error: 'server_error' }, 500)
  }

  // Resolve active provider with runtime Zod validation (WR-03)
  const rawProvider = creatorSettings?.active_provider ?? 'anthropic'
  const providerParseResult = ProviderSchema.safeParse(rawProvider)
  if (!providerParseResult.success) {
    console.error('[ai] invalid active_provider in DB:', rawProvider)
    return c.json({ error: 'invalid_provider' }, 500)
  }
  const providerName: ProviderName = providerParseResult.data

  // Resolve the encrypted key column for the active provider
  const encryptedKey = creatorSettings?.[`${providerName}_api_key` as keyof typeof creatorSettings] as string | null | undefined

  if (!encryptedKey) {
    return c.json({ error: 'no_api_key' }, 400)
  }

  let plaintextKey: string
  try {
    plaintextKey = decryptKey(encryptedKey, env.KEY_ENCRYPTION_SECRET)
  } catch (err) {
    console.error('[ai] key decrypt error:', (err as Error).constructor.name)
    return c.json({ error: 'no_api_key' }, 400)
  }

  // -------------------------------------------------------------------------
  // 6. Instantiate the adapter ONCE — used for compression only (D-07)
  //    Graph nodes create their own adapters via createAdapter() seam
  // -------------------------------------------------------------------------
  const adapter = createAdapter(providerName, plaintextKey)

  // -------------------------------------------------------------------------
  // 7. Fetch last 8 messages (AI-06: path_id filter) + older for compression (AI-08)
  // -------------------------------------------------------------------------
  // Recent 8 messages (sliding window) — path-filtered to prevent cross-branch leakage
  const { data: recentData } = await supabase
    .from('messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .in('path_id', ancestorPaths)  // AI-06 / T-02-08: branch isolation
    .order('created_at', { ascending: false })
    .limit(8)

  const recentMessages: Message[] = (recentData ?? []).reverse().map(m => ({
    role: (m.role ?? 'user') as 'user' | 'assistant',
    content: m.content as string,
  }))

  // Older messages — for history compression (AI-08)
  const { data: olderData } = await supabase
    .from('messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .in('path_id', ancestorPaths)
    .order('created_at', { ascending: false })
    .range(8, 58)  // up to 50 older messages to compress

  let historicalSummary = ''
  if (olderData && olderData.length > 0) {
    const olderMessages: Message[] = olderData.reverse().map(m => ({
      role: (m.role ?? 'user') as 'user' | 'assistant',
      content: m.content as string,
    }))
    try {
      historicalSummary = await compressHistory(adapter, TASK_MODELS[providerName].compression, olderMessages)
    } catch (err) {
      // Non-fatal: if compression fails, proceed without historical summary
      console.error('[ai] compressHistory error:', (err as Error).message)
      historicalSummary = ''
    }
  }

  // -------------------------------------------------------------------------
  // 8. Assemble prompt array (AI-11 cache breakpoint via AnthropicAdapter)
  //    Note: system prompt assembly stays in the route (Phase 6 D-09 decision).
  //    buildAgentSystemPrompt() is called inside AgentNode with blueprint context.
  //    assemblePromptArray here assembles the conversation history only.
  // -------------------------------------------------------------------------
  const promptArray = assemblePromptArray({
    systemPrompt: '',  // AgentNode constructs the system prompt from Blueprint context
    personaInstructions: '',  // passed via config.configurable.activePersonas instead
    historicalSummary,
    recentMessages,
    userMessage,
  })

  // -------------------------------------------------------------------------
  // Step 7.5: Load Blueprint before opening SSE stream (D-04)
  // MUST complete before return streamSSE(...) — errors here return JSON 500, not SSE error events.
  // See RESEARCH.md Pitfall 1: opening SSE before blueprint load bricks error response.
  // -------------------------------------------------------------------------
  let blueprint: Blueprint
  try {
    blueprint = await loadBlueprint(session.blueprint_id)
  } catch (err) {
    console.error('[ai] blueprint load failed:', (err as Error).message)
    return c.json({ error: 'blueprint_load_failed' }, 500)
  }

  // -------------------------------------------------------------------------
  // Step 8: Initialize PostgresSaver checkpointer (lazy singleton — safe to call per-request)
  // -------------------------------------------------------------------------
  const checkpointer = await getCheckpointer()
  const graph = createGraph(checkpointer)

  // -------------------------------------------------------------------------
  // Step 8.5: Resolve activeBranchId to a real UUID (RESEARCH.md Pitfall 1)
  // The branch UUID is required for try_acquire_mic — null is not valid.
  // If the client did not send a branchId, fall back to the session's main branch.
  // -------------------------------------------------------------------------
  if (!activeBranchId) {
    const { data: mainBranch } = await supabase
      .from('branches')
      .select('id')
      .eq('session_id', sessionId)
      .eq('is_main', true)
      .single()
    if (!mainBranch) {
      return c.json({ error: 'branch_not_found' }, 404)
    }
    activeBranchId = mainBranch.id
  }

  // -------------------------------------------------------------------------
  // Step 8.55: Resolve the real author of the message being responded to (WR-04)
  // Mirrors profile-builder.ts's resolveAuthorId pattern: identity is ALWAYS resolved
  // server-side from the authoritative `messages` table, never from client input or
  // an LLM-supplied label. This is the actual author of the last human message on the
  // active branch — which may be a guest, and is NOT necessarily the session creator
  // (the /invoke ownership gate above forces user.id === session.creator_id always,
  // so user.id can never be used as a stand-in for "the participant this turn is
  // responding to"). Falls back to user.id only if no human message resolves (e.g.
  // very first turn on a branch) — this keeps participantId always non-null for
  // moderation/personalization consumers (T-13-07-01, T-13-07-02).
  // -------------------------------------------------------------------------
  const { data: lastHumanMessage } = await supabase
    .from('messages')
    .select('author_id')
    .eq('session_id', sessionId)
    .in('path_id', ancestorPaths)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastHumanAuthorId = (lastHumanMessage?.author_id as string | undefined) ?? user.id

  // -------------------------------------------------------------------------
  // Step 8.6: Mic lock acquire — BEFORE streamSSE() so locked branches return
  // JSON 409 (not an SSE error). Must be after branch UUID resolution. (HUMAN-01, D-01)
  // -------------------------------------------------------------------------
  const { data: micResult, error: micError } = await supabase.rpc('try_acquire_mic', {
    p_branch_id: activeBranchId,
    p_holder_id: sessionId,
    p_expiry_seconds: 30,
  })

  if (micError || !micResult?.[0]) {
    console.error('[ai] mic lock RPC error:', micError?.message)
    return c.json({ error: 'mic_lock_error' }, 500)
  }
  if (!micResult[0].acquired) {
    return c.json({ error: 'mic_locked', branch_id: activeBranchId }, 409)
  }

  // D-04: broadcast mic_acquired fire-and-forget
  supabase
    .channel(`session:${sessionId}`)
    .httpSend('mic_acquired', { branch_id: activeBranchId })
    .catch((err) => console.error('[ai] mic_acquired broadcast failed', err))

  // -------------------------------------------------------------------------
  // Step 9: Open SSE stream with graph.astream() + async-queue streamWriter
  // -------------------------------------------------------------------------
  return streamSSE(c, async (stream) => {
    // --- Async queue backed by streamWriter (D-05, D-06) ---
    const textChunks: string[] = []
    let _notify: (() => void) | null = null
    let graphDone = false

    function streamWriter(text: string): void {
      if (graphDone) return  // guard: no-op after graph completes (RESEARCH Pitfall 3)
      textChunks.push(text)
      _notify?.()
    }

    // --- Per-request Langfuse CallbackHandler (D-15, D-16, OBS-01) ---
    // Instantiated inside SSE callback, never module-level — prevents trace context corruption.
    // D-16: early-exit paths (400/409/429) are not traced — only real invocations reach here.
    const callbackHandler = new CallbackHandler({
      tags: [`session:${sessionId}`, `branch:${activeBranchId ?? 'main'}`, 'trigger:human-reactive'],
    })

    // --- graph.astream config (D-05, D-10, D-14, ORCH-05) ---
    // F2/D-12/D-13: supabase/serviceClient/branchId/participantId/botOverrides make
    // profileBuilder, phase-readiness, and moderation reachable on the real human
    // /invoke path for the first time — previously these config.configurable keys were
    // only ever supplied by test harnesses, so those Skills/nodes were silent no-ops in
    // production (RESEARCH.md Finding 2). Both `supabase` and `serviceClient` point at
    // the SAME client — moderation.ts reads `supabase`; profileBuilderNode/orphan-edge/
    // phase-readiness read `serviceClient` (`?? createServiceClient()` fallback).
    // WR-04: participantId is now the resolved AUTHOR of the last human message on the
    // active branch (Step 8.55 above), NOT always the session creator — the /invoke
    // ownership gate (T-02-05) only constrains WHO can invoke, never who the Coach/
    // Analyst/moderation Skills should target or attribute. This corrects moderation
    // escalation attribution and supplies the correct default personalization target.
    const graphConfig = {
      configurable: {
        thread_id: `${activeBranchId ?? sessionId}:human`,  // BOT-04: dual thread_id — human thread
        blueprint,
        providerName,
        plaintextKey,
        activePersonas: activePersonaInstructions,  // D-10: string[] of persona systemPromptAddition values
        streamWriter,                               // D-05: text token seam
        supabase,                                    // F2/D-12: moderation.ts's config.configurable.supabase seam
        serviceClient: supabase,                     // F2/D-12: profileBuilder/orphan-edge/phase-readiness seam
        branchId: activeBranchId,                    // F2/D-12
        participantId: lastHumanAuthorId,             // WR-04: resolved author of the last human message
        botOverrides: (session.bot_overrides as Record<string, boolean> | null) ?? {},  // D-13
      },
      callbacks: [callbackHandler],
      signal: c.req.raw.signal,  // D-14: abort propagation (T-07-04)
    }

    const initialState = {
      blueprintId: session.blueprint_id,
      currentPhaseId: session.current_phase ?? blueprint.phase_sequence[0]?.id ?? '',  // BLUE-04
      messages: promptArray,
      canvasOps: [],
    }

    // --- SSE drain loop ---
    let accumulatedText = ''

    async function drainQueue(): Promise<void> {
      while (!graphDone || textChunks.length > 0) {
        while (textChunks.length > 0) {
          const text = textChunks.shift()!
          accumulatedText += text
          await stream.writeSSE({ event: 'text_delta', data: JSON.stringify({ text }) })
        }
        if (!graphDone) {
          await new Promise<void>((resolve) => { _notify = resolve })
          _notify = null
        }
      }
    }

    // --- graph execution loop ---
    let finalState: Record<string, unknown> = {}

    async function runGraph(): Promise<void> {
      try {
        // graph.stream() with default streamMode='updates' emits { [nodeName]: nodeReturnValue }
        // per node. Object.assign(finalState, chunk) would store node-keyed wrappers, making
        // finalState.canvasOps always undefined. Instead we merge the node's return value directly
        // so finalState holds field-level values (canvasOps, phase_signal, agentConfidence, etc).
        // WR-04: INVARIANT — Only MutationGateNode emits canvasOps. Object.assign merges
        // node output deltas sequentially; if two nodes both emitted canvasOps the second
        // would overwrite the first (the LangGraph checkpoint accumulates via concat reducer,
        // but finalState is assembled from raw deltas, not from the checkpoint).
        // If a future Phase adds a second node that emits canvasOps, switch to reading from
        // the graph checkpoint after the stream completes:
        //   const cp = await graph.getState({ configurable: { thread_id: graphConfig.configurable.thread_id } })
        //   const allCanvasOps = cp.values?.canvasOps ?? []
        const graphStream = await graph.stream(initialState, graphConfig)
        for await (const chunk of graphStream) {
          // chunk = { nodeName: { field: value, ... } } — merge the inner value, not the wrapper
          for (const nodeOutput of Object.values(chunk)) {
            Object.assign(finalState, nodeOutput)
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // D-14: log disconnect (T-07-04); callbackHandler will include in trace span
          console.info('[ai] client_disconnected', { sessionId, branchId: activeBranchId })
          return
        }
        throw err
      } finally {
        graphDone = true
        _notify?.()  // wake drainQueue for final flush
      }
    }

    try {
      await Promise.all([runGraph(), drainQueue()])

      // --- Message insert (RESEARCH Pitfall 7: handle empty accumulatedText) ---
      // T-07-08: empty accumulatedText + no canvasOps → skip INSERT
      if (!accumulatedText.trim() && (finalState as any)?.canvasOps?.length > 0) {
        accumulatedText = '[canvas updated]'  // minimal fallback for messages_content_check constraint
      }

      if (accumulatedText.length > 0) {
        const { data: row, error: insertError } = await supabase
          .from('messages')
          .insert({
            session_id: sessionId,
            author_id: session.creator_id,
            display_name: matchedPersonas[0]?.displayName ?? 'AI',
            parent_id: null,
            path_id: activePathId,
            branch_id: activeBranchId,
            role: 'assistant',
            content: accumulatedText,
            canvas_snapshot_state: null,  // Phase 7: null — canvas DB writes are Phase 8
          })
          .select()
          .single()

        if (insertError || !row) {
          console.error('[ai] message insert error', insertError)
          // Stream already open — log only, don't abort the SSE connection
        } else {
          // Broadcast the new AI message to all participants in real-time
          supabase
            .channel(`session:${sessionId}`)
            .httpSend('new_message', row)
            .catch((err) => console.error('[ai] broadcast failed', err))
        }

        // T-02-07: increment cap ONLY after a completed real AI stream with content
        await incrementCount(supabase, sessionId)
      }

      // OBS-02: flush Langfuse traces before function exit
      // flushLangfuse() calls forceFlush() on the module-held LangfuseSpanProcessor directly
      // (null-safe). Never throws — safe to await without try/catch. See langfuse-otel.ts.
      await flushLangfuse()

      // D-10 (HUMAN-02): emit phase_signal SSE event BEFORE 'done' if LLM signalled readiness
      // phase_signal is advisory only — the human must confirm phase advancement via PATCH /phase
      // CR-01: emit next_phase_id (the phase to advance TO), not the current phase.
      // Suppress the signal if already at the last phase.
      if ((finalState as any)?.phase_signal === true) {
        const currentPhaseIndex = blueprint.phase_sequence.findIndex(
          (p) => p.id === (session.current_phase ?? blueprint.phase_sequence[0]?.id)
        )
        // WR-02: an unresolved current phase (findIndex -1) must SUPPRESS the signal,
        // not fall through to `-1 + 1 = 0` and wrongly offer phase 0 as "next".
        const nextPhase = currentPhaseIndex >= 0 ? (blueprint.phase_sequence[currentPhaseIndex + 1] ?? null) : null

        if (nextPhase) {
          await stream.writeSSE({
            event: 'phase_signal',
            data: JSON.stringify({
              next_phase_id: nextPhase.id,
              blueprint_id: session.blueprint_id,
            }),
          })
        }
        // If no next phase exists, suppress the signal (already at final phase)
      }

      // -------------------------------------------------------------------
      // Canvas upserts before 'done' so committed nodes/edges can be
      // delivered to the invoking client via SSE (canvas_update SSE event).
      //
      // Realtime httpSend broadcasts fire after 'done' as fire-and-forget for
      // all other participants. In WSL2 local dev the browser cannot reach
      // Supabase Realtime (ERR_CONNECTION_TIMED_OUT), so SSE is the only
      // reliable delivery path for the invoking client.
      //
      // Phase 9 D-01 reversal: ghost nodes ARE now persisted.
      // ADD_NODE ops first to generate UUIDs (D-15/D-17), then ADD_EDGE.
      // -------------------------------------------------------------------
      const allCanvasOps = (finalState as any)?.canvasOps ?? []

      const committedOps = allCanvasOps.filter(
        (op: import('@panelito/types').CanvasOp) => op.op !== 'NO_ACTION' && op.status === 'committed'
      )

      // Phase 9 D-01: ghost ops also persisted — reverses Phase 8 D-14
      // Ghost nodes need NO deduplication (Pitfall 5 — multiple same-label ghosts coexist until expiry)
      const ghostOps = allCanvasOps.filter(
        (op: import('@panelito/types').CanvasOp) => op.op !== 'NO_ACTION' && (op as any).status === 'ghost'
      )

      const committedNodeRows: import('@panelito/types').CanvasNode[] = []
      const committedEdgeRows: import('@panelito/types').CanvasEdge[] = []
      const ghostNodeRows: import('@panelito/types').CanvasNode[] = []
      const ghostEdgeRows: import('@panelito/types').CanvasEdge[] = []

      if (committedOps.length > 0) {
        const nodeIdMap = new Map<string, string>()  // label → uuid (same-invocation edge refs)

        // Step 1: ADD_NODE ops — server-generated UUIDs (D-15)
        for (const op of committedOps.filter((o: any) => o.op === 'ADD_NODE')) {
          const nodeId = crypto.randomUUID()
          const { data: nrow, error: nerr } = await supabase
            .from('canvas_nodes')
            .upsert({
              id: nodeId,
              session_id: sessionId,
              branch_id: activeBranchId,
              blueprint_id: session.blueprint_id,
              node_type_id: op.node_type_id,
              label: op.label,
              status: 'committed',
              position_x: null,
              position_y: null,
            }, { onConflict: 'id' })
            .select()
            .single()

          if (nerr || !nrow) {
            console.warn('[ai] canvas_nodes upsert failed — skipping (fail-silent)', nerr?.message)
          } else {
            nodeIdMap.set(op.label, nodeId)
            committedNodeRows.push(nrow)
          }
        }

        // Step 2: ADD_EDGE ops — drop silently if source/target nodes not in DB (D-17)
        for (const op of committedOps.filter((o: any) => o.op === 'ADD_EDGE')) {
          const sourceId = nodeIdMap.get(op.source_node_id) ?? op.source_node_id
          const targetId = nodeIdMap.get(op.target_node_id) ?? op.target_node_id

          const [{ count: srcCount }, { count: tgtCount }] = await Promise.all([
            supabase.from('canvas_nodes').select('id', { count: 'exact', head: true })
              .eq('id', sourceId).eq('session_id', sessionId),
            supabase.from('canvas_nodes').select('id', { count: 'exact', head: true })
              .eq('id', targetId).eq('session_id', sessionId),
          ])

          if (!srcCount || !tgtCount) {
            console.warn('[ai] ADD_EDGE references unknown node — dropping silently (D-17)')
            continue
          }

          const edgeId = crypto.randomUUID()
          const { data: erow, error: eerr } = await supabase
            .from('canvas_edges')
            .upsert({
              id: edgeId,
              session_id: sessionId,
              branch_id: activeBranchId,
              blueprint_id: session.blueprint_id,
              source_node_id: sourceId,
              target_node_id: targetId,
              edge_type_id: op.edge_type_id,
              status: 'committed',
            }, { onConflict: 'id' })
            .select()
            .single()

          if (eerr || !erow) {
            console.warn('[ai] canvas_edges upsert failed — skipping (fail-silent)', eerr?.message)
          } else {
            committedEdgeRows.push(erow)
          }
        }
      }

      // Phase 9 D-01: persist ghost nodes — ADD_NODE before ADD_EDGE (D-17)
      // ghost nodes get server-generated UUIDs; no deduplication needed (Pitfall 5)
      if (ghostOps.length > 0) {
        const ghostNodeIdMap = new Map<string, string>()  // label → uuid for ghost edge refs

        // Ghost Step 1: ADD_NODE ops with status='ghost'
        for (const op of ghostOps.filter((o: any) => o.op === 'ADD_NODE')) {
          const nodeId = crypto.randomUUID()
          const { data: gnrow, error: gnerr } = await supabase
            .from('canvas_nodes')
            .upsert({
              id: nodeId,
              session_id: sessionId,
              branch_id: activeBranchId,
              blueprint_id: session.blueprint_id,
              node_type_id: op.node_type_id,
              label: op.label,
              status: 'ghost',  // Phase 9 D-01
              position_x: null,
              position_y: null,
            }, { onConflict: 'id' })
            .select()
            .single()

          if (gnerr || !gnrow) {
            console.warn('[ai] ghost canvas_nodes upsert failed — skipping (fail-silent)', gnerr?.message)
          } else {
            ghostNodeIdMap.set(op.label, nodeId)
            ghostNodeRows.push(gnrow)
          }
        }

        // Ghost Step 2: ADD_EDGE ops — ghost edges may reference ghost nodes (FK is by id, status-agnostic)
        for (const op of ghostOps.filter((o: any) => o.op === 'ADD_EDGE')) {
          const sourceId = ghostNodeIdMap.get(op.source_node_id) ?? op.source_node_id
          const targetId = ghostNodeIdMap.get(op.target_node_id) ?? op.target_node_id

          const [{ count: srcCount }, { count: tgtCount }] = await Promise.all([
            supabase.from('canvas_nodes').select('id', { count: 'exact', head: true })
              .eq('id', sourceId).eq('session_id', sessionId),
            supabase.from('canvas_nodes').select('id', { count: 'exact', head: true })
              .eq('id', targetId).eq('session_id', sessionId),
          ])

          if (!srcCount || !tgtCount) {
            console.warn('[ai] ghost ADD_EDGE references unknown node — dropping silently')
            continue
          }

          const edgeId = crypto.randomUUID()
          const { data: gerow, error: geerr } = await supabase
            .from('canvas_edges')
            .upsert({
              id: edgeId,
              session_id: sessionId,
              branch_id: activeBranchId,
              blueprint_id: session.blueprint_id,
              source_node_id: sourceId,
              target_node_id: targetId,
              edge_type_id: op.edge_type_id,
              status: 'ghost',  // Phase 9 D-01
            }, { onConflict: 'id' })
            .select()
            .single()

          if (geerr || !gerow) {
            console.warn('[ai] ghost canvas_edges upsert failed — skipping (fail-silent)', geerr?.message)
          } else {
            ghostEdgeRows.push(gerow)
          }
        }
      }

      // SSE delivery to the invoking client — committed + ghost nodes.
      // Ghost nodes must be included here: Realtime is unreachable in WSL2 local dev
      // (ERR_CONNECTION_TIMED_OUT), so SSE is the only delivery path for the invoking client.
      const sseNodeRows = [...committedNodeRows, ...ghostNodeRows]
      const sseEdgeRows = [...committedEdgeRows, ...ghostEdgeRows]
      if (sseNodeRows.length > 0 || sseEdgeRows.length > 0) {
        await stream.writeSSE({
          event: 'canvas_update',
          data: JSON.stringify({ nodes: sseNodeRows, edges: sseEdgeRows }),
        })
      }

      // SSE panel_update: switch the invoking client's panel to 'graph'.
      // Must fire BEFORE 'done' — client stops processing SSE events after done.
      const hasCanvasOps = sseNodeRows.length > 0 || sseEdgeRows.length > 0
      if (hasCanvasOps) {
        await stream.writeSSE({
          event: 'panel_update',
          data: JSON.stringify({ widget_type: 'graph' }),
        })
      }

      await stream.writeSSE({ event: 'done', data: '{}' })

      // Phase 9 D-02: Realtime broadcast for all other participants — fire-and-forget.
      // Sends committed + ghost so late-joining clients and non-invokers get full canvas state.
      const allNodeRows = [...committedNodeRows, ...ghostNodeRows]
      const allEdgeRows = [...committedEdgeRows, ...ghostEdgeRows]
      if (allNodeRows.length > 0 || allEdgeRows.length > 0) {
        supabase
          .channel(`session:${sessionId}`)
          .httpSend('canvas_update', { nodes: allNodeRows, edges: allEdgeRows })
          .catch((err) => console.error('[ai] canvas_update broadcast failed', err))

        supabase
          .channel(`session:${sessionId}`)
          .httpSend('panel_update', { widget_type: 'graph' })
          .catch((err) => console.error('[ai] panel_update broadcast failed', err))
      }
    } catch (err) {
      console.error('[ai] stream error:', (err as Error).message)
      // T-04-15 / T-07-06: no provider-specific detail leaked
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: 'stream_failed' }),
      })
    } finally {
      // D-06: always release mic, even on AbortError or stream crash (T-08-04-F)
      try {
        await supabase.rpc('release_mic', { p_branch_id: activeBranchId })
      } catch (err: unknown) {
        console.warn('[ai] release_mic error (non-fatal):', (err as Error).message)
      }
      supabase
        .channel(`session:${sessionId}`)
        .httpSend('mic_released', { branch_id: activeBranchId, reason: 'completed' })
        .catch((err) => console.error('[ai] mic_released broadcast failed', err))
    }
  })
})

export default aiRouter
