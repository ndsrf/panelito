# Phase 7: /invoke Route Modification - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 7 wires the Phase 6 LangGraph StateGraph into the live `/invoke` route (`apps/api/src/routes/ai.ts`), replacing the direct `adapter.stream()` call with `graph.astream()`. Every user message that reaches this route now executes the full OrchestratorNode → AgentNode → MutationGateNode pipeline (or the DOMAIN_DRIFT path through DriftReplyNode).

This phase also finalizes the Phase 6 graph nodes to support real-time SSE text streaming (the streamWriter seam), adds LANGFUSE_TRACE_LEVEL env control, and enforces Blueprint-mandatory sessions (v1 backward compat is explicitly dropped).

Phase 7 ends when all 4 success criteria in ROADMAP.md §Phase 7 pass. Canvas mutations from MutationGateNode are NOT written to Supabase in this phase (that is Phase 8). Ghost nodes are not yet rendered on the frontend (Phase 9).

</domain>

<decisions>
## Implementation Decisions

### V1 Session Deprecation

- **D-01:** V1 backward compatibility is dropped in Phase 7. Sessions with no `blueprint_id` return `c.json({ error: 'no_blueprint' }, 400)` immediately, before any AI call. No dual code path. All sessions that reach the graph must have an active Blueprint.
- **D-02:** The existing `session.active_personas` 409 gate (`no_active_persona`) is preserved — it runs after the `no_blueprint` check. Blueprints activate default personas (via `blueprint.default_personas` field — a Phase 5/Foundation concern already seeded in the Blueprint schema); creators can add extra personas on top.

### Session Data Fetching

- **D-03:** The session SELECT query must be expanded to include `blueprint_id` and `current_phase` (in addition to the existing `id, creator_id, active_personas`). These two fields populate the initial LangGraph state. `blueprint_id` drives the 400 gate; `current_phase` maps to `currentPhaseId` in state (BLUE-04).
- **D-04:** `loadBlueprint(blueprintId)` is called immediately after session fetch and before opening the SSE stream. The full Blueprint object is passed via `config.configurable.blueprint`. This is the same pattern as Phase 6 test setup.

### Text Streaming Seam

- **D-05:** Text tokens from AgentNode and DriftReplyNode reach the SSE client via a **streamWriter seam**: `streamWriter?: (text: string) => void` is added to `config.configurable`. Both AgentNode and DriftReplyNode call `config.configurable.streamWriter?.(event.text)` for each `text_delta` event in their `adapter.stream()` loop. This requires a one-line change to each node.
- **D-06:** The route creates an async queue (EventEmitter or async generator pattern) backed by streamWriter. Inside `streamSSE(c, ...)`, the route runs `Promise.all([graphExecution, ssePiping])` — the graph runs in one branch, the SSE consumer drains the queue in the other. The SSE stream emits a `done` event only after both branches resolve.
- **D-07:** No new npm packages are added for streaming. The AIProvider adapter abstraction is preserved inside graph nodes.

### AI Text Output Rules (AgentNode)

- **D-08:** AgentNode system prompt explicitly bans canvas meta-commentary. Banned phrases include: "I added a node", "I mapped this to", "I connected", "I've recorded", and any description of what was done to the canvas. The LLM must NOT describe its own canvas operations.
- **D-09:** AgentNode produces text output **only when the information cannot be fully represented in the canvas mutation**. If the canvas mutation fully captures the insight, output NO text. Prefer silence. Text should be 1–2 sentences of substantive insight, context, or implication that enriches the human's point beyond what the canvas shows.
- **D-10:** AgentNode's `buildAgentSystemPrompt()` is updated to accept active persona instructions and append them after the Blueprint's phase instructions. The route passes `active_personas` via `config.configurable` (alongside `blueprint`, `providerName`, `plaintextKey`). Blueprint defines domain constraints; persona adds rhetorical style.

### AI Behavior on DOMAIN_BRIDGE

- **D-11:** On DOMAIN_BRIDGE, the route still goes to AgentNode for a best-effort canvas mutation. In addition, a probability-gated steering text is produced: the OrchestratorNode applies the same `blueprint.drift_reply_probability` roll it uses for DOMAIN_DRIFT. If roll < probability → the AgentNode also produces a brief, friendly steering text in the chat bubble, guiding the human back toward the Blueprint's active phase objective. If roll ≥ probability → canvas mutation only, no steering text.
- **D-12:** Steering text on DOMAIN_BRIDGE is polite and redirective, never corrective or condescending. Example tone: "That's an interesting angle — for our Debate session, it might help to frame this as a Hypothesis or Evidence." The text must not mention "blueprint", "domain", or technical terms — it should feel like natural facilitation.

### Blueprint + Persona Integration

- **D-13:** In Blueprint sessions, the existing `active_personas` session field still works. Blueprints set their default personas (Blueprint schema concern). Creators can add extra personas on top — even unusual combinations. The PERSONA_LIBRARY lookup and `matchedPersonas` filtering in the route still applies; the 409 `no_active_persona` gate is unchanged.

### Abort Controller

- **D-14:** Claude picks the abort mechanism. Hard requirement: client disconnect MUST be logged in Langfuse as a trace attribute or event on the graph execution span. The mechanism (`c.req.raw.signal` preferred for simplicity) must propagate to `graph.astream()` via `config.signal`.

### Langfuse Tracing

- **D-15:** New env var `LANGFUSE_TRACE_LEVEL: 'graph' | 'full'`. Default: `'graph'` — the per-request Langfuse CallbackHandler on `graph.astream()` (from Phase 6) is the only trace point. `'full'`: the entire route handler is wrapped in a Langfuse parent span, making DB query latency visible alongside graph spans. Validated in `apps/api/src/lib/env.ts` with a union type. Add to `.env.example`.
- **D-16:** Early-exit paths (400, 409, 429) are NOT traced in either level — they are routing errors, not AI calls.

### Claude's Discretion

- Exact `Promise.all` / async queue coordination pattern for concurrent graph + SSE piping
- Whether to use `c.req.raw.signal` directly or create a manual AbortController with Hono stream lifecycle events
- The `active_personas` field name in `config.configurable` (suggest `activePersonas: string[]`)
- `buildAgentSystemPrompt()` signature extension to accept persona instructions
- LANGFUSE_TRACE_LEVEL 'full' route-level parent span implementation details

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and Roadmap
- `.planning/REQUIREMENTS.md` — ORCH-01 is the primary requirement for Phase 7; also INFRA-03 (shared types), BLUE-03 (Blueprint vocab injection), BLUE-04 (phase-aware prompts), ORCH-02 through ORCH-05 (established in Phase 6)
- `.planning/ROADMAP.md §Phase 7` — 4 success criteria that must be TRUE; read the exact language for "abort controller" and "Langfuse trace" criteria
- `.planning/REQUIREMENTS.md §Out of Scope` — LangGraph interrupt() banned; per-domain DB schemas banned; module-level Langfuse singleton banned

### Prior Phase Context (READ — Phase 7 extends Phase 6 decisions)
- `.planning/phases/06-graph-construction-checkpointer/06-CONTEXT.md` — All Phase 6 decisions (D-01 through D-12) apply; especially D-05 (tool use pattern), D-09 (Blueprint in configurable), D-10 (state schema), D-11/D-12 (test strategy). Phase 7 must NOT contradict these.

### The Route Being Modified
- `apps/api/src/routes/ai.ts` — Current /invoke route; Phase 7 replaces steps 8-9 (adapter.stream call + SSE loop) with graph.astream() + streamWriter piping. Steps 1-7 (session fetch, cap check, persona gate, provider/key resolution) remain largely intact (D-03 adds blueprint_id + current_phase to session SELECT).

### Graph (Phase 6 deliverables)
- `apps/api/src/graph/graph.ts` — `createGraph(checkpointer?)` factory; Phase 7 calls this with a PostgresSaver instance
- `apps/api/src/graph/state.ts` — `GraphStateAnnotation` and `GraphState` type; Phase 7 populates initial state from route context
- `apps/api/src/graph/nodes/agent.ts` — `agentNode` and `buildAgentSystemPrompt()`; Phase 7 adds `active_personas` to configurable and extends `buildAgentSystemPrompt()` to include persona instructions; adds `streamWriter` call in text_delta branch
- `apps/api/src/graph/nodes/drift-reply.ts` — `driftReplyNode`; Phase 7 adds `streamWriter` call in text_delta branch (one-line change)
- `apps/api/src/graph/nodes/orchestrator.ts` — `orchestratorNode`; Phase 7 extends DOMAIN_BRIDGE handling to apply drift_reply_probability roll for steering text decision (D-11)
- `apps/api/src/graph/nodes/mutation-gate.ts` — `mutationGateNode`; Phase 7 does NOT modify this node

### Existing Services (USE, don't duplicate)
- `apps/api/src/lib/blueprint-loader.ts` — `loadBlueprint(blueprintId)` — call this before graph.astream(); result passed as `config.configurable.blueprint`
- `apps/api/src/lib/supabase.ts` — `createServiceClient()` for PostgresSaver initialization
- `apps/api/src/lib/env.ts` — add `LANGFUSE_TRACE_LEVEL` union type validation here
- `apps/api/src/lib/anthropic.ts` — `assemblePromptArray()` and `compressHistory()` — the route still uses these to build `state.messages` before graph invocation (history compression stays in the route, not the graph)

### Types (check before defining anything new)
- `packages/types/src/canvas.ts` — CanvasOp, CanvasNode, CanvasEdge
- `packages/types/src/blueprint.ts` — Blueprint, NodeTypeConfig, EdgeTypeConfig; Phase 7 reads `blueprint.drift_reply_probability` for DOMAIN_BRIDGE (D-11)
- `packages/types/src/ai.ts` — ProviderMessage, AIProvider interface, renderPanelTool; Phase 7 removes `renderPanelTool` from the route's tool list (it was v1 only)

### Do NOT Touch (Phase 8 domain)
- `supabase/migrations/` — No new DB migrations in Phase 7
- Canvas upserts to `canvas_nodes` / `canvas_edges` — Phase 8's job
- Supabase Realtime httpSend for canvas mutations — Phase 8's job
- `sessions.current_phase` write path — Phase 8 (Human Consensus Pattern)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/lib/anthropic.ts#assemblePromptArray` — Still used in Phase 7 to build the initial `state.messages` from history + compression before graph.astream(). The graph's message accumulator starts with this output.
- `apps/api/src/lib/anthropic.ts#compressHistory` — Still used in Phase 7; the route still compresses history pre-graph (compression stays outside the graph to keep checkpoint payloads lean, per D-09 from Phase 6).
- `apps/api/src/lib/blueprint-loader.ts#loadBlueprint` — Call this between session fetch (step 1) and graph invocation; result into config.configurable.
- `apps/api/src/lib/cap-guard.ts` — `checkCap` + `incrementCount` — preserved unchanged; incrementCount called after graph completes and text has been produced.

### Established Patterns
- **SSE streaming via Hono streamSSE**: The `streamSSE(c, async (stream) => { ... })` wrapper is preserved. The queue fed by streamWriter pipes into `stream.writeSSE()` calls — same SSE format (text_delta, done, error events).
- **Per-request Langfuse CallbackHandler**: From Phase 6. Passed as a callback in `config.callbacks` (not `config.configurable`). Phase 7 adds LANGFUSE_TRACE_LEVEL control around this instantiation.
- **Test adapter injection seam**: `config.configurable.agentAdapter` / `config.configurable.driftReplyAdapter` / `config.configurable.classifierAdapter` — Phase 7 tests use these to inject mocks without a real Anthropic key.
- **MemorySaver vs PostgresSaver swap**: Phase 7 integration tests pass MemorySaver; production route uses PostgresSaver initialized from SUPABASE_DIRECT_URL.
- **fail-silent error handling**: Consistent with Phase 6 nodes — route logs errors and emits generic `stream_failed` SSE event; no provider-specific detail leaked (T-04-15).

### Integration Points
- `aiRouter.post('/:id/invoke', ...)` — The handler in `apps/api/src/routes/ai.ts`; Phase 7 modifies steps 8-9 and adds a blueprint_id gate at step 1.5 (between session fetch and cap check).
- `sessions` table — Phase 7 needs `blueprint_id` and `current_phase` in the SELECT
- `creator_settings` table — Unchanged; provider + key resolution stays the same
- `messages` table — INSERT after graph completes; `canvas_snapshot_state` is set to null for Blueprint sessions in Phase 7 (canvas DB writes are Phase 8)
- LangGraph `config.configurable` — `blueprint`, `providerName`, `plaintextKey`, `activePersonas` (new in Phase 7), `streamWriter` (new in Phase 7), `agentAdapter`/`driftReplyAdapter`/`classifierAdapter` (test seams from Phase 6)

</code_context>

<specifics>
## Specific Ideas

- **Steering text tone for DOMAIN_BRIDGE**: Natural facilitation, not technical correction. Never say "blueprint", "domain", or "ontology". Example: "That's an interesting angle — for our Debate session, it might help to frame this as a Hypothesis or Evidence." The user explicitly wants this to feel like a skilled human facilitator redirecting conversation.
- **Silence as the default**: When AgentNode produces a canvas mutation that fully captures the insight, it should produce NO text. The user's preference is silence over explanation. Only add text when it adds substantive value not representable in the canvas.
- **drift_reply_probability governs both DOMAIN_DRIFT and DOMAIN_BRIDGE**: The same probability roll controls whether a text reply is generated in both cases. DOMAIN_DRIFT: probabilistic full conversational reply. DOMAIN_BRIDGE: probabilistic steering text (while still routing to AgentNode for canvas mutation).
- **Blueprint = session type**: When a creator creates a session, the session type determines the Blueprint. "Debate session" → Debate/Strategy Blueprint. This is a product-level constraint the researcher and planner should be aware of (UI/creation flow is Phase 9/later, but the data model implication exists now).
- **Blueprint activates default personas**: Blueprints have a `default_personas` field (established in Phase 5 Foundation). The 409 `no_active_persona` gate stays, but Blueprint personas are pre-seeded at session creation time. Phase 7 assumes this is already working.
- **LANGFUSE_TRACE_LEVEL=graph is the default**: Production should default to graph-only tracing. 'full' is a debugging tool. The planner should set the default in `env.ts` to `'graph'`.

</specifics>

<deferred>
## Deferred Ideas

- **Blueprint hot-reload**: User mentioned session type → Blueprint mapping; changing Blueprint mid-session is v2.1 (BLUE-07). Phase 7 loads Blueprint once at request time and uses it for that invocation.
- **phase_signal emission from LLM** (HUMAN-02): The LLM can emit a `phase_signal` to indicate phase readiness. Mentioned during discussion but Phase 7 does not implement the UI affordance — this is Phase 8 (Human Consensus Pattern). Phase 7's graph output can include `phase_signal` in state for future use but the route does not act on it.
- **Canvas snapshot state for Blueprint sessions**: Currently the route sets `canvas_snapshot_state = lastPanelUpdate`. For Blueprint sessions, this should be the current canvas state (committed CanvasOps). Phase 8 handles canvas DB writes and the snapshot logic.

</deferred>

---

*Phase: 07-invoke-route-modification*
*Context gathered: 2026-07-02*
