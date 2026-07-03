# Phase 8: Human Control + Canvas Sync - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 7 (4 modified, 1 new route subroutine, 1 new migration, 1 implicit test extension)
**Analogs found:** 7 / 7

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/api/src/routes/ai.ts` | route (primary mod target) | streaming + CRUD + event-driven | itself (existing file, Phase 8 extends it) | self |
| `apps/api/src/routes/sessions.ts` | route | request-response + CRUD | `apps/api/src/routes/sessions.ts` `POST /:id/freeze` handler (lines 244–283) | exact |
| `apps/api/src/graph/state.ts` | state schema | transform | itself — `steeringTextEnabled` / `agentConfidence` fields (lines 56–79) | self |
| `apps/api/src/graph/nodes/agent.ts` | graph node | event-driven | itself — `tool_use` event handler block (lines 148–165) | self |
| `apps/api/src/graph/nodes/mutation-gate.ts` | graph node | transform | itself — return block (line 80) | self |
| `packages/types/src/canvas-tool.ts` | shared types / config | transform | itself — `reason` property block (lines 67–72) | self |
| `supabase/migrations/0010_mic_lock.sql` | migration | CRUD | `supabase/migrations/0003_ai_count_helpers.sql` | exact |

---

## Pattern Assignments

### `apps/api/src/routes/ai.ts` (route, streaming + CRUD + event-driven)

**Analog:** itself — reads from the current implementation and inserts new blocks at precise positions.

**Imports pattern** — no new imports needed beyond what's already present (lines 30–47). All utilities (`createServiceClient`, `supabase`, `stream.writeSSE`, `incrementCount`, etc.) are already imported. `crypto.randomUUID()` is a Node.js global — no import required.

**Mic acquire block — insert BEFORE `streamSSE(c, ...)` call, after blueprint load (line 274)**

Insert a new Step 8.5 block. The model is the RPC call in `cap-guard.ts` lines 81–96, adapted for the mic lock:
```typescript
// Step 8.5: Mic lock acquire (HUMAN-01, D-01, D-02)
// Must be BEFORE streamSSE() so a locked branch returns JSON 409, not an SSE error.
const { data: micResult, error: micError } = await supabase
  .rpc('try_acquire_mic', {
    p_branch_id: activeBranchId ?? sessionMainBranchId,  // see Pitfall 1 in RESEARCH.md
    p_holder_id: sessionId,
    p_expiry_seconds: 30,
  })

if (micError || !micResult?.[0]) {
  return c.json({ error: 'mic_lock_error' }, 500)
}
if (!micResult[0].acquired) {
  return c.json({ error: 'mic_locked', branch_id: activeBranchId }, 409)
}

// D-04: broadcast mic_acquired fire-and-forget (copy httpSend pattern from line 395–397)
supabase
  .channel(`session:${sessionId}`)
  .httpSend('mic_acquired', { branch_id: activeBranchId })
  .catch((err) => console.error('[ai] mic_acquired broadcast failed', err))
```

**httpSend fire-and-forget broadcast pattern** — from `messages.ts` lines 138–141 and `ai.ts` lines 394–396:
```typescript
// EXACT pattern — copy verbatim for all new broadcasts
supabase
  .channel(`session:${sessionId}`)
  .httpSend('event_name', payload)
  .catch((err) => console.error('[ai] event_name broadcast failed', err))
```

**phase_signal SSE event — insert BEFORE `await stream.writeSSE({ event: 'done', ... })` (line 411)**

The existing `stream.writeSSE` call at line 411 is the template:
```typescript
// D-10: emit phase_signal SSE event if LLM signalled phase readiness (BEFORE 'done')
if ((finalState as any)?.phase_signal === true) {
  await stream.writeSSE({
    event: 'phase_signal',
    data: JSON.stringify({
      current_phase_id: session.current_phase ?? blueprint.phase_sequence[0]?.id ?? '',
      blueprint_id: session.blueprint_id,
    }),
  })
}

await stream.writeSSE({ event: 'done', data: '{}' })  // existing line 411 — unchanged
```

**canvas upsert block — insert AFTER `stream.writeSSE({ event: 'done', ... })` (after current line 411)**

Model: `reactions.ts` lines 83–95 (upsert with onConflict) + `branches.ts` line 161 (crypto.randomUUID()):
```typescript
// D-18: canvas upserts AFTER 'done' event; fail-silent (same as message insert error path)
const committedOps = ((finalState as any)?.canvasOps ?? []).filter(
  (op: import('@panelito/types').CanvasOp) => op.status === 'committed'
)

if (committedOps.length > 0) {
  const nodeIdMap = new Map<string, string>()   // label → new uuid (for same-invocation edges)
  const nodeRows: import('@panelito/types').CanvasNode[] = []
  const edgeRows: import('@panelito/types').CanvasEdge[] = []

  // Step 1: ADD_NODE ops — server-generated UUIDs (D-15)
  for (const op of committedOps.filter((o: any) => o.op === 'ADD_NODE')) {
    const nodeId = crypto.randomUUID()           // branches.ts:161 pattern
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
      }, { onConflict: 'id' })                  // reactions.ts:93 onConflict pattern
      .select()
      .single()

    if (error || !row) {
      console.warn('[ai] canvas_nodes upsert failed — skipping (fail-silent)', error?.message)
    } else {
      nodeIdMap.set(op.label, nodeId)
      nodeRows.push(row)
    }
  }

  // Step 2: ADD_EDGE ops (D-17: drop silently if nodes don't exist)
  for (const op of committedOps.filter((o: any) => o.op === 'ADD_EDGE')) {
    const sourceId = nodeIdMap.get(op.source_node_id) ?? op.source_node_id
    const targetId = nodeIdMap.get(op.target_node_id) ?? op.target_node_id

    const [{ count: srcCount }, { count: tgtCount }] = await Promise.all([
      supabase.from('canvas_nodes').select('id', { count: 'exact', head: true })
        .eq('id', sourceId).eq('session_id', sessionId),
      supabase.from('canvas_nodes').select('id', { count: 'exact', head: true })
        .eq('id', targetId).eq('session_id', sessionId),
    ])

    if (!srcCount || !tgtCount) {
      console.warn('[ai] ADD_EDGE references unknown node — dropping silently (D-17)')
      continue
    }

    const edgeId = crypto.randomUUID()
    const { data: erow, error: eerr } = await supabase
      .from('canvas_edges')
      .upsert({
        id: edgeId,
        session_id: sessionId,
        branch_id: activeBranchId,
        blueprint_id: session.blueprint_id,
        source_node_id: sourceId,
        target_node_id: targetId,
        edge_type_id: op.edge_type_id,
        status: 'committed',
      }, { onConflict: 'id' })
      .select()
      .single()

    if (eerr || !erow) {
      console.warn('[ai] canvas_edges upsert failed — skipping (fail-silent)', eerr?.message)
    } else {
      edgeRows.push(erow)
    }
  }

  // Step 3: broadcast (D-16) — fire-and-forget, same pattern as messages.ts:138–141
  if (nodeRows.length > 0 || edgeRows.length > 0) {
    supabase
      .channel(`session:${sessionId}`)
      .httpSend('canvas_update', { nodes: nodeRows, edges: edgeRows })
      .catch((err) => console.error('[ai] canvas_update broadcast failed', err))
  }
}
```

**Mic release — add `finally` block wrapping the existing `try` block (after line 419)**

The existing try/catch ends at line 419. Add a `finally` below the `catch`:
```typescript
} finally {
  // D-06: always release mic, even on AbortError or stream crash
  await supabase.rpc('release_mic', { p_branch_id: activeBranchId ?? sessionMainBranchId })
  supabase
    .channel(`session:${sessionId}`)
    .httpSend('mic_released', { branch_id: activeBranchId, reason: 'completed' })
    .catch((err) => console.error('[ai] mic_released broadcast failed', err))
}
```

**Error handling pattern** — copy the fail-silent pattern already at lines 388–390:
```typescript
if (insertError || !row) {
  console.error('[ai] message insert error', insertError)
  // Stream already open — log only, don't abort the SSE connection
}
```
Apply same pattern to canvas upsert errors (log + skip, no throw).

---

### `apps/api/src/routes/sessions.ts` — PATCH `/:id/phase` subroute (HUMAN-02, D-11, D-12)

**Analog:** `sessionsRouter.post('/:id/freeze', ...)` block (lines 244–283) — exact pattern: fetch session, creator_id ownership gate, action, re-fetch, return.

**Imports pattern** — no new imports. `z`, `requireAuth`, `createServiceClient`, `supabase.channel().httpSend()` all already imported or available.

**Core pattern** — copy `POST /:id/freeze` structure exactly, substituting UPDATE logic:

```typescript
// POST /:id/freeze pattern (lines 244–283) — ownership gate is the template:
sessionsRouter.patch('/:id/phase', requireAuth, async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')
  const supabase = createServiceClient()

  // Zod body validation — mirrors UnfreezeBodySchema pattern (lines 353–356)
  const PatchPhaseBodySchema = z.object({
    next_phase_id: z.string().min(1),
  })
  const rawBody = await c.req.json().catch(() => ({}))
  const parsed = PatchPhaseBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', message: 'next_phase_id is required' }, 400)
  }

  // Fetch session — mirrors lines 254–258
  const { data: session, error: fetchError } = await supabase
    .from('sessions')
    .select('id, creator_id, blueprint_id, current_phase')
    .eq('id', id)
    .single()

  if (fetchError || !session) {
    return c.json({ error: 'not_found' }, 404)
  }

  // Ownership gate — mirrors lines 261–263 exactly
  if (session.creator_id !== user.id) {
    return c.json({ error: 'forbidden' }, 403)
  }

  // Phase sequence validation (D-11) — loadBlueprint() is already imported in ai.ts;
  // import it here too or inline the query
  const blueprint = await loadBlueprint(session.blueprint_id)
  const phaseExists = blueprint.phase_sequence.some((p) => p.id === parsed.data.next_phase_id)
  if (!phaseExists) {
    return c.json({ error: 'invalid_phase', message: 'next_phase_id not in Blueprint phase_sequence' }, 400)
  }

  // Write current_phase
  const { error: updateErr } = await supabase
    .from('sessions')
    .update({ current_phase: parsed.data.next_phase_id })
    .eq('id', id)

  if (updateErr) return c.json({ error: 'update_failed' }, 500)

  // D-12: broadcast phase_advanced — fire-and-forget (messages.ts:138–141 pattern)
  supabase
    .channel(`session:${id}`)
    .httpSend('phase_advanced', {
      new_phase_id: parsed.data.next_phase_id,
      blueprint_id: session.blueprint_id,
    })
    .catch((err) => console.error('[sessions] phase_advanced broadcast failed', err))

  return c.json({ current_phase: parsed.data.next_phase_id }, 200)
})
```

**Auth/Guard pattern** — `requireAuth` is already applied as middleware argument (same as all existing `sessionsRouter` handlers at lines 56, 128, 213, 244, 297, 348).

**Error handling** — `toClientError()` helper (lines 33–39) wraps unexpected Supabase errors; use for unexpected `updateErr`.

---

### `apps/api/src/graph/state.ts` — Add `phase_signal` field (D-09)

**Analog:** `steeringTextEnabled` field (lines 75–79) — identical overwrite-style reducer pattern.

**Core pattern** — copy `steeringTextEnabled` field definition verbatim, substituting the type:
```typescript
// Source: state.ts lines 75–79 — exact reducer pattern to copy:
steeringTextEnabled: Annotation<boolean | null>({
  reducer: (_: boolean | null, v: boolean | null) => v,
  default: () => null,
}),

// Phase 8 addition — insert after steeringTextEnabled (line 79), before closing `})`):
/** phase_signal from AgentNode tool output — advisory only; human must confirm (HUMAN-02, D-09). */
phase_signal: Annotation<boolean | null>({
  reducer: (_: boolean | null, v: boolean | null) => v,
  default: () => null,
}),
```

No new imports required — `Annotation` is already imported at line 13.

---

### `apps/api/src/graph/nodes/agent.ts` — Extract `phase_signal` before safeParse (D-08, Pitfall 2/4)

**Analog:** The existing `tool_use` event handler block (lines 148–165).

**Core pattern** — read `phase_signal` from raw input BEFORE `CanvasOpSchema.safeParse()` strips unknown fields; return it as a separate state field:

```typescript
// Current handler (lines 148–165) — starting point:
} else if (event.type === 'tool_use' && event.name === 'canvas_mutation') {
  const parsed = CanvasOpSchema.safeParse(event.input)
  if (parsed.success) {
    agentOutput = parsed.data
    agentConfidence = 'confidence' in parsed.data ? (parsed.data.confidence ?? null) : null
  } else {
    console.error('[agent] CanvasOpSchema.safeParse failed — dropping malformed tool output', ...)
  }
  break
}

// Phase 8 modification — insert rawPhaseSignal read BEFORE safeParse call:
} else if (event.type === 'tool_use' && event.name === 'canvas_mutation') {
  // D-08/Pitfall 4: read phase_signal from raw input before safeParse strips it
  const rawInput = event.input as Record<string, unknown>
  const rawPhaseSignal = typeof rawInput.phase_signal === 'boolean'
    ? rawInput.phase_signal
    : null

  const parsed = CanvasOpSchema.safeParse(event.input)
  if (parsed.success) {
    agentOutput = parsed.data
    agentConfidence = 'confidence' in parsed.data ? (parsed.data.confidence ?? null) : null
  } else {
    console.error('[agent] CanvasOpSchema.safeParse failed — dropping malformed tool output', ...)
  }
  // Phase 8: return phase_signal alongside agentOutput (D-09)
  return { agentOutput, agentConfidence, phase_signal: rawPhaseSignal }
}
```

The `return { agentOutput, agentConfidence }` at line 172 also needs `phase_signal: null` added for the no-tool-call path.

---

### `apps/api/src/graph/nodes/mutation-gate.ts` — Pass `phase_signal` through state (D-08)

**Analog:** The existing return statement at line 80.

**Core pattern** — `phase_signal` is already in `GraphState` (after D-09 extension). MutationGateNode does not need to read it from `agentOutput`; AgentNode sets it directly in state. MutationGateNode's return value stays as-is for the `canvasOps` accumulation path. No change needed if AgentNode returns `phase_signal` directly to state.

However, the `return {}` paths (vocabulary drop, confidence below threshold) must not accidentally reset `phase_signal` to `null`. Verify the overwrite reducer behaviour: the `reducer: (_, v) => v` means returning `{}` leaves the previous state value unchanged. **No change to mutation-gate.ts is required** as long as AgentNode returns `phase_signal` in its own output object — the overwrite reducer will have already set it before MutationGateNode runs.

---

### `packages/types/src/canvas-tool.ts` — Add `phase_signal` property (D-08)

**Analog:** The `reason` property block (lines 67–72) — same optional field pattern.

**Core pattern** — insert after `reason` property, before `}` closing `properties`:
```typescript
// Source: canvas-tool.ts lines 67–72 — existing optional field pattern:
reason: {
  type: 'string',
  description: 'Optional. For NO_ACTION: why no canvas change was made.',
},

// Phase 8 addition (insert after reason, before closing `}`):
phase_signal: {
  type: 'boolean',
  description:
    'Optional. Set to true when the conversation has reached a natural conclusion ' +
    'for the current phase and the group is ready to advance to the next phase. ' +
    'This is advisory only — a human must confirm phase advancement.',
},
```

The `required` array at line 73 (`required: ['op']`) remains unchanged — `phase_signal` is optional.

---

### `supabase/migrations/0010_mic_lock.sql` — New migration (HUMAN-01, D-03)

**Analog:** `supabase/migrations/0003_ai_count_helpers.sql` — exact SQL style: `CREATE OR REPLACE FUNCTION`, `SECURITY DEFINER`, `SET search_path = public`, `GRANT EXECUTE ... TO service_role`.

**Core pattern** — ALTER TABLE + two RPC functions following the 0003 pattern exactly:
```sql
-- Source: 0003_ai_count_helpers.sql lines 9–20 — function structure to copy:
create or replace function public.increment_ai_count(s_id uuid)
returns table(new_count int, cap int)
language sql
security definer
set search_path = public
as $$
  update public.sessions ...
$$;
grant execute on function public.increment_ai_count(uuid) to service_role;

-- Phase 8 migration follows same structure with plpgsql for IF FOUND:
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS mic_holder_id   text        NULL,
  ADD COLUMN IF NOT EXISTS mic_acquired_at timestamptz NULL;

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
DECLARE v_now timestamptz := now();
BEGIN
  UPDATE public.branches
  SET mic_holder_id = p_holder_id, mic_acquired_at = v_now
  WHERE id = p_branch_id
    AND (mic_holder_id IS NULL
         OR mic_acquired_at < (v_now - (p_expiry_seconds || ' seconds')::interval));
  IF FOUND THEN
    RETURN QUERY SELECT true, v_now;
  ELSE
    RETURN QUERY SELECT false, mic_acquired_at FROM public.branches WHERE id = p_branch_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_mic(p_branch_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.branches
  SET mic_holder_id = NULL, mic_acquired_at = NULL
  WHERE id = p_branch_id;
$$;

GRANT EXECUTE ON FUNCTION public.try_acquire_mic(uuid, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_mic(uuid) TO service_role;
```

Note: Use `(p_expiry_seconds || ' seconds')::interval` (line 19 of research Pattern 1 fallback) — safer than `make_interval()` across Postgres versions.

---

## Shared Patterns

### httpSend Fire-and-Forget Broadcast
**Source:** `apps/api/src/routes/messages.ts` lines 138–141 (canonical), also at `ai.ts` lines 394–396, `reactions.ts` lines 110–113, `branches.ts` lines 188–190.
**Apply to:** ALL 4 new Phase 8 broadcasts: `mic_acquired`, `mic_released`, `canvas_update`, `phase_advanced`.
```typescript
supabase
  .channel(`session:${sessionId}`)
  .httpSend('event_name', payload)
  .catch((err) => console.error('[module] event_name broadcast failed', err))
```
Critical: NO `await`. The `.catch()` is mandatory to prevent unhandled rejection.

### Postgres RPC Call Pattern
**Source:** `apps/api/src/lib/cap-guard.ts` lines 81–96.
**Apply to:** `try_acquire_mic` and `release_mic` calls in `ai.ts`.
```typescript
const { data, error } = await supabase.rpc('function_name', { param: value })
if (error || !data || !Array.isArray(data) || data.length === 0) {
  // handle error
}
const result = data[0] as { field: type }
```

### Ownership Gate (creator_id check)
**Source:** `apps/api/src/routes/sessions.ts` lines 261–263 (freeze), also `ai.ts` lines 83–85.
**Apply to:** `PATCH /:id/phase` handler.
```typescript
if (session.creator_id !== user.id) {
  return c.json({ error: 'forbidden' }, 403)
}
```

### Overwrite-Style Annotation Reducer
**Source:** `apps/api/src/graph/state.ts` lines 56–79 (`guardrailResult`, `agentConfidence`, `driftAction`, `agentOutput`, `steeringTextEnabled`).
**Apply to:** `phase_signal` field in `state.ts`.
```typescript
fieldName: Annotation<T | null>({
  reducer: (_: T | null, v: T | null) => v,
  default: () => null,
}),
```

### Fail-Silent Error Handling
**Source:** `apps/api/src/routes/ai.ts` lines 388–390 (message insert error path).
**Apply to:** Canvas upsert errors in `ai.ts` post-stream block.
```typescript
if (error || !row) {
  console.warn('[ai] operation failed — skipping (fail-silent)', error?.message)
  // continue, do not throw
}
```

### Zod Body Validation in Route Handlers
**Source:** `apps/api/src/routes/sessions.ts` lines 353–356 (UnfreezeBodySchema inline) and `messages.ts` lines 55–62 (PostMessageBodySchema.parse with try/catch).
**Apply to:** `PATCH /:id/phase` body parsing.
```typescript
const BodySchema = z.object({ field: z.string().min(1) })
const rawBody = await c.req.json().catch(() => ({}))
const parsed = BodySchema.safeParse(rawBody)
if (!parsed.success) {
  return c.json({ error: 'invalid_request', message: '...' }, 400)
}
```

### Server-Side UUID Generation
**Source:** `apps/api/src/routes/branches.ts` line 161.
**Apply to:** Canvas node and edge ID generation in `ai.ts` canvas upsert block.
```typescript
const newId = crypto.randomUUID()  // Node.js built-in — no import needed
```

### Upsert with onConflict
**Source:** `apps/api/src/routes/reactions.ts` lines 83–95.
**Apply to:** `canvas_nodes` and `canvas_edges` upserts in `ai.ts`.
```typescript
await supabase
  .from('table_name')
  .upsert({ ...fields }, { onConflict: 'id' })
  .select()
  .single()
```

---

## No Analog Found

All Phase 8 files have strong analogs in the existing codebase. No files require fallback to RESEARCH.md patterns alone.

---

## Post-Stream Cleanup Sequence (Critical Ordering)

The correct ordering in `ai.ts` after `await Promise.all([runGraph(), drainQueue()])` (current line 363):

1. **Message INSERT + `new_message` broadcast** — existing (lines 365–397)
2. **`phase_signal` SSE event** — NEW (if `finalState.phase_signal === true`), BEFORE `done`
3. **Langfuse `forceFlush`** — existing (lines 406–409)
4. **`done` SSE event** — existing (line 411)
5. **Canvas upserts (ADD_NODE first, then ADD_EDGE)** — NEW (AFTER `done`)
6. **`canvas_update` broadcast** — NEW fire-and-forget (AFTER upserts)

**`finally` block (always runs, even on AbortError):**
7. **`release_mic` RPC** — NEW
8. **`mic_released` broadcast** — NEW fire-and-forget

Source for sequence authority: `ai.ts` lines 362–419 + CONTEXT.md D-18, D-10, D-06; RESEARCH.md Pitfall 6.

---

## Metadata

**Analog search scope:** `apps/api/src/routes/`, `apps/api/src/graph/`, `apps/api/src/lib/`, `packages/types/src/`, `supabase/migrations/`
**Files scanned:** 11 source files read directly
**Pattern extraction date:** 2026-07-03
