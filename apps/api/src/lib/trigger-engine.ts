/**
 * trigger-engine.ts — persistent, drift-aware, cancellable TriggerEngine loop (TRIGGER-07).
 *
 * Generalized from Phase 11's interim single-trigger scan-loop module (D-15, TRIGGER-01). Five of the six
 * trigger types already fire reactively (Phases 12-13, synchronous Skills evaluated inline
 * during a human /invoke turn); this module is the ONE timer-based trigger — the silence-window
 * re-evaluation (D-01) — because silence, by definition, has no inbound event to react to.
 *
 * Per active branch of every active session, runs the Phase 10 chain (checkSilenceGate ->
 * runArbitration -> checkBotBudget) and — when all three pass and the Coach bot is enabled for
 * the session — invokes the graph on the BOT thread (`${branchId}:bot`, never the human thread
 * — BOT-04) and inserts a content-aware Coach message directly into `messages` (D-16: no SSE,
 * there is no active HTTP request to stream a proactively-fired message over).
 *
 * Loop mechanics (D-02, Pattern 1): a `node:timers/promises` async-iterator `setInterval` driven
 * by an `AbortController`, so each tick is awaited before the next fires (no overlap hazard) and
 * `startTriggerEngine` returns a stop function for graceful shutdown (server.ts SIGTERM/SIGINT).
 *
 * Frozen-session guard (Critical Failure Mode 6): none of the three reused Phase 10 primitives
 * (checkSilenceGate/runArbitration/checkBotBudget) check session.status — this loop owns that
 * check, both at the query level (.eq('status','active')) and defensively in code.
 *
 * Cooldown enforcement (TRIGGER-01 success criterion 3 — fires at most once per cooldown
 * window): read from the BOT thread's own checkpoint (triggerMetadata.silence_gate.cooldown_
 * until), not from application memory — memory does not survive a server restart, PostgresSaver
 * checkpoints do (BOT-05).
 *
 * Langfuse tracing (D-14 inherited fix): a per-request CallbackHandler (never module-level) is
 * constructed inside scanBranch() and passed to graph.invoke()'s callbacks array, tagged
 * `trigger:silence_gate` — this closes the previously-confirmed tracing gap on the proactive
 * path (COST-03), mirroring ai.ts's own per-request CallbackHandler construction.
 *
 * Phase-readiness coupling (D-03/D-04): when the Blueprint opts in via
 * `silence_phase_readiness_coupling_enabled`, a silence fire also invokes the existing
 * `phaseReadinessSkill.detect()`/`buildPromptGuidance()` (never duplicated) so the Coach can
 * weigh "redirect" (existing content-aware silence question) vs "suggest advancing" (advisory
 * only — HUMAN-02/T-13-11, never auto-advances the phase).
 */

import { setInterval as asyncInterval } from 'node:timers/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Blueprint, Personality, ProviderMessage, ProviderName } from '@panelito/types'
import { PersonalitySchema, ProviderSchema } from '@panelito/types'
import { CallbackHandler } from '@langfuse/langchain'
import { checkSilenceGate } from './silence-gate'
import { runArbitration, releaseBotLock } from './bot-arbitrator'
import { checkBotBudget } from './bot-budget'
import { registerBots } from './bot-registration'
import { loadBlueprint } from './blueprint-loader'
import { decryptKey } from './crypto'
import { env } from './env'
import { CONTEXT_WINDOWS } from './bot-context'
import { createGraph } from '../graph/graph'
import { getCheckpointer } from './langgraph-checkpointer'
import type { GraphState } from '../graph/state'
import type { SkillContext } from './skills'
import { phaseReadinessSkill } from './skills/phase-readiness'

type CompiledGraph = ReturnType<typeof createGraph>

// ---------------------------------------------------------------------------
// Constants — env-var overrides, min-floor warnings (auto-freeze.ts pattern)
// ---------------------------------------------------------------------------

/** How often the scan tick runs. Default 60s (D-02) — decoupled from auto-freeze. */
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS ?? '60000', 10)
const SCAN_INTERVAL_FLOOR_MS = 5_000
if (SCAN_INTERVAL_MS < SCAN_INTERVAL_FLOOR_MS) {
  console.warn(
    `[trigger-engine] WARNING: SCAN_INTERVAL_MS=${SCAN_INTERVAL_MS} is below the recommended minimum of ${SCAN_INTERVAL_FLOOR_MS}. ` +
    'This should only be set in test environments.'
  )
}

/** How long a branch must be silent (no message + no typing) before the gate can pass. */
const SILENCE_THRESHOLD_MS = parseInt(process.env.SILENCE_THRESHOLD_MS ?? '60000', 10)
const SILENCE_THRESHOLD_FLOOR_MS = 10_000
if (SILENCE_THRESHOLD_MS < SILENCE_THRESHOLD_FLOOR_MS) {
  console.warn(
    `[trigger-engine] WARNING: SILENCE_THRESHOLD_MS=${SILENCE_THRESHOLD_MS} is below the recommended minimum of ${SILENCE_THRESHOLD_FLOOR_MS}. ` +
    'This should only be set in test environments.'
  )
}

/** Fallback Coach cooldown window (minutes) when the Blueprint doesn't declare bot_cooldowns.coach. */
const DEFAULT_COACH_COOLDOWN_MINUTES = 15

/**
 * A priori token estimate for a single Coach fire, used to guard checkBotBudget() BEFORE the
 * LLM call (the guard must run before invocation, so actual usage isn't known yet). Covers
 * facilitation-agent.ts's maxTokens:256 output plus a conservative system-prompt/context
 * estimate. Phase 14's TriggerEngine should replace this with real adapter usage figures fed
 * back into a post-hoc ledger correction, if the API supports it.
 */
const ESTIMATED_COACH_FIRE_TOKENS = 400

/** Dedicated bot-author sentinel — distinct from session.creator_id and from
 *  sessions-helpers.ts's SYSTEM_AUTHOR_ID (Assumption A3 / T-11-20: ambiguous bot authorship
 *  is a Repudiation threat). messages.author_id has no FK constraint (0001_initial_schema.sql:
 *  "author_id has no FK to auth.users because guests use anon tokens"), so a fixed sentinel
 *  UUID is safe. */
export const COACH_AUTHOR_ID = '00000000-0000-0000-0000-000000000b01'
const COACH_DISPLAY_NAME = 'Facilitador'

// ---------------------------------------------------------------------------
// Row shapes (partial — only the columns this module selects)
// ---------------------------------------------------------------------------

interface ActiveSessionRow {
  id: string
  status: string
  creator_id: string
  blueprint_id: string | null
  bot_overrides: Record<string, boolean> | null
  current_phase: string | null
}

interface ActiveBranchRow {
  id: string
  path_id: string
}

interface ProviderContext {
  providerName: ProviderName
  plaintextKey: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * startTriggerEngine — run once at API boot (server.ts, alongside startAutoFreezeTracker).
 *
 * Registers the Coach/Analyst bots with the arbitrator, resolves a default graph (PostgresSaver
 * checkpointer) if none is supplied, then starts a drift-aware async-iterator setInterval loop
 * (Pattern 1: `node:timers/promises`, AbortController-driven — no manual Date.now() drift
 * bookkeeping, no overlap hazard since each tick is awaited before the next fires). Per-tick
 * `try/catch` isolation ensures one bad tick never kills the loop.
 *
 * @param supabase - Service-role Supabase client.
 * @param graph - Optional pre-built compiled graph (test seam). Defaults to
 *   createGraph(await getCheckpointer()), matching how ai.ts constructs graph+checkpointer.
 * @returns A stop function — calling it aborts the loop; a subsequent tick never runs.
 */
export async function startTriggerEngine(
  supabase: SupabaseClient,
  graph?: CompiledGraph
): Promise<() => void> {
  registerBots()

  const resolvedGraph = graph ?? createGraph(await getCheckpointer())

  const controller = new AbortController()

  void (async () => {
    try {
      for await (const _tick of asyncInterval(SCAN_INTERVAL_MS, undefined, { signal: controller.signal })) {
        try {
          await runSilenceScan(supabase, resolvedGraph)
        } catch (err) {
          // Per-tick error isolation — one bad tick must never kill the loop.
          console.error('[trigger-engine] uncaught error in scan tick', err)
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[trigger-engine] loop terminated unexpectedly', err)
      }
    }
  })()

  console.log(
    `[trigger-engine] scan loop started (interval: ${SCAN_INTERVAL_MS}ms, silence threshold: ${SILENCE_THRESHOLD_MS}ms)`
  )

  return () => controller.abort()
}

/**
 * runSilenceScan — one scan tick: evaluate every active branch of every active session.
 *
 * Frozen-session guard: filters at the query level (.eq('status','active')) AND rechecks
 * session.status in code before any per-branch work — Critical Failure Mode 6.
 */
export async function runSilenceScan(supabase: SupabaseClient, graph: CompiledGraph): Promise<void> {
  const { data: sessions, error: sessionsError } = await supabase
    .from('sessions')
    .select('id, status, creator_id, blueprint_id, bot_overrides, current_phase')
    .eq('status', 'active')

  if (sessionsError) {
    console.error('[trigger-engine] sessions query error:', sessionsError.message)
    return
  }

  for (const session of (sessions ?? []) as ActiveSessionRow[]) {
    await scanSession(supabase, graph, session)
  }
}

// ---------------------------------------------------------------------------
// Internal — per-session, per-branch pipeline
// ---------------------------------------------------------------------------

async function scanSession(
  supabase: SupabaseClient,
  graph: CompiledGraph,
  session: ActiveSessionRow
): Promise<void> {
  // Defense-in-depth: the query already filters to status='active', but a frozen session must
  // NEVER reach graph.invoke() even if that filter is ever weakened (Critical Failure Mode 6).
  if (session.status !== 'active') return

  if (!session.blueprint_id) return

  let blueprint: Blueprint
  try {
    blueprint = await loadBlueprint(session.blueprint_id)
  } catch (err) {
    console.error('[trigger-engine] blueprint load failed for session', session.id, (err as Error).message)
    return
  }

  // D-10: effective Coach on/off = bot_overrides.coach ?? blueprint.bot_defaults.coach ?? false
  const coachEnabled = session.bot_overrides?.coach ?? blueprint.bot_defaults?.coach ?? false
  if (!coachEnabled) return

  const providerCtx = await resolveProviderContext(supabase, session.creator_id)
  if (!providerCtx) return // no configured/decryptable API key — skip silently, no bot fires

  const personality = await resolveCoachPersonality(supabase, blueprint)

  const { data: branches, error: branchesError } = await supabase
    .from('branches')
    .select('id, path_id')
    .eq('session_id', session.id)
    .eq('is_archived', false)

  if (branchesError) {
    console.error('[trigger-engine] branches query error for session', session.id, branchesError.message)
    return
  }

  for (const branch of (branches ?? []) as ActiveBranchRow[]) {
    await scanBranch(supabase, graph, session, blueprint, personality, providerCtx, branch)
  }
}

async function scanBranch(
  supabase: SupabaseClient,
  graph: CompiledGraph,
  session: ActiveSessionRow,
  blueprint: Blueprint,
  personality: Personality | undefined,
  providerCtx: ProviderContext,
  branch: ActiveBranchRow
): Promise<void> {
  const gateResult = await checkSilenceGate({
    supabase,
    branchId: branch.id,
    thresholdMs: SILENCE_THRESHOLD_MS,
  })
  if (!gateResult.passed) return

  const botThreadId = `${branch.id}:bot`

  const cooldownUntil = await readCooldownUntil(graph, botThreadId)
  if (cooldownUntil && new Date(cooldownUntil).getTime() > Date.now()) {
    console.info('[trigger-engine] cooldown active for', branch.id, 'until', cooldownUntil)
    return
  }

  const winner = await runArbitration(branch.id, blueprint, supabase)
  if (winner !== 'coach') return

  try {
    const budget = await checkBotBudget(supabase, branch.id, ESTIMATED_COACH_FIRE_TOKENS)
    if (!budget.allowed) {
      console.warn('[trigger-engine] budget guard denied Coach fire for branch', branch.id, {
        circuit_open: budget.circuit_open,
      })
      return
    }

    const recentMessages = await fetchRecentMessages(supabase, branch.id)

    // D-03/D-04: Blueprint-opt-in phase-readiness coupling — advisory only, never auto-advances
    // the phase (HUMAN-02/T-13-11). No-op (zero added cost) for the default-off Blueprint.
    await applyPhaseReadinessCoupling(supabase, graph, botThreadId, session, blueprint, branch, providerCtx, recentMessages)

    let accumulatedText = ''
    const streamWriter = (text: string): void => {
      accumulatedText += text
    }

    // Per-request Langfuse CallbackHandler (D-14 inherited fix, OBS-01) — instantiated per
    // invocation, never module-level, mirrors ai.ts's own per-request construction. Closes the
    // previously-confirmed tracing gap on this proactive path (COST-03).
    const callbackHandler = new CallbackHandler({
      tags: [`session:${session.id}`, `branch:${branch.id}`, 'trigger:silence_gate'],
    })

    await graph.invoke(
      {
        triggerType: 'silence_gate',
        messages: recentMessages,
        blueprintId: blueprint.id,
        currentPhaseId: session.current_phase ?? blueprint.phase_sequence[0]?.id ?? '',
      },
      {
        configurable: {
          thread_id: botThreadId,
          blueprint,
          providerName: providerCtx.providerName,
          plaintextKey: providerCtx.plaintextKey,
          personality,
          streamWriter,
          // Pitfall 5: reachability config keys ai.ts sets that this proactive path lacked —
          // required so Coach participant-profile personalization (Phase 13 D-12/D-13) and any
          // Skill reading serviceClient/branchId can reach this invocation. Deliberately NOT
          // adding botOverrides here (Pitfall 6): routeFromStart sends 'silence_gate' straight to
          // 'facilitation', bypassing TriggerGateNode's gate entirely — botOverrides would be a
          // dead key on this call site.
          supabase,
          serviceClient: supabase,
          branchId: branch.id,
        },
        callbacks: [callbackHandler],
      }
    )

    if (accumulatedText.trim().length === 0) {
      console.warn('[trigger-engine] Coach produced no text for branch', branch.id, '- skipping insert')
      return
    }

    const { data: row, error: insertError } = await supabase
      .from('messages')
      .insert({
        session_id: session.id,
        author_id: COACH_AUTHOR_ID,
        display_name: COACH_DISPLAY_NAME,
        parent_id: null,
        path_id: branch.path_id,
        branch_id: branch.id,
        role: 'assistant',
        content: accumulatedText,
        canvas_snapshot_state: null,
      })
      .select()
      .single()

    if (insertError || !row) {
      console.error('[trigger-engine] message insert error for branch', branch.id, insertError?.message)
    } else {
      supabase
        .channel(`session:${session.id}`)
        .httpSend('new_message', row)
        .catch((err: unknown) => console.error('[trigger-engine] broadcast failed', err))
    }

    await recordCooldown(graph, botThreadId, blueprint)
  } finally {
    // MUST be released even if invoke/insert throws — Phase 10 documented contract
    // (bot-arbitrator.ts releaseBotLock doc comment); otherwise the lock leaks until
    // locked_until expires.
    await releaseBotLock(branch.id, supabase)
  }
}

// ---------------------------------------------------------------------------
// Internal — phase-readiness coupling (D-03/D-04)
// ---------------------------------------------------------------------------

/**
 * applyPhaseReadinessCoupling — when (and only when) the Blueprint opts in via
 * `silence_phase_readiness_coupling_enabled` (default false — zero added cost for non-opted-in
 * Blueprints, `detect()` is never called), invokes the existing `phaseReadinessSkill` (reused
 * as-is — never duplicates its N/M gate or coverage-judgment logic, RESEARCH Don't-Hand-Roll)
 * and, if it fires, appends its `buildPromptGuidance()` text to `recentMessages` (mutated in
 * place) so the Coach's own graph.invoke() call — the very next step in scanBranch — sees it as
 * part of the conversation it streams to the model (role 'user' — the only ProviderMessage role
 * guaranteed to reach all three BYOK providers unfiltered; Anthropic maps 'system' to 'user'
 * anyway and Gemini filters 'system' out of contents entirely, so 'user' is the only reliable
 * cross-provider carrier for this advisory note). Advisory only (HUMAN-02/T-13-11): nothing
 * here writes `sessions.current_phase` or otherwise auto-advances the phase — the Coach may at
 * most ASK the group whether they feel ready to advance, exactly like phase-readiness's existing
 * synchronous TriggerGateNode-driven path.
 */
async function applyPhaseReadinessCoupling(
  supabase: SupabaseClient,
  graph: CompiledGraph,
  botThreadId: string,
  session: ActiveSessionRow,
  blueprint: Blueprint,
  branch: ActiveBranchRow,
  providerCtx: ProviderContext,
  recentMessages: ProviderMessage[]
): Promise<void> {
  if (!blueprint.silence_phase_readiness_coupling_enabled) return

  // CR-02 fix (REVIEW.md): the bot thread's own checkpoint is the sole durable home for
  // phaseGateProgress on this call site (the silence_gate route bypasses TriggerGateNode
  // entirely, Pitfall 6, so there is no live GraphState to read the counter from otherwise).
  // Without threading this through, buildPhaseReadinessState always constructed a
  // phaseGateProgress: null object, which phase-readiness.ts treats as "gate freshly opened"
  // on every single tick — the M-message threshold (default 5) then became permanently
  // unsatisfiable because triggerType: 'silence_gate' (not null) means the silence path never
  // increments messagesSinceGateOpen either (by design, WR-01). Reading and persisting the
  // real counter here closes that gap.
  let existingProgress: GraphState['phaseGateProgress'] = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snapshot: any = await graph.getState({ configurable: { thread_id: botThreadId } })
    existingProgress = snapshot?.values?.phaseGateProgress ?? null
  } catch (err) {
    console.warn(
      '[trigger-engine] getState failed for phase-readiness coupling (treating as no progress)',
      botThreadId,
      (err as Error).message
    )
  }

  const skillContext: SkillContext = {
    state: buildPhaseReadinessState(session, blueprint, recentMessages, existingProgress),
    blueprint,
    config: {
      configurable: {
        serviceClient: supabase,
        branchId: branch.id,
        providerName: providerCtx.providerName,
        plaintextKey: providerCtx.plaintextKey,
      },
    },
  }

  try {
    const result = await phaseReadinessSkill.detect(skillContext)

    // Persist the updated gate progress back onto the bot thread's checkpoint regardless of
    // fires/no-fires (mirrors recordCooldown's existing merge-and-writeback pattern, and
    // trigger-gate.ts's own phaseGateProgress-surfacing convention), so the next silence tick
    // reads the advanced counter instead of a fresh reset.
    if (result.meta && 'phaseGateProgress' in result.meta) {
      const phaseGateProgress = result.meta.phaseGateProgress as GraphState['phaseGateProgress']
      try {
        await graph.updateState({ configurable: { thread_id: botThreadId } }, { phaseGateProgress })
      } catch (err) {
        console.error(
          '[trigger-engine] failed to persist phaseGateProgress for',
          botThreadId,
          (err as Error).message
        )
      }
    }

    if (!result.fires) return

    const guidance = phaseReadinessSkill.buildPromptGuidance(skillContext)
    recentMessages.push({
      role: 'user',
      content: `[Nota interna del sistema — orientación de fase, no es un mensaje de un participante] ${guidance}`,
    })
  } catch (err) {
    // detect() already fails closed internally and never throws — this is defensive
    // belt-and-suspenders so a coupling failure can never block the silence fire itself.
    console.error('[trigger-engine] phase-readiness coupling error (advisory only, continuing)', (err as Error).message)
  }
}

/** Minimal GraphState-shaped object for the phase-readiness Skill's detect()/buildPromptGuidance()
 *  — called OUTSIDE the graph (the silence_gate route bypasses TriggerGateNode entirely, Pitfall
 *  6), so there is no live GraphState to read from; this constructs the fields the Skill actually
 *  reads (currentPhaseId, messages, triggerType) with safe defaults for the rest.
 *  `phaseGateProgress` (CR-02 fix) is threaded through from the bot thread's own checkpoint by
 *  the caller, rather than always resetting to null. */
function buildPhaseReadinessState(
  session: ActiveSessionRow,
  blueprint: Blueprint,
  recentMessages: ProviderMessage[],
  phaseGateProgress: GraphState['phaseGateProgress'] = null
): GraphState {
  return {
    blueprintId: blueprint.id,
    currentPhaseId: session.current_phase ?? blueprint.phase_sequence[0]?.id ?? '',
    messages: recentMessages,
    canvasOps: [],
    guardrailResult: null,
    agentConfidence: null,
    driftAction: null,
    agentOutput: null,
    steeringTextEnabled: null,
    phase_signal: null,
    argGraph: { nodes: [], edges: [] },
    triggerMetadata: {},
    triggerType: 'silence_gate',
    firingSkillId: null,
    firingSkillRole: null,
    skillMeta: null,
    triggerGateComplete: null,
    phaseGateProgress,
    roleInvocationCounts: {},
  }
}

// ---------------------------------------------------------------------------
// Internal — helpers
// ---------------------------------------------------------------------------

async function resolveProviderContext(
  supabase: SupabaseClient,
  creatorId: string
): Promise<ProviderContext | null> {
  const { data: creatorSettings, error } = await supabase
    .from('creator_settings')
    .select('anthropic_api_key, openai_api_key, gemini_api_key, active_provider')
    .eq('user_id', creatorId)
    .maybeSingle()

  if (error || !creatorSettings) return null

  const providerParse = ProviderSchema.safeParse(creatorSettings.active_provider ?? 'anthropic')
  if (!providerParse.success) return null
  const providerName = providerParse.data

  const encryptedKey = creatorSettings[`${providerName}_api_key` as keyof typeof creatorSettings] as
    | string
    | null
    | undefined
  if (!encryptedKey) return null

  try {
    const plaintextKey = decryptKey(encryptedKey, env.KEY_ENCRYPTION_SECRET)
    return { providerName, plaintextKey }
  } catch (err) {
    console.error('[trigger-engine] key decrypt error:', (err as Error).constructor.name)
    return null
  }
}

async function resolveCoachPersonality(
  supabase: SupabaseClient,
  blueprint: Blueprint
): Promise<Personality | undefined> {
  const personalityId = blueprint.role_personalities?.coach
  if (!personalityId) return undefined

  const { data, error } = await supabase
    .from('personalities')
    .select('id, name, definition')
    .eq('id', personalityId)
    .maybeSingle()

  if (error || !data) return undefined

  const parsed = PersonalitySchema.safeParse(data)
  return parsed.success ? parsed.data : undefined
}

async function fetchRecentMessages(supabase: SupabaseClient, branchId: string): Promise<ProviderMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .limit(CONTEXT_WINDOWS.facilitation)

  // WR-05 fix (REVIEW.md): every other Supabase call in this file logs on failure; this one
  // silently degraded to an empty message list, letting the Coach run with zero conversational
  // context with no log line to diagnose why.
  if (error) {
    console.error('[trigger-engine] fetchRecentMessages error for branch', branchId, error.message)
    return []
  }

  return ((data ?? []) as Array<{ role: string | null; content: string }>)
    .reverse()
    .map((m) => ({
      role: (m.role === 'assistant' || m.role === 'system' ? m.role : 'user') as ProviderMessage['role'],
      content: m.content,
    }))
}

/** Read triggerMetadata.silence_gate.cooldown_until from the bot thread's checkpoint.
 *  Returns null (no cooldown) if the thread has no checkpoint yet or getState fails. */
async function readCooldownUntil(graph: CompiledGraph, threadId: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snapshot: any = await graph.getState({ configurable: { thread_id: threadId } })
    return snapshot?.values?.triggerMetadata?.silence_gate?.cooldown_until ?? null
  } catch (err) {
    console.warn(
      '[trigger-engine] getState failed for cooldown check (treating as no cooldown)',
      threadId,
      (err as Error).message
    )
    return null
  }
}

/** Write triggerMetadata.silence_gate.{last_fired_at, cooldown_until} into the bot thread
 *  checkpoint using the Blueprint's bot_cooldowns.coach.window_minutes — so the next tick
 *  honors TRIGGER-01 (at most once per cooldown window). facilitationAgentNode already writes
 *  last_fired_at as part of its own partial-state return (auto-checkpointed by graph.invoke);
 *  this only needs to add cooldown_until on top, preserving whatever last_fired_at the node
 *  just wrote. */
async function recordCooldown(graph: CompiledGraph, threadId: string, blueprint: Blueprint): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snapshot: any = await graph.getState({ configurable: { thread_id: threadId } })
    const currentMeta = snapshot?.values?.triggerMetadata ?? {}
    const windowMinutes = blueprint.bot_cooldowns?.coach?.window_minutes ?? DEFAULT_COACH_COOLDOWN_MINUTES
    const cooldownUntil = new Date(Date.now() + windowMinutes * 60_000).toISOString()

    await graph.updateState(
      { configurable: { thread_id: threadId } },
      {
        triggerMetadata: {
          ...currentMeta,
          silence_gate: {
            last_fired_at: currentMeta.silence_gate?.last_fired_at ?? new Date().toISOString(),
            cooldown_until: cooldownUntil,
          },
        },
      }
    )
  } catch (err) {
    console.error('[trigger-engine] failed to record cooldown for', threadId, (err as Error).message)
  }
}
