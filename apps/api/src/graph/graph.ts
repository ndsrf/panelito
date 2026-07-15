/**
 * graph.ts — createGraph factory + routeFromStart / routeAfterOrchestrator conditional edges
 *
 * Creates a StateGraph with seven nodes:
 *   START → (conditional: routeFromStart) → facilitation | argGraphBuilder→analysis | orchestrator
 *   orchestrator → (conditional: routeAfterOrchestrator) → agent | driftReply | END
 *   agent → mutationGate → END
 *   driftReply → END
 *   facilitation → END
 *   argGraphBuilder → analysis → mutationGate → END
 *
 * checkpointer parameter enables the MemorySaver/PostgresSaver swap:
 *   - No arg (or undefined): defaults to MemorySaver (unit tests, D-11)
 *   - PostgresSaver: production (ORCH-05) and integration tests (D-12)
 *
 * routeFromStart implements Phase 11's conditional START edge (highest-risk topology
 * change of the phase — STATE.md). Reads state.triggerType (Plan 01):
 *   'silence_gate'      → 'facilitation' (FacilitationAgentNode / Coach)
 *   'analysis_request'  → 'analysis' (routes through argGraphBuilder first, populates
 *                          state.argGraph before AnalyticsAgentNode runs)
 *   null | undefined    → 'orchestrator' (valid human /invoke path, unchanged)
 *   any other defined string → console.error + throw (Finding 6 / ROADMAP success
 *                          criterion 2 — a defined-but-unrecognized triggerType must
 *                          error loudly, never silently fall through to 'orchestrator'
 *                          as if it were a human message). Per the Task 1 spike
 *                          (graph.test.ts SPIKE block), LangGraph 1.4.7 surfaces both a
 *                          thrown router error AND a pathsMap-unmapped return value as a
 *                          rejected graph.invoke() promise — so throwing explicitly here
 *                          is both loud (console.error, greppable) and safe (never
 *                          silently routes to the human path).
 *
 * routeAfterOrchestrator implements D-03 routing (unchanged from Phase 10):
 *   DOMAIN_DRIFT + driftAction 'replied' → 'driftReply'
 *   DOMAIN_DRIFT + driftAction 'ignored' → 'end'
 *   DOMAIN_MATCH | DOMAIN_BRIDGE (or null fallback) → 'agent'
 *
 * Anti-pattern: Never call getCheckpointer() here — unit tests pass MemorySaver directly.
 * [CITED: RESEARCH Anti-Pattern "Calling getCheckpointer() in unit tests"]
 */

import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { GraphStateAnnotation } from './state'
import type { GraphState } from './state'
import { orchestratorNode } from './nodes/orchestrator'
import { agentNode } from './nodes/agent'
import { mutationGateNode } from './nodes/mutation-gate'
import { driftReplyNode } from './nodes/drift-reply'
import { argGraphBuilderNode } from './nodes/arg-graph-builder'
import { facilitationAgentNode } from './nodes/facilitation-agent'
import { analyticsAgentNode } from './nodes/analytics-agent'

/**
 * Conditional edge function that routes after the OrchestratorNode completes.
 *
 * Returns a key that maps to the next node name in addConditionalEdges:
 *   'agent'      → AgentNode (DOMAIN_MATCH or DOMAIN_BRIDGE)
 *   'driftReply' → DriftReplyNode (DOMAIN_DRIFT + driftAction 'replied')
 *   'end'        → END (DOMAIN_DRIFT + driftAction 'ignored', or silent exit)
 */
export function routeAfterOrchestrator(state: GraphState): 'agent' | 'driftReply' | 'end' {
  if (state.guardrailResult === 'DOMAIN_DRIFT') {
    return state.driftAction === 'replied' ? 'driftReply' : 'end'
  }
  // DOMAIN_MATCH, DOMAIN_BRIDGE, or null (fail-open fallback) → route to agent
  return 'agent'
}

/**
 * Conditional edge function that routes the very first graph edge (Phase 11 — highest-risk
 * topology change of the phase). Reads state.triggerType (Plan 01: string | null; null =
 * human /invoke path — unchanged behavior).
 *
 * CRITICAL (Pitfall 3): every normally-returned value MUST be a pathsMap key in createGraph's
 * addConditionalEdges(START, ...) call below. A defined-but-unrecognized triggerType is NOT a
 * normal return value — it is a bug (Finding 6), and this function throws for it instead of
 * returning, so it never needs (or gets) a pathsMap entry.
 */
export function routeFromStart(state: GraphState): 'facilitation' | 'analysis' | 'orchestrator' {
  const { triggerType } = state

  if (triggerType === 'silence_gate') {
    console.info('[graph] START → facilitation (silence_gate trigger)')
    return 'facilitation'
  }
  if (triggerType === 'analysis_request') {
    console.info('[graph] START → analysis (analysis_request trigger, via argGraphBuilder)')
    return 'analysis'
  }
  if (triggerType === null || triggerType === undefined) {
    // Valid human path — no trigger set at all. Not an error.
    console.info('[graph] START → orchestrator (human message, no triggerType)')
    return 'orchestrator'
  }

  // A defined-but-unrecognized triggerType (typo, a future Phase 12+ trigger type not yet
  // wired here, or a corrupted checkpoint) must error loudly — never silently fall through
  // to 'orchestrator' as if it were a human message (ROADMAP success criterion 2 / Finding 6).
  console.error('[graph] unrecognized triggerType:', triggerType)
  throw new Error(`[graph] routeFromStart: unrecognized triggerType "${triggerType}"`)
}

/**
 * Factory function that builds and compiles the Project Multiverse NSAI StateGraph.
 *
 * @param checkpointer - Optional checkpointer. Defaults to MemorySaver for tests.
 *   Pass PostgresSaver for production (ORCH-05) and integration tests (D-12).
 */
export function createGraph(checkpointer?: BaseCheckpointSaver) {
  const graph = new StateGraph(GraphStateAnnotation)
    // Existing nodes (unchanged)
    .addNode('orchestrator', orchestratorNode)
    .addNode('agent', agentNode)
    .addNode('mutationGate', mutationGateNode)
    .addNode('driftReply', driftReplyNode)
    // Phase 11 new nodes
    .addNode('argGraphBuilder', argGraphBuilderNode)
    .addNode('facilitation', facilitationAgentNode)
    .addNode('analysis', analyticsAgentNode)

    // Phase 11: conditional START edge REPLACES the fixed START → orchestrator edge
    // (Pitfall 2 — both cannot coexist; the fixed edge would silently win).
    .addConditionalEdges(START, routeFromStart, {
      facilitation: 'facilitation',
      analysis: 'argGraphBuilder', // ArgGraphBuilderNode runs first, populates state.argGraph
      orchestrator: 'orchestrator',
    })

    .addConditionalEdges('orchestrator', routeAfterOrchestrator, {
      agent: 'agent',
      driftReply: 'driftReply',
      end: END,
    })
    .addEdge('agent', 'mutationGate')
    .addEdge('mutationGate', END)
    .addEdge('driftReply', END)

    // Phase 11 new edges
    .addEdge('argGraphBuilder', 'analysis')
    .addEdge('facilitation', END)
    // 'analysis' routes through mutationGate (same as 'agent') so that any
    // canvas mutation the Analyst proposes actually reaches state.canvasOps —
    // mutationGateNode already returns {} when state.agentOutput is null/
    // NO_ACTION, so this is a no-op for the common no-mutation case
    // (CR-01 fix — REVIEW.md).
    .addEdge('analysis', 'mutationGate')

  return graph.compile({ checkpointer: checkpointer ?? new MemorySaver() })
}
