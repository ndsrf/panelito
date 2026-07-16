/**
 * arg-graph-builder.test.ts — ArgGraphBuilderNode unit tests (Phase 11 Task 1, GRAPH-01, GRAPH-02)
 *
 * Per 11-PATTERNS.md Pattern 3 the codebase normally tests at the graph level (no per-node unit
 * test files), but this task is tdd="true" with an explicit <behavior> block — a dedicated node
 * test file is warranted here so each extraction/substitution/merge behavior is independently
 * verifiable without wiring the full conditional-START graph topology (which lands in Plan 05).
 *
 * Mock adapter pattern copied from graph.test.ts's createMockAdapter (RESEARCH Pattern 7).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AIProvider, AIStreamEvent } from '@panelito/types'
import { argGraphBuilderNode } from './arg-graph-builder'
import type { GraphState } from '../state'

function createMockAdapter(eventsPerCall: AIStreamEvent[][]): AIProvider {
  let call = 0
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
      const events = eventsPerCall[Math.min(call, eventsPerCall.length - 1)] ?? []
      call += 1
      for (const event of events) {
        yield event
      }
    },
  }
}

function baseState(overrides: Partial<GraphState> = {}): GraphState {
  return {
    blueprintId: 'debate-strategy-v1',
    currentPhaseId: 'opening',
    messages: [
      { role: 'user', content: 'Miguel: I think the evidence is solid.' },
      { role: 'user', content: 'Ana: I disagree, the sample size is too small.' },
    ],
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
    ...overrides,
  }
}

function makeConfig(argGraphAdapter: AIProvider, branchId = '11111111-1111-4111-8111-111111111111') {
  return {
    configurable: {
      thread_id: `bot-${branchId}`,
      providerName: 'anthropic' as const,
      plaintextKey: 'test-key',
      argGraphAdapter,
      branchId,
    },
  }
}

const VALID_MESSAGE_ID = '22222222-2222-4222-8222-222222222222'

describe('argGraphBuilderNode', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('substitutes short refs for UUIDs and passes ArgNodeSchema/ArgEdgeSchema .uuid() validation', async () => {
    const adapter = createMockAdapter([
      [
        {
          type: 'tool_use',
          name: 'extract_arg_graph',
          input: {
            nodes: [
              { id: 'n1', type: 'claim', label: 'Evidence is solid', message_id: VALID_MESSAGE_ID, speaker: 'Miguel' },
              { id: 'n2', type: 'counterargument', label: 'Sample too small', message_id: VALID_MESSAGE_ID, speaker: 'Ana' },
            ],
            edges: [{ id: 'e1', source_ref: 'n2', target_ref: 'n1', relation: 'CONTRADICTS' }],
          },
        },
      ],
    ])

    const result = await argGraphBuilderNode(baseState(), makeConfig(adapter))

    expect(result.argGraph).toBeDefined()
    expect(result.argGraph!.nodes).toHaveLength(2)
    expect(result.argGraph!.edges).toHaveLength(1)

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    for (const node of result.argGraph!.nodes) {
      expect(node.id).toMatch(uuidRe)
      expect(node.branch_id).toBe('11111111-1111-4111-8111-111111111111')
    }
    const edge = result.argGraph!.edges[0]!
    expect(edge.id).toMatch(uuidRe)
    expect(edge.source_id).toMatch(uuidRe)
    expect(edge.target_id).toMatch(uuidRe)
    // source_ref 'n2' and target_ref 'n1' must resolve to the SAME uuids as the node refs
    const nodeByLabel = Object.fromEntries(result.argGraph!.nodes.map((n) => [n.label, n.id]))
    expect(edge.source_id).toBe(nodeByLabel['Sample too small'])
    expect(edge.target_id).toBe(nodeByLabel['Evidence is solid'])
  })

  it('returns {} and logs a warning (not an error) when no tool_use event is emitted', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = createMockAdapter([[{ type: 'text_delta', text: 'no tool call here' }]])

    const result = await argGraphBuilderNode(baseState(), makeConfig(adapter))

    expect(result).toEqual({})
    expect(warnSpy).toHaveBeenCalled()
  })

  it('retries up to MAX_RETRIES on ArgGraphSchema validation failure post-substitution, then returns {}', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // message_id 'not-a-real-uuid' passes the relaxed raw shape check but fails
    // the strict ArgNodeSchema.message_id.uuid() domain validation every attempt.
    const invalidEvents: AIStreamEvent[] = [
      {
        type: 'tool_use',
        name: 'extract_arg_graph',
        input: {
          nodes: [{ id: 'n1', type: 'claim', label: 'X', message_id: 'not-a-real-uuid', speaker: 'Miguel' }],
          edges: [],
        },
      },
    ]
    const adapter = createMockAdapter([invalidEvents, invalidEvents, invalidEvents, invalidEvents])
    let streamCalls = 0
    const countingAdapter: AIProvider = {
      capabilities: adapter.capabilities,
      stream(...args) {
        streamCalls += 1
        return adapter.stream(...args)
      },
    }

    const result = await argGraphBuilderNode(baseState(), makeConfig(countingAdapter))

    expect(result).toEqual({})
    // 1 initial attempt + 2 retries = 3 total calls (MAX_RETRIES = 2)
    expect(streamCalls).toBe(3)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('merges a valid extraction into a non-empty prior argGraph (union by id, no overwrite)', async () => {
    const priorNode = {
      id: '33333333-3333-4333-8333-333333333333',
      type: 'claim',
      label: 'Prior claim',
      branch_id: '11111111-1111-4111-8111-111111111111',
      message_id: VALID_MESSAGE_ID,
      speaker: 'Laura',
    }
    const priorState = baseState({ argGraph: { nodes: [priorNode], edges: [] } })

    const adapter = createMockAdapter([
      [
        {
          type: 'tool_use',
          name: 'extract_arg_graph',
          input: {
            nodes: [{ id: 'n1', type: 'evidence', label: 'New evidence', message_id: VALID_MESSAGE_ID, speaker: 'Carlos' }],
            edges: [],
          },
        },
      ],
    ])

    const result = await argGraphBuilderNode(priorState, makeConfig(adapter))

    expect(result.argGraph!.nodes).toHaveLength(2)
    expect(result.argGraph!.nodes.map((n) => n.label).sort()).toEqual(['New evidence', 'Prior claim'])
    expect(result.argGraph!.nodes.find((n) => n.id === priorNode.id)).toEqual(priorNode)
  })

  it('never throws — returns {} when adapter is unavailable', async () => {
    const result = await argGraphBuilderNode(baseState(), { configurable: {} })
    expect(result).toEqual({})
  })
})
