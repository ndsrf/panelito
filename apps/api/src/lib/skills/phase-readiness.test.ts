/**
 * phase-readiness.test.ts — Unit tests for the phase-readiness Analyst Skill (TRIGGER-02,
 * D-07/D-08/D-09/D-10).
 *
 * Covers the plan's <behavior> block:
 *   1. progress resets to a fresh object when phaseGateProgress is null or belongs to a
 *      different phaseId
 *   2. committed count below min_nodes -> no-fire, ZERO adapter.stream calls
 *   3. committed count at/above min_nodes but message count below min_messages_after ->
 *      no-fire, ZERO adapter.stream calls, messagesSinceGateOpen incremented in meta
 *   4. both thresholds crossed -> the coverage-judgment call fires exactly once, resolving
 *      TASK_MODELS[provider].analysis (never .classification), for anthropic AND openai
 *      (T-13-10 tier-regression guard)
 *   5. committed count is read from canvas_nodes.status='committed' (Supabase), NEVER from
 *      state.argGraph (mirrors orphan-edge.ts's own guard)
 *   6. malformed/absent tool output over MAX_ATTEMPTS fails closed (T-13-09)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import type { AIProvider, AIStreamEvent, Blueprint, ProviderName } from '@panelito/types'
import { phaseReadinessSkill } from './phase-readiness'
import { TASK_MODELS } from '../model-config'
import type { GraphState } from '../../graph/state'
import type { SkillContext } from '../skills'

// ---------------------------------------------------------------------------
// Mock adapter builder (mirrors fact-check.test.ts's createMockAdapter)
// ---------------------------------------------------------------------------

function createMockAdapter(eventsPerCall: AIStreamEvent[][]): { adapter: AIProvider; callModels: string[] } {
  let call = 0
  const callModels: string[] = []
  const adapter: AIProvider = {
    capabilities: () => ({
      streaming: true,
      toolUse: true,
      contextCaching: false,
      semanticCaching: false,
      imageInput: false,
      voiceInput: false,
      compression: false,
    }),
    async *stream(_messages, _tools, options): AsyncIterable<AIStreamEvent> {
      callModels.push(options.model)
      const events = eventsPerCall[Math.min(call, eventsPerCall.length - 1)] ?? []
      call += 1
      for (const event of events) {
        yield event
      }
    },
  }
  return { adapter, callModels }
}

function makeSpyAdapter(streamSpy: ReturnType<typeof vi.fn>): AIProvider {
  return {
    capabilities: () => ({
      streaming: true,
      toolUse: true,
      contextCaching: false,
      semanticCaching: false,
      imageInput: false,
      voiceInput: false,
      compression: false,
    }),
    stream: streamSpy as unknown as AIProvider['stream'],
  }
}

// ---------------------------------------------------------------------------
// Supabase count-query chain-mock builder (mirrors orphan-edge.test.ts convention)
// ---------------------------------------------------------------------------

function buildSupabaseMock(result: { count: number | null; error: { message: string } | null }) {
  const eq2 = vi.fn().mockResolvedValue(result)
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  const from = vi.fn((table: string) => {
    if (table === 'canvas_nodes') return { select }
    throw new Error(`unexpected table: ${table}`)
  })
  return { from, select, eq1, eq2 }
}

function baseGraphState(overrides: Partial<GraphState> = {}): GraphState {
  return {
    blueprintId: 'debate-strategy-v1',
    currentPhaseId: 'opening',
    messages: [],
    canvasOps: [],
    guardrailResult: null,
    agentConfidence: null,
    driftAction: null,
    agentOutput: null,
    steeringTextEnabled: null,
    phase_signal: null,
    argGraph: { nodes: [], edges: [] },
    triggerMetadata: {},
    triggerType: null,
    firingSkillId: null,
    firingSkillRole: null,
    skillMeta: null,
    triggerGateComplete: null,
    phaseGateProgress: null,
    roleInvocationCounts: {},
    ...overrides,
  }
}

const blueprintStub: Blueprint = {
  id: 'debate-strategy-v1',
  name: 'Debate & Strategy',
  canvas_view_mode: 'graph',
  node_types: [{ id: 'claim', label: 'Claim', color: '#fff', description: 'A claim' }],
  edge_types: [{ id: 'supports', label: 'Supports', color: '#000' }],
  phase_sequence: [
    {
      id: 'opening',
      label: 'Opening',
      llm_instructions: 'Discuss the opening topic broadly.',
      allowed_node_types: ['claim'],
      phase_readiness_gate: { min_nodes: 3, min_messages_after: 2 },
    },
  ],
  active_persona_ids: [],
  drift_reply_probability: 0.8,
  drift_detection_enabled: true,
  bot_defaults: {},
  role_personalities: {},
  silence_phase_readiness_coupling_enabled: false,
}

function makeContext(
  supabase: unknown,
  opts: {
    adapter?: AIProvider
    providerName?: ProviderName
    stateOverrides?: Partial<GraphState>
  } = {}
): SkillContext {
  return {
    state: baseGraphState({ ...opts.stateOverrides }),
    blueprint: blueprintStub,
    config: {
      configurable: {
        branchId: 'branch-1',
        serviceClient: supabase,
        providerName: opts.providerName ?? 'anthropic',
        plaintextKey: 'test-key',
        phaseReadinessAdapter: opts.adapter,
      },
    },
  }
}

describe('phaseReadinessSkill', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('id/role match the Skill contract', () => {
    expect(phaseReadinessSkill.id).toBe('phase-readiness')
    expect(phaseReadinessSkill.role).toBe('analyst')
  })

  // -------------------------------------------------------------------------
  // 1. Progress reset behavior
  // -------------------------------------------------------------------------

  it('resets progress to a fresh object when phaseGateProgress is null', async () => {
    const { from } = buildSupabaseMock({ count: 2, error: null })
    const context = makeContext({ from }, { stateOverrides: { phaseGateProgress: null } })

    const result = await phaseReadinessSkill.detect(context)

    expect(result.meta?.phaseGateProgress).toEqual({
      phaseId: 'opening',
      nodeCountAtGateOpen: 0,
      messagesSinceGateOpen: 0,
    })
  })

  it('resets progress when existing phaseGateProgress belongs to a different phaseId', async () => {
    const { from } = buildSupabaseMock({ count: 2, error: null })
    const context = makeContext(
      { from },
      {
        stateOverrides: {
          phaseGateProgress: { phaseId: 'previous-phase', nodeCountAtGateOpen: 99, messagesSinceGateOpen: 99 },
        },
      }
    )

    const result = await phaseReadinessSkill.detect(context)

    expect(result.meta?.phaseGateProgress).toEqual({
      phaseId: 'opening',
      nodeCountAtGateOpen: 0,
      messagesSinceGateOpen: 0,
    })
  })

  // -------------------------------------------------------------------------
  // 2. committed count below min_nodes -> no-fire, ZERO adapter calls
  // -------------------------------------------------------------------------

  it('does not fire when committed count is below min_nodes — ZERO adapter.stream calls', async () => {
    const { from, eq1, eq2 } = buildSupabaseMock({ count: 2, error: null })
    const streamSpy = vi.fn()
    const context = makeContext({ from }, { adapter: makeSpyAdapter(streamSpy) })

    const result = await phaseReadinessSkill.detect(context)

    expect(result.fires).toBe(false)
    expect(result.confidence).toBe(0)
    expect(streamSpy).not.toHaveBeenCalled()
    expect(eq1).toHaveBeenCalledWith('branch_id', 'branch-1')
    expect(eq2).toHaveBeenCalledWith('status', 'committed')
  })

  // -------------------------------------------------------------------------
  // 3. gate open but message count below min_messages_after -> no-fire, ZERO adapter calls
  // -------------------------------------------------------------------------

  it('gate open (committed >= min_nodes) but message count below min_messages_after — ZERO adapter calls, increments messagesSinceGateOpen', async () => {
    const { from } = buildSupabaseMock({ count: 3, error: null })
    const streamSpy = vi.fn()
    const context = makeContext(
      { from },
      {
        adapter: makeSpyAdapter(streamSpy),
        stateOverrides: {
          phaseGateProgress: { phaseId: 'opening', nodeCountAtGateOpen: 0, messagesSinceGateOpen: 0 },
        },
      }
    )
    // gate min_messages_after: 2 -> messagesSinceGateOpen becomes 1 < 2 -> no fire

    const result = await phaseReadinessSkill.detect(context)

    expect(result.fires).toBe(false)
    expect(result.meta?.phaseGateProgress).toEqual({
      phaseId: 'opening',
      nodeCountAtGateOpen: 0,
      messagesSinceGateOpen: 1,
    })
    expect(streamSpy).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 4. both thresholds crossed -> coverage-judgment call fires exactly once,
  //    TASK_MODELS[provider].analysis, for anthropic AND openai (T-13-10)
  // -------------------------------------------------------------------------

  it('both thresholds crossed — coverage-judgment call resolves TASK_MODELS[provider].analysis for anthropic and openai', async () => {
    const providers: ProviderName[] = ['anthropic', 'openai']

    for (const providerName of providers) {
      const { from } = buildSupabaseMock({ count: 3, error: null })
      const { adapter, callModels } = createMockAdapter([
        [{ type: 'tool_use', name: 'judge_phase_readiness', input: { sufficient: true, confidence: 0.9 } }],
      ])
      const context = makeContext(
        { from },
        {
          adapter,
          providerName,
          stateOverrides: {
            phaseGateProgress: { phaseId: 'opening', nodeCountAtGateOpen: 0, messagesSinceGateOpen: 1 },
          },
        }
      )

      const result = await phaseReadinessSkill.detect(context)

      expect(result.fires).toBe(true)
      expect(result.confidence).toBe(0.9)
      expect(result.meta?.phaseGateProgress).toBeNull()
      expect(callModels).toEqual([TASK_MODELS[providerName].analysis])
      expect(callModels).not.toEqual([TASK_MODELS[providerName].classification])
    }
  })

  it('sufficient=false retains progress (no reset) and does not fire', async () => {
    const { from } = buildSupabaseMock({ count: 3, error: null })
    const { adapter, callModels } = createMockAdapter([
      [{ type: 'tool_use', name: 'judge_phase_readiness', input: { sufficient: false, confidence: 0.3 } }],
    ])
    const context = makeContext(
      { from },
      {
        adapter,
        stateOverrides: {
          phaseGateProgress: { phaseId: 'opening', nodeCountAtGateOpen: 0, messagesSinceGateOpen: 1 },
        },
      }
    )

    const result = await phaseReadinessSkill.detect(context)

    expect(result.fires).toBe(false)
    expect(result.confidence).toBe(0.3)
    expect(result.meta?.phaseGateProgress).toEqual({
      phaseId: 'opening',
      nodeCountAtGateOpen: 0,
      messagesSinceGateOpen: 2,
    })
    expect(callModels).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // 5. committed count sourced from canvas_nodes.status='committed', never argGraph
  // -------------------------------------------------------------------------

  it('never reads state.argGraph for committed-node counting — source-level check', async () => {
    const source = await readFile(path.join(__dirname, './phase-readiness.ts'), 'utf-8')
    expect(source).toMatch(/canvas_nodes/)
    expect(source).toMatch(/['"]status['"]\s*,\s*['"]committed['"]/)
    // Checks the actual assignment expression, not doc-comment prose describing the
    // anti-pattern (this file's own header comment explains WHY argGraph is not used).
    expect(source).not.toMatch(/committedCount\s*=\s*[^\n;]*argGraph/)
  })

  it('a poisoned state.argGraph does not affect the committed-count gate decision', async () => {
    const { from } = buildSupabaseMock({ count: 2, error: null })
    const context = makeContext(
      { from },
      {
        stateOverrides: {
          argGraph: {
            nodes: Array.from({ length: 50 }, (_, i) => ({
              id: `poison-${i}`,
              type: 'claim',
              label: 'poison',
              branch_id: 'b1',
              message_id: 'm1',
              speaker: 'Someone',
            })),
            edges: [],
          },
        },
      }
    )

    const result = await phaseReadinessSkill.detect(context)

    // Supabase mock says count=2 (< min_nodes=3) — the gate must stay closed regardless
    // of argGraph's 50-node poison payload.
    expect(result.fires).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 6. malformed/absent tool output over MAX_ATTEMPTS fails closed (T-13-09)
  // -------------------------------------------------------------------------

  it('malformed tool output over MAX_ATTEMPTS fails CLOSED', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { from } = buildSupabaseMock({ count: 3, error: null })
    const { adapter, callModels } = createMockAdapter([
      [{ type: 'tool_use', name: 'judge_phase_readiness', input: { sufficient: 'not-a-boolean' } }],
      [{ type: 'tool_use', name: 'judge_phase_readiness', input: { sufficient: 'still-bad' } }],
    ])
    const context = makeContext(
      { from },
      {
        adapter,
        stateOverrides: {
          phaseGateProgress: { phaseId: 'opening', nodeCountAtGateOpen: 0, messagesSinceGateOpen: 1 },
        },
      }
    )

    const result = await phaseReadinessSkill.detect(context)

    expect(result).toEqual({ fires: false, confidence: 0 })
    expect(callModels).toHaveLength(2)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('absent tool_use event over MAX_ATTEMPTS fails CLOSED', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { from } = buildSupabaseMock({ count: 3, error: null })
    const { adapter, callModels } = createMockAdapter([[], []])
    const context = makeContext(
      { from },
      {
        adapter,
        stateOverrides: {
          phaseGateProgress: { phaseId: 'opening', nodeCountAtGateOpen: 0, messagesSinceGateOpen: 1 },
        },
      }
    )

    const result = await phaseReadinessSkill.detect(context)

    expect(result).toEqual({ fires: false, confidence: 0 })
    expect(callModels).toHaveLength(2)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // Fail-closed guards
  // -------------------------------------------------------------------------

  it('missing branchId yields no-fire without throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const context: SkillContext = {
      state: baseGraphState(),
      blueprint: blueprintStub,
      config: { configurable: { serviceClient: { from: vi.fn() } } },
    }

    const result = await phaseReadinessSkill.detect(context)

    expect(result).toEqual({ fires: false, confidence: 0 })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('canvas_nodes query error yields no-fire without throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { from } = buildSupabaseMock({ count: null, error: { message: 'DB error' } })
    const context = makeContext({ from })

    const result = await phaseReadinessSkill.detect(context)

    expect(result).toEqual({ fires: false, confidence: 0 })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('no adapter available once both thresholds cross — fails closed without throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { from } = buildSupabaseMock({ count: 3, error: null })
    const context: SkillContext = {
      state: baseGraphState({
        phaseGateProgress: { phaseId: 'opening', nodeCountAtGateOpen: 0, messagesSinceGateOpen: 1 },
      }),
      blueprint: blueprintStub,
      config: { configurable: { branchId: 'branch-1', serviceClient: { from } } },
    }

    const result = await phaseReadinessSkill.detect(context)

    expect(result).toEqual({ fires: false, confidence: 0 })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // buildPromptGuidance — Pattern 3: no summarizeParticipant() call (no single target)
  // -------------------------------------------------------------------------

  describe('buildPromptGuidance', () => {
    it('asks the group whether they are ready to advance, references the phase, never advances it', () => {
      const context = makeContext({ from: vi.fn() })

      const guidance = phaseReadinessSkill.buildPromptGuidance(context)

      expect(guidance.toLowerCase()).toContain('advance')
      expect(guidance).toContain('Opening')
      expect(guidance.toLowerCase()).toContain('human')
    })

    it('does not import summarizeParticipant (Pattern 3 — no single target participant)', async () => {
      const source = await readFile(path.join(__dirname, './phase-readiness.ts'), 'utf-8')
      // Checks the actual import statement, not doc-comment prose explaining WHY this
      // Skill deliberately does not call summarizeParticipant() (Pattern 3).
      expect(source).not.toMatch(/import\s*\{[^}]*summarizeParticipant[^}]*\}\s*from/)
    })
  })
})
