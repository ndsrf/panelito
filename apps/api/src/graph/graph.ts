/**
 * graph.ts — createGraph factory + routeAfterOrchestrator conditional edge
 *
 * Creates a StateGraph with four nodes:
 *   orchestrator → (conditional) → agent | driftReply | END
 *   agent → mutationGate → END
 *   driftReply → END
 *
 * checkpointer parameter enables the MemorySaver/PostgresSaver swap:
 *   - No arg (or undefined): defaults to MemorySaver (unit tests, D-11)
 *   - PostgresSaver: production (ORCH-05) and integration tests (D-12)
 *
 * routeAfterOrchestrator implements D-03 routing:
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
 * Factory function that builds and compiles the Project Multiverse NSAI StateGraph.
 *
 * @param checkpointer - Optional checkpointer. Defaults to MemorySaver for tests.
 *   Pass PostgresSaver for production (ORCH-05) and integration tests (D-12).
 */
export function createGraph(checkpointer?: BaseCheckpointSaver) {
  const graph = new StateGraph(GraphStateAnnotation)
    .addNode('orchestrator', orchestratorNode)
    .addNode('agent', agentNode)
    .addNode('mutationGate', mutationGateNode)
    .addNode('driftReply', driftReplyNode)
    .addEdge(START, 'orchestrator')
    .addConditionalEdges('orchestrator', routeAfterOrchestrator, {
      agent: 'agent',
      driftReply: 'driftReply',
      end: END,
    })
    .addEdge('agent', 'mutationGate')
    .addEdge('mutationGate', END)
    .addEdge('driftReply', END)

  return graph.compile({ checkpointer: checkpointer ?? new MemorySaver() })
}
