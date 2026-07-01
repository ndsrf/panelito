# Phase 6: Graph Construction + Checkpointer - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 6 delivers a fully-tested LangGraph StateGraph (OrchestratorNode → AgentNode → MutationGateNode) with PostgresSaver checkpointer and Langfuse observability — all built and tested in isolation before a single character of the /invoke route is touched. Specifically:
- A `StateGraph` with 3 nodes built in `apps/api/src/graph/`
- `OrchestratorNode`: DOMAIN_MATCH / DOMAIN_BRIDGE / DOMAIN_DRIFT classifier
- `AgentNode`: structured Claude call via `canvas_mutation` tool → ADD_NODE / ADD_EDGE / NO_ACTION + confidence
- `MutationGateNode`: threshold evaluation (>0.85 direct, 0.5–0.85 ghost, <0.5 silent)
- `DriftReplyNode`: optional real Claude call for DOMAIN_DRIFT (Blueprint-controlled via `drift_reply_probability`)
- PostgresSaver checkpointer (prepare:false, SUPABASE_DIRECT_URL) wired and verified
- Langfuse per-request CallbackHandler on every graph execution
- Unit tests (mock LLM) + PostgresSaver integration test (real Supabase)

Phase 6 ends when all 5 success criteria in ROADMAP.md §Phase 6 pass. The /invoke route (`apps/api/src/routes/ai.ts`) is NOT modified in this phase.

</domain>

<decisions>
## Implementation Decisions

### DOMAIN_DRIFT Reply Strategy

- **D-01:** A `DriftReplyNode` exists as a real LangGraph node that makes a lightweight Claude API call. It uses a minimal system prompt: respond naturally and helpfully to the off-topic message without rejecting or refusing. No canvas mutation, no error, no phase_signal output.
- **D-02:** The Blueprint schema gains a `drift_reply_probability: number` field (0.0–1.0). This field is added to both the Zod schema in `packages/types/src/blueprint.ts` (the `BlueprintSchema`) AND the Ajv meta-schema in `apps/api/src/lib/blueprint-loader.ts`. Default for Debate Blueprint: Claude decides (likely 0.8).
- **D-03:** On DOMAIN_DRIFT, the OrchestratorNode reads `blueprint.drift_reply_probability` from `config.configurable`, rolls a random number. If roll < probability → conditional edge routes to `DriftReplyNode` → Claude generates reply → SSE text_delta events, no canvas mutation. If roll ≥ probability → silent exit: no SSE events, graph ends immediately.
- **D-04:** The Langfuse trace MUST record DRIFT events even on silent exits. The OrchestratorNode span must include attributes: `drift_probability`, `drift_roll`, `drift_action: 'replied' | 'ignored'`. Observability is the primary requirement even when no reply is generated.

### AgentNode Structured Output

- **D-05:** AgentNode uses tool use (`canvas_mutation` tool schema) to force structured Claude output — consistent with the existing `render_panel` tool pattern in `apps/api/src/routes/ai.ts`. NOT `withStructuredOutput()` from LangGraph.
- **D-06:** `canvasMutationTool` is exported from `packages/types/` alongside `renderPanelTool`. Claude decides the exact file location (`packages/types/src/ai.ts` or a new `packages/types/src/canvas-tool.ts`) following the established pattern.
- **D-07:** Blueprint vocabulary constraint (allowed node_type / edge_type ids) is enforced by two mechanisms: (a) system prompt injection (OrchestratorNode injects Blueprint node_types and edge_types into the AgentNode context before it runs), (b) MutationGateNode post-validates the returned node/edge type against `blueprint.node_types` and `blueprint.edge_types`. The static Zod/tool schema accepts any string — dynamic Blueprint constraints are not baked into the schema.

### LangGraph State Schema

- **D-08:** `blueprintId: string` is part of the checkpointed LangGraph State type. This is the only Blueprint reference stored in the checkpoint.
- **D-09:** The full `Blueprint` object is NOT in the checkpointed state. It is loaded fresh per-invocation via `loadBlueprint(blueprintId)` (from `apps/api/src/lib/blueprint-loader.ts`) and passed to the graph via LangGraph `config.configurable`. This keeps checkpoint payloads lean and ensures Blueprint updates take effect on next invocation without state migration.
- **D-10:** State type explicitly includes (user-locked fields):
  - `currentPhaseId: string` — the active Blueprint phase id (from `sessions.current_phase` in Supabase); drives BLUE-04 system prompt mutation per phase
  - `messages: ProviderMessage[]` — conversation history fed into AgentNode prompt; uses LangGraph's `MessagesAnnotation` accumulator pattern
  - `canvasOps: CanvasOp[]` — accumulated canvas operations produced by this thread; MutationGateNode appends to this list
- Claude designs the remaining state fields (guardrail result, confidence score, intermediate outputs) based on LangGraph JS patterns.

### Test Isolation Strategy

- **D-11:** All Claude API calls in Phase 6 tests use a mock `AIProvider` adapter (created via `createAdapter()` factory or a test stub class) that returns deterministic pre-written responses. The mock stub set must cover all graph paths:
  - DOMAIN_MATCH response + ADD_NODE with confidence 0.9 (→ direct commit path)
  - DOMAIN_MATCH response + ADD_EDGE with confidence 0.7 (→ ghost node path)
  - DOMAIN_MATCH response + NO_ACTION with confidence 0.3 (→ silent path)
  - DOMAIN_DRIFT classification + drift reply text (→ DriftReplyNode path)
  - DOMAIN_DRIFT classification with silent roll (→ no output path)
- **D-12:** The PostgresSaver checkpointer test is an integration test that connects to the real Supabase instance via `SUPABASE_DIRECT_URL`. It verifies: (a) graph state is stored in the `langgraph.checkpoints` table after the first invocation, (b) a second invocation on the same `thread_id` correctly resumes from checkpoint (state accumulates, not resets). Requires `SUPABASE_DIRECT_URL` in test environment.

### Claude's Discretion

- Exact `canvasMutationTool` schema (tool input shape for ADD_NODE, ADD_EDGE, NO_ACTION — including confidence field)
- Remaining LangGraph State fields beyond the user-locked set in D-10
- `graph/` directory structure (`graph/state.ts`, `graph/nodes/`, `graph/graph.ts` or flat variant)
- Langfuse `waitUntil` flush pattern for Hono Node.js runtime (vs Edge Runtime `executionCtx.waitUntil`)
- Debate Blueprint `drift_reply_probability` default value
- `MemorySaver` vs `PostgresSaver` switch mechanism in the graph factory (test vs prod)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and Roadmap
- `.planning/REQUIREMENTS.md` — Full v2.0 requirements; Phase 6 maps to BLUE-03, BLUE-04, ORCH-02, ORCH-03, ORCH-04, ORCH-05, HUMAN-03, OBS-01, OBS-02 (with traceability table at bottom)
- `.planning/ROADMAP.md §Phase 6` — 5 success criteria that must be TRUE; also contains Phase 7 goals to understand what Phase 6 must NOT touch
- `.planning/REQUIREMENTS.md §Out of Scope` — LangGraph interrupt() explicitly banned; per-domain DB schemas banned; module-level Langfuse singleton banned

### Existing Types (READ before defining any new types)
- `packages/types/src/blueprint.ts` — Blueprint, NodeTypeConfig, EdgeTypeConfig, PhaseSequence; `drift_reply_probability: number` field must be added here (and to BlueprintSchema)
- `packages/types/src/canvas.ts` — CanvasNode, CanvasEdge, CanvasOp, CanvasNodeStatus; CanvasOp is what AgentNode emits and MutationGateNode processes
- `packages/types/src/ai.ts` — renderPanelTool and ProviderTool type; canvasMutationTool follows this exact pattern
- `packages/types/src/index.ts` — How types are re-exported; new exports from Phase 6 additions follow the same pattern

### Existing Services (USE, don't duplicate)
- `apps/api/src/lib/blueprint-loader.ts` — `loadBlueprint(blueprintId: string): Promise<Blueprint>`; Ajv validation included; also needs `drift_reply_probability` added to its JSON meta-schema
- `apps/api/src/lib/env.ts` — `SUPABASE_DIRECT_URL` is already validated here; no additional env work needed
- `apps/api/src/lib/adapter-factory.ts` — `createAdapter(providerName, plaintextKey)` returns AIProvider; AgentNode and DriftReplyNode use this, NOT LangGraph's native model binding
- `apps/api/src/lib/supabase.ts` — `createServiceClient()` for any Supabase calls within graph nodes

### Do NOT Touch (Phase 7's domain)
- `apps/api/src/routes/ai.ts` — The /invoke route is Phase 7's integration point; Phase 6 builds the graph in isolation only

### Supabase Migrations (reference only — tables already exist from Phase 5)
- `supabase/migrations/0008_*.sql` — LangGraph checkpointer tables already created (`langgraph.checkpoints`, `langgraph.checkpoint_blobs`, `langgraph.checkpoint_writes`); Phase 6 should NOT create new migrations unless there's a gap

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/lib/blueprint-loader.ts` — `loadBlueprint()` is the graph's Bootstrap entry point; call it before `graph.invoke()` and pass result via `config.configurable`
- `packages/types/src/ai.ts#renderPanelTool` — Copy this pattern exactly for `canvasMutationTool`; the ProviderTool interface is already compatible with the AIProvider abstraction
- `apps/api/src/lib/adapter-factory.ts#createAdapter` — Both AgentNode and DriftReplyNode instantiate AIProvider via this factory; no direct Anthropic SDK calls inside graph nodes
- Existing Vitest setup in `apps/api` — Phase 6 tests follow the same test file naming convention as `apps/api/src/routes/*.test.ts`

### Established Patterns
- Tool use for structured output: `render_panel` in `ai.ts` forces Claude to call a tool; `canvas_mutation` follows the same pattern with a different schema
- Service module pattern: `apps/api/src/lib/` has flat single-file service modules (`blueprint-loader.ts`, `supabase.ts`, etc.); the graph module breaks this pattern (3 nodes + state + routing logic suggests a dedicated `apps/api/src/graph/` directory)
- Ajv + Zod double-validation: blueprint-loader.ts already does this (Ajv checks structure, Zod produces typed value); MutationGateNode should follow the same defense-in-depth for canvas op vocabulary validation

### Integration Points
- `sessions.blueprint_id` → `loadBlueprint()` → `config.configurable.blueprint` → OrchestratorNode/AgentNode
- `sessions.current_phase` → initial LangGraph state `currentPhaseId` → AgentNode system prompt mutation (BLUE-04)
- `sessions.id` / `branch_id` → LangGraph `thread_id` (ORCH-05) → PostgresSaver checkpoint key
- Graph output (committed CanvasOps) → `canvas_nodes` / `canvas_edges` Supabase upserts (Phase 8's job — Phase 6 only produces the ops, does not write to DB)

</code_context>

<specifics>
## Specific Ideas

- **drift_reply_probability as float**: The user explicitly wants probabilistic drift behavior ("sometimes let it go, sometimes engage"). This means the roll must be truly random — `Math.random()` in the OrchestratorNode at runtime, not a deterministic hash. Mock tests must simulate both outcomes explicitly (by passing `drift_roll` as a test override or having two separate mock stubs).
- **DRIFT must always produce a Langfuse trace**: Even when `drift_roll >= drift_reply_probability` and no SSE is emitted, the Langfuse trace for that invocation must record the DRIFT classification and the silent exit. The user's key requirement is observability, not just chat UX.
- **canvasMutationTool in @panelito/types**: Keeps the web frontend able to import the schema (in case Phase 9 needs to parse canvas_mutation payloads client-side for ghost node display logic). This is future-proofing that the user approved.
- **MemorySaver for tests, PostgresSaver for prod**: The graph factory must support a checkpointer override to enable test-time use of MemorySaver (no DB required for pure unit tests) and PostgresSaver in production. Claude designs this switch mechanism.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 6-graph-construction-checkpointer*
*Context gathered: 2026-07-01*
