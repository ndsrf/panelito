---
phase: 06-graph-construction-checkpointer
plan: "03"
subsystem: api
tags: [langgraph, stategraph, orchestrator, agent, mutation-gate, drift-reply, memorysaver, tdd, wave-2]
dependency_graph:
  requires:
    - "06-01: canvasMutationTool in @panelito/types"
    - "06-01: drift_reply_probability field on BlueprintSchema"
    - "06-02: getCheckpointer() singleton (PostgresSaver)"
    - "06-02: setupLangfuseOtel() infrastructure"
  provides:
    - "GraphStateAnnotation (Annotation.Root) + GraphState type — apps/api/src/graph/state.ts"
    - "orchestratorNode: DOMAIN_MATCH/BRIDGE/DRIFT classification + D-03 drift roll"
    - "agentNode: canvasMutationTool structured output + CanvasOpSchema.safeParse"
    - "mutationGateNode: ORCH-04 confidence thresholds + D-07 blueprint vocabulary post-validation"
    - "driftReplyNode: conversational reply, no canvas mutation (HUMAN-03)"
    - "createGraph(checkpointer?) factory + routeAfterOrchestrator conditional edges"
    - "graph.test.ts: all 5 D-11 mock paths passing under MemorySaver"
  affects:
    - "06-04: server.ts wires setupLangfuseOtel() + CallbackHandler per-request; Langfuse spans capture drift_probability/roll/action from orchestratorNode console output"
    - "06-05: PostgresSaver integration test calls createGraph(await getCheckpointer())"
    - "07-invoke-route: /invoke route calls createGraph(checkpointer) and passes config.configurable"
tech_stack:
  added: []
  patterns:
    - "Annotation.Root with custom concat reducer for ProviderMessage[] — avoids MessagesAnnotation (RESEARCH Pitfall 6)"
    - "Annotation reducer: (_, v) => v for overwrite-semantics nullable fields with default"
    - "Node function signature: (state: GraphState, config?: any) — required for LangGraph 1.4.7 NodeAction type compatibility"
    - "config.configurable seam pattern: classifierAdapter/agentAdapter/driftReplyAdapter for test injection without modifying production paths"
    - "drift_reply_probability=1.0 / 0.0 blueprint override for deterministic drift path testing"
    - "Valid v4 UUID strings for CanvasOpSchema.safeParse (Zod strict uuid validator requires version digit 1-8)"
key_files:
  created:
    - "apps/api/src/graph/state.ts"
    - "apps/api/src/graph/nodes/orchestrator.ts"
    - "apps/api/src/graph/nodes/agent.ts"
    - "apps/api/src/graph/nodes/mutation-gate.ts"
    - "apps/api/src/graph/nodes/drift-reply.ts"
    - "apps/api/src/graph/graph.ts"
    - "apps/api/src/graph/graph.test.ts"
  modified: []
decisions:
  - "Node signatures use 'config?: any' instead of a custom RunnableConfig interface — LangGraph 1.4.7's NodeAction type expects Runtime<...> which is not assignable to a custom interface without an index signature"
  - "Overwrite-semantics nullable fields (guardrailResult, agentConfidence, driftAction, agentOutput) use reducer: (_,v)=>v + default instead of Annotation<T>() (no-arg) — the no-arg form creates LastValue channel with no default support"
  - "Drift path control in tests via blueprint.drift_reply_probability override (1.0=always-replied, 0.0=always-ignored) — cleaner than Math.random mocking; avoids vi.spyOn complexity"
  - "classifierAdapter and agentAdapter as separate config.configurable seams — allows independent mock per role; avoids call-count ordering"
metrics:
  duration: "25 minutes"
  completed: "2026-07-02T13:46:00Z"
  tasks: 3
  files: 7
---

# Phase 6 Plan 03: Graph Construction + Unit Tests Summary

**One-liner:** Full LangGraph StateGraph with OrchestratorNode (DOMAIN_MATCH/BRIDGE/DRIFT + drift roll), AgentNode (canvasMutationTool structured output), MutationGateNode (confidence thresholds + Blueprint vocabulary validation), DriftReplyNode (conversational, no canvas mutation), and createGraph factory — proven by 5/5 D-11 mock paths under MemorySaver.

## What Was Built

### Task 1: Graph state schema + OrchestratorNode

Created `apps/api/src/graph/state.ts` with `GraphStateAnnotation.Root`:
- `blueprintId: string`, `currentPhaseId: string` — LangGraph overwrite channels (D-08, D-10)
- `messages: ProviderMessage[]`, `canvasOps: CanvasOp[]` — custom concat reducers (avoids MessagesAnnotation, RESEARCH Pitfall 6 verified)
- `guardrailResult`, `agentConfidence`, `driftAction`, `agentOutput` — nullable fields with identity reducer + `default: () => null`
- Exports `GraphStateAnnotation` and `type GraphState`

Created `apps/api/src/graph/nodes/orchestrator.ts` with `orchestratorNode`:
- Reads `blueprint`, `providerName`, `plaintextKey` from `config.configurable`
- `classifierAdapter` seam for test injection
- BLUE-04: `blueprint.phase_sequence.find(p => p.id === state.currentPhaseId) ?? phase_sequence[0]`
- BLUE-03: builds system prompt with node_types, edge_types, phase llm_instructions
- Classifies via `adapter.stream()` → parses DOMAIN_MATCH/BRIDGE/DRIFT text response
- D-03: `Math.random()` vs `drift_reply_probability` → `driftAction: 'replied' | 'ignored'`
- D-04: `console.info('[orchestrator] drift event', { drift_probability, drift_roll, drift_action })`
- Fail-open on classification error → DOMAIN_BRIDGE

### Task 2: AgentNode + MutationGateNode + DriftReplyNode

Created `apps/api/src/graph/nodes/agent.ts`:
- `buildAgentSystemPrompt(blueprint, currentPhaseId)` helper: BLUE-03 node/edge vocab + BLUE-04 phase instructions
- Streams with `[canvasMutationTool]` tools array; collects first `canvas_mutation` tool_use event
- `CanvasOpSchema.safeParse(event.input)` — T-06-08: failure logged + dropped (fail-silent)
- Returns `{ agentOutput, agentConfidence }`

Created `apps/api/src/graph/nodes/mutation-gate.ts`:
- D-07 blueprint vocabulary post-validation: `blueprint.node_types.some(n => n.id === op.node_type_id)` / `blueprint.edge_types.some(e => e.id === op.edge_type_id)`
- ORCH-04: `confidence > 0.85` → 'committed'; `confidence >= 0.5` → 'ghost'; else → silent `{}`
- Returns `{ canvasOps: [{ ...op, status }] }` (reducer appends)

Created `apps/api/src/graph/nodes/drift-reply.ts`:
- Minimal "respond naturally, do not refuse" system prompt (D-01, HUMAN-03)
- `adapter.stream([lastMessage], [], ...)` — empty tools array (never mutates canvas)
- Returns `{ driftAction: 'replied' }` only — NEVER emits canvasOp

### Task 3: createGraph factory + 5 D-11 unit tests

Created `apps/api/src/graph/graph.ts`:
- `createGraph(checkpointer?) → CompiledGraph` — MemorySaver default, accepts PostgresSaver
- `routeAfterOrchestrator(state)`: DOMAIN_DRIFT+replied→'driftReply', DOMAIN_DRIFT+ignored→'end', otherwise→'agent'
- `addConditionalEdges('orchestrator', routeAfterOrchestrator, { agent, driftReply, end: END })`
- `addEdge('agent','mutationGate')`, `addEdge('mutationGate', END)`, `addEdge('driftReply', END)`

Created `apps/api/src/graph/graph.test.ts`:
- `createMockAdapter(events: AIStreamEvent[]): AIProvider` — deterministic async generator
- Debate Blueprint fixture with node_types=['hypothesis','evidence','counter_argument','action'] and edge_types=['SUPPORTS','CONTRADICTS','BUILDS_ON']
- 5 D-11 paths using `classifierAdapter` + `agentAdapter` seams:
  1. MATCH + ADD_NODE conf 0.9 → `canvasOps[0].status === 'committed'` ✓
  2. MATCH + ADD_EDGE conf 0.7 → `canvasOps[0].status === 'ghost'` ✓
  3. MATCH + NO_ACTION → `canvasOps.length === 0` ✓
  4. DRIFT + drift_reply_probability=1.0 → `driftAction === 'replied'`, 0 canvasOps ✓
  5. DRIFT + drift_reply_probability=0.0 → `driftAction === 'ignored'`, 0 canvasOps ✓

## Verification Results

| Check | Result |
|-------|--------|
| `node_modules/.bin/tsc --noEmit` (graph files) | PASS — 0 errors in graph/ |
| `vitest run src/graph/graph.test.ts` | PASS — 5/5 tests |
| `grep -rn "^import.*@anthropic-ai/sdk" graph/nodes/` | PASS — no direct SDK imports |
| `apps/api/src/graph/state.ts` contains `Annotation.Root` | PASS |
| `apps/api/src/graph/state.ts` does NOT contain `MessagesAnnotation` | PASS |
| `apps/api/src/graph/nodes/mutation-gate.ts` contains `0.85` and `0.5` | PASS |
| `apps/api/src/graph/graph.ts` exports `createGraph` and `addConditionalEdges` | PASS |
| `apps/api/src/graph/graph.test.ts` contains `MemorySaver` | PASS |
| `apps/api/src/graph/graph.test.ts` does NOT contain `getCheckpointer` | PASS |

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 6641913 | feat | implement graph state schema and OrchestratorNode |
| 7b8379f | feat | implement AgentNode, MutationGateNode, and DriftReplyNode |
| 8727057 | feat | createGraph factory, routeAfterOrchestrator, and unit tests for all 5 D-11 paths |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Annotation nullables require `reducer` key, not just `default`**
- **Found during:** Task 1 TypeScript check
- **Issue:** `Annotation<T>({ default: () => null })` rejected by TypeScript — `SingleReducer<T>` type requires either `reducer` or `value` key; `{ default }` alone is not a valid overload
- **Fix:** Changed to `{ reducer: (_: T, v: T) => v, default: () => null }` for all nullable overwrite-semantics fields
- **Files modified:** `apps/api/src/graph/state.ts`

**2. [Rule 1 - Bug] Custom `RunnableConfig` interface incompatible with LangGraph 1.4.7 `NodeAction` type**
- **Found during:** Task 3 TypeScript check (graph.ts `addNode` call)
- **Issue:** LangGraph's `NodeAction<S, U>` expects node functions whose second parameter type accepts `Runtime<S, unknown, unknown>`. A custom interface without `[key: string]: unknown` index signature is not assignable to `Runtime`.
- **Fix:** Changed all node function signatures to `config?: any`. The runtime values are the same; only the TypeScript type is loosened to satisfy the NodeAction constraint.
- **Files modified:** orchestrator.ts, agent.ts, mutation-gate.ts, drift-reply.ts

**3. [Rule 1 - Bug] ADD_EDGE mock used invalid UUID strings**
- **Found during:** Task 3 test run (Path 2 failure)
- **Issue:** `CanvasOpSchema` uses `z.string().uuid()` for source/target node ids. Zod v4's UUID validator is strict — requires version digit 1-8 in the third segment. `00000000-0000-0000-0000-000000000001` fails (version digit `0`).
- **Fix:** Changed to valid v4 UUID strings: `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11` etc.
- **Files modified:** `apps/api/src/graph/graph.test.ts`

## Known Stubs

None — all nodes make real LLM calls (mocked via adapter seams in tests; production uses createAdapter()). No hardcoded placeholder values in the graph execution path.

## Threat Flags

None — no new network endpoints beyond existing `/invoke` route (not modified). No new auth paths or trust boundary changes. The MutationGateNode T-06-07 and AgentNode T-06-08 mitigations from the plan's threat register are both implemented as specified.

## Self-Check

| File | Status |
|------|--------|
| apps/api/src/graph/state.ts | FOUND |
| apps/api/src/graph/nodes/orchestrator.ts | FOUND |
| apps/api/src/graph/nodes/agent.ts | FOUND |
| apps/api/src/graph/nodes/mutation-gate.ts | FOUND |
| apps/api/src/graph/nodes/drift-reply.ts | FOUND |
| apps/api/src/graph/graph.ts | FOUND |
| apps/api/src/graph/graph.test.ts | FOUND |

| Commit | Status |
|--------|--------|
| 6641913 | FOUND |
| 7b8379f | FOUND |
| 8727057 | FOUND |

## Self-Check: PASSED
