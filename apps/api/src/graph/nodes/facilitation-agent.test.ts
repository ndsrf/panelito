/**
 * facilitation-agent.test.ts — FacilitationAgentNode (Coach) unit tests (Phase 11 Plan 04, Task 1)
 *
 * Covers:
 *   - buildCoachSystemPrompt: Role rules structurally BEFORE Personality voice (D-03, Pitfall 4)
 *   - buildCoachSystemPrompt: >=2 Spanish BAD/GOOD few-shot pairs present
 *   - buildCoachSystemPrompt: summarizeArgGraph(argGraph) content injected (D-13/D-14)
 *   - facilitationAgentNode: fail-silent on missing blueprint / adapter error (never throws)
 *   - facilitationAgentNode: routes model through TASK_MODELS[...].facilitation
 *   - facilitationAgentNode: triggerMetadata.silence_gate.last_fired_at updated on success
 */

import { describe, it, expect, vi } from 'vitest'
import type { AIProvider, AIStreamEvent, Blueprint, Personality } from '@panelito/types'
import { TASK_MODELS } from '../../lib/model-config'
import { buildCoachSystemPrompt, facilitationAgentNode } from './facilitation-agent'
import { driftRedirectSkill } from '../../lib/skills/drift-redirect'
import type { GraphState } from '../state'

function createMockAdapter(
  events: AIStreamEvent[],
  captureOptions?: (options: { model: string; maxTokens: number; system?: string }) => void
): AIProvider {
  return {
    capabilities: () => ({
      streaming: true,
      toolUse: false,
      contextCaching: false,
      semanticCaching: false,
      imageInput: false,
      voiceInput: false,
      compression: false,
    }),
    async *stream(_messages, _tools, options): AsyncIterable<AIStreamEvent> {
      captureOptions?.(options)
      for (const event of events) {
        yield event
      }
    },
  }
}

function createThrowingAdapter(): AIProvider {
  return {
    capabilities: () => ({
      streaming: true,
      toolUse: false,
      contextCaching: false,
      semanticCaching: false,
      imageInput: false,
      voiceInput: false,
      compression: false,
    }),
    async *stream(): AsyncIterable<AIStreamEvent> {
      throw new Error('adapter boom')
    },
  }
}

const debateBlueprint: Blueprint = {
  id: 'debate-strategy-v1',
  name: 'Debate & Strategy',
  canvas_view_mode: 'graph',
  node_types: [
    { id: 'hypothesis', label: 'Hypothesis', color: '#6366f1', description: 'A testable claim.' },
  ],
  edge_types: [{ id: 'SUPPORTS', label: 'Supports', color: '#10b981' }],
  phase_sequence: [
    { id: 'opening', label: 'Opening', llm_instructions: 'Establish hypotheses.', allowed_node_types: ['hypothesis'], phase_readiness_gate: { min_nodes: 3, min_messages_after: 5 } },
  ],
  active_persona_ids: [],
  drift_reply_probability: 0.8,
  drift_detection_enabled: true,
  bot_defaults: {},
  role_personalities: {},
}

const casualPersonality: Personality = {
  id: 'coach-casual',
  name: 'Casual Coach',
  definition: {
    language: 'es',
    formality: 'informal',
    voice_instructions: 'Habla en tono cercano y motivador, usando "tío" ocasionalmente.',
    catchphrases: ['¡Vamos allá!'],
  },
}

const populatedArgGraph = {
  nodes: [
    {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      type: 'claim',
      label: 'El agua es esencial para la vida',
      branch_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      message_id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
      speaker: 'Miguel',
    },
  ],
  edges: [],
}

const emptyArgGraph = { nodes: [], edges: [] }

function makeState(overrides: Partial<GraphState> = {}): GraphState {
  return {
    blueprintId: 'debate-strategy-v1',
    currentPhaseId: 'opening',
    messages: [{ role: 'user', content: 'El agua es esencial para la vida.' }],
    canvasOps: [],
    guardrailResult: null,
    agentConfidence: null,
    driftAction: null,
    agentOutput: null,
    steeringTextEnabled: null,
    phase_signal: null,
    argGraph: emptyArgGraph,
    triggerMetadata: {},
    triggerType: null,
    firingSkillId: null,
    firingSkillRole: null,
    skillMeta: null,
    triggerGateComplete: null,
    phaseGateProgress: null,
    ...overrides,
  }
}

describe('buildCoachSystemPrompt — D-03 Role-dominant composition', () => {
  it('places the Role behavioral contract BEFORE the Personality voice block (source order)', () => {
    const system = buildCoachSystemPrompt(debateBlueprint, casualPersonality, emptyArgGraph)
    const roleIdx = system.indexOf('question mark')
    const voiceIdx = system.indexOf(casualPersonality.definition.voice_instructions)
    expect(roleIdx).toBeGreaterThanOrEqual(0)
    expect(voiceIdx).toBeGreaterThan(roleIdx)
  })

  it('contains at least 2 BAD/GOOD Spanish few-shot pairs', () => {
    const system = buildCoachSystemPrompt(debateBlueprint, undefined, emptyArgGraph)
    const badCount = (system.match(/BAD:/g) ?? []).length
    const goodCount = (system.match(/GOOD:/g) ?? []).length
    expect(badCount).toBeGreaterThanOrEqual(2)
    expect(goodCount).toBeGreaterThanOrEqual(2)
  })

  it('injects summarizeArgGraph(argGraph) content-aware output', () => {
    const system = buildCoachSystemPrompt(debateBlueprint, undefined, populatedArgGraph)
    expect(system).toContain('Miguel')
    expect(system).toContain('El agua es esencial para la vida')
  })

  it('omits the Personality voice block entirely when no Personality is provided', () => {
    const system = buildCoachSystemPrompt(debateBlueprint, undefined, emptyArgGraph)
    expect(system).not.toContain('does not override')
  })

  it('splices skillGuidance AFTER the argGraph context and BEFORE the Personality voice (D-03)', () => {
    const system = buildCoachSystemPrompt(debateBlueprint, casualPersonality, populatedArgGraph, 'Test guidance text.')
    const argGraphIdx = system.indexOf('Argument structure so far')
    const guidanceIdx = system.indexOf('Test guidance text.')
    const voiceIdx = system.indexOf(casualPersonality.definition.voice_instructions)
    expect(argGraphIdx).toBeGreaterThanOrEqual(0)
    expect(guidanceIdx).toBeGreaterThan(argGraphIdx)
    expect(voiceIdx).toBeGreaterThan(guidanceIdx)
  })

  it('adds no guidance block when skillGuidance is undefined (regression — byte-identical to pre-change)', () => {
    const withoutGuidance = buildCoachSystemPrompt(debateBlueprint, casualPersonality, populatedArgGraph)
    const withUndefinedGuidance = buildCoachSystemPrompt(debateBlueprint, casualPersonality, populatedArgGraph, undefined)
    expect(withUndefinedGuidance).toBe(withoutGuidance)
    expect(withoutGuidance).not.toContain('Active trigger guidance')
  })
})

describe('facilitationAgentNode — Coach Skill-guidance injection slot (Phase 12 Plan 05)', () => {
  it('splices the firing Coach Skill buildPromptGuidance() output into the system prompt', async () => {
    const captured: { system?: string } = {}
    const adapter = createMockAdapter(
      [{ type: 'text_delta', text: '¿Cómo se conecta esto?' }, { type: 'done' }],
      (options) => {
        captured.system = options.system
      }
    )
    const state = makeState({
      firingSkillId: 'drift-redirect',
      messages: [
        { role: 'user', content: 'Primer mensaje' },
        { role: 'user', content: 'Segundo mensaje' },
        { role: 'user', content: 'Tercer mensaje sobre otra cosa' },
      ],
    })
    await facilitationAgentNode(state, {
      configurable: { blueprint: debateBlueprint, providerName: 'anthropic', facilitationAdapter: adapter },
    })
    const expectedGuidance = driftRedirectSkill.buildPromptGuidance({
      state,
      blueprint: debateBlueprint,
      config: { configurable: { blueprint: debateBlueprint, providerName: 'anthropic', facilitationAdapter: adapter } },
    })
    expect(captured.system).toContain(expectedGuidance)
  })

  it('positions the guidance block after argGraph context and before Personality voice in the constructed prompt', async () => {
    const captured: { system?: string } = {}
    const adapter = createMockAdapter(
      [{ type: 'text_delta', text: '¿Y ahora?' }, { type: 'done' }],
      (options) => {
        captured.system = options.system
      }
    )
    const state = makeState({
      firingSkillId: 'drift-redirect',
      argGraph: populatedArgGraph,
      messages: [
        { role: 'user', content: 'Primer mensaje' },
        { role: 'user', content: 'Segundo mensaje' },
        { role: 'user', content: 'Tercer mensaje sobre otra cosa' },
      ],
    })
    await facilitationAgentNode(state, {
      configurable: {
        blueprint: debateBlueprint,
        providerName: 'anthropic',
        personality: casualPersonality,
        facilitationAdapter: adapter,
      },
    })
    const argGraphIdx = captured.system!.indexOf('Argument structure so far')
    const guidanceIdx = captured.system!.indexOf('Trigger: the last few messages have drifted')
    const voiceIdx = captured.system!.indexOf(casualPersonality.definition.voice_instructions)
    expect(argGraphIdx).toBeGreaterThanOrEqual(0)
    expect(guidanceIdx).toBeGreaterThan(argGraphIdx)
    expect(voiceIdx).toBeGreaterThan(guidanceIdx)
  })

  it('adds no guidance block when firingSkillId is null (non-firing turn unchanged)', async () => {
    const captured: { system?: string } = {}
    const adapter = createMockAdapter(
      [{ type: 'text_delta', text: '¿Y ahora?' }, { type: 'done' }],
      (options) => {
        captured.system = options.system
      }
    )
    const state = makeState({ firingSkillId: null })
    await facilitationAgentNode(state, {
      configurable: { blueprint: debateBlueprint, providerName: 'anthropic', facilitationAdapter: adapter },
    })
    expect(captured.system).not.toContain('Active trigger guidance')
  })

  it('adds no guidance block when firingSkillId does not match any COACH_SKILLS entry', async () => {
    const captured: { system?: string } = {}
    const adapter = createMockAdapter(
      [{ type: 'text_delta', text: '¿Y ahora?' }, { type: 'done' }],
      (options) => {
        captured.system = options.system
      }
    )
    const state = makeState({ firingSkillId: 'orphan-edge' }) // an Analyst Skill, not a Coach Skill
    await facilitationAgentNode(state, {
      configurable: { blueprint: debateBlueprint, providerName: 'anthropic', facilitationAdapter: adapter },
    })
    expect(captured.system).not.toContain('Active trigger guidance')
  })
})

describe('facilitationAgentNode — participant-profile splice (Phase 13 Plan 07, WR-03/WR-04)', () => {
  function buildProfileSupabaseMock(profile: unknown) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: profile, error: null })
    const eq2 = vi.fn().mockReturnValue({ maybeSingle })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    return { from, select, eq1, eq2, maybeSingle }
  }

  it('splices target participant profile into the system prompt when config.configurable.participantId is set (no skillMeta)', async () => {
    const captured: { system?: string } = {}
    const adapter = createMockAdapter(
      [{ type: 'text_delta', text: '¿Qué opinas?' }, { type: 'done' }],
      (options) => {
        captured.system = options.system
      }
    )
    const { from, eq2 } = buildProfileSupabaseMock({
      branch_id: 'branch-1',
      participant_id: 'author-a',
      positions: ['La evidencia importa'],
      assertions: [],
      messages_sent: 3,
      reactions_used: 0,
      moderation_count: 0,
      updated_at: '2026-07-16T00:00:00.000Z',
    })
    const state = makeState({ firingSkillId: null, skillMeta: null })
    await facilitationAgentNode(state, {
      configurable: {
        blueprint: debateBlueprint,
        providerName: 'anthropic',
        facilitationAdapter: adapter,
        participantId: 'author-a',
        branchId: 'branch-1',
        supabase: { from } as never,
      },
    })
    expect(captured.system).toContain('La evidencia importa')
    expect(captured.system).toContain('PARTICIPANT_PROFILE_DATA')
    expect(eq2).toHaveBeenCalledWith('participant_id', 'author-a')
  })

  it('skillMeta.participantId takes precedence over config participantId', async () => {
    const adapter = createMockAdapter([{ type: 'text_delta', text: '¿Y esto?' }, { type: 'done' }])
    const { from, eq2 } = buildProfileSupabaseMock(null)
    const state = makeState({ firingSkillId: null, skillMeta: { participantId: 'author-b' } })
    await facilitationAgentNode(state, {
      configurable: {
        blueprint: debateBlueprint,
        providerName: 'anthropic',
        facilitationAdapter: adapter,
        participantId: 'author-a',
        branchId: 'branch-1',
        supabase: { from } as never,
      },
    })
    expect(eq2).toHaveBeenCalledWith('participant_id', 'author-b')
  })
})

describe('facilitationAgentNode — fail-silent + routing', () => {
  it('returns {} when blueprint is missing from config.configurable', async () => {
    const result = await facilitationAgentNode(makeState(), { configurable: {} })
    expect(result).toEqual({})
  })

  it('returns {} when no adapter can be constructed', async () => {
    const result = await facilitationAgentNode(makeState(), {
      configurable: { blueprint: debateBlueprint },
    })
    expect(result).toEqual({})
  })

  it('never throws on adapter.stream error — returns {}', async () => {
    const result = await facilitationAgentNode(makeState(), {
      configurable: { blueprint: debateBlueprint, facilitationAdapter: createThrowingAdapter() },
    })
    expect(result).toEqual({})
  })

  it('routes the model through TASK_MODELS[...].facilitation (never a hardcoded string)', async () => {
    const captured: { model?: string; maxTokens?: number } = {}
    const adapter = createMockAdapter(
      [{ type: 'text_delta', text: '¿Qué opinan?' }, { type: 'done' }],
      (options) => {
        captured.model = options.model
        captured.maxTokens = options.maxTokens
      }
    )
    await facilitationAgentNode(makeState(), {
      configurable: { blueprint: debateBlueprint, providerName: 'anthropic', facilitationAdapter: adapter },
    })
    expect(captured.model).toBe(TASK_MODELS.anthropic.facilitation)
    expect(captured.maxTokens).toBe(256)
  })

  it('forwards streamed tokens via config.configurable.streamWriter', async () => {
    const chunks: string[] = []
    const adapter = createMockAdapter([
      { type: 'text_delta', text: '¿Qué piensan de esto?' },
      { type: 'done' },
    ])
    await facilitationAgentNode(makeState(), {
      configurable: {
        blueprint: debateBlueprint,
        providerName: 'anthropic',
        facilitationAdapter: adapter,
        streamWriter: (text: string) => chunks.push(text),
      },
    })
    expect(chunks.join('')).toBe('¿Qué piensan de esto?')
  })

  it('updates triggerMetadata.silence_gate.last_fired_at on success, preserving other keys', async () => {
    const adapter = createMockAdapter([{ type: 'text_delta', text: '¿Y ahora?' }, { type: 'done' }])
    const state = makeState({
      triggerMetadata: { unlinked_assertion: { last_fired_at: '2026-01-01T00:00:00.000Z', cooldown_until: null } },
    })
    const result = await facilitationAgentNode(state, {
      configurable: { blueprint: debateBlueprint, providerName: 'anthropic', facilitationAdapter: adapter },
    })
    expect(result.triggerMetadata?.unlinked_assertion).toEqual({
      last_fired_at: '2026-01-01T00:00:00.000Z',
      cooldown_until: null,
    })
    expect(result.triggerMetadata?.silence_gate?.last_fired_at).toBeTruthy()
    expect(new Date(result.triggerMetadata!.silence_gate!.last_fired_at as string).getTime()).not.toBeNaN()
  })
})
