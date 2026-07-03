# Phase 8: Human Control + Canvas Sync - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 8 delivers two human authority patterns (Mic Check + Human Consensus) and the server-side canvas sync pipeline (committed mutations → DB upsert + Realtime broadcast). It bridges the LangGraph output from Phase 7 to real Supabase state and live client updates — completing the AI cartography loop.

Concretely:
- A branch-scoped DB lock prevents concurrent LangGraph executions on the same branch; acquisition and release happen inside the /invoke route; mic status is broadcast via Supabase Realtime
- A new `phase_signal` SSE event type carries the LLM's phase readiness signal to the frontend; a new `PATCH /sessions/:id/phase` endpoint enforces that only the session creator can advance `current_phase`
- After each graph run, committed canvas ops (`status = 'committed'`) are upserted to `canvas_nodes` / `canvas_edges` and broadcast as full DB rows via Supabase Realtime httpSend

Phase 8 ends when all 3 success criteria in ROADMAP.md §Phase 8 pass.

**Not in this phase:** Ghost node rendering (Phase 9); frontend Graph Canvas (`@xyflow/react`); branch reconnect canvas fetch (CANVAS-03, Phase 9); human canvas editing (UI-04, v2.1 deferred).

</domain>

<decisions>
## Implementation Decisions

### Mic Check Pattern (HUMAN-01)

- **D-01:** The mic lock is acquired at `/invoke` time, atomically, as the first DB operation in the route. It is NOT acquired at typing start. A separate "acquire mic" step is not needed — the /invoke itself is the first request.
- **D-02:** The mic lock is **branch-scoped** — specifically to `branch_id` (= LangGraph `thread_id`). Its purpose is preventing multiple concurrent bot invocations on the same branch, not human turn management.
- **D-03:** The mic lock storage mechanism (sessions table columns vs separate mic_tokens table) is Claude's discretion, with the constraint that it MUST be branch-scoped and support atomic compare-and-set (acquire only if no lock held, or if existing lock is expired).
- **D-04:** On mic acquisition success, the route broadcasts `mic_acquired` on `channel('session:${sessionId}')` with payload `{ branch_id }`. On release (normal or expired), it broadcasts `mic_released` with payload `{ branch_id, reason: 'completed' | 'expired' | 'client_released' }`.
- **D-05:** If an active mic lock is found on the same branch that is NOT expired, the /invoke route returns an appropriate error (Claude decides the error code and shape) instead of running the graph.

### Mic Release Mechanism (HUMAN-01 timeout)

- **D-06:** Two release mechanisms are both required: (a) server-side `finally` block always releases the lock after graph run completes (or crashes); (b) server-side expiry check on acquire — if the existing lock is > 30 seconds old, it is treated as expired and the new caller can steal it. No dedicated client-side release endpoint is needed.
- **D-07:** The 30-second expiry is a safety net for orphaned locks (Vercel function crash). Normal graph runs complete in < 30 seconds. No client-side timer or explicit release endpoint required.

### phase_signal Delivery (HUMAN-02)

- **D-08:** The LLM signals phase readiness via the `canvas_mutation` tool output. A new `phase_signal: boolean` field must be added to the `canvasMutationTool` schema (in `@panelito/types`) so the AgentNode can include it alongside the canvas op. MutationGateNode passes `phase_signal` through to state regardless of confidence routing.
- **D-09:** A new `phase_signal: boolean | null` field must be added to `GraphStateAnnotation` in `apps/api/src/graph/state.ts` (overwrite-style reducer, same as `agentConfidence`).
- **D-10:** After `Promise.all([runGraph, drainQueue])` completes, if `finalState.phase_signal === true`, the route emits a `phase_signal` SSE event before the `done` event. Payload: `{ current_phase_id: string, blueprint_id: string }` so the frontend knows which phase is being signalled ready.
- **D-11:** Human phase advancement is via a new endpoint: `PATCH /sessions/:id/phase`. Only the session creator can call it (ownership gate: `session.creator_id === user.id`). The endpoint validates that the requested `next_phase_id` exists in the Blueprint's `phase_sequence`, then writes it to `sessions.current_phase`. Returns 400 if next phase doesn't exist in sequence; 403 if not creator.
- **D-12:** After writing `current_phase`, the PATCH endpoint broadcasts `phase_advanced` on `channel('session:${sessionId}')` with payload `{ new_phase_id: string, blueprint_id: string }` so all participants' UIs update in real time.
- **D-13:** The LLM has NO tool, action, or code path capable of writing `sessions.current_phase` autonomously. The `phase_signal` field is advisory only — it emits an SSE event; the human click is required to write the DB.

### Canvas Sync (CANVAS-02)

- **D-14:** Only canvas ops with `status = 'committed'` (confidence > 0.85, set by MutationGateNode) are upserted to `canvas_nodes` / `canvas_edges` in Phase 8. Ghost nodes (`status = 'ghost'`) are NOT persisted to DB in Phase 8 — they remain ephemeral LangGraph state, discarded on reconnect (CANVAS-03 alignment).
- **D-15:** The server (route) generates UUIDs for new canvas nodes before DB upsert. This allows the UUID to be included in the Realtime broadcast and available to Phase 9 for stable node identity.
- **D-16:** After upsert, the route broadcasts `canvas_update` on `channel('session:${sessionId}')` with payload `{ nodes: CanvasNode[], edges: CanvasEdge[] }` — full DB rows returned by the `.select()` call. This matches the `new_message` broadcast pattern (full row, not compact diff).
- **D-17:** Canvas upserts are ordered: ADD_NODE ops are processed first to generate UUIDs, then ADD_EDGE ops use those UUIDs as `source_node_id` / `target_node_id`. If an ADD_EDGE references a node that doesn't exist in DB (and wasn't created in this invocation), drop it silently and log a warning — fail-silent, consistent with MutationGateNode and blueprint vocabulary validation.
- **D-18:** The canvas upsert and broadcast happen after the SSE stream has emitted the `done` event (outside `streamSSE`) or via `waitUntil` — consistent with cap increment and Langfuse flush placement. Canvas writes must not block the SSE stream completion.

### Claude's Discretion

- Exact storage mechanism for the mic lock (branches table columns vs separate mic_tokens table), as long as it's branch-scoped and supports atomic acquire with expiry
- Error code and response shape when /invoke is blocked by an active mic lock on the same branch
- Whether to use a Postgres function (like `increment_ai_count`) or a conditional UPDATE for atomic mic lock acquisition
- Exact `canvasMutationTool` schema extension for `phase_signal` (field name, where in the input object, optional vs required)
- Position of canvas upsert relative to cap increment and Langfuse flush in the post-stream cleanup sequence

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and Roadmap
- `.planning/REQUIREMENTS.md §HUMAN-01` — Mic Check Pattern full spec; also HUMAN-02 (Human Consensus), CANVAS-02 (canvas sync)
- `.planning/ROADMAP.md §Phase 8` — 3 success criteria that must be TRUE; read exact wording for "no second LangGraph execution" and "second browser tab receives within one second"
- `.planning/REQUIREMENTS.md §Out of Scope` — LangGraph interrupt() banned; CRDT/Yjs banned; per-domain schemas banned

### Prior Phase Context (MUST READ — Phase 8 extends Phase 7 decisions)
- `.planning/phases/07-invoke-route-modification/07-CONTEXT.md` — All Phase 7 decisions apply; especially D-05 (streamWriter seam), D-06 (Promise.all graph+SSE), D-14 (abort controller), D-15 (LANGFUSE_TRACE_LEVEL). Phase 8 must NOT contradict these.
- `.planning/phases/06-graph-construction-checkpointer/06-CONTEXT.md` — D-08/D-09/D-10 (state schema), D-07 (Blueprint vocabulary validation in MutationGateNode). Phase 8 extends state.ts.

### The Route Being Modified
- `apps/api/src/routes/ai.ts` — Phase 8's primary modification target. Adds: mic acquire at top of handler, mic release in finally, phase_signal SSE event emission post-graph, canvas upsert post-SSE. Read full current implementation before modifying.

### Graph State and Nodes
- `apps/api/src/graph/state.ts` — Add `phase_signal: boolean | null` field (Phase 8, D-09)
- `apps/api/src/graph/nodes/mutation-gate.ts` — Passes `phase_signal` through from AgentNode output; Phase 8 may need to extract and propagate it in state
- `apps/api/src/graph/nodes/agent.ts` — AgentNode emits `phase_signal` via canvas_mutation tool; Phase 8 updates buildAgentSystemPrompt() to instruct when to signal

### Types (check before defining anything new)
- `packages/types/src/canvas.ts` — CanvasNode, CanvasEdge, CanvasOp, CanvasNodeStatus; Phase 8 extends canvasMutationTool schema with phase_signal field
- `packages/types/src/ai.ts` — canvasMutationTool defined here (Phase 6 decision); Phase 8 adds phase_signal to the tool input schema

### Existing Services (USE, don't duplicate)
- `apps/api/src/routes/messages.ts` — httpSend broadcast pattern: `supabase.channel('session:${sessionId}').httpSend('event_name', row)` — Phase 8 replicates this exactly for canvas_update and mic events
- `apps/api/src/lib/supabase.ts` — `createServiceClient()` for all DB writes
- `apps/api/src/lib/cap-guard.ts` — Atomic DB increment pattern (increment_ai_count Postgres function); Mic lock acquisition may follow a similar atomic CAS pattern

### Database (Phase 5 deliverables — already exist)
- `supabase/migrations/0008_*.sql` (or equivalent) — canvas_nodes and canvas_edges tables already created in Phase 5 (INFRA-02); Phase 8 does first upserts, NOT new migrations for canvas tables
- Any migrations Phase 8 adds are for the mic lock storage only (if branches table is modified or a mic_tokens table is added)

### Do NOT Touch (Phase 9 domain)
- `@xyflow/react` Graph Canvas frontend — Phase 9
- `GET /api/sessions/:id/canvas?branch_id=` fetch endpoint — Phase 9 (CANVAS-03)
- Ghost node rendering and expiry UI — Phase 9 (UI-02)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/routes/messages.ts#httpSend` — `supabase.channel('session:${sessionId}').httpSend('new_message', row)` is the broadcast template; Phase 8 replicates for `mic_acquired`, `mic_released`, `canvas_update`, `phase_advanced`
- `apps/api/src/lib/cap-guard.ts#incrementCount` — Postgres RPC function pattern for atomic DB ops; mic lock acquisition/release may follow the same pattern (a `try_acquire_mic(branch_id, holder_id, expiry_seconds)` function)
- `apps/api/src/graph/state.ts#GraphStateAnnotation` — Overwrite-style field pattern (see `agentConfidence`, `guardrailResult`); `phase_signal` field follows the same pattern
- `packages/types/src/ai.ts#canvasMutationTool` — The Phase 6 tool schema; Phase 8 extends the tool input to include an optional `phase_signal: boolean` field

### Established Patterns
- **httpSend fire-and-forget**: `supabase.channel(...).httpSend(...).catch((err) => console.error(...))` — no await, non-blocking. Phase 8 canvas broadcast follows this same pattern.
- **Post-stream cleanup sequence**: In `apps/api/src/routes/ai.ts`, after `Promise.all([runGraph, drainQueue])` completes — message insert → Realtime broadcast → cap increment → Langfuse flush → SSE done event. Phase 8 adds: mic release broadcast, phase_signal SSE event, canvas upserts, canvas broadcast — Claude decides exact ordering within this sequence.
- **Fail-silent for non-fatal operations**: `insertError || !row` → log only, don't abort SSE. Canvas upsert failures follow the same pattern.
- **Ownership gate**: `session.creator_id !== user.id → 403`. The new PATCH /sessions/:id/phase endpoint follows the same ownership check.
- **ProviderSchema.safeParse() for runtime validation**: Pattern from Phase 7 WR-03 fix. Any new route inputs should follow runtime validation pattern.

### Integration Points
- `/invoke` route (`apps/api/src/routes/ai.ts`) — Primary Phase 8 modification target: add mic acquire/release, phase_signal SSE emission, canvas upserts
- `sessions` router (wherever `apps/api/src/routes/sessions.ts` is mounted) — New `PATCH /:id/phase` subroute added here
- `branches` table — Mic lock storage if column-based (add mic_holder_id + mic_acquired_at); or separate mic_tokens table
- `canvas_nodes` / `canvas_edges` tables — Phase 8 first upserts; tables already exist from Phase 5
- `sessions.current_phase` — Phase 8 adds the write path (PATCH endpoint + Realtime broadcast); the read path already exists in the /invoke route (D-03, Phase 7)

</code_context>

<specifics>
## Specific Ideas

- **Mic lock purpose clarification**: The mic lock is for bots, not humans. Its sole purpose is preventing two simultaneous LangGraph invocations on the same branch — it's a concurrency guard, not a human turn-taking system. No human UI affordance is needed beyond the Realtime `mic_acquired` / `mic_released` events (Phase 9 can use these for a visual "AI thinking" indicator).
- **phase_signal is advisory**: The LLM signals readiness to advance phase; the human decides. The SSE event reaches the frontend; the frontend shows an affordance; the creator clicks it. The LLM has no path to write `sessions.current_phase`. This invariant must be enforced at the endpoint level (not just at the graph level).
- **Canvas UUID generation on server**: The server generates UUIDs before DB insert so the same UUID appears in both the DB row and the Realtime broadcast payload. Phase 9 can use this UUID as a stable React key for canvas nodes.
- **ADD_EDGE ordering constraint**: ADD_NODE ops must be processed before ADD_EDGE ops in the same invocation. If ADD_EDGE references a node_id that doesn't exist after processing ADD_NODE ops from this invocation, drop silently (same fail-silent philosophy as MutationGateNode vocabulary validation).

</specifics>

<deferred>
## Deferred Ideas

- **Ghost node persistence** — The user confirmed ghost nodes are NOT persisted to DB in Phase 8. Ghost nodes exist only in LangGraph state; they're discarded on reconnect (CANVAS-03, Phase 9). If Phase 9 needs persistent ghost nodes, that's a Phase 9 decision.
- **Human canvas editing** — Participants manually editing canvas nodes/edges (UI-04) is explicitly v2.1 deferred.
- **Branch fork canvas carry-over** — Forked branches inheriting parent canvas state (CANVAS-05) is v2.1 deferred.
- **client_released reason in mic_released** — The `reason: 'client_released'` variant was captured in decisions but D-07 confirms no explicit client release endpoint is required. If a client-side timeout still sends a release call, Claude may add a release endpoint at discretion, but it's not a Phase 8 requirement.

</deferred>

---

*Phase: 08-human-control-canvas-sync*
*Context gathered: 2026-07-03*
