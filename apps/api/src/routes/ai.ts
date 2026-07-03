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
import { PERSONA_LIBRARY } from '@panelito/types'
import type { ProviderName } from '@panelito/types'
import { createGraph } from '../graph/graph'
import { getCheckpointer } from '../lib/langgraph-checkpointer'
import { loadBlueprint } from '../lib/blueprint-loader'
import { getLangfuseTracerProvider } from '@langfuse/tracing'
import { CallbackHandler } from '@langfuse/langchain'
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
  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .select('id, creator_id, active_personas, blueprint_id, current_phase')
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
  if (body.anyoneTyping) {
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

  // Resolve active provider (default 'anthropic' if not set)
  const providerName = ((creatorSettings?.active_provider) ?? 'anthropic') as ProviderName

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
      tags: [`session:${sessionId}`, `branch:${activeBranchId ?? 'main'}`],
    })

    // --- graph.astream config (D-05, D-10, D-14, ORCH-05) ---
    const graphConfig = {
      configurable: {
        thread_id: activeBranchId ?? sessionId,  // ORCH-05: thread_id = branch_id (RESEARCH Pitfall 5)
        blueprint,
        providerName,
        plaintextKey,
        activePersonas: activePersonaInstructions,  // D-10: string[] of persona systemPromptAddition values
        streamWriter,                               // D-05: text token seam
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
        // graph.stream() is the JS LangGraph equivalent of Python's graph.astream()
        // Returns Promise<IterableReadableStream> — must await before iterating (graph.astream pattern)
        const graphStream = await graph.stream(initialState, graphConfig)
        for await (const chunk of graphStream) {
          // chunk is a partial state snapshot — text flows via streamWriter out-of-band
          Object.assign(finalState, chunk)
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
      // Cast to any: getLangfuseTracerProvider() returns TracerProvider but the actual
      // NodeTracerProvider instance has forceFlush(). Same pattern as graph.integration.test.ts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (getLangfuseTracerProvider() as any).forceFlush().catch((flushErr: unknown) => {
        console.warn('[ai] Langfuse forceFlush error (non-fatal):', (flushErr as Error).message)
      })

      await stream.writeSSE({ event: 'done', data: '{}' })
    } catch (err) {
      console.error('[ai] stream error:', (err as Error).message)
      // T-04-15 / T-07-06: no provider-specific detail leaked
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: 'stream_failed' }),
      })
    }
  })
})

export default aiRouter
