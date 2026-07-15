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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StateGraph, START, END, MemorySaver, Annotation } from '@langchain/langgraph'
import type { AIProvider, AIStreamEvent, Blueprint } from '@panelito/types'

// ---------------------------------------------------------------------------
// Phase 12 Plan 06 Task 3 — mock skills.ts so TriggerGateNode's Skill fan-out is
// deterministic (no real ONNX/Supabase/heuristic work) for the routing/termination
// tests below. Suffix-Mock naming (not prefix) matches this codebase's existing
// vi.mock-hoisting-safe convention (silence-break.test.ts's checkSilenceGateMock).
// Safe for the PRE-EXISTING D-11/routeFromStart tests in this file too: every one of
// them uses debateBlueprint's bot_defaults: {} (both Roles disabled), so TriggerGateNode's
// D-07 role-gate excludes these mock Skills from evaluation entirely regardless of what's
// inside these arrays — those tests are unaffected by this mock.
// ---------------------------------------------------------------------------
const coachSkillDetectMock = vi.fn()
const analystSkillDetectMock = vi.fn()

vi.mock('../lib/skills', () => ({
  COACH_SKILLS: [
    {
      id: 'mock-coach-skill',
      role: 'coach',
      detect: (...args: unknown[]) => coachSkillDetectMock(...args),
      buildPromptGuidance: () => 'Mock coach trigger guidance.',
    },
  ],
  ANALYST_SKILLS: [
    {
      id: 'mock-analyst-skill',
      role: 'analyst',
      detect: (...args: unknown[]) => analystSkillDetectMock(...args),
      buildPromptGuidance: () => 'Mock analyst trigger guidance.',
    },
  ],
}))

import { createGraph, routeAfterTriggerGate } from './graph'

// ---------------------------------------------------------------------------
// SPIKE: LangGraph conditional-edge router error propagation (Task 1, Plan 05)
//
// Open Question 3 / Assumption A2 (11-RESEARCH.md): does a thrown error inside
// a conditional-edge router function (the addConditionalEdges callback) surface
// to graph.invoke()'s caller the same way a thrown node error would, or is it
// swallowed? Separately: what happens if the router returns a string that is
// NOT a key in the pathsMap (Pitfall 3)?
//
// This is a minimal, throwaway StateGraph (not the real Project Multiverse
// graph) built solely to observe LangGraph 1.4.7's actual runtime behavior —
// promoted to a permanent regression test per the task instruction ("keep the
// spike block or convert it into a permanent regression test — do not leave
// dead code") since the two behaviors it documents are exactly the two
// failure modes routeFromStart (Task 2) must handle correctly.
// ---------------------------------------------------------------------------
describe('SPIKE: router error propagation (LangGraph 1.4.7 conditional START edge)', () => {
  const SpikeAnnotation = Annotation.Root({
    value: Annotation<string>({
      reducer: (_: string, v: string) => v,
      default: () => 'init',
    }),
  })

  it('OBSERVED: a router function that throws surfaces the error to graph.invoke() (rejects, not swallowed)', async () => {
    const throwingRouter = (): string => {
      throw new Error('spike: router threw')
    }

    const graph = new StateGraph(SpikeAnnotation)
      .addNode('a', async () => ({ value: 'a-ran' }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .addConditionalEdges(START, throwingRouter as any, { a: 'a' })
      .addEdge('a', END)
      .compile({ checkpointer: new MemorySaver() })

    await expect(
      graph.invoke({ value: 'init' }, { configurable: { thread_id: 'spike-throw' } })
    ).rejects.toThrow('spike: router threw')
  })

  it('OBSERVED: a router return value absent from the pathsMap ALSO throws to graph.invoke() (contradicts 11-RESEARCH.md Pitfall 3\'s assumed "silent drop" — empirically corrected here)', async () => {
    const unmappedRouter = (): string => 'nonexistent-key'

    const graph = new StateGraph(SpikeAnnotation)
      .addNode('a', async () => ({ value: 'a-ran' }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .addConditionalEdges(START, unmappedRouter as any, { a: 'a' })
      .addEdge('a', END)
      .compile({ checkpointer: new MemorySaver() })

    // LangGraph JS 1.4.7's Branch._route throws "Branch condition returned unknown
    // or null destination" for an unmapped key — it does NOT silently drop the
    // invocation as 11-RESEARCH.md Pitfall 3 assumed (that assumption predates
    // this empirical check and is superseded by this observation for this
    // installed version). Still, routeFromStart's pathsMap is kept exhaustive
    // for every value it can normally return — this spike documents what
    // happens on the *bug* path (a return value never intentionally produced).
    await expect(
      graph.invoke({ value: 'init' }, { configurable: { thread_id: 'spike-unmapped' } })
    ).rejects.toThrow('Branch condition returned unknown or null destination')
  })
})

// ---------------------------------------------------------------------------
// CHOSEN STRATEGY (Task 1 conclusion, applied in Task 2's routeFromStart):
// Both failure modes surface as a THROWN error to graph.invoke()'s caller in
// this installed LangGraph version (1.4.7) — a router that throws explicitly,
// and a router that returns a pathsMap-unmapped key, both reject the invoke()
// promise rather than being swallowed or silently dropped. This means the
// "log + safe fallback to a dead-end path" alternative from 11-RESEARCH.md
// Finding 6 is unnecessary: routeFromStart can (and does) simply
// console.error() a distinguishable message and then throw an explicit Error
// for a defined-but-unrecognized triggerType — this is loud (satisfies ROADMAP
// success criterion 2, testable via a console.error spy) AND never silently
// takes the human orchestrator path. The pathsMap remains exhaustive for every
// value routeFromStart can normally return (facilitation/analysis/orchestrator).
// ---------------------------------------------------------------------------

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
  drift_detection_enabled: true,
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
    classifierAdapter?: AIProvider
    agentAdapter?: AIProvider
    driftReplyAdapter?: AIProvider
    // Phase 11 Plan 05 — new START-path node adapter seams
    facilitationAdapter?: AIProvider
    analyticsAdapter?: AIProvider
    argGraphAdapter?: AIProvider
    branchId?: string
    streamWriter?: (text: string) => void
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
      facilitationAdapter: options.facilitationAdapter,
      analyticsAdapter: options.analyticsAdapter,
      argGraphAdapter: options.argGraphAdapter,
      branchId: options.branchId,
      streamWriter: options.streamWriter,
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

// ---------------------------------------------------------------------------
// Phase 11 Plan 05 — conditional START edge (routeFromStart) path coverage
//
// Covers the four routeFromStart outcomes: facilitation, analysis (via
// argGraphBuilder), orchestrator-fallback (human path regression), and the
// unrecognized-trigger error path (Finding 6 / ROADMAP success criterion 2).
// ---------------------------------------------------------------------------

const VALID_MESSAGE_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const VALID_BRANCH_UUID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'

describe('routeFromStart — facilitation path (triggerType: silence_gate)', () => {
  it('invokes FacilitationAgentNode (Coach); output ends with a question mark; no canvas/orchestrator side effects', async () => {
    let captured = ''
    const coachAdapter = createMockAdapter([
      { type: 'text_delta', text: 'Miguel mencionó la calidad de la evidencia — ' },
      { type: 'text_delta', text: '¿qué criterios usarían para evaluarla?' },
      { type: 'done' },
    ])

    const graph = createGraph(new MemorySaver())
    const result = await graph.invoke(
      {
        blueprintId: 'debate-strategy-v1',
        currentPhaseId: 'opening',
        messages: initialMessages,
        canvasOps: [],
        triggerType: 'silence_gate',
      },
      makeConfig({
        facilitationAdapter: coachAdapter,
        streamWriter: (text: string) => {
          captured += text
        },
      })
    )

    expect(captured.endsWith('?')).toBe(true)
    // No canvas mutation and no orchestrator classification happened on this path.
    expect(result.canvasOps).toHaveLength(0)
    expect(result.guardrailResult).toBeNull()
  })
})

describe('routeFromStart — analysis path (triggerType: analysis_request, via argGraphBuilder)', () => {
  it('populates state.argGraph via argGraphBuilder BEFORE AnalyticsAgentNode runs; Analyst system prompt cites the extracted speaker', async () => {
    let capturedSystem = ''

    const argGraphAdapterMock: AIProvider = {
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
        yield {
          type: 'tool_use',
          name: 'extract_arg_graph',
          input: {
            nodes: [
              {
                id: 'n1',
                type: 'claim',
                label: 'Water is essential for life',
                message_id: VALID_MESSAGE_UUID,
                speaker: 'Miguel',
              },
            ],
            edges: [],
          },
        }
        yield { type: 'done' }
      },
    }

    const analyticsAdapterMock: AIProvider = {
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
        capturedSystem = options.system ?? ''
        yield { type: 'text_delta', text: 'Miguel afirmó que el agua es esencial para la vida.' }
        yield { type: 'done' }
      },
    }

    const graph = createGraph(new MemorySaver())
    const result = await graph.invoke(
      {
        blueprintId: 'debate-strategy-v1',
        currentPhaseId: 'opening',
        messages: initialMessages,
        canvasOps: [],
        triggerType: 'analysis_request',
      },
      makeConfig({
        branchId: VALID_BRANCH_UUID,
        argGraphAdapter: argGraphAdapterMock,
        analyticsAdapter: analyticsAdapterMock,
      })
    )

    // argGraphBuilder ran first and merged its extraction into state.argGraph.
    expect(result.argGraph.nodes).toHaveLength(1)
    expect(result.argGraph.nodes[0]).toMatchObject({ speaker: 'Miguel', label: 'Water is essential for life' })
    // By the time AnalyticsAgentNode's adapter.stream() was called, the system prompt
    // (built from state.argGraph via summarizeArgGraph) already cites the speaker —
    // proving argGraph was populated BEFORE analysis ran, not after.
    expect(capturedSystem).toContain('Miguel')
  })
})

describe('routeFromStart — orchestrator fallback (triggerType: null, human path regression)', () => {
  it('routes to the existing orchestrator pipeline unchanged when triggerType is null', async () => {
    const graph = createGraph(new MemorySaver())

    const result = await graph.invoke(
      {
        blueprintId: 'debate-strategy-v1',
        currentPhaseId: 'opening',
        messages: initialMessages,
        canvasOps: [],
        triggerType: null,
      },
      makeConfig({ classifierAdapter: classifierMatchAdapter, agentAdapter: agentAddNode09 })
    )

    // Identical assertions to D-11 Path 1 — proves the human path is untouched by
    // the new conditional START edge.
    expect(result.guardrailResult).toBe('DOMAIN_MATCH')
    expect(result.canvasOps).toHaveLength(1)
    expect(result.canvasOps[0]).toMatchObject({
      op: 'ADD_NODE',
      node_type_id: 'hypothesis',
      label: 'Test claim',
      status: 'committed',
    })
  })
})

describe('routeFromStart — unrecognized triggerType (Finding 6 / ROADMAP success criterion 2)', () => {
  it('console.errors and does NOT silently route to orchestrator for a defined-but-unrecognized triggerType', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    const graph = createGraph(new MemorySaver())

    // The invocation is rejected — routeFromStart threw rather than resolving with
    // a partial/silent state, so the human orchestrator path was never taken.
    await expect(
      graph.invoke(
        {
          blueprintId: 'debate-strategy-v1',
          currentPhaseId: 'opening',
          messages: initialMessages,
          canvasOps: [],
          triggerType: 'bogus_value',
        },
        makeConfig({})
      )
    ).rejects.toThrow(/unrecognized triggerType/)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[graph] unrecognized triggerType:'),
      'bogus_value'
    )
    // Never logged the orchestrator route (which would only happen on the valid human path).
    const infoOrchestratorCalls = consoleInfoSpy.mock.calls.filter((call) =>
      String(call[0]).includes('START → orchestrator')
    )
    expect(infoOrchestratorCalls).toHaveLength(0)

    consoleErrorSpy.mockRestore()
    consoleInfoSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Phase 12 Plan 06 Task 3 — TriggerGateNode routing + termination coverage
//
// Covers the six behaviors from 12-06-PLAN.md Task 3:
//   (a) Coach-fires human path: agent -> mutationGate -> triggerGate -> facilitation -> END
//   (b) Analyst-fires human path: triggerGate -> analysis -> mutationGate -> END (loop guard)
//   (c) No-fire human path: triggerGate -> END silently, zero Role nodes invoked
//   (d) Proactive analysis_request path still reaches analysis and terminates
//   (e) firingSkillRole matches the routing outcome (asserted inline in a/b)
//   (f) pathsMap-exhaustiveness guard — every routeAfterTriggerGate return value is handled
// ---------------------------------------------------------------------------

/** An adapter whose stream() is a spy — used to assert a Role node was (or was not) invoked. */
function createSpyAdapter(events: AIStreamEvent[]) {
  const streamSpy = vi.fn(async function* (): AsyncIterable<AIStreamEvent> {
    for (const event of events) yield event
  })
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
    stream: streamSpy as unknown as AIProvider['stream'],
  }
  return { adapter, streamSpy }
}

describe('TriggerGateNode wiring — human-path routing + termination (Phase 12 Plan 06 Task 3)', () => {
  beforeEach(() => {
    coachSkillDetectMock.mockReset()
    analystSkillDetectMock.mockReset()
  })

  it('(a) Coach Skill fires: agent -> mutationGate -> triggerGate -> facilitation -> END, terminates', async () => {
    coachSkillDetectMock.mockResolvedValue({ fires: true, confidence: 0.9, meta: { reason: 'drift' } })
    analystSkillDetectMock.mockResolvedValue({ fires: false, confidence: 0 })

    const coachEnabledBlueprint: Blueprint = {
      ...debateBlueprint,
      bot_defaults: { coach: true, analyst: false },
    }

    const { adapter: coachAdapter, streamSpy: coachStreamSpy } = createSpyAdapter([
      { type: 'text_delta', text: '¿Podrían profundizar en ese punto?' },
      { type: 'done' },
    ])
    const { adapter: analyticsAdapter, streamSpy: analyticsStreamSpy } = createSpyAdapter([
      { type: 'text_delta', text: 'should never run' },
      { type: 'done' },
    ])

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
          thread_id: `test-coach-fires-${Math.random().toString(36).slice(2)}`,
          blueprint: coachEnabledBlueprint,
          providerName: 'anthropic' as const,
          plaintextKey: 'test-key',
          classifierAdapter: classifierMatchAdapter,
          agentAdapter: agentAddNode09,
          facilitationAdapter: coachAdapter,
          analyticsAdapter,
        },
      }
    )

    // Terminated without a rejected promise (implicit — await above did not throw).
    expect(result.firingSkillId).toBe('mock-coach-skill')
    expect(result.firingSkillRole).toBe('coach')
    expect(result.triggerGateComplete).toBe(true)
    // Coach's Role node ran; Analyst's Role node never did.
    expect(coachStreamSpy).toHaveBeenCalledTimes(1)
    expect(analyticsStreamSpy).not.toHaveBeenCalled()
    // Analyst Skill was disabled (bot_defaults.analyst: false) — never evaluated (D-07).
    expect(analystSkillDetectMock).not.toHaveBeenCalled()
    expect(coachSkillDetectMock).toHaveBeenCalledTimes(1)
  })

  it('(b) Analyst Skill fires: triggerGate -> analysis -> mutationGate -> END, loop guard verified (2nd mutationGate pass terminates)', async () => {
    coachSkillDetectMock.mockResolvedValue({ fires: false, confidence: 0 })
    analystSkillDetectMock.mockResolvedValue({ fires: true, confidence: 0.8, meta: { claimMessageId: 'm1' } })

    const analystEnabledBlueprint: Blueprint = {
      ...debateBlueprint,
      bot_defaults: { coach: false, analyst: true },
    }

    const { adapter: coachAdapter, streamSpy: coachStreamSpy } = createSpyAdapter([
      { type: 'text_delta', text: 'should never run' },
      { type: 'done' },
    ])
    const { adapter: analyticsAdapter, streamSpy: analyticsStreamSpy } = createSpyAdapter([
      { type: 'text_delta', text: 'Miguel afirmó que el agua es esencial — ¿de dónde viene esa cifra?' },
      { type: 'done' },
    ])

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
          thread_id: `test-analyst-fires-${Math.random().toString(36).slice(2)}`,
          blueprint: analystEnabledBlueprint,
          providerName: 'anthropic' as const,
          plaintextKey: 'test-key',
          classifierAdapter: classifierMatchAdapter,
          agentAdapter: agentAddNode09,
          facilitationAdapter: coachAdapter,
          analyticsAdapter,
        },
      }
    )

    // Terminated (await resolved, not rejected) — the loop guard sent the 2nd mutationGate
    // pass (after analysis) to END rather than re-entering triggerGate.
    expect(result.firingSkillId).toBe('mock-analyst-skill')
    expect(result.firingSkillRole).toBe('analyst')
    expect(result.triggerGateComplete).toBe(true)
    expect(analyticsStreamSpy).toHaveBeenCalledTimes(1)
    expect(coachStreamSpy).not.toHaveBeenCalled()
    // Coach Skill was disabled (bot_defaults.coach: false) — never evaluated (D-07).
    expect(coachSkillDetectMock).not.toHaveBeenCalled()
    expect(analystSkillDetectMock).toHaveBeenCalledTimes(1)
    // The original agent-proposed ADD_NODE was already gated on mutationGate's FIRST pass;
    // the Analyst's plain-text (no tool_use) response adds no additional canvasOp.
    expect(result.canvasOps).toHaveLength(1)
  })

  it('(c) No Skill fires: triggerGate -> END silently, zero Role nodes invoked', async () => {
    coachSkillDetectMock.mockResolvedValue({ fires: false, confidence: 0.1 })
    analystSkillDetectMock.mockResolvedValue({ fires: false, confidence: 0.2 })

    const bothEnabledBlueprint: Blueprint = {
      ...debateBlueprint,
      bot_defaults: { coach: true, analyst: true },
    }

    const { adapter: coachAdapter, streamSpy: coachStreamSpy } = createSpyAdapter([
      { type: 'text_delta', text: 'should never run' },
      { type: 'done' },
    ])
    const { adapter: analyticsAdapter, streamSpy: analyticsStreamSpy } = createSpyAdapter([
      { type: 'text_delta', text: 'should never run' },
      { type: 'done' },
    ])

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
          thread_id: `test-no-fire-${Math.random().toString(36).slice(2)}`,
          blueprint: bothEnabledBlueprint,
          providerName: 'anthropic' as const,
          plaintextKey: 'test-key',
          classifierAdapter: classifierMatchAdapter,
          agentAdapter: agentAddNode09,
          facilitationAdapter: coachAdapter,
          analyticsAdapter,
        },
      }
    )

    expect(result.firingSkillId).toBeNull()
    expect(result.firingSkillRole).toBeNull()
    expect(result.triggerGateComplete).toBe(true)
    // Both Skills WERE evaluated (both Roles enabled)...
    expect(coachSkillDetectMock).toHaveBeenCalledTimes(1)
    expect(analystSkillDetectMock).toHaveBeenCalledTimes(1)
    // ...but neither Role node ran — triggerGate routed straight to END.
    expect(coachStreamSpy).not.toHaveBeenCalled()
    expect(analyticsStreamSpy).not.toHaveBeenCalled()
  })

  it('(d) Proactive analysis_request path still reaches analysis (Phase 11 behavior preserved) and terminates', async () => {
    // debateBlueprint's bot_defaults: {} disables both Roles — TriggerGateNode's own
    // (2nd, post-analysis) evaluation on this path fires nothing and exits at END, proving
    // termination even though this path additionally passes through triggerGate once
    // (routeAfterMutationGate's loop guard) after argGraphBuilder routed straight to
    // 'analysis' (routeAfterArgGraphBuilder preserving Phase 11 behavior for analysis_request).
    coachSkillDetectMock.mockResolvedValue({ fires: false, confidence: 0 })
    analystSkillDetectMock.mockResolvedValue({ fires: false, confidence: 0 })

    const argGraphAdapterMock: AIProvider = {
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
        yield {
          type: 'tool_use',
          name: 'extract_arg_graph',
          input: {
            nodes: [
              {
                id: 'n1',
                type: 'claim',
                label: 'Water is essential for life',
                message_id: VALID_MESSAGE_UUID,
                speaker: 'Miguel',
              },
            ],
            edges: [],
          },
        }
        yield { type: 'done' }
      },
    }

    const analyticsAdapterMock: AIProvider = {
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
        yield { type: 'text_delta', text: 'Miguel afirmó que el agua es esencial para la vida.' }
        yield { type: 'done' }
      },
    }

    const graph = createGraph(new MemorySaver())

    // Termination proof: this await either resolves or rejects — a real infinite loop would
    // hang (this test's own timeout) or LangGraph's recursion-limit guard would reject.
    const result = await graph.invoke(
      {
        blueprintId: 'debate-strategy-v1',
        currentPhaseId: 'opening',
        messages: initialMessages,
        canvasOps: [],
        triggerType: 'analysis_request',
      },
      makeConfig({
        branchId: VALID_BRANCH_UUID,
        argGraphAdapter: argGraphAdapterMock,
        analyticsAdapter: analyticsAdapterMock,
      })
    )

    expect(result.argGraph.nodes).toHaveLength(1)
    // No Skill fired (bot_defaults: {} on debateBlueprint) — the extra triggerGate pass this
    // path now takes exits silently at END, matching (c)'s no-fire behavior.
    expect(result.firingSkillId).toBeNull()
    expect(result.triggerGateComplete).toBe(true)
  })

  it('(f) pathsMap-exhaustiveness guard — routeAfterTriggerGate never returns a value outside {facilitation, analysis, end}', () => {
    const VALID_ROUTES = new Set(['facilitation', 'analysis', 'end'])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stateCoach = { firingSkillRole: 'coach' } as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stateAnalyst = { firingSkillRole: 'analyst' } as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stateNone = { firingSkillRole: null } as any

    expect(VALID_ROUTES.has(routeAfterTriggerGate(stateCoach))).toBe(true)
    expect(VALID_ROUTES.has(routeAfterTriggerGate(stateAnalyst))).toBe(true)
    expect(VALID_ROUTES.has(routeAfterTriggerGate(stateNone))).toBe(true)
    expect(routeAfterTriggerGate(stateCoach)).toBe('facilitation')
    expect(routeAfterTriggerGate(stateAnalyst)).toBe('analysis')
    expect(routeAfterTriggerGate(stateNone)).toBe('end')
  })
})
