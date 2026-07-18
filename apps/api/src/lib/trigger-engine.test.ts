/**
 * trigger-engine.test.ts — Unit tests for the generalized TriggerEngine loop (TRIGGER-07,
 * inherited from Phase 11's D-15 interim single-trigger scan-loop module).
 *
 * Tests runSilenceScan's orchestration logic in isolation: mocks the Phase 10 chain
 * (checkSilenceGate/runArbitration/checkBotBudget/releaseBotLock), blueprint-loader, crypto,
 * Langfuse's CallbackHandler (mirrors ai.test.ts's mocking pattern), and a fake compiled graph
 * (invoke/getState/updateState) — no real DB/LLM. Covers the six behaviors from the plan:
 *   1. frozen-session skip (status !== 'active')
 *   2. typing/gate-not-passed skip
 *   3. cooldown-active skip
 *   4. arbitration-loss / budget-open skip
 *   5. single-insert-on-success + release-in-finally
 *   6. startTriggerEngine returns a stop function; calling it aborts the loop (no further ticks)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Blueprint } from '@panelito/types'

// ---------------------------------------------------------------------------
// Mocks — declared before any import that transitively uses them (hoisting)
// ---------------------------------------------------------------------------

vi.mock('./blueprint-loader', () => ({
  loadBlueprint: vi.fn(),
}))

vi.mock('./crypto', () => ({
  decryptKey: vi.fn().mockReturnValue('sk-test-plaintext-key'),
}))

vi.mock('./silence-gate', () => ({
  checkSilenceGate: vi.fn(),
}))

vi.mock('./bot-arbitrator', () => ({
  runArbitration: vi.fn(),
  releaseBotLock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./bot-budget', () => ({
  checkBotBudget: vi.fn(),
}))

vi.mock('./bot-registration', () => ({
  registerBots: vi.fn(),
}))

// D-03/D-04: phase-readiness Skill is reused as-is, never duplicated — mocked at the module
// boundary so the coupling tests assert wiring (called/not-called, guidance splice) without
// exercising the Skill's own internal N/M gate + coverage-judgment LLM logic (already covered
// by phase-readiness.test.ts).
vi.mock('./skills/phase-readiness', () => ({
  phaseReadinessSkill: {
    id: 'phase-readiness',
    role: 'analyst',
    detect: vi.fn(),
    buildPromptGuidance: vi.fn(),
  },
}))

// Mirrors ai.test.ts's own mocking of @langfuse/langchain — CallbackHandler is a real SDK
// class that reaches out to Langfuse config; tests never construct a real one.
vi.mock('@langfuse/langchain', () => ({
  CallbackHandler: vi.fn().mockImplementation(() => ({})),
}))

// Deterministic, controllable replacement for node:timers/promises' async-iterator setInterval
// (Behavior 6): yields exactly ONE tick immediately, then awaits forever until the AbortSignal
// fires, at which point it throws an AbortError — matching the real module's documented
// behavior closely enough to exercise startTriggerEngine's loop/stop-function contract without
// depending on real timer delays or sinon fake-timer support for node:timers/promises.
vi.mock('node:timers/promises', () => ({
  setInterval: async function* (
    _delay: number,
    _value: unknown,
    options?: { signal?: AbortSignal }
  ) {
    const signal = options?.signal
    yield undefined
    await new Promise<never>((_resolve, reject) => {
      const onAbort = (): void => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        reject(err)
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort)
    })
  },
}))

import { runSilenceScan, startTriggerEngine, COACH_AUTHOR_ID } from './trigger-engine'
import { loadBlueprint } from './blueprint-loader'
import { checkSilenceGate } from './silence-gate'
import { runArbitration, releaseBotLock } from './bot-arbitrator'
import { checkBotBudget } from './bot-budget'
import { registerBots } from './bot-registration'
import { phaseReadinessSkill } from './skills/phase-readiness'

const mockLoadBlueprint = vi.mocked(loadBlueprint)
const mockCheckSilenceGate = vi.mocked(checkSilenceGate)
const mockRunArbitration = vi.mocked(runArbitration)
const mockReleaseBotLock = vi.mocked(releaseBotLock)
const mockCheckBotBudget = vi.mocked(checkBotBudget)
const mockRegisterBots = vi.mocked(registerBots)
const mockPhaseReadinessDetect = vi.mocked(phaseReadinessSkill.detect)
const mockPhaseReadinessBuildGuidance = vi.mocked(phaseReadinessSkill.buildPromptGuidance)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const debateBlueprint: Blueprint = {
  id: 'debate-strategy-v1',
  name: 'Debate & Strategy',
  canvas_view_mode: 'graph',
  node_types: [{ id: 'claim', label: 'Claim', color: '#fff', description: 'A claim' }],
  edge_types: [{ id: 'supports', label: 'Supports', color: '#000' }],
  phase_sequence: [{ id: 'opening', label: 'Opening', llm_instructions: '...', allowed_node_types: ['claim'], phase_readiness_gate: { min_nodes: 3, min_messages_after: 5 } }],
  active_persona_ids: [],
  drift_reply_probability: 0.8,
  drift_detection_enabled: true,
  bot_defaults: { coach: true, analyst: true },
  role_personalities: { coach: 'coach_default', analyst: 'analyst_default' },
  bot_cooldowns: { coach: { max: 3, window_minutes: 15 }, analyst: { max: 2, window_minutes: 15 } },
  silence_phase_readiness_coupling_enabled: false,
}

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    status: 'active',
    creator_id: 'creator-1',
    blueprint_id: 'debate-strategy-v1',
    bot_overrides: {},
    current_phase: 'opening',
    ...overrides,
  }
}

function makeBranchRow(overrides: Record<string, unknown> = {}) {
  return { id: 'branch-1', path_id: 'main', ...overrides }
}

/** Fake compiled graph — invoke/getState/updateState, no real LangGraph/LLM. */
function buildFakeGraph(options: {
  invokeImpl?: (input: unknown, config: unknown) => Promise<unknown>
  cooldownUntil?: string | null
} = {}) {
  const invoke = vi.fn().mockImplementation(
    options.invokeImpl ??
      (async (_input: unknown, config: unknown) => {
        const cfg = config as { configurable?: { streamWriter?: (t: string) => void } }
        cfg?.configurable?.streamWriter?.('Miguel mencionó la evidencia — ¿qué opinan los demás?')
        return {}
      })
  )
  const getState = vi.fn().mockResolvedValue({
    values: {
      triggerMetadata: {
        silence_gate: {
          last_fired_at: null,
          cooldown_until: options.cooldownUntil ?? null,
        },
      },
    },
  })
  const updateState = vi.fn().mockResolvedValue(undefined)
  return { invoke, getState, updateState }
}

/** Minimal chainable Supabase mock — dispatches by table name. */
function buildSupabaseMock(config: {
  sessions?: unknown[]
  sessionsError?: unknown
  branches?: unknown[]
  creatorSettings?: Record<string, unknown> | null
  personalityRow?: Record<string, unknown> | null
  recentMessages?: Array<{ role: string; content: string }>
  insertResult?: { data: unknown; error: unknown }
}) {
  const insertResult = config.insertResult ?? {
    data: { id: 'msg-1', content: 'x', role: 'assistant' },
    error: null,
  }

  const httpSend = vi.fn().mockResolvedValue(undefined)
  const channel = vi.fn().mockReturnValue({ httpSend })

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'sessions') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: config.sessions ?? [], error: config.sessionsError ?? null }),
        }),
      }
    }
    if (table === 'branches') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: config.branches ?? [], error: null }),
          }),
        }),
      }
    }
    if (table === 'messages') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            neq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: config.recentMessages ?? [], error: null }),
              }),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(insertResult),
          }),
        }),
      }
    }
    if (table === 'creator_settings') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: config.creatorSettings ?? null, error: null }),
          }),
        }),
      }
    }
    if (table === 'personalities') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: config.personalityRow ?? null, error: null }),
          }),
        }),
      }
    }
    throw new Error(`buildSupabaseMock: unexpected table "${table}"`)
  })

  return { from, channel } as never
}

const defaultCreatorSettings = {
  anthropic_api_key: 'encrypted-blob',
  openai_api_key: null,
  gemini_api_key: null,
  active_provider: 'anthropic',
}

describe('trigger-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadBlueprint.mockResolvedValue(debateBlueprint)
    mockCheckSilenceGate.mockResolvedValue({ passed: true, presence_fallback: false })
    mockRunArbitration.mockResolvedValue('coach')
    mockCheckBotBudget.mockResolvedValue({ allowed: true, circuit_open: false, tokens_used_window: 0 })
    mockPhaseReadinessDetect.mockResolvedValue({ fires: false, confidence: 0 })
    mockPhaseReadinessBuildGuidance.mockReturnValue('')
  })

  it('Behavior 1: frozen session (status !== active) is skipped — no gate/arbitration/invoke call', async () => {
    const supabase = buildSupabaseMock({
      sessions: [makeSessionRow({ status: 'frozen' })],
      branches: [makeBranchRow()],
      creatorSettings: defaultCreatorSettings,
    })
    const graph = buildFakeGraph()

    await runSilenceScan(supabase, graph as never)

    expect(mockCheckSilenceGate).not.toHaveBeenCalled()
    expect(mockRunArbitration).not.toHaveBeenCalled()
    expect(graph.invoke).not.toHaveBeenCalled()
  })

  it('Behavior 2: silence gate not passed (typing / too_soon) — skip, no arbitration/invoke', async () => {
    mockCheckSilenceGate.mockResolvedValue({ passed: false, reason: 'typing', presence_fallback: false })
    const supabase = buildSupabaseMock({
      sessions: [makeSessionRow()],
      branches: [makeBranchRow()],
      creatorSettings: defaultCreatorSettings,
    })
    const graph = buildFakeGraph()

    await runSilenceScan(supabase, graph as never)

    expect(mockCheckSilenceGate).toHaveBeenCalledTimes(1)
    expect(mockRunArbitration).not.toHaveBeenCalled()
    expect(graph.invoke).not.toHaveBeenCalled()
  })

  it('Behavior 3: cooldown still active on the bot thread — skip, no arbitration/invoke', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const supabase = buildSupabaseMock({
      sessions: [makeSessionRow()],
      branches: [makeBranchRow()],
      creatorSettings: defaultCreatorSettings,
    })
    const graph = buildFakeGraph({ cooldownUntil: future })

    await runSilenceScan(supabase, graph as never)

    expect(graph.getState).toHaveBeenCalledWith({ configurable: { thread_id: 'branch-1:bot' } })
    expect(mockRunArbitration).not.toHaveBeenCalled()
    expect(graph.invoke).not.toHaveBeenCalled()
  })

  it('Behavior 4a: Coach loses arbitration — no invoke, no message insert', async () => {
    mockRunArbitration.mockResolvedValue('analyst')
    const supabase = buildSupabaseMock({
      sessions: [makeSessionRow()],
      branches: [makeBranchRow()],
      creatorSettings: defaultCreatorSettings,
    })
    const graph = buildFakeGraph()

    await runSilenceScan(supabase, graph as never)

    expect(mockRunArbitration).toHaveBeenCalledTimes(1)
    expect(mockCheckBotBudget).not.toHaveBeenCalled()
    expect(graph.invoke).not.toHaveBeenCalled()
  })

  it('Behavior 4b: budget circuit open — no invoke, no message insert, lock still released', async () => {
    mockCheckBotBudget.mockResolvedValue({ allowed: false, circuit_open: true, tokens_used_window: 5000 })
    const supabase = buildSupabaseMock({
      sessions: [makeSessionRow()],
      branches: [makeBranchRow()],
      creatorSettings: defaultCreatorSettings,
    })
    const graph = buildFakeGraph()

    await runSilenceScan(supabase, graph as never)

    expect(mockCheckBotBudget).toHaveBeenCalledTimes(1)
    expect(graph.invoke).not.toHaveBeenCalled()
    expect(mockReleaseBotLock).toHaveBeenCalledWith('branch-1', supabase)
  })

  it('Behavior 5: success path — exactly one message insert (assistant/Facilitador), bot thread_id, cooldown recorded, lock released in finally', async () => {
    const insertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'msg-1' }, error: null }),
      }),
    })
    const supabase = buildSupabaseMock({
      sessions: [makeSessionRow()],
      branches: [makeBranchRow()],
      creatorSettings: defaultCreatorSettings,
      personalityRow: { id: 'coach_default', name: 'Facilitador', definition: { language: 'es', formality: 'informal', voice_instructions: 'x', catchphrases: [] } },
    })
    // Override messages.insert to a dedicated spy so we can assert call shape precisely.
    const originalFrom = (supabase as { from: (t: string) => unknown }).from as ReturnType<typeof vi.fn>
    originalFrom.mockImplementation((table: string) => {
      if (table === 'messages') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
          insert: insertSpy,
        }
      }
      if (table === 'sessions') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [makeSessionRow()], error: null }) }) }
      }
      if (table === 'branches') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [makeBranchRow()], error: null }) }),
          }),
        }
      }
      if (table === 'creator_settings') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: defaultCreatorSettings, error: null }) }),
          }),
        }
      }
      if (table === 'personalities') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'coach_default', name: 'Facilitador', definition: { language: 'es', formality: 'informal', voice_instructions: 'x', catchphrases: [] } },
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    const graph = buildFakeGraph()

    await runSilenceScan(supabase, graph as never)

    expect(graph.invoke).toHaveBeenCalledTimes(1)
    const [invokeInput, invokeConfig] = graph.invoke.mock.calls[0] as [
      { triggerType: string },
      { configurable: { thread_id: string; personality?: unknown } }
    ]
    expect(invokeInput.triggerType).toBe('silence_gate')
    expect(invokeConfig.configurable.thread_id).toBe('branch-1:bot')

    expect(insertSpy).toHaveBeenCalledTimes(1)
    const insertArg = insertSpy.mock.calls[0]![0] as Record<string, unknown>
    expect(insertArg.role).toBe('assistant')
    expect(insertArg.display_name).toBe('Facilitador')
    expect(insertArg.branch_id).toBe('branch-1')
    expect(insertArg.author_id).toBe(COACH_AUTHOR_ID)
    expect(insertArg.author_id).not.toBe('creator-1')

    // Cooldown recorded via graph.updateState (next tick honors TRIGGER-01)
    expect(graph.updateState).toHaveBeenCalledTimes(1)
    const [, updateValues] = graph.updateState.mock.calls[0] as [unknown, { triggerMetadata: { silence_gate: { cooldown_until: string } } }]
    expect(updateValues.triggerMetadata.silence_gate.cooldown_until).toBeTruthy()

    // Lock released in finally regardless of success
    expect(mockReleaseBotLock).toHaveBeenCalledWith('branch-1', supabase)
  })

  it('Behavior 6: startTriggerEngine registers bots once, returns a callable stop function, and calling it aborts the loop (a subsequent tick does not run)', async () => {
    const supabase = buildSupabaseMock({ sessions: [], branches: [] })
    const sessionsFrom = (supabase as unknown as { from: ReturnType<typeof vi.fn> }).from
    const graph = buildFakeGraph()

    const stop = await startTriggerEngine(supabase, graph as never)

    expect(mockRegisterBots).toHaveBeenCalledTimes(1)
    expect(typeof stop).toBe('function')

    // The mocked node:timers/promises setInterval yields exactly ONE tick immediately, then
    // awaits forever until aborted — allow that first tick's runSilenceScan to complete.
    await new Promise((resolve) => setTimeout(resolve, 10))
    const callsAfterFirstTick = sessionsFrom.mock.calls.filter((call) => call[0] === 'sessions').length
    expect(callsAfterFirstTick).toBeGreaterThanOrEqual(1)

    stop()

    // Allow the abort to propagate through the loop's outer try/catch (AbortError swallowed).
    await new Promise((resolve) => setTimeout(resolve, 10))
    const callsAfterStop = sessionsFrom.mock.calls.filter((call) => call[0] === 'sessions').length
    expect(callsAfterStop).toBe(callsAfterFirstTick) // no further ticks ran after stop()
  })

  // -------------------------------------------------------------------------
  // D-03/D-04: Blueprint-opt-in phase-readiness coupling on silence fires
  // -------------------------------------------------------------------------

  it('phase-readiness coupling toggle OFF (default) — phaseReadinessSkill.detect is NOT called on a silence fire', async () => {
    // debateBlueprint fixture already has silence_phase_readiness_coupling_enabled: false
    const supabase = buildSupabaseMock({
      sessions: [makeSessionRow()],
      branches: [makeBranchRow()],
      creatorSettings: defaultCreatorSettings,
    })
    const graph = buildFakeGraph()

    await runSilenceScan(supabase, graph as never)

    expect(graph.invoke).toHaveBeenCalledTimes(1) // silence fire still happens normally
    expect(mockPhaseReadinessDetect).not.toHaveBeenCalled()
    expect(mockPhaseReadinessBuildGuidance).not.toHaveBeenCalled()
  })

  it('phase-readiness coupling toggle ON — phaseReadinessSkill.detect IS called, and its buildPromptGuidance() text reaches the fired prompt path (graph.invoke messages)', async () => {
    const coupledBlueprint: Blueprint = { ...debateBlueprint, silence_phase_readiness_coupling_enabled: true }
    mockLoadBlueprint.mockResolvedValue(coupledBlueprint)
    mockPhaseReadinessDetect.mockResolvedValue({ fires: true, confidence: 0.9 })
    mockPhaseReadinessBuildGuidance.mockReturnValue(
      '¿Sienten que el grupo está listo para avanzar a la siguiente fase?'
    )

    const supabase = buildSupabaseMock({
      sessions: [makeSessionRow()],
      branches: [makeBranchRow()],
      creatorSettings: defaultCreatorSettings,
    })
    const graph = buildFakeGraph()

    await runSilenceScan(supabase, graph as never)

    expect(mockPhaseReadinessDetect).toHaveBeenCalledTimes(1)
    expect(mockPhaseReadinessBuildGuidance).toHaveBeenCalledTimes(1)

    // Advisory-only invariant (HUMAN-02/T-13-11): the coupling call context never carries a
    // Supabase client capable of writing sessions.current_phase — only serviceClient/branchId/
    // providerName/plaintextKey are threaded through, matching phaseReadinessSkill's own
    // read-only canvas_nodes count query contract.
    const detectContext = mockPhaseReadinessDetect.mock.calls[0]![0]
    expect(detectContext.config.configurable.branchId).toBe('branch-1')

    expect(graph.invoke).toHaveBeenCalledTimes(1)
    const [invokeInput] = graph.invoke.mock.calls[0] as [{ messages: Array<{ role: string; content: string }> }]
    const guidanceMessage = invokeInput.messages.find((m) =>
      m.content.includes('¿Sienten que el grupo está listo para avanzar a la siguiente fase?')
    )
    expect(guidanceMessage).toBeDefined()
    expect(guidanceMessage?.role).toBe('user')
  })

  it('CR-02-followup: coupling call forces min_messages_after to 0 on the active phase (node-count-only gate), leaves min_nodes and the original Blueprint untouched', async () => {
    // debateBlueprint fixture's 'opening' phase has phase_readiness_gate: { min_nodes: 3,
    // min_messages_after: 5 } — zero prior messages recorded is exactly the scenario CR-02
    // originally left permanently unreachable (0 < 5 forever). Assert the Blueprint object
    // phaseReadinessSkill.detect() actually receives on this silence-triggered call site has
    // min_messages_after forced to 0 (so detect() is no longer blocked by message count),
    // while min_nodes is preserved from the real Blueprint and the original Blueprint
    // reference/array is never mutated in place.
    const coupledBlueprint: Blueprint = { ...debateBlueprint, silence_phase_readiness_coupling_enabled: true }
    const originalGate = coupledBlueprint.phase_sequence[0]!.phase_readiness_gate
    mockLoadBlueprint.mockResolvedValue(coupledBlueprint)
    mockPhaseReadinessDetect.mockResolvedValue({ fires: false, confidence: 0 })

    const supabase = buildSupabaseMock({
      sessions: [makeSessionRow()],
      branches: [makeBranchRow()],
      creatorSettings: defaultCreatorSettings,
    })
    const graph = buildFakeGraph()

    await runSilenceScan(supabase, graph as never)

    expect(mockPhaseReadinessDetect).toHaveBeenCalledTimes(1)
    const detectContext = mockPhaseReadinessDetect.mock.calls[0]![0]
    const effectivePhase = detectContext.blueprint.phase_sequence.find((p) => p.id === 'opening')
    expect(effectivePhase?.phase_readiness_gate).toEqual({ min_nodes: 3, min_messages_after: 0 })

    // Non-mutating: the original Blueprint object (as loaded/held by the caller) must be
    // untouched — same reference passed to loadBlueprint's mock, gate config unchanged.
    expect(coupledBlueprint.phase_sequence[0]!.phase_readiness_gate).toEqual(originalGate)
    expect(coupledBlueprint.phase_sequence[0]!.phase_readiness_gate.min_messages_after).toBe(5)
  })

  it('phase-readiness coupling toggle ON but Skill does not fire — no guidance is spliced into graph.invoke messages', async () => {
    const coupledBlueprint: Blueprint = { ...debateBlueprint, silence_phase_readiness_coupling_enabled: true }
    mockLoadBlueprint.mockResolvedValue(coupledBlueprint)
    mockPhaseReadinessDetect.mockResolvedValue({ fires: false, confidence: 0.2 })

    const supabase = buildSupabaseMock({
      sessions: [makeSessionRow()],
      branches: [makeBranchRow()],
      creatorSettings: defaultCreatorSettings,
    })
    const graph = buildFakeGraph()

    await runSilenceScan(supabase, graph as never)

    expect(mockPhaseReadinessDetect).toHaveBeenCalledTimes(1)
    expect(mockPhaseReadinessBuildGuidance).not.toHaveBeenCalled()
    expect(graph.invoke).toHaveBeenCalledTimes(1)
    const [invokeInput] = graph.invoke.mock.calls[0] as [{ messages: Array<{ role: string; content: string }> }]
    expect(invokeInput.messages.some((m) => m.content.includes('Nota interna del sistema'))).toBe(false)
  })
})
