/**
 * graph.ts — createGraph factory + routeFromStart / routeAfterOrchestrator conditional edges
 *
 * Creates a StateGraph with nine nodes (Phase 12 Plan 06 added triggerGate; Phase 13
 * Plan 03 adds profileBuilder — Finding 1 human-path reachability fix):
 *   START → (conditional: routeFromStart) → facilitation | argGraphBuilder | orchestrator
 *   orchestrator → (conditional: routeAfterOrchestrator) → agent | driftReply | END
 *   agent → mutationGate → (conditional: routeAfterMutationGate) → argGraphBuilder | triggerGate | END
 *   driftReply → END
 *   facilitation → END
 *   argGraphBuilder → (conditional: routeAfterArgGraphBuilder) → analysis | profileBuilder
 *   profileBuilder → triggerGate
 *   analysis → mutationGate → (conditional: routeAfterMutationGate) → argGraphBuilder | triggerGate | END
 *   triggerGate → (conditional: routeAfterTriggerGate) → facilitation | analysis | END
 *
 * Phase 13 Plan 03 human path (Finding 1, 13-RESEARCH.md): on a real human message,
 * mutationGate → argGraphBuilder → profileBuilder → triggerGate — making state.argGraph
 * (and therefore ProfileBuilderNode's positions/assertions derivation, D-06) load-bearing
 * on every human turn for the first time in this project's history. The analysis_request
 * proactive path is UNCHANGED (routeAfterArgGraphBuilder's analysis_request branch still
 * goes straight to 'analysis', preserving Phase 11 behavior) — routeAfterMutationGate
 * distinguishes the two paths via state.triggerType (see its own doc comment below) so
 * argGraphBuilder is never re-entered a second time within the same invocation for the
 * analysis_request path (that would both double an LLM extraction call and break the
 * termination proof, since routeAfterArgGraphBuilder's analysis_request branch never
 * routes through triggerGate to set triggerGateComplete).
 *
 * checkpointer parameter enables the MemorySaver/PostgresSaver swap:
 *   - No arg (or undefined): defaults to MemorySaver (unit tests, D-11)
 *   - PostgresSaver: production (ORCH-05) and integration tests (D-12)
 *
 * routeFromStart implements Phase 11's conditional START edge (highest-risk topology
 * change of that phase — STATE.md). Reads state.triggerType (Plan 01):
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
 * Phase 12 Plan 06 — TriggerGateNode wiring (locked human-path reachability decision,
 * 12-CONTEXT.md/12-06-PLAN.md). TriggerGateNode (trigger-gate.ts) is now reachable from
 * BOTH the primary human-message path (agent → mutationGate → triggerGate) AND the
 * proactive analysis_request path (argGraphBuilder → triggerGate, for any OTHER
 * triggerType than analysis_request — analysis_request itself still routes straight to
 * 'analysis', preserving Phase 11 behavior unchanged).
 *
 * routeAfterMutationGate and routeAfterArgGraphBuilder — see each function's own doc
 * comment below (updated for Phase 13 Plan 03's Finding 1 human-path reachability fix,
 * which routes the human-message path through argGraphBuilder → profileBuilder before
 * triggerGate for the first time, while leaving the analysis_request path unchanged).
 *
 * routeAfterTriggerGate reads state.firingSkillRole (mirrors routeAfterOrchestrator's
 * shape): 'coach' → 'facilitation', 'analyst' → 'analysis', null (no Skill fired) →
 * 'end' — matches mutation-gate.ts's silent-below-threshold convention.
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
import { triggerGateNode } from './nodes/trigger-gate'
import { profileBuilderNode } from './nodes/profile-builder'

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
 * Conditional edge function that routes after MutationGateNode completes (Phase 12 Plan 06 —
 * T-12-16 loop guard; Phase 13 Plan 03 — Finding 1 human-path reachability fix). REPLACES the
 * fixed .addEdge('mutationGate', END) from Phase 6-11 (Pitfall: a fixed edge and a conditional
 * edge from the same source both fire — fan-out, not override — same class of bug already
 * documented for START/argGraphBuilder in this file).
 *
 * Reads state.triggerGateComplete (state.ts, Plan 01/06): triggerGateNode unconditionally sets
 * this to true on every one of its own return paths (trigger-gate.ts) — it is never reset back
 * to null within a single graph invocation (overwrite-style Annotation, no node ever writes
 * `false`/`null` to it once set). This guarantees termination:
 *   - Any pass through mutationGate ONCE triggerGateComplete === true → 'end'. This covers
 *     both the loop-guard's original subsequent-pass case AND the analysis_request path's
 *     own post-triggerGate mutationGate pass (CR-02 / routeAfterTriggerGate).
 *   - Otherwise (triggerGateComplete is still null — triggerGateNode has not run yet this
 *     invocation), the route depends on state.triggerType (Finding 1):
 *       - triggerType === null | undefined (the human-message path, reached via
 *         agent → mutationGate) → 'argGraphBuilder', so state.argGraph gets populated and
 *         profileBuilder runs BEFORE triggerGate for the first time on a real human turn.
 *       - triggerType === 'analysis_request' (reached via analysis → mutationGate, on the
 *         proactive path that already ran argGraphBuilder once via routeFromStart) →
 *         'triggerGate' directly, exactly as before Phase 13 — re-entering argGraphBuilder
 *         here would both double the extraction LLM call AND infinite-loop, since
 *         routeAfterArgGraphBuilder's analysis_request branch never routes through
 *         triggerGate to ever set triggerGateComplete=true.
 */
export function routeAfterMutationGate(state: GraphState): 'argGraphBuilder' | 'triggerGate' | 'end' {
  if (state.triggerGateComplete === true) {
    return 'end'
  }
  return state.triggerType === null || state.triggerType === undefined ? 'argGraphBuilder' : 'triggerGate'
}

/**
 * Conditional edge function that routes after ArgGraphBuilderNode completes (Phase 12 Plan 06;
 * Phase 13 Plan 03 — Finding 1). REPLACES the fixed .addEdge('argGraphBuilder', 'analysis')
 * from Phase 11 (same fan-out hazard as above — replaced, not added alongside).
 *
 * Preserves the exact Phase 11 analysis_request behavior as one branch: 'analysis' when
 * state.triggerType === 'analysis_request' (routeFromStart is the only caller that reaches
 * argGraphBuilder via START, and it only ever does so for this triggerType, so state.argGraph
 * was already populated by the time this router runs on that path). Any other triggerType
 * value reaching argGraphBuilder (in practice only null/undefined — routeAfterMutationGate is
 * the only OTHER caller of argGraphBuilder, and it only routes there for the human path, above)
 * routes to 'profileBuilder' instead, so ProfileBuilderNode can derive positions/assertions
 * from the argGraph this very call just populated (D-03/D-06) before continuing on to
 * triggerGate via a fixed profileBuilder → triggerGate edge.
 */
export function routeAfterArgGraphBuilder(state: GraphState): 'analysis' | 'profileBuilder' {
  return state.triggerType === 'analysis_request' ? 'analysis' : 'profileBuilder'
}

/**
 * Conditional edge function that routes after TriggerGateNode completes (Phase 12 Plan 06 —
 * D-06). Mirrors routeAfterOrchestrator's shape exactly. Reads state.firingSkillRole
 * (trigger-gate.ts's own return value) — never sets state itself, purely a router.
 *
 * CRITICAL (Pitfall 4): every normally-returned value MUST be a pathsMap key in createGraph's
 * addConditionalEdges('triggerGate', ...) call below.
 *
 * CR-02 fix (REVIEW.md): for the analysis_request trigger path, routeAfterArgGraphBuilder
 * already routed straight to 'analysis' once, by design, before triggerGate ever ran (see
 * that function's own doc comment). If an Analyst Skill also fires during this triggerGate
 * pass, routing back into 'analysis' here would invoke analyticsAgentNode a SECOND time in
 * the same graph.invoke() call — a duplicate LLM call and duplicate streamed response. Only
 * the human-message path (state.triggerType is null) hasn't run 'analysis' yet at this point,
 * so only that path is allowed to route there via an Analyst Skill firing.
 */
export function routeAfterTriggerGate(state: GraphState): 'facilitation' | 'analysis' | 'end' {
  if (state.firingSkillRole === 'coach') return 'facilitation'
  if (state.firingSkillRole === 'analyst') {
    return state.triggerType === 'analysis_request' ? 'end' : 'analysis'
  }
  // No Skill fired — silent exit, matches mutation-gate.ts's silent-below-threshold convention.
  return 'end'
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
    // Phase 12 Plan 06 new node
    .addNode('triggerGate', triggerGateNode)
    // Phase 13 Plan 03 new node (Finding 1 human-path reachability fix)
    .addNode('profileBuilder', profileBuilderNode)

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
    .addEdge('driftReply', END)

    // Phase 12 Plan 06 / Phase 13 Plan 03: conditional mutationGate edge REPLACES the
    // fixed .addEdge('mutationGate', END) (Phase 6-11) — T-12-16 loop guard + Finding 1
    // human-path reachability fix (see routeAfterMutationGate's own doc comment above for
    // the termination proof and the triggerType-based path split).
    .addConditionalEdges('mutationGate', routeAfterMutationGate, {
      argGraphBuilder: 'argGraphBuilder',
      triggerGate: 'triggerGate',
      end: END,
    })

    .addEdge('facilitation', END)

    // Phase 12 Plan 06 / Phase 13 Plan 03: conditional argGraphBuilder edge REPLACES the
    // fixed .addEdge('argGraphBuilder', 'analysis') (Phase 11) — preserves the exact
    // Phase 11 analysis_request behavior as one branch (Pitfall 3 — replace, don't add
    // alongside); the other branch now routes to profileBuilder (Finding 1) instead of
    // straight to triggerGate.
    .addConditionalEdges('argGraphBuilder', routeAfterArgGraphBuilder, {
      analysis: 'analysis',
      profileBuilder: 'profileBuilder',
    })

    // Phase 13 Plan 03: fixed profileBuilder → triggerGate edge (Finding 1) — always
    // continues to TriggerGateNode regardless of what profileBuilderNode's fail-open
    // return did (it always returns {}, never blocking this edge).
    .addEdge('profileBuilder', 'triggerGate')

    // Phase 12 Plan 06: TriggerGateNode's own conditional edge (D-06) — every return value
    // of routeAfterTriggerGate MUST be a pathsMap key here (Pitfall 4).
    .addConditionalEdges('triggerGate', routeAfterTriggerGate, {
      facilitation: 'facilitation',
      analysis: 'analysis',
      end: END,
    })

    // 'analysis' routes through mutationGate (same as 'agent') so that any
    // canvas mutation the Analyst proposes actually reaches state.canvasOps —
    // mutationGateNode already returns {} when state.agentOutput is null/
    // NO_ACTION, so this is a no-op for the common no-mutation case
    // (CR-01 fix — REVIEW.md). mutationGate's own conditional edge (above) then
    // applies the same T-12-16 loop guard regardless of which path reached it.
    .addEdge('analysis', 'mutationGate')

  return graph.compile({ checkpointer: checkpointer ?? new MemorySaver() })
}
