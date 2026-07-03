# Phase 8: Human Control + Canvas Sync - Research

**Researched:** 2026-07-03
**Domain:** Supabase Realtime broadcasting, PostgreSQL atomic operations, Hono route extension, LangGraph state extension, canvas DB persistence
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Mic Check Pattern (HUMAN-01)**
- D-01: Mic lock acquired at `/invoke` time as the first DB operation in the route. No separate "acquire mic" step.
- D-02: Mic lock is branch-scoped to `branch_id` (= LangGraph `thread_id`). Purpose: prevent concurrent bot invocations on the same branch.
- D-03: Mic lock storage mechanism (sessions table columns vs separate mic_tokens table) is Claude's discretion, with constraint: branch-scoped, supports atomic compare-and-set (acquire only if no lock held or existing lock is expired).
- D-04: On mic acquisition success, route broadcasts `mic_acquired` on `channel('session:${sessionId}')` with payload `{ branch_id }`. On release, broadcasts `mic_released` with payload `{ branch_id, reason: 'completed' | 'expired' | 'client_released' }`.
- D-05: If active mic lock on same branch is NOT expired, /invoke returns an error (Claude decides error code and shape).
- D-06: Two release mechanisms required: (a) server-side `finally` block always releases after graph run; (b) server-side expiry check on acquire — if existing lock is > 30 seconds old, treated as expired and caller can steal it.
- D-07: 30-second expiry is a safety net for orphaned locks. No client-side timer or explicit release endpoint required.

**phase_signal Delivery (HUMAN-02)**
- D-08: LLM signals phase readiness via `canvas_mutation` tool output. New `phase_signal: boolean` field added to `canvasMutationTool` schema in `packages/types/src/canvas-tool.ts`.
- D-09: New `phase_signal: boolean | null` field added to `GraphStateAnnotation` in `apps/api/src/graph/state.ts` (overwrite-style reducer, same as `agentConfidence`).
- D-10: After `Promise.all([runGraph, drainQueue])` completes, if `finalState.phase_signal === true`, route emits a `phase_signal` SSE event before the `done` event. Payload: `{ current_phase_id: string, blueprint_id: string }`.
- D-11: Human phase advancement via new endpoint: `PATCH /sessions/:id/phase`. Only session creator can call it. Validates `next_phase_id` exists in Blueprint's `phase_sequence`, then writes to `sessions.current_phase`. Returns 400 if next phase doesn't exist; 403 if not creator.
- D-12: After writing `current_phase`, PATCH endpoint broadcasts `phase_advanced` on `channel('session:${sessionId}')` with payload `{ new_phase_id: string, blueprint_id: string }`.
- D-13: LLM has NO tool, action, or code path capable of writing `sessions.current_phase` autonomously. `phase_signal` is advisory only.

**Canvas Sync (CANVAS-02)**
- D-14: Only canvas ops with `status = 'committed'` (confidence > 0.85) are upserted to `canvas_nodes` / `canvas_edges`. Ghost nodes are NOT persisted in Phase 8.
- D-15: Server generates UUIDs for new canvas nodes before DB upsert.
- D-16: After upsert, route broadcasts `canvas_update` on `channel('session:${sessionId}')` with payload `{ nodes: CanvasNode[], edges: CanvasEdge[] }` — full DB rows from `.select()`.
- D-17: ADD_NODE ops processed first (generate UUIDs), then ADD_EDGE ops (use those UUIDs). ADD_EDGE referencing a node not created in this invocation or not already in DB is dropped silently with a warning log.
- D-18: Canvas upsert and broadcast happen after the SSE stream has emitted the `done` event (consistent with cap increment and Langfuse flush placement — post-stream cleanup sequence).

### Claude's Discretion

- Exact storage mechanism for the mic lock (branches table columns vs separate mic_tokens table), as long as it's branch-scoped and supports atomic acquire with expiry
- Error code and response shape when /invoke is blocked by an active mic lock on the same branch
- Whether to use a Postgres function (like `increment_ai_count`) or a conditional UPDATE for atomic mic lock acquisition
- Exact `canvasMutationTool` schema extension for `phase_signal` (field name, where in the input object, optional vs required)
- Position of canvas upsert relative to cap increment and Langfuse flush in the post-stream cleanup sequence

### Deferred Ideas (OUT OF SCOPE)

- Ghost node persistence — ghost nodes are NOT persisted to DB in Phase 8
- Human canvas editing (UI-04) — v2.1 deferred
- Branch fork canvas carry-over (CANVAS-05) — v2.1 deferred
- `client_released` reason in `mic_released` — no explicit client release endpoint required in Phase 8
- `GET /api/sessions/:id/canvas?branch_id=` fetch endpoint — Phase 9 (CANVAS-03)
- `@xyflow/react` Graph Canvas frontend — Phase 9
- Ghost node rendering and expiry UI — Phase 9 (UI-02)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HUMAN-01 | Mic Check Pattern — branch-scoped DB lock prevents concurrent LangGraph executions; mic_acquired / mic_released broadcast via Supabase Realtime; automatic release after graph run or 30-second timeout | Atomic Postgres CAS pattern (`try_acquire_mic` RPC), `finally` block release, httpSend broadcast pattern all verified in codebase |
| HUMAN-02 | Human Consensus Pattern — LLM may emit `phase_signal`; UI shows "Advance Phase" affordance; only human click writes `current_phase`; LLM has no autonomous write path | New SSE event type, new PATCH endpoint with ownership gate — patterns all verified in existing routes |
| CANVAS-02 | Committed canvas mutations upserted to `canvas_nodes`/`canvas_edges` and broadcast to all participants via Supabase Realtime httpSend | Tables exist (migration 0008), upsert pattern verified in reactions.ts, broadcast pattern verified in messages.ts |
</phase_requirements>

---

## Summary

Phase 8 extends the existing `/invoke` route and sessions router with three interdependent capabilities: a branch-scoped concurrency lock (mic check), a human-gated phase advancement signal, and server-driven canvas DB persistence. All three operate on the same post-stream cleanup sequence that Phase 7 established.

The existing codebase provides verified patterns for every major operation needed in this phase. The httpSend fire-and-forget broadcast pattern is already used in five places (`messages.ts`, `reactions.ts`, `branches.ts`, `auto-name.ts`, `sessions-helpers.ts`). The atomic Postgres RPC pattern is already proven by `increment_ai_count` in `cap-guard.ts`. The upsert-with-conflict pattern is already used by `reactions.ts`. The ownership gate pattern is used in multiple routes.

The primary technical risk is the ordering and sequencing of new operations in the `/invoke` route's post-stream cleanup block: mic release (D-06), phase_signal SSE event (D-10), canvas upserts (D-18), canvas broadcast (D-16), and cap increment (D-18). Getting this ordering wrong or making any step block the SSE stream completion is the main pitfall.

**Primary recommendation:** Implement mic lock as a branches table extension (add `mic_holder_id` + `mic_acquired_at` columns) with a `try_acquire_mic(branch_id, expiry_seconds)` Postgres RPC function following the exact same pattern as `increment_ai_count`. This gives atomic CAS in a single UPDATE … WHERE … RETURNING statement without a new table.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mic lock acquire/release | API / Backend | Database | Atomic compare-and-set requires DB-level lock; release lives in server `finally` |
| mic_acquired/mic_released broadcast | API / Backend | — | httpSend fire-and-forget from /invoke route, same pattern as new_message |
| phase_signal SSE event | API / Backend | — | Route emits SSE event after graph completes; frontend receives it |
| PATCH /sessions/:id/phase endpoint | API / Backend | Database | Ownership gate + DB write + Realtime broadcast |
| phase_advanced broadcast | API / Backend | — | httpSend from PATCH endpoint |
| Canvas ops upsert (committed only) | API / Backend | Database | Service client bypasses RLS; canvas_nodes/canvas_edges tables already exist |
| canvas_update broadcast | API / Backend | — | httpSend fire-and-forget after upsert completes |
| `phase_signal` field in state | API / Backend | — | GraphStateAnnotation extension in state.ts, read by route post-graph |
| `phase_signal` in canvasMutationTool | Shared Types | — | canvas-tool.ts in @panelito/types; consumed by both AgentNode and route |

---

## Standard Stack

### Core (all already installed — no new packages)

| Library | Current Version | Purpose | Phase 8 Usage |
|---------|----------------|---------|---------------|
| `@supabase/supabase-js` | Already in project | DB client + Realtime broadcast | Mic lock CAS, canvas upserts, httpSend broadcasts |
| `hono` | Already in project | HTTP framework | New PATCH /sessions/:id/phase route |
| `@langchain/langgraph` | Already in project | State graph + checkpointer | Add `phase_signal` field to GraphStateAnnotation |
| `zod` | Already in project | Runtime validation | Validate PATCH /phase request body |
| `@panelito/types` | Already in project (workspace pkg) | Shared types | Extend canvasMutationTool + CanvasOpSchema with phase_signal |

**No new npm packages are required for Phase 8.** All capabilities are implemented via extensions to existing infrastructure. [VERIFIED: codebase audit]

### Supporting Utilities (already in codebase)

| Utility | Location | Phase 8 Usage |
|---------|----------|---------------|
| `createServiceClient()` | `apps/api/src/lib/supabase.ts` | All DB writes in mic lock, canvas upserts, phase PATCH |
| `requireAuth` middleware | `apps/api/src/middleware/auth.ts` | Auth gate on PATCH /phase |
| `httpSend` pattern | `apps/api/src/routes/messages.ts:139` | Template for all 4 new broadcasts |
| `increment_ai_count` RPC pattern | `supabase/migrations/0003_ai_count_helpers.sql` | Template for `try_acquire_mic` RPC |
| `crypto.randomUUID()` | `apps/api/src/routes/branches.ts:161` | UUID generation for new canvas nodes (D-15) |
| `ProviderSchema.safeParse()` | `apps/api/src/routes/ai.ts:175` | Pattern for runtime validation in PATCH route |

### Package Legitimacy Audit

> No new external packages are installed in Phase 8 — all work extends existing dependencies. This section is N/A.

**Packages removed due to slopcheck:** none
**Packages flagged as suspicious:** none

---

## Architecture Patterns

### System Architecture Diagram

```
POST /invoke
    │
    ├─► [STEP 0 — NEW] try_acquire_mic(branch_id, 30s)
    │        ├─► lock acquired → broadcast mic_acquired → continue
    │        └─► lock held + not expired → return 409 mic_locked
    │
    ├─► [existing] Blueprint gate, cap check, persona check, key decrypt
    │
    ├─► streamSSE() {
    │       Promise.all([runGraph(), drainQueue()])
    │           │
    │           └─► graph.stream() → AgentNode emits phase_signal via canvasMutationTool
    │               MutationGateNode passes phase_signal through to finalState
    │   }
    │
    └─► Post-stream cleanup (after Promise.all):
            │
            ├─► [existing] message INSERT + new_message broadcast
            ├─► [NEW] release_mic(branch_id) → broadcast mic_released
            ├─► [NEW] if finalState.phase_signal → emit phase_signal SSE event
            ├─► [NEW] canvas upserts (ADD_NODE first → generate UUIDs, then ADD_EDGE)
            ├─► [NEW] canvas_update broadcast with full DB rows
            ├─► [existing] incrementCount (cap guard)
            └─► [existing] Langfuse forceFlush + SSE done event


PATCH /sessions/:id/phase
    │
    ├─► requireAuth
    ├─► fetch session (creator_id, blueprint_id, current_phase)
    ├─► ownership gate (creator_id === user.id → else 403)
    ├─► validate next_phase_id exists in Blueprint.phase_sequence → else 400
    ├─► UPDATE sessions SET current_phase = next_phase_id
    └─► broadcast phase_advanced { new_phase_id, blueprint_id }


Supabase Realtime (channel: session:${sessionId})
    ├─► mic_acquired       { branch_id }
    ├─► mic_released       { branch_id, reason }
    ├─► canvas_update      { nodes: CanvasNode[], edges: CanvasEdge[] }
    └─► phase_advanced     { new_phase_id, blueprint_id }
```

### Recommended Project Structure (Phase 8 file touches)

```
apps/api/src/
├── routes/
│   ├── ai.ts                    # PRIMARY: mic acquire/release, phase_signal SSE, canvas upserts
│   └── sessions.ts              # ADD: PATCH /:id/phase subroute
├── graph/
│   └── state.ts                 # ADD: phase_signal: boolean | null field
packages/types/src/
├── canvas-tool.ts               # ADD: phase_signal?: boolean to tool parameters
└── canvas.ts                    # ADD: phase_signal?: boolean to CanvasOp ADD_NODE/ADD_EDGE
supabase/migrations/
└── 0010_mic_lock.sql            # NEW: ALTER TABLE branches ADD mic_holder_id + mic_acquired_at
                                 #      + try_acquire_mic() RPC function
                                 #      + release_mic() RPC function
apps/api/src/routes/
└── ai.test.ts                   # EXTEND: add mic lock tests, phase_signal tests, canvas tests
```

### Pattern 1: Atomic Mic Lock Acquisition (Postgres RPC)

**What:** A single `UPDATE ... WHERE ... RETURNING` statement that atomically acquires the mic lock only if no active lock exists (or existing lock is expired). Returns the lock acquisition result.

**When to use:** Called as the first DB operation in `/invoke`, before cap check and before opening SSE stream.

**Model — `increment_ai_count` pattern (verified in codebase):**
```sql
-- Source: supabase/migrations/0003_ai_count_helpers.sql (verified pattern)
-- New function follows same structure:
CREATE OR REPLACE FUNCTION public.try_acquire_mic(
  p_branch_id uuid,
  p_holder_id text,       -- session_id or user_id as lock holder identity
  p_expiry_seconds int DEFAULT 30
)
RETURNS table(acquired boolean, held_since timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE public.branches
  SET
    mic_holder_id   = p_holder_id,
    mic_acquired_at = v_now
  WHERE
    id = p_branch_id
    AND (
      mic_holder_id IS NULL
      OR mic_acquired_at < (v_now - (p_expiry_seconds || ' seconds')::interval)
    )
  ;
  -- If UPDATE affected a row, we acquired the lock
  IF FOUND THEN
    RETURN QUERY SELECT true, v_now;
  ELSE
    -- Return the current holder's acquired_at so caller knows how old the lock is
    RETURN QUERY
      SELECT false, mic_acquired_at
      FROM public.branches
      WHERE id = p_branch_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_mic(p_branch_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.branches
  SET mic_holder_id = NULL, mic_acquired_at = NULL
  WHERE id = p_branch_id;
$$;
```

**Route usage:**
```typescript
// Source: ai.ts pattern (verified — mirrors increment_ai_count usage in cap-guard.ts)
// Step 0 in /invoke handler: mic acquire (before cap check, before SSE open)
const { data: micResult, error: micError } = await supabase
  .rpc('try_acquire_mic', {
    p_branch_id: activeBranchId,
    p_holder_id: sessionId,  // session-scoped lock identity
    p_expiry_seconds: 30,
  })

if (micError || !micResult?.[0]) {
  return c.json({ error: 'mic_lock_error' }, 500)
}
if (!micResult[0].acquired) {
  return c.json({ error: 'mic_locked', branch_id: activeBranchId }, 409)
}

// After acquiring: broadcast mic_acquired (fire-and-forget)
supabase
  .channel(`session:${sessionId}`)
  .httpSend('mic_acquired', { branch_id: activeBranchId })
  .catch((err) => console.error('[ai] mic_acquired broadcast failed', err))
```

**Mic release in `finally`:**
```typescript
// Source: ai.ts — finally block pattern (Phase 7 has no finally yet; Phase 8 adds it)
// In the finally block after streamSSE() completes:
try {
  // ... existing post-stream cleanup ...
} finally {
  // D-06: always release mic, even if graph crashed
  await supabase.rpc('release_mic', { p_branch_id: activeBranchId })
  supabase
    .channel(`session:${sessionId}`)
    .httpSend('mic_released', { branch_id: activeBranchId, reason: 'completed' })
    .catch((err) => console.error('[ai] mic_released broadcast failed', err))
}
```

**Constraint:** This pattern only works when `activeBranchId` is non-null (a real UUID). For `activeBranchId === null` (main branch, no explicit branch), the mic lock should use a sentinel value or be skipped — there is only one "main" execution context per session. See Pitfall 3 below.

### Pattern 2: httpSend Fire-and-Forget Broadcast

**What:** Non-blocking Realtime broadcast using the REST path (not WebSocket). Already used in 6 places.

**When to use:** All 4 new Phase 8 broadcasts: `mic_acquired`, `mic_released`, `canvas_update`, `phase_advanced`.

```typescript
// Source: apps/api/src/routes/messages.ts:139 (VERIFIED in codebase)
// Exact pattern — copy verbatim for all new broadcasts:
supabase
  .channel(`session:${sessionId}`)
  .httpSend('canvas_update', { nodes: committedNodes, edges: committedEdges })
  .catch((err) => console.error('[ai] canvas_update broadcast failed', err))
```

**Critical:** No `await`. Non-blocking. The `.catch()` is required to prevent unhandled rejection.

### Pattern 3: Canvas Upsert with Server-Generated UUIDs

**What:** For each committed canvas op, generate a UUID server-side, upsert to `canvas_nodes` or `canvas_edges`, collect DB rows, broadcast all at once.

**Ordering constraint (D-17):** ADD_NODE ops must be processed before ADD_EDGE ops to ensure node UUIDs exist before edge creation.

```typescript
// Source: canvas.ts types + reactions.ts upsert pattern (VERIFIED in codebase)
// Process committed ops after SSE done event (D-18):
const committedOps = (finalState.canvasOps ?? []).filter(
  (op: CanvasOp) => op.status === 'committed'
)

// Step 1: ADD_NODE ops — generate UUIDs server-side (D-15)
const nodeIdMap = new Map<string, string>() // label → uuid (for same-invocation edge refs)
const nodeRows: CanvasNode[] = []

for (const op of committedOps.filter((o: CanvasOp) => o.op === 'ADD_NODE')) {
  const nodeId = crypto.randomUUID()  // D-15: server-generated UUID
  // Source: branches.ts:161 — crypto.randomUUID() verified pattern
  const { data: row, error } = await supabase
    .from('canvas_nodes')
    .upsert({
      id: nodeId,
      session_id: sessionId,
      branch_id: activeBranchId,
      blueprint_id: session.blueprint_id,
      node_type_id: op.node_type_id,
      label: op.label,
      status: 'committed',
      position_x: null,
      position_y: null,
    }, { onConflict: 'id' })
    .select()
    .single()

  if (error || !row) {
    console.warn('[ai] canvas_nodes upsert failed — skipping (fail-silent)', error?.message)
  } else {
    nodeIdMap.set(op.label, nodeId)
    nodeRows.push(row)
  }
}

// Step 2: ADD_EDGE ops — use UUIDs from step 1 or existing DB nodes
const edgeRows: CanvasEdge[] = []

for (const op of committedOps.filter((o: CanvasOp) => o.op === 'ADD_EDGE')) {
  // D-17: drop silently if referenced nodes don't exist
  const sourceExists = await nodeExistsInDb(supabase, op.source_node_id, sessionId)
  const targetExists = await nodeExistsInDb(supabase, op.target_node_id, sessionId)
  if (!sourceExists || !targetExists) {
    console.warn('[ai] ADD_EDGE references unknown node — dropping silently (D-17)')
    continue
  }
  // ... upsert edge row ...
}

// Step 3: broadcast combined result (D-16)
if (nodeRows.length > 0 || edgeRows.length > 0) {
  supabase
    .channel(`session:${sessionId}`)
    .httpSend('canvas_update', { nodes: nodeRows, edges: edgeRows })
    .catch((err) => console.error('[ai] canvas_update broadcast failed', err))
}
```

### Pattern 4: GraphStateAnnotation Extension

**What:** Add `phase_signal: boolean | null` field to `GraphStateAnnotation` using the overwrite-style reducer already established for `agentConfidence` and `guardrailResult`.

```typescript
// Source: apps/api/src/graph/state.ts (VERIFIED — exact pattern to copy)
// Add after 'steeringTextEnabled' field:
phase_signal: Annotation<boolean | null>({
  reducer: (_: boolean | null, v: boolean | null) => v,
  default: () => null,
}),
```

**MutationGateNode propagation (D-08):** MutationGateNode must extract `phase_signal` from `state.agentOutput` (which is the raw CanvasOp) and return it in its output. The field is passed through regardless of confidence routing.

```typescript
// Source: mutation-gate.ts — extend return value
// Current: return { canvasOps: [gatedOp] }
// Phase 8: also extract phase_signal from the raw tool output
// Note: phase_signal is on the canvasMutationTool input, not on CanvasOp schema directly.
// AgentNode must set agentOutput + separately set phase_signal in its return.
// OR: MutationGateNode reads phase_signal from state if AgentNode stores it first.
// See Pitfall 4 for the correct threading pattern.
```

### Pattern 5: PATCH /sessions/:id/phase Endpoint

**What:** New subroute in `sessions.ts` (or a dedicated file mounted under sessions). Validates ownership, validates phase sequence membership, writes DB, broadcasts.

```typescript
// Source: ai.ts ownership gate pattern (VERIFIED) + sessions.ts structure
sessionsRouter.patch('/:id/phase', requireAuth, async (c) => {
  const user = c.get('user')
  const sessionId = c.req.param('id')
  const supabase = createServiceClient()

  // Parse + validate body (ProviderSchema.safeParse() pattern from WR-03)
  const body = await c.req.json().catch(() => ({})) as { next_phase_id?: string }
  if (!body.next_phase_id || typeof body.next_phase_id !== 'string') {
    return c.json({ error: 'invalid_request', message: 'next_phase_id is required' }, 400)
  }

  // Fetch session + creator_id + blueprint_id
  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .select('id, creator_id, blueprint_id, current_phase')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !session) return c.json({ error: 'not_found' }, 404)

  // D-11: ownership gate — 403 if not creator
  if (session.creator_id !== user.id) return c.json({ error: 'forbidden' }, 403)

  // D-11: validate next_phase_id exists in Blueprint.phase_sequence
  const blueprint = await loadBlueprint(session.blueprint_id)
  const phaseExists = blueprint.phase_sequence.some((p) => p.id === body.next_phase_id)
  if (!phaseExists) {
    return c.json({ error: 'invalid_phase', message: 'next_phase_id not in Blueprint phase_sequence' }, 400)
  }

  // D-11: write current_phase to DB
  const { error: updateErr } = await supabase
    .from('sessions')
    .update({ current_phase: body.next_phase_id })
    .eq('id', sessionId)

  if (updateErr) return c.json({ error: 'update_failed' }, 500)

  // D-12: broadcast phase_advanced (fire-and-forget)
  supabase
    .channel(`session:${sessionId}`)
    .httpSend('phase_advanced', {
      new_phase_id: body.next_phase_id,
      blueprint_id: session.blueprint_id,
    })
    .catch((err) => console.error('[sessions] phase_advanced broadcast failed', err))

  return c.json({ current_phase: body.next_phase_id }, 200)
})
```

### Anti-Patterns to Avoid

- **Awaiting httpSend:** httpSend must be fire-and-forget (`.catch()` only). Awaiting it risks blocking the SSE response. [VERIFIED: all 6 existing httpSend calls in codebase follow this pattern]
- **Canvas writes before SSE done:** D-18 mandates canvas upserts happen after the SSE stream completes. Inserting them inside `streamSSE()` before the `done` event would violate this constraint.
- **Mic lock outside streamSSE:** The mic must be acquired BEFORE opening `streamSSE()` so that errors return a proper JSON response (not an SSE error event). See existing blueprint gate at `Step 7.5` in `ai.ts`.
- **Checking for mic lock inside streamSSE:** Same problem — once inside `streamSSE()`, you cannot return a non-SSE response.
- **Not releasing on AbortError:** The `AbortError` path in `runGraph()` currently returns early without releasing the mic. The `finally` block in the outer try-catch must handle this case.
- **Using status === 'ghost' to filter:** Only `status === 'committed'` ops go to DB (D-14). Filter by `op.status === 'committed'` not by confidence score (MutationGateNode already set the status field).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic mic lock acquire | Custom application-level locking | Postgres `UPDATE ... WHERE ... RETURNING` (RPC) | Race condition between two near-simultaneous /invoke calls requires DB-level atomicity; app-level state is not safe in serverless |
| Realtime broadcast | Custom WebSocket server | `supabase.channel().httpSend()` — already in use | 6 existing broadcasts use this; adding more follows the same pattern; no new infrastructure |
| Canvas UUID generation | Letting DB generate UUIDs | `crypto.randomUUID()` server-side before upsert | D-15: UUID must be in both the DB row and the broadcast payload simultaneously; can't get it from DB in same pass without selecting after insert which is more complex |
| Phase sequence validation | String comparison | `blueprint.phase_sequence.some()` after `loadBlueprint()` | Blueprint is already loaded and cached in `loadBlueprint()` per existing pattern; no new DB query needed |

**Key insight:** Phase 8 is primarily an extension phase — every hard problem (atomic DB ops, broadcasting, streaming) is already solved in the existing codebase. The work is wiring them together in the correct order.

---

## Common Pitfalls

### Pitfall 1: Mic Lock with null activeBranchId

**What goes wrong:** The current `/invoke` route supports `activeBranchId = null` (when no branch is specified, defaulting to the main branch). The `try_acquire_mic` RPC takes a `uuid` parameter. Passing `null` will fail.

**Why it happens:** The route has a fallback `activeBranchId = null` path where `body.branchId` is absent. On the main branch, there is no UUID.

**How to avoid:** Either (a) require a non-null `activeBranchId` to run the lock (skip mic lock for main branch — acceptable since concurrent main-branch invocations are less likely), or (b) look up the session's main branch UUID before the mic acquire step and use it as the lock target. Option (b) is cleaner as it enforces the invariant everywhere.

**Warning signs:** TypeScript will catch `null` passed to RPC param if typed correctly. Supabase will return a Postgres error if null is passed to a uuid parameter.

### Pitfall 2: phase_signal Propagation Chain Break

**What goes wrong:** `phase_signal` is emitted by the LLM via `canvasMutationTool` input, but the existing CanvasOp schema (`CanvasOpSchema`) does not include it. AgentNode's `CanvasOpSchema.safeParse()` will STRIP it (unknown fields in Zod discriminated union schemas are dropped by default in strict mode).

**Why it happens:** `CanvasOpSchema` uses `z.discriminatedUnion("op", [...])` without `.passthrough()`. The `phase_signal` field in the raw tool output is not part of the current schema.

**How to avoid:** Add `phase_signal: z.boolean().optional()` to all three union arms of `CanvasOpSchema` in `canvas.ts`. Then `CanvasOpSchema.safeParse()` in `agentNode` will preserve it. Alternatively: read `phase_signal` from `event.input` (raw) BEFORE calling `CanvasOpSchema.safeParse()`, and return it separately from `agentOutput`. The second approach is cleaner because it doesn't conflate the canvas op schema with the advisory signal.

**Warning signs:** `finalState.phase_signal` is always `null` even when LLM outputs it.

### Pitfall 3: Canvas Upsert Blocks SSE Stream

**What goes wrong:** Canvas upserts (await supabase.from(...).upsert(...)) run inside the `streamSSE()` callback, causing the SSE connection to stay open while DB writes complete.

**Why it happens:** D-18 says canvas writes must not block SSE stream completion. The `done` event must be emitted before canvas writes.

**How to avoid:** Emit `done` first inside the `streamSSE()` callback, then do canvas writes after `streamSSE()` completes (outside the `streamSSE()` callback). Or use Vercel's `waitUntil()` if available. The existing cleanup sequence pattern (message insert → cap increment → Langfuse flush → done event) must be respected: canvas writes should be added after the current sequence, not inserted in the middle.

**Warning signs:** Test client sees `done` event arrive late (after canvas writes), or canvas writes fail because the SSE connection was closed before they completed.

### Pitfall 4: phase_signal Threading in MutationGateNode

**What goes wrong:** MutationGateNode receives `state.agentOutput` (a `CanvasOp`) and is supposed to pass `phase_signal` through to state (D-08). But if `phase_signal` was stripped from `agentOutput` by `CanvasOpSchema.safeParse()`, MutationGateNode has no access to it.

**Why it happens:** The current data flow is: LLM tool output → `CanvasOpSchema.safeParse()` → `agentOutput` in state. If `phase_signal` isn't in `CanvasOpSchema`, it's gone by the time MutationGateNode runs.

**How to avoid:** In AgentNode, read `phase_signal` from `event.input` (the raw tool use payload) directly, before or alongside `CanvasOpSchema.safeParse()`. Return it as a separate field in AgentNode's return value: `return { agentOutput, agentConfidence, phase_signal: rawInput.phase_signal ?? null }`. This requires `phase_signal` to be in `GraphStateAnnotation` (D-09) so it can be included in the return.

**Warning signs:** `phase_signal` is always null in `finalState` even when LLM emits it.

### Pitfall 5: ADD_EDGE Source/Target Node Validation

**What goes wrong:** The LLM emits ADD_EDGE ops with `source_node_id` and `target_node_id` that may reference nodes created in the SAME invocation (not yet in DB). The route processes ADD_EDGE after ADD_NODE, but without a node ID map, the validation logic fails.

**Why it happens:** D-17 says if ADD_EDGE references a node that doesn't exist in DB (and wasn't created in this invocation), drop it. But "wasn't created in this invocation" requires tracking which nodes were just created.

**How to avoid:** Maintain a `Map<string, string>` (or `Set<string>`) of newly created node UUIDs during the ADD_NODE processing step. In the ADD_EDGE step, check both the DB (for pre-existing nodes) AND the local map (for nodes created this invocation). The `source_node_id` and `target_node_id` from the LLM in ADD_EDGE ops may reference the label or may reference a DB UUID — this depends on how the system prompt instructs the LLM. Verify this against the AgentNode system prompt and canvasMutationTool description.

**Warning signs:** All ADD_EDGE ops are dropped even when the referenced nodes were created in the same invocation.

### Pitfall 6: Post-Stream Cleanup Ordering

**What goes wrong:** The existing post-stream cleanup sequence in `ai.ts` is: (1) message INSERT, (2) new_message broadcast, (3) incrementCount, (4) Langfuse flush, (5) `done` SSE event. Phase 8 adds: mic release broadcast, phase_signal SSE event, canvas upserts, canvas broadcast. Getting the ordering wrong (e.g., emitting `done` before canvas upserts, but also blocking SSE with canvas upserts) creates contradictions.

**Why it happens:** D-18 says canvas upserts happen after `done` event. But `done` is currently the LAST operation in the cleanup block. And mic release should happen in `finally` (always), not in the try block.

**How to avoid:** The correct ordering is:
1. Message INSERT + new_message broadcast (existing)
2. `phase_signal` SSE event (if `finalState.phase_signal === true`) — BEFORE `done`
3. `done` SSE event
4. (Outside SSE callback or in `finally`) Canvas upserts + canvas_update broadcast
5. Mic release + mic_released broadcast (in `finally` so it always runs)
6. incrementCount (existing — can stay in try block before `done`)
7. Langfuse flush (existing)

The key insight: `phase_signal` SSE event must be BEFORE `done` (the frontend needs to receive it in the same stream). Canvas upserts must be AFTER `done`. Mic release must be in `finally`.

**Warning signs:** Frontend doesn't receive `phase_signal` event (if emitted after `done`). Canvas upserts block SSE stream (if done before `done` event).

---

## Code Examples

### canvasMutationTool extension (phase_signal)

```typescript
// Source: packages/types/src/canvas-tool.ts (current file — VERIFIED)
// Add to parameters.properties object:
phase_signal: {
  type: 'boolean',
  description:
    'Optional. Set to true when the conversation has reached a natural conclusion ' +
    'for the current phase and the group is ready to advance to the next phase. ' +
    'This is advisory only — a human must confirm the phase advancement.',
},
```

The `required` array remains `['op']` — `phase_signal` is optional.

### GraphStateAnnotation extension

```typescript
// Source: apps/api/src/graph/state.ts (current file — VERIFIED pattern)
// Add after steeringTextEnabled field (line 79), following exact same pattern:
/** phase_signal from AgentNode tool output — advisory only (HUMAN-02, D-09). */
phase_signal: Annotation<boolean | null>({
  reducer: (_: boolean | null, v: boolean | null) => v,
  default: () => null,
}),
```

### AgentNode phase_signal extraction

```typescript
// Source: apps/api/src/graph/nodes/agent.ts (current file — VERIFIED)
// In the tool_use event handler, before the 'break' statement:
} else if (event.type === 'tool_use' && event.name === 'canvas_mutation') {
  // Read phase_signal from raw tool input BEFORE safeParse strips it
  const rawInput = event.input as Record<string, unknown>
  const rawPhaseSignal = typeof rawInput.phase_signal === 'boolean'
    ? rawInput.phase_signal
    : null

  const parsed = CanvasOpSchema.safeParse(event.input)
  if (parsed.success) {
    agentOutput = parsed.data
    agentConfidence = 'confidence' in parsed.data ? (parsed.data.confidence ?? null) : null
  } else {
    console.error('[agent] CanvasOpSchema.safeParse failed — dropping', parsed.error.flatten())
  }
  // phase_signal returned separately (not part of agentOutput)
  return { agentOutput, agentConfidence, phase_signal: rawPhaseSignal }
}
```

### Migration: branches table mic lock columns

```sql
-- supabase/migrations/0010_mic_lock.sql
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS mic_holder_id   text        NULL,
  ADD COLUMN IF NOT EXISTS mic_acquired_at timestamptz NULL;

COMMENT ON COLUMN public.branches.mic_holder_id IS
  'Session ID holding the mic lock for this branch. NULL = unlocked. (HUMAN-01)';
COMMENT ON COLUMN public.branches.mic_acquired_at IS
  'Timestamp when mic lock was acquired. Used for 30s expiry check. (HUMAN-01)';

-- try_acquire_mic: atomic CAS — acquires lock only if free or expired
-- Returns (acquired boolean, held_since timestamptz)
CREATE OR REPLACE FUNCTION public.try_acquire_mic(
  p_branch_id       uuid,
  p_holder_id       text,
  p_expiry_seconds  int DEFAULT 30
)
RETURNS TABLE(acquired boolean, held_since timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE public.branches
  SET
    mic_holder_id   = p_holder_id,
    mic_acquired_at = v_now
  WHERE
    id = p_branch_id
    AND (
      mic_holder_id IS NULL
      OR mic_acquired_at < (v_now - make_interval(secs => p_expiry_seconds))
    );

  IF FOUND THEN
    RETURN QUERY SELECT true, v_now;
  ELSE
    RETURN QUERY
      SELECT false, mic_acquired_at AS held_since
      FROM public.branches
      WHERE id = p_branch_id;
  END IF;
END;
$$;

-- release_mic: clears the mic lock for a branch
CREATE OR REPLACE FUNCTION public.release_mic(p_branch_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.branches
  SET mic_holder_id = NULL, mic_acquired_at = NULL
  WHERE id = p_branch_id;
$$;

GRANT EXECUTE ON FUNCTION public.try_acquire_mic(uuid, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_mic(uuid) TO service_role;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `send()` for Realtime broadcast | `httpSend()` (explicit REST path) | Phase 6+ | httpSend is the explicit server-side path; `send()` had deprecated WebSocket auto-fallback |
| Module-level Langfuse singleton | Per-request CallbackHandler | Phase 6 | Prevents trace context corruption across concurrent requests |
| Direct LLM adapter call | LangGraph StateGraph via `graph.stream()` | Phase 7 | Enables multi-node pipeline with checkpointing |

**No deprecated patterns involved in Phase 8** — all new features use established Phase 7 patterns.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `activeBranchId` is always non-null for mic lock target (main branch must look up its UUID) | Pitfall 1 | Mic lock silently skipped for main branch invocations |
| A2 | `make_interval(secs => p_expiry_seconds)` syntax works in Supabase's Postgres version | Pattern 1 SQL | Migration fails; use `(p_expiry_seconds \|\| ' seconds')::interval` as fallback |
| A3 | `phase_signal` field in canvasMutationTool will be respected by all three providers (Anthropic, OpenAI, Gemini) via the adapter layer | Code Examples | LLM ignores `phase_signal` field or fails with schema error (only Anthropic is tested in practice) |
| A4 | The outer `streamSSE()` callback's `try/finally` structure in Phase 7 allows inserting a `finally` block that runs after SSE closes | Post-Stream Cleanup | Mic release broadcast may not fire reliably if SSE close timing differs |

---

## Open Questions

1. **Main branch mic lock target**
   - What we know: `activeBranchId` can be `null` in `/invoke` when no branch is specified
   - What's unclear: Should mic lock be skipped for main branch (no concurrent isolation needed since the session has only one "main"), or should the route always resolve to a branch UUID first?
   - Recommendation: Look up the session's main branch UUID at the start of the handler (branches are created by trigger on session creation — a main branch always exists). Use that UUID for mic lock even on main branch invocations.

2. **ADD_EDGE source_node_id format from LLM**
   - What we know: `canvasMutationTool` parameters for ADD_EDGE expect `source_node_id: string` (described as UUID). The LLM is instructed to use UUIDs.
   - What's unclear: In the first invocation (no prior nodes in DB), the LLM cannot know any node UUIDs. ADD_EDGE ops from a brand-new session will always have invalid source/target UUIDs.
   - Recommendation: D-17 covers this — drop ADD_EDGE silently if nodes don't exist. In practice, the LLM only produces ADD_EDGE ops in subsequent invocations after ADD_NODE ops have been committed. Document this in the AgentNode system prompt update.

3. **post-stream `finally` vs explicit `waitUntil`**
   - What we know: D-18 says canvas writes happen after SSE stream completes. Langfuse already uses `waitUntil` (OBS-02). Phase 7 code already calls `forceFlush()` after the `done` event inside `streamSSE()`.
   - What's unclear: Whether canvas writes should go inside `streamSSE()` after `done` (blocking SSE close) or outside via `waitUntil` (truly non-blocking but requires Vercel's `waitUntil` API).
   - Recommendation: Keep canvas writes inside `streamSSE()` after the `done` event (consistent with how Langfuse flush is currently handled). This keeps the cleanup sequence in one place and avoids Vercel-specific API dependency. The SSE stream remains open until the cleanup block finishes — this is acceptable since the client has already received `done`.

---

## Environment Availability

> Step 2.6: SKIPPED — Phase 8 is a code/config change to existing infrastructure. No new external tools, services, or CLIs are required. All dependencies (Supabase, Hono, LangGraph, Zod, Anthropic SDK) are already installed and verified in the running project.

---

## Validation Architecture

> `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`. This section is skipped.

---

## Security Domain

> Security enforcement is enabled (not explicitly disabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `requireAuth` middleware on all new routes |
| V3 Session Management | yes | Mic lock is session+branch scoped; no session state in memory |
| V4 Access Control | yes | Ownership gate: `session.creator_id === user.id` on PATCH /phase (D-11) |
| V5 Input Validation | yes | Zod validation on PATCH /phase body; `CanvasOpSchema.safeParse()` on LLM output |
| V6 Cryptography | no | No new crypto operations |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| LLM autonomously advancing phase | Elevation of privilege | D-13: `phase_signal` is advisory SSE event only; PATCH /phase requires human HTTP call with ownership gate |
| Concurrent /invoke flooding same branch | DoS | Mic lock prevents concurrent executions; 409 response on lock held |
| Forged `next_phase_id` not in Blueprint | Tampering | `blueprint.phase_sequence.some()` validation before DB write (D-11) |
| Canvas node injection (wrong blueprint vocabulary) | Tampering | MutationGateNode vocabulary validation already in place (D-07, Phase 6); Phase 8 writes only committed ops |
| Mic lock not released on crash | Availability | 30-second expiry on next acquire; `finally` block always releases (D-06/D-07) |

---

## Sources

### Primary (HIGH confidence — verified by direct codebase inspection)

- `apps/api/src/routes/ai.ts` — Full route implementation read; post-stream cleanup sequence verified; existing patterns enumerated
- `apps/api/src/routes/messages.ts` — httpSend fire-and-forget pattern (lines 136-141)
- `apps/api/src/lib/cap-guard.ts` — Atomic Postgres RPC pattern (increment_ai_count)
- `apps/api/src/graph/state.ts` — GraphStateAnnotation overwrite-style reducer pattern
- `apps/api/src/graph/nodes/agent.ts` — AgentNode tool_use handling pattern
- `apps/api/src/graph/nodes/mutation-gate.ts` — MutationGateNode confidence threshold routing
- `packages/types/src/canvas-tool.ts` — canvasMutationTool definition
- `packages/types/src/canvas.ts` — CanvasOpSchema, CanvasNode, CanvasEdge types
- `supabase/migrations/0003_ai_count_helpers.sql` — Atomic RPC function pattern
- `supabase/migrations/0007_branches_table.sql` — branches table schema (mic lock columns to add here)
- `supabase/migrations/0008_nsai_foundation.sql` — canvas_nodes/canvas_edges table schemas + RLS
- `supabase/migrations/0009_sessions_current_phase.sql` — sessions.current_phase column
- `apps/api/src/routes/reactions.ts` — upsert with onConflict pattern
- `apps/api/src/routes/branches.ts:161` — `crypto.randomUUID()` server-side UUID generation
- `.planning/phases/08-human-control-canvas-sync/08-CONTEXT.md` — All user decisions (D-01 through D-18)

### Secondary (MEDIUM confidence — verified against CONTEXT.md decisions)

- `.planning/REQUIREMENTS.md` — HUMAN-01, HUMAN-02, CANVAS-02 full specs
- `.planning/phases/07-invoke-route-modification/07-CONTEXT.md` — Phase 7 decisions referenced

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all patterns verified in existing codebase
- Architecture: HIGH — decisions locked in CONTEXT.md; verified against actual source files
- Pitfalls: HIGH — derived directly from reading existing code and tracing data flows
- SQL patterns: MEDIUM — `make_interval(secs => ...)` syntax assumed valid for Supabase's Postgres; `||' seconds')::interval` fallback is safer

**Research date:** 2026-07-03
**Valid until:** 2026-08-03 (stable stack — no fast-moving dependencies)
