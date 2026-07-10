---
phase: 10-infrastructure-foundation
reviewed: 2026-07-10T12:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - packages/types/src/bot.ts
  - packages/types/src/bot.test.ts
  - packages/types/src/index.ts
  - apps/api/src/graph/state.ts
  - apps/api/src/routes/ai.ts
  - supabase/migrations/0012_bot_infrastructure.sql
  - apps/api/src/lib/bot-arbitrator.ts
  - apps/api/src/lib/bot-arbitrator.test.ts
  - apps/api/src/lib/bot-budget.ts
  - apps/api/src/lib/bot-budget.test.ts
  - apps/api/src/lib/silence-gate.ts
  - apps/api/src/lib/silence-gate.test.ts
findings:
  critical: 3
  warning: 5
  info: 2
  total: 10
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-07-10T12:00:00Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 10 delivers the bot infrastructure layer: a token budget guard (`bot-budget.ts`), a two-signal silence gate (`silence-gate.ts`), a plugin arbitration registry (`bot-arbitrator.ts`), new graph state fields in `state.ts`, Zod-typed schemas in `packages/types/src/bot.ts`, a SQL migration adding three tables and three atomic RPCs, and a `triggerMetadata` field in the state graph. The `ai.ts` route is unchanged in structure but touched by the new `triggerMetadata` state field.

The individual modules show good fail-closed discipline in `bot-budget.ts` and structured WSL2 fallback handling in `silence-gate.ts`. However three blockers are present: the SQL budget RPC returns a `bigint` column while the TypeScript guard checks `typeof === 'number'`, silently producing `0` for large token sums; `runArbitration` has no per-scorer error isolation so a single faulty scorer crashes arbitration for all bots; and `release_bot_lock` is defined in the migration and documented as the mirror of `release_mic`, but is never called from any application code, creating a lock-leak on every arbitration win. Five warnings are also documented.

---

## Critical Issues

### CR-01: `tokens_used_window` bigint/number type mismatch — silently zeros large token counts

**File:** `apps/api/src/lib/bot-budget.ts:62`

**Issue:** The SQL function `check_and_record_bot_budget` declares its return column as `bigint` (migration line 157: `returns table(allowed boolean, circuit_open boolean, tokens_used_window bigint)`). The Supabase JS client serialises PostgreSQL `bigint` values as JavaScript `string` when the value exceeds 2^53 (safe-integer boundary). The guard in `bot-budget.ts` is:

```typescript
const tokens_used_window = typeof row.tokens_used_window === 'number' ? row.tokens_used_window : 0
```

When Supabase-js returns the value as a string (e.g., `"2097152"` for a 2M-token window), `typeof row.tokens_used_window` is `'string'`, not `'number'`, so the guard falls through to `0`. The function returns `{ tokens_used_window: 0 }` — the circuit-breaker window value is silently wrong. The `BotBudgetResultSchema` in `packages/types/src/bot.ts:37` also declares `tokens_used_window: z.number()`, creating the same mismatch if the schema is ever used to parse the raw RPC response.

For typical session token budgets (default threshold = 1000), this bug is latent: values under ~9 trillion tokens are safe. But high-usage sessions or future threshold increases can expose it without any warning.

**Fix:**
```typescript
// bot-budget.ts line 62 — handle both number (small bigint) and string (large bigint) serializations
const tokens_used_window =
  typeof row.tokens_used_window === 'number'
    ? row.tokens_used_window
    : typeof row.tokens_used_window === 'string'
    ? Number(row.tokens_used_window)
    : 0
```

Alternatively, change the SQL return type to `int` (migration line 157: `tokens_used_window int`). The 5-minute windowed sum of token usage will never realistically exceed 2^31 (2.1 billion), so `int` is sufficient and eliminates the JS serialization edge case entirely. Also update `BotBudgetResultSchema` in `bot.ts` to match.

---

### CR-02: Scorer exceptions in `runArbitration` are unhandled — one faulty scorer crashes all bot arbitration

**File:** `apps/api/src/lib/bot-arbitrator.ts:93-95`

**Issue:** The scoring loop calls `scorer(context)` with no `try/catch`:

```typescript
for (const [botId, scorer] of _registry) {
  const score = scorer(context)  // line 94 — no error isolation
  if (score > highScore) {
    highScore = score
    winnerId = botId
  }
}
```

If any registered scorer throws — due to a Phase 11 implementation bug, a missing property on `context.blueprint`, or accessing a blueprint field that is undefined for a particular blueprint version — the thrown exception propagates out of `runArbitration` as a rejected promise. The caller receives an unhandled rejection. A single faulty scorer silently disables arbitration for all bots in all sessions for the lifetime of the process, until a deploy restarts the server (module-level registry is singleton).

**Fix:**
```typescript
for (const [botId, scorer] of _registry) {
  let score: number
  try {
    score = scorer(context)
  } catch (err) {
    console.warn('[bot-arbitrator] scorer threw for bot:', botId, (err as Error).message)
    continue  // skip this bot; one bad scorer must not block others
  }
  if (score > highScore) {
    highScore = score
    winnerId = botId
  }
}
```

---

### CR-03: `release_bot_lock` is never called — bot arbitration lock leaks on every win

**File:** `supabase/migrations/0012_bot_infrastructure.sql:134-147` and `apps/api/src/lib/bot-arbitrator.ts`

**Issue:** The migration defines `release_bot_lock(p_branch_id uuid)` in Section 6 and grants execute to `service_role` (line 248). The table comment on line 37 states the table is "Mutated exclusively by try_acquire_bot_lock / release_bot_lock". However, a `grep -rn "release_bot_lock"` across the entire `apps/api/src/` tree returns zero results — the function is never called.

The bot lock therefore relies entirely on expiry (`locked_until`) for release. The expiry is computed from `blueprint.bot_cooldowns?.[winnerId] ?? DEFAULT_COOLDOWN_SECONDS` (30 seconds default). If the bot invocation fails before natural expiry (e.g., an error thrown in Phase 11 bot logic after `runArbitration` returns), the branch remains locked for the full cooldown period with no early-release path.

This is a design gap rather than a current runtime bug (Phase 10 has no bots yet), but it means Phase 11 bot implementations have no documented contract for when to call `release_bot_lock`, and no `finally` block pattern to copy. The analogue `release_mic` IS called in a `finally` block (`ai.ts:698`) for the human invoke path.

**Fix:** Export a `releaseBotLock` wrapper from `bot-arbitrator.ts` that calls the RPC, and add a comment documenting that callers must invoke it in a `finally` block after bot execution:

```typescript
// bot-arbitrator.ts — add after runArbitration
/**
 * releaseBotLock — explicitly releases the arbitration lock for a branch.
 *
 * MUST be called in a finally block after bot execution completes or fails.
 * Mirrors the release_mic pattern in ai.ts. Failure to call this leaves the
 * lock held until locked_until expires (up to blueprint.bot_cooldowns seconds).
 */
export async function releaseBotLock(
  branchId: string,
  supabase: SupabaseClient
): Promise<void> {
  const { error } = await supabase.rpc('release_bot_lock', { p_branch_id: branchId })
  if (error) {
    console.warn('[bot-arbitrator] release_bot_lock error (non-fatal):', error.message)
  }
}
```

---

## Warnings

### WR-01: `silence-gate.ts` zero-message branch sets `lastCreatedAt = 0` — gate passes spuriously

**File:** `apps/api/src/lib/silence-gate.ts:81-83`

**Issue:** When the `messages` query returns an empty array (a freshly created branch with no messages), the fallback on lines 81-83 is:

```typescript
const lastCreatedAt =
  rows && rows.length > 0 && rows[0]?.created_at ? new Date(rows[0].created_at).getTime() : 0
const elapsedMs = Date.now() - lastCreatedAt
```

`lastCreatedAt = 0` is Unix epoch (January 1970). `Date.now() - 0` is approximately 1.76 trillion milliseconds — far exceeding any `thresholdMs`. The silence gate therefore passes for a brand-new branch with zero messages, and a bot can post an unsolicited first message into an empty branch. The arbitration lock and budget guard would still prevent concurrent bots, but a bot could fire immediately on branch creation with no human having spoken.

No test covers this case. Test 5 in `silence-gate.test.ts` passes `buildMessagesMock(null, { message: 'DB error' })` — this triggers the `msgsError` path (early return), not the zero-rows-no-error path.

**Fix:**
```typescript
// silence-gate.ts lines 81-87 — treat zero messages as too_soon
if (!rows || rows.length === 0) {
  return { passed: false, reason: 'too_soon', presence_fallback: false }
}
const lastCreatedAt = rows[0]?.created_at
  ? new Date(rows[0].created_at).getTime()
  : null
if (lastCreatedAt === null) {
  return { passed: false, reason: 'too_soon', presence_fallback: false }
}
const elapsedMs = Date.now() - lastCreatedAt
```

---

### WR-02: Security-definer bot RPCs lack `REVOKE EXECUTE FROM PUBLIC` — authenticated users can call them directly

**File:** `supabase/migrations/0012_bot_infrastructure.sql:247-249`

**Issue:** In PostgreSQL, `CREATE OR REPLACE FUNCTION` grants `EXECUTE` to `PUBLIC` by default. The migration adds `GRANT EXECUTE TO service_role` but never issues `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC`. The migration comment on line 15-16 states "RPCs granted exclusively to service_role" — this comment is incorrect: the PUBLIC grant remains in effect.

An authenticated database user (or anon user in environments where anon has EXECUTE) can call these SECURITY DEFINER functions directly:
- `check_and_record_bot_budget`: Can inject arbitrary token counts for any branch, inflating the budget window and deliberately tripping circuit breakers for any session (DoS against bot responses).
- `try_acquire_bot_lock`: Can acquire a bot lock for any branch with any `p_locked_until` timestamp — including a far-future date like `'2099-01-01'` — permanently preventing bots from firing in targeted sessions.
- `release_bot_lock`: Can release bot locks, bypassing arbitration timing.

Note: The existing `0010_mic_lock.sql` has the same missing REVOKE pattern (`try_acquire_mic`, `release_mic`), and the `supabase/config.toml` indicates Supabase Cloud auto-exposure of functions to PostgREST was disabled as of 2026-05-30. The PostgREST API-layer risk is therefore mitigated in cloud deployments. However, direct database connections (e.g., via `pg` or `psql` as the authenticated role) retain EXECUTE access.

**Fix:** Add to Section 8 of the migration:
```sql
revoke execute on function public.try_acquire_bot_lock(uuid, text, timestamptz) from public;
revoke execute on function public.release_bot_lock(uuid) from public;
revoke execute on function public.check_and_record_bot_budget(uuid, int) from public;
```

Also create a follow-up migration for `0010_mic_lock.sql`'s functions for consistency.

---

### WR-03: `anyoneTyping` gate uses a truthy check, not strict boolean — string `"false"` triggers 429

**File:** `apps/api/src/routes/ai.ts:115`

**Issue:** The request body is parsed with `.catch(() => ({}))` and cast to an unvalidated type. The typing-hold check is:

```typescript
if (body.anyoneTyping) {
  return c.json({ error: 'typing_hold' }, 429)
}
```

Any truthy value triggers the 429: the string `"false"` (a common client-side serialization mistake), the number `1`, an empty object `{}`. A frontend bug sending `anyoneTyping: "false"` (JSON-stringified boolean) would block all AI responses silently and permanently until the bug is fixed on the client.

**Fix:**
```typescript
if (body.anyoneTyping === true) {
  return c.json({ error: 'typing_hold' }, 429)
}
```

---

### WR-04: `finalState.canvasOps` captures only the last node's delta — multi-node ops would be silently dropped

**File:** `apps/api/src/routes/ai.ts:380-392` and `apps/api/src/graph/state.ts:37-40`

**Issue:** The `finalState` object in `runGraph` is assembled by `Object.assign`-ing each node's output delta:

```typescript
for (const nodeOutput of Object.values(chunk)) {
  Object.assign(finalState, nodeOutput)
}
```

The `canvasOps` field uses a concat reducer in `GraphStateAnnotation` (state.ts:39) — the LangGraph checkpoint accumulates ops from all nodes. But `finalState` is assembled from raw node output deltas, not from the checkpoint. If two nodes each returned `{ canvasOps: [op] }`, the second `Object.assign` would overwrite `finalState.canvasOps` with only the second op.

Currently, only `MutationGateNode` emits `canvasOps` (one op per invocation), and the graph runs each node once. So in the current single-linear-path design, only one delta is ever assigned and the bug is latent. The comment at line 385-387 explicitly discusses this for the node-wrapper case but does not acknowledge the multi-op risk. If a future Phase adds a second node that emits canvas ops (e.g., a ghost-promotion node), this would silently drop all but the last.

**Fix:** Either document the single-emitter constraint explicitly:
```typescript
// INVARIANT: Only MutationGateNode emits canvasOps. If a second node is added
// that emits canvasOps, switch to reading from graph.getState() checkpoint instead.
```
Or read accumulated canvas ops from the graph checkpoint after the stream completes:
```typescript
const checkpointState = await graph.getState({ configurable: { thread_id: graphConfig.configurable.thread_id } })
const allCanvasOps = checkpointState.values?.canvasOps ?? []
```

---

### WR-05: `check_and_record_bot_budget` TOCTOU — two concurrent callers can both pass the threshold check

**File:** `supabase/migrations/0012_bot_infrastructure.sql:167-234`

**Issue:** The function performs these steps across separate statements within one transaction (READ COMMITTED isolation):

1. (a) SELECT circuit state
2. (c) INSERT into ledger (unconditional)
3. (d) SUM window including the just-inserted row
4. (e) Trip circuit if sum > threshold

In READ COMMITTED, if two concurrent transactions both reach step (d) before either commits, each SUM sees only its own ledger insert — not the other's. Both sums read below threshold; both return `allowed: true`. The combined actual spend is 2x the threshold before the circuit trips.

The bot-vs-bot case is mitigated by `try_acquire_bot_lock` (bots serialize through the arbitration lock). However, a human `/invoke` call and a bot invoke can run concurrently on the same branch (they use separate locks: `try_acquire_mic` vs `try_acquire_bot_lock`). In that scenario, both could call `check_and_record_bot_budget` simultaneously.

The severity is bounded: the overspend is at most one extra bot invocation above threshold per concurrent pair, after which the window SUM from committed inserts will trip the circuit for subsequent calls.

**Fix:** Add `FOR UPDATE` on the circuit state SELECT to serialize concurrent budget checks per branch:
```sql
SELECT cs.circuit_open, cs.reset_at
INTO   v_circuit_open, v_reset_at
FROM   public.bot_circuit_state cs
WHERE  cs.branch_id = p_branch_id
FOR UPDATE;  -- serialize concurrent budget checks on this branch
```

If the circuit state row doesn't exist yet, the advisory locking approach with `pg_advisory_xact_lock(hashtext(p_branch_id::text))` can serialize the first-insert case.

---

## Info

### IN-01: `BotBudgetResultSchema` declares `tokens_used_window: z.number()` but SQL returns `bigint`

**File:** `packages/types/src/bot.ts:37-39`

**Issue:** The Zod schema declares `tokens_used_window: z.number()`. The SQL function returns `bigint`. If the schema is ever used to parse the raw RPC response (e.g., in a future refactor of `bot-budget.ts` to use Zod validation), large values will either fail validation or produce incorrect results depending on how the `bigint` is serialized. Related to CR-01. Currently `bot-budget.ts` uses manual field extraction that bypasses the schema.

**Fix:** Update the schema to explicitly handle both serialization shapes:
```typescript
tokens_used_window: z.union([z.number(), z.string().transform(Number)]),
```

Or change the SQL return type to `int` (see CR-01 fix) and keep `z.number()`.

---

### IN-02: `bot-arbitrator.test.ts` Test 4 warn spy uses `expect.anything()` for third arg that is `undefined` in the error-null case

**File:** `apps/api/src/lib/bot-arbitrator.test.ts:100-104`

**Issue:** The production `console.warn` call is:
```typescript
console.warn('[bot-arbitrator] lock not acquired for winner:', winnerId, error?.message)
```

In Test 4, `error = { message: 'DB error' }`, so `error?.message` is the string `'DB error'`. The spy assertion uses `expect.anything()` for the third argument, which matches. However, in the no-error case (Test 3: `acquired: false, error: null`), `error?.message` is `undefined`. `expect.anything()` in Vitest returns `false` for `undefined`. Test 3 does not assert on the warn spy, so no current failure — but if Test 3 is extended to assert the warning log, the assertion would fail incorrectly.

**Fix:** Either use `expect.stringContaining('DB error')` in Test 4 for the third argument, or make the `console.warn` call omit `error?.message` when error is null:
```typescript
console.warn('[bot-arbitrator] lock not acquired for winner:', winnerId, error?.message ?? '(no error)')
```

---

_Reviewed: 2026-07-10T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
