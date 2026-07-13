/**
 * graph.test.ts — Unit tests covering all 5 D-11 mock paths via MemorySaver StateGraph
 *
 * D-11 paths:
 *   1. DOMAIN_MATCH + ADD_NODE conf 0.9 → canvasOps with status 'committed'
 *   2. DOMAIN_MATCH + ADD_EDGE conf 0.7 → canvasOps with status 'ghost'
 *   3. DOMAIN_MATCH + NO_ACTION conf 0.3 → 0 canvasOps
 *   4. DOMAIN_DRIFT + replied → driftAction 'replied', 0 canvasOps
 *   5. DOMAIN_DRIFT + ignored → driftAction 'ignored', 0 canvasOps
 *
 * Uses separate classifierAdapter and agentAdapter seams in config.configurable
 * so each mock adapter only needs to yield events for its single role.
 *
 * Anti-pattern: never calls getCheckpointer() — MemorySaver only (RESEARCH Anti-Pattern).
 * All 5 tests use createGraph() with no argument (defaults to MemorySaver).
 */

import { describe, it, expect } from 'vitest'
import { MemorySaver } from '@langchain/langgraph'
import type { AIProvider, AIStreamEvent, Blueprint } from '@panelito/types'
import { createGraph } from './graph'

// ---------------------------------------------------------------------------
// Mock AIProvider factory (RESEARCH Pattern 7)
// Returns a deterministic async generator that yields the provided events.
// ---------------------------------------------------------------------------
function createMockAdapter(events: AIStreamEvent[]): AIProvider {
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
      for (const event of events) {
        yield event
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Debate Blueprint fixture — node_types incl. 'hypothesis', edge_types incl. 'SUPPORTS'
// Vocabulary validation in MutationGateNode passes for these values.
// ---------------------------------------------------------------------------
const debateBlueprint: Blueprint = {
  id: 'debate-strategy-v1',
  name: 'Debate & Strategy',
  canvas_view_mode: 'graph',
  node_types: [
    { id: 'hypothesis', label: 'Hypothesis', color: '#6366f1', description: 'A testable claim or assertion.' },
    { id: 'evidence', label: 'Evidence', color: '#10b981', description: 'Supporting or refuting data.' },
    { id: 'counter_argument', label: 'Counter-Argument', color: '#ef4444', description: 'A challenge to a hypothesis.' },
    { id: 'action', label: 'Action', color: '#f59e0b', description: 'A proposed course of action.' },
  ],
  edge_types: [
    { id: 'SUPPORTS', label: 'Supports', color: '#10b981' },
    { id: 'CONTRADICTS', label: 'Contradicts', color: '#ef4444' },
    { id: 'BUILDS_ON', label: 'Builds On', color: '#6366f1' },
  ],
  phase_sequence: [
    {
      id: 'opening',
      label: 'Opening',
      llm_instructions: 'Focus on establishing core hypotheses and initial evidence.',
      allowed_node_types: ['hypothesis', 'evidence'],
    },
    {
      id: 'debate',
      label: 'Debate',
      llm_instructions: 'Surface counter-arguments and challenge assumptions.',
      allowed_node_types: ['counter_argument', 'evidence'],
    },
  ],
  active_persona_ids: ['scientific-analyst', 'devils-advocate'],
  drift_reply_probability: 0.8,
  bot_defaults: {},
  role_personalities: {},
}

// ---------------------------------------------------------------------------
// Mock event sets for the 5 D-11 paths
// ---------------------------------------------------------------------------

/** Classifier mock that returns DOMAIN_MATCH classification */
const classifierMatchAdapter = createMockAdapter([
  { type: 'text_delta', text: 'DOMAIN_MATCH' },
  { type: 'done' },
])

/** Classifier mock that returns DOMAIN_DRIFT classification */
const classifierDriftAdapter = createMockAdapter([
  { type: 'text_delta', text: 'DOMAIN_DRIFT' },
  { type: 'done' },
])

/** Agent mock: ADD_NODE with confidence 0.9 → committed path */
const agentAddNode09 = createMockAdapter([
  {
    type: 'tool_use',
    name: 'canvas_mutation',
    input: { op: 'ADD_NODE', node_type_id: 'hypothesis', label: 'Test claim', confidence: 0.9 },
  },
  { type: 'done' },
])

/** Agent mock: ADD_EDGE with confidence 0.7 → ghost path */
const agentAddEdge07 = createMockAdapter([
  {
    type: 'tool_use',
    name: 'canvas_mutation',
    input: {
      op: 'ADD_EDGE',
      source_node_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      target_node_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      edge_type_id: 'SUPPORTS',
      confidence: 0.7,
    },
  },
  { type: 'done' },
])

/** Agent mock: NO_ACTION with confidence 0.3 → no op path */
const agentNoAction03 = createMockAdapter([
  {
    type: 'tool_use',
    name: 'canvas_mutation',
    input: { op: 'NO_ACTION', reason: 'Message is ambiguous' },
  },
  { type: 'done' },
])

/** DriftReply mock: text response only (no tool_use) */
const driftReplyAdapter = createMockAdapter([
  { type: 'text_delta', text: 'That is an interesting thought!' },
  { type: 'done' },
])

// ---------------------------------------------------------------------------
// Shared initial state and config builder
// ---------------------------------------------------------------------------
const initialMessages = [{ role: 'user' as const, content: 'Water is essential for life.' }]

function makeConfig(
  options: {
    classifierAdapter: AIProvider
    agentAdapter?: AIProvider
    driftReplyAdapter?: AIProvider
  }
) {
  return {
    configurable: {
      thread_id: `test-${Math.random().toString(36).slice(2)}`,
      blueprint: debateBlueprint,
      providerName: 'anthropic' as const,
      plaintextKey: 'test-key',
      classifierAdapter: options.classifierAdapter,
      agentAdapter: options.agentAdapter,
      driftReplyAdapter: options.driftReplyAdapter,
    },
  }
}

// ---------------------------------------------------------------------------
// D-11 Test Suite
// ---------------------------------------------------------------------------

describe('createGraph() — all 5 D-11 mock paths (MemorySaver)', () => {

  it('Path 1: DOMAIN_MATCH + ADD_NODE conf 0.9 → canvasOps[0].status === committed', async () => {
    const graph = createGraph(new MemorySaver())

    const result = await graph.invoke(
      {
        blueprintId: 'debate-strategy-v1',
        currentPhaseId: 'opening',
        messages: initialMessages,
        canvasOps: [],
      },
      makeConfig({ classifierAdapter: classifierMatchAdapter, agentAdapter: agentAddNode09 })
    )

    expect(result.guardrailResult).toBe('DOMAIN_MATCH')
    expect(result.canvasOps).toHaveLength(1)
    expect(result.canvasOps[0]).toMatchObject({
      op: 'ADD_NODE',
      node_type_id: 'hypothesis',
      label: 'Test claim',
      status: 'committed',
    })
  })

  it('Path 2: DOMAIN_MATCH + ADD_EDGE conf 0.7 → canvasOps[0].status === ghost', async () => {
    const graph = createGraph(new MemorySaver())

    const result = await graph.invoke(
      {
        blueprintId: 'debate-strategy-v1',
        currentPhaseId: 'opening',
        messages: initialMessages,
        canvasOps: [],
      },
      makeConfig({ classifierAdapter: classifierMatchAdapter, agentAdapter: agentAddEdge07 })
    )

    expect(result.guardrailResult).toBe('DOMAIN_MATCH')
    expect(result.canvasOps).toHaveLength(1)
    expect(result.canvasOps[0]).toMatchObject({
      op: 'ADD_EDGE',
      edge_type_id: 'SUPPORTS',
      status: 'ghost',
    })
  })

  it('Path 3: DOMAIN_MATCH + NO_ACTION → 0 canvasOps', async () => {
    const graph = createGraph(new MemorySaver())

    const result = await graph.invoke(
      {
        blueprintId: 'debate-strategy-v1',
        currentPhaseId: 'opening',
        messages: initialMessages,
        canvasOps: [],
      },
      makeConfig({ classifierAdapter: classifierMatchAdapter, agentAdapter: agentNoAction03 })
    )

    expect(result.guardrailResult).toBe('DOMAIN_MATCH')
    expect(result.canvasOps).toHaveLength(0)
    // agentOutput is NO_ACTION — mutationGate returns {} immediately
    expect(result.agentOutput).toMatchObject({ op: 'NO_ACTION' })
  })

  it('Path 4: DOMAIN_DRIFT + replied → driftAction === replied, 0 canvasOps', async () => {
    // Control the drift probability roll: override drift_reply_probability to 1.0
    // so Math.random() < 1.0 always → driftAction = 'replied'
    const highProbBlueprint: Blueprint = { ...debateBlueprint, drift_reply_probability: 1.0 }

    const graph = createGraph(new MemorySaver())

    const result = await graph.invoke(
      {
        blueprintId: 'debate-strategy-v1',
        currentPhaseId: 'opening',
        messages: initialMessages,
        canvasOps: [],
      },
      {
        configurable: {
          thread_id: `test-drift-replied-${Math.random().toString(36).slice(2)}`,
          blueprint: highProbBlueprint,
          providerName: 'anthropic' as const,
          plaintextKey: 'test-key',
          classifierAdapter: classifierDriftAdapter,
          driftReplyAdapter: driftReplyAdapter,
        },
      }
    )

    expect(result.guardrailResult).toBe('DOMAIN_DRIFT')
    expect(result.driftAction).toBe('replied')
    expect(result.canvasOps).toHaveLength(0)
  })

  it('Path 5: DOMAIN_DRIFT + ignored → driftAction === ignored, 0 canvasOps', async () => {
    // Control the drift probability roll: override drift_reply_probability to 0.0
    // so Math.random() >= 0.0 always → driftAction = 'ignored'
    const zeroProbBlueprint: Blueprint = { ...debateBlueprint, drift_reply_probability: 0.0 }

    const graph = createGraph(new MemorySaver())

    const result = await graph.invoke(
      {
        blueprintId: 'debate-strategy-v1',
        currentPhaseId: 'opening',
        messages: initialMessages,
        canvasOps: [],
      },
      {
        configurable: {
          thread_id: `test-drift-ignored-${Math.random().toString(36).slice(2)}`,
          blueprint: zeroProbBlueprint,
          providerName: 'anthropic' as const,
          plaintextKey: 'test-key',
          classifierAdapter: classifierDriftAdapter,
          // No driftReplyAdapter needed — graph exits silently without calling DriftReplyNode
        },
      }
    )

    expect(result.guardrailResult).toBe('DOMAIN_DRIFT')
    expect(result.driftAction).toBe('ignored')
    expect(result.canvasOps).toHaveLength(0)
  })
})
