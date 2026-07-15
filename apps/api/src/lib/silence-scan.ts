/**
 * silence-scan.ts — interim single-trigger (silence-gate only) scan loop (D-15, TRIGGER-01).
 *
 * Phase 11 ships the first LIVE trigger: an async setInterval loop that, per active branch
 * of every active session, runs the Phase 10 chain (checkSilenceGate -> runArbitration ->
 * checkBotBudget) and — when all three pass and the Coach bot is enabled for the session —
 * invokes the graph on the BOT thread (`${branchId}:bot`, never the human thread — BOT-04)
 * and inserts a content-aware Coach message directly into `messages` (D-16: no SSE, there is
 * no active HTTP request to stream a proactively-fired message over).
 *
 * This is deliberately minimal (D-15): a single trigger type, no persistent multi-trigger
 * TriggerEngine. Phase 14 (TRIGGER-07) generalizes this into the full 6-trigger engine; some
 * rework here is expected and accepted.
 *
 * Frozen-session guard (Critical Failure Mode 6): none of the three reused Phase 10 primitives
 * (checkSilenceGate/runArbitration/checkBotBudget) check session.status — this loop owns that
 * check, both at the query level (.eq('status','active')) and defensively in code.
 *
 * Cooldown enforcement (TRIGGER-01 success criterion 3 — fires at most once per cooldown
 * window): read from the BOT thread's own checkpoint (triggerMetadata.silence_gate.cooldown_
 * until), not from application memory — memory does not survive a server restart, PostgresSaver
 * checkpoints do (BOT-05).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Blueprint, Personality, ProviderMessage, ProviderName } from '@panelito/types'
import { PersonalitySchema, ProviderSchema } from '@panelito/types'
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

type CompiledGraph = ReturnType<typeof createGraph>

// ---------------------------------------------------------------------------
// Constants — env-var overrides, min-floor warnings (auto-freeze.ts pattern)
// ---------------------------------------------------------------------------

/** How often the scan tick runs. Default 15s. */
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS ?? '15000', 10)
const SCAN_INTERVAL_FLOOR_MS = 5_000
if (SCAN_INTERVAL_MS < SCAN_INTERVAL_FLOOR_MS) {
  console.warn(
    `[silence-scan] WARNING: SCAN_INTERVAL_MS=${SCAN_INTERVAL_MS} is below the recommended minimum of ${SCAN_INTERVAL_FLOOR_MS}. ` +
    'This should only be set in test environments.'
  )
}

/** How long a branch must be silent (no message + no typing) before the gate can pass. */
const SILENCE_THRESHOLD_MS = parseInt(process.env.SILENCE_THRESHOLD_MS ?? '60000', 10)
const SILENCE_THRESHOLD_FLOOR_MS = 10_000
if (SILENCE_THRESHOLD_MS < SILENCE_THRESHOLD_FLOOR_MS) {
  console.warn(
    `[silence-scan] WARNING: SILENCE_THRESHOLD_MS=${SILENCE_THRESHOLD_MS} is below the recommended minimum of ${SILENCE_THRESHOLD_FLOOR_MS}. ` +
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
 * startSilenceScanLoop — run once at API boot (server.ts, alongside startAutoFreezeTracker).
 *
 * Registers the Coach/Analyst bots with the arbitrator, resolves a default graph (PostgresSaver
 * checkpointer) if none is supplied, then starts an async setInterval loop. The callback MUST
 * be async and MUST await runSilenceScan (Failure Mode 3 / AI-SPEC 4b.2) — an un-awaited call
 * would allow overlapping ticks, racing the cooldown check.
 *
 * @param supabase - Service-role Supabase client.
 * @param graph - Optional pre-built compiled graph (test seam). Defaults to
 *   createGraph(await getCheckpointer()), matching how ai.ts constructs graph+checkpointer.
 */
export async function startSilenceScanLoop(
  supabase: SupabaseClient,
  graph?: CompiledGraph
): Promise<void> {
  registerBots()

  const resolvedGraph = graph ?? createGraph(await getCheckpointer())

  setInterval(async () => {
    try {
      await runSilenceScan(supabase, resolvedGraph)
    } catch (err) {
      console.error('[silence-scan] uncaught error in scan tick', err)
    }
  }, SCAN_INTERVAL_MS)

  console.log(
    `[silence-scan] scan loop started (interval: ${SCAN_INTERVAL_MS}ms, silence threshold: ${SILENCE_THRESHOLD_MS}ms)`
  )
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
    console.error('[silence-scan] sessions query error:', sessionsError.message)
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
    console.error('[silence-scan] blueprint load failed for session', session.id, (err as Error).message)
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
    console.error('[silence-scan] branches query error for session', session.id, branchesError.message)
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
    console.info('[silence-scan] cooldown active for', branch.id, 'until', cooldownUntil)
    return
  }

  const winner = await runArbitration(branch.id, blueprint, supabase)
  if (winner !== 'coach') return

  try {
    const budget = await checkBotBudget(supabase, branch.id, ESTIMATED_COACH_FIRE_TOKENS)
    if (!budget.allowed) {
      console.warn('[silence-scan] budget guard denied Coach fire for branch', branch.id, {
        circuit_open: budget.circuit_open,
      })
      return
    }

    const recentMessages = await fetchRecentMessages(supabase, branch.id)

    let accumulatedText = ''
    const streamWriter = (text: string): void => {
      accumulatedText += text
    }

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
        },
      }
    )

    if (accumulatedText.trim().length === 0) {
      console.warn('[silence-scan] Coach produced no text for branch', branch.id, '- skipping insert')
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
      console.error('[silence-scan] message insert error for branch', branch.id, insertError?.message)
    } else {
      supabase
        .channel(`session:${session.id}`)
        .httpSend('new_message', row)
        .catch((err: unknown) => console.error('[silence-scan] broadcast failed', err))
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
    console.error('[silence-scan] key decrypt error:', (err as Error).constructor.name)
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
    console.error('[silence-scan] fetchRecentMessages error for branch', branchId, error.message)
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
      '[silence-scan] getState failed for cooldown check (treating as no cooldown)',
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
    console.error('[silence-scan] failed to record cooldown for', threadId, (err as Error).message)
  }
}
