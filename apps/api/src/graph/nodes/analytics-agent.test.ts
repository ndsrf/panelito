/**
 * analytics-agent.test.ts — AnalyticsAgentNode (Analyst/Fact-Checker) unit tests
 * (Phase 11 Plan 04, Task 2)
 *
 * Covers:
 *   - buildAnalyticsSystemPrompt: Role contract (citation discipline) BEFORE Personality
 *     voice (D-03)
 *   - buildAnalyticsSystemPrompt: >=2 Spanish BAD/GOOD few-shot pairs
 *   - buildAnalyticsSystemPrompt: summarizeArgGraph(argGraph) injected (GRAPH-04)
 *   - buildAnalyticsSystemPrompt: conditional fact-check framing appends
 *     uncertainty-only / no-confident-counter-assertion language (PERSONA-02)
 *   - analyticsAgentNode: fail-silent on missing blueprint / adapter error
 *   - analyticsAgentNode: routes model through TASK_MODELS[...].analysis
 *   - analyticsAgentNode: canvas_mutation tool_use is safeParsed into agentOutput
 */

import { describe, it, expect } from 'vitest'
import type { AIProvider, AIStreamEvent, Blueprint, Personality } from '@panelito/types'
import { TASK_MODELS } from '../../lib/model-config'
import { buildAnalyticsSystemPrompt, analyticsAgentNode } from './analytics-agent'
import type { GraphState } from '../state'

function createMockAdapter(
  events: AIStreamEvent[],
  captureOptions?: (options: { model: string; maxTokens: number; system?: string }) => void
): AIProvider {
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
      toolUse: true,
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
    { id: 'opening', label: 'Opening', llm_instructions: 'Establish hypotheses.', allowed_node_types: ['hypothesis'] },
  ],
  active_persona_ids: [],
  drift_reply_probability: 0.8,
  bot_defaults: {},
  role_personalities: {},
}

const neutralPersonality: Personality = {
  id: 'analyst-neutral',
  name: 'Neutral Analyst',
  definition: {
    language: 'es',
    formality: 'formal',
    voice_instructions: 'Habla con tono neutral y preciso, evitando adjetivos innecesarios.',
    catchphrases: [],
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
    ...overrides,
  }
}

describe('buildAnalyticsSystemPrompt — D-03 Role-dominant composition', () => {
  it('places the citation Role contract BEFORE the Personality voice block (source order)', () => {
    const system = buildAnalyticsSystemPrompt(debateBlueprint, neutralPersonality, emptyArgGraph, false)
    const roleIdx = system.indexOf('Always cite')
    const voiceIdx = system.indexOf(neutralPersonality.definition.voice_instructions)
    expect(roleIdx).toBeGreaterThanOrEqual(0)
    expect(voiceIdx).toBeGreaterThan(roleIdx)
  })

  it('contains at least 2 BAD/GOOD Spanish few-shot pairs', () => {
    const system = buildAnalyticsSystemPrompt(debateBlueprint, undefined, emptyArgGraph, false)
    const badCount = (system.match(/BAD:/g) ?? []).length
    const goodCount = (system.match(/GOOD:/g) ?? []).length
    expect(badCount).toBeGreaterThanOrEqual(2)
    expect(goodCount).toBeGreaterThanOrEqual(2)
  })

  it('injects summarizeArgGraph(argGraph) content so citations reference real nodes (GRAPH-04)', () => {
    const system = buildAnalyticsSystemPrompt(debateBlueprint, undefined, populatedArgGraph, false)
    expect(system).toContain('Miguel')
    expect(system).toContain('El agua es esencial para la vida')
  })

  it('does NOT append fact-check framing language when factCheckFraming is false', () => {
    const system = buildAnalyticsSystemPrompt(debateBlueprint, undefined, emptyArgGraph, false)
    expect(system.toLowerCase()).not.toContain('no puedo verificar')
  })

  it('appends uncertainty-only, no-confident-counter-assertion language when factCheckFraming is true', () => {
    const system = buildAnalyticsSystemPrompt(debateBlueprint, undefined, emptyArgGraph, true)
    expect(system.toLowerCase()).toMatch(/no puedo verificar|verificar|fuente/)
    expect(system.toLowerCase()).toContain('never')
  })
})

describe('analyticsAgentNode — fail-silent + routing', () => {
  it('returns {} when blueprint is missing from config.configurable', async () => {
    const result = await analyticsAgentNode(makeState(), { configurable: {} })
    expect(result).toEqual({})
  })

  it('returns {} when no adapter can be constructed', async () => {
    const result = await analyticsAgentNode(makeState(), {
      configurable: { blueprint: debateBlueprint },
    })
    expect(result).toEqual({})
  })

  it('never throws on adapter.stream error — returns {}', async () => {
    const result = await analyticsAgentNode(makeState(), {
      configurable: { blueprint: debateBlueprint, analyticsAdapter: createThrowingAdapter() },
    })
    expect(result).toEqual({})
  })

  it('routes the model through TASK_MODELS[...].analysis with maxTokens 512', async () => {
    const captured: { model?: string; maxTokens?: number } = {}
    const adapter = createMockAdapter(
      [{ type: 'text_delta', text: 'Según Miguel, el agua es esencial.' }, { type: 'done' }],
      (options) => {
        captured.model = options.model
        captured.maxTokens = options.maxTokens
      }
    )
    await analyticsAgentNode(makeState(), {
      configurable: { blueprint: debateBlueprint, providerName: 'anthropic', analyticsAdapter: adapter },
    })
    expect(captured.model).toBe(TASK_MODELS.anthropic.analysis)
    expect(captured.maxTokens).toBe(512)
  })

  it('safeParses a canvas_mutation tool_use event into agentOutput/agentConfidence', async () => {
    const adapter = createMockAdapter([
      {
        type: 'tool_use',
        name: 'canvas_mutation',
        input: { op: 'ADD_NODE', node_type_id: 'hypothesis', label: 'Nueva evidencia', confidence: 0.75 },
      },
      { type: 'done' },
    ])
    const result = await analyticsAgentNode(makeState(), {
      configurable: { blueprint: debateBlueprint, providerName: 'anthropic', analyticsAdapter: adapter },
    })
    expect(result.agentOutput).toMatchObject({ op: 'ADD_NODE', label: 'Nueva evidencia', confidence: 0.75 })
    expect(result.agentConfidence).toBe(0.75)
  })

  it('drops a malformed canvas_mutation tool_use event (fail-silent, no throw)', async () => {
    const adapter = createMockAdapter([
      { type: 'tool_use', name: 'canvas_mutation', input: { op: 'ADD_NODE' /* missing label/confidence */ } },
      { type: 'done' },
    ])
    const result = await analyticsAgentNode(makeState(), {
      configurable: { blueprint: debateBlueprint, providerName: 'anthropic', analyticsAdapter: adapter },
    })
    expect(result.agentOutput ?? null).toBeNull()
  })

  it('forwards streamed tokens via config.configurable.streamWriter', async () => {
    const chunks: string[] = []
    const adapter = createMockAdapter([
      { type: 'text_delta', text: 'Según Ana, la propuesta es viable.' },
      { type: 'done' },
    ])
    await analyticsAgentNode(makeState(), {
      configurable: {
        blueprint: debateBlueprint,
        providerName: 'anthropic',
        analyticsAdapter: adapter,
        streamWriter: (text: string) => chunks.push(text),
      },
    })
    expect(chunks.join('')).toBe('Según Ana, la propuesta es viable.')
  })
})
