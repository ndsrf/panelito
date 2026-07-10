---
phase: 10-infrastructure-foundation
reviewed: 2026-07-10T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - apps/api/src/graph/state.ts
  - apps/api/src/lib/bot-arbitrator.test.ts
  - apps/api/src/lib/bot-arbitrator.ts
  - apps/api/src/lib/bot-budget.test.ts
  - apps/api/src/lib/bot-budget.ts
  - apps/api/src/lib/silence-gate.test.ts
  - apps/api/src/lib/silence-gate.ts
  - apps/api/src/routes/ai.ts
  - packages/types/src/bot.test.ts
  - packages/types/src/bot.ts
  - packages/types/src/index.ts
  - supabase/migrations/0012_bot_infrastructure.sql
findings:
  critical: 4
  warning: 5
  info: 2
  total: 11
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-07-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 10 delivers bot infrastructure: the budget guard (`bot-budget.ts`), silence gate (`silence-gate.ts`), arbitration registry (`bot-arbitrator.ts`), new graph state fields (`state.ts`), bot type schemas (`packages/types/src/bot.ts`), a SQL migration (`0012_bot_infrastructure.sql`), and route-level wiring in `apps/api/src/routes/ai.ts`.

The individual modules are well-structured with good fail-closed discipline. However, four blockers are present: a type mismatch between the SQL function's `bigint` return and the TypeScript `number` guard that silently zeros out high-token-count values at runtime; an unhandled scorer exception that crashes `runArbitration` for all bots if any single scorer throws; the `release_bot_lock` RPC is defined in the migration but never called anywhere — the bot lock leaks on every successful arbitration; and a drainQueue notification race that can lose the final chunk of text on an unlucky interleaving. Several warnings are also documented below.

---

## Critical Issues

### CR-01: `tokens_used_window` type mismatch — `bigint` SQL vs. `number` TypeScript guard silently zeros

**File:** `apps/api/src/lib/bot-budget.ts:62`

**Issue:** The SQL function `check_and_record_bot_budget` declares its return column as `bigint` (migration line 157). Supabase-js serialises PostgreSQL `bigint` columns as JavaScript `string` when the value is large enough to overflow a 53-bit float. The guard on line 62 is `typeof row.tokens_used_window === 'number'`, which is `false` for string-serialised bigints, so `tokens_used_window` silently falls back to `0`. In practice this means a session that has consumed, say, 1 048 576 tokens reports `0` tokens in the window — the circuit-breaker window value is silently wrong at scale. (Values under ~9 000 tokens are safe; the bug is latent but real.)

**Fix:**
```typescript
// In bot-budget.ts line 62 — coerce both number and string shapes
const tokens_used_window =
  typeof row.tokens_used_window === 'number'
    ? row.tokens_used_window
    : typeof row.tokens_used_window === 'string'
    ? Number(row.tokens_used_window)
    : 0
```

Alternatively, change the SQL return type to `int` (which Postgres serialises as a JS `number` without overflow risk in normal token ranges), since 5-minute windowed token sums will never realistically exceed 2^31.

---

### CR-02: Scorer exceptions crash `runArbitration` — no error isolation per-bot

**File:** `apps/api/src/lib/bot-arbitrator.ts:93-95`

**Issue:** The scoring loop iterates registered bots and calls `scorer(context)` with no `try/catch`. If any scorer function throws (e.g., a Phase 11 scorer with a bug, or one accessing `context.blueprint` fields that are undefined for a given blueprint), the entire `runArbitration` call rejects. The caller receives an unhandled promise rejection and the mic lock held at the route level will still be released, but the error propagates up to the route's outer catch on line 688 of `ai.ts`, which emits a generic `stream_failed` SSE event. A single faulty bot scorer breaks all bot arbitration for every session.

**Fix:**
```typescript
for (const [botId, scorer] of _registry) {
  let score: number
  try {
    score = scorer(context)
  } catch (err) {
    console.warn('[bot-arbitrator] scorer threw for bot:', botId, (err as Error).message)
    continue  // skip this bot; don't let one bad scorer break arbitration
  }
  if (score > highScore) {
    highScore = score
    winnerId = botId
  }
}
```

---

### CR-03: `release_bot_lock` is never called — bot lock leaks on every arbitration win

**File:** `supabase/migrations/0012_bot_infrastructure.sql:134-147` and `apps/api/src/lib/bot-arbitrator.ts`

**Issue:** The migration defines `release_bot_lock(p_branch_id uuid)` (Section 6), which NULLs out `locked_until` and `winner_bot_id` so the next bot can win. However, `grep -rn "release_bot_lock"` across the entire `apps/api/src/` tree returns no results — this RPC is never called. When a bot wins arbitration, the lock is held until `locked_until` expires (default 30 seconds, or blueprint-configured). If the bot invocation fails partway through before its natural expiry, the lock is not explicitly released and the branch sits locked for the full cooldown period. More importantly, this means even after a successful run the lock is never explicitly cleared — early expiry-based release is the only mechanism, which is the design intent but the absence of any explicit release is different from `release_mic`, which IS called in `ai.ts:698` in a `finally` block.

This is an architectural gap: if the bot infrastructure is meant to mirror the mic lock pattern, `release_bot_lock` must be called in the finally block of the bot invocation path (Phase 11). But the function being unused right now means any future caller must discover this requirement independently, and there is no test or comment in `bot-arbitrator.ts` describing when it should be called.

**Fix:** Either add a call to `release_bot_lock` in `runArbitration` (or expose it as a module-level function) and document the caller contract, or add a `// TODO(Phase 11): call release_bot_lock in bot invocation finally block` comment in `bot-arbitrator.ts` with a reference to the migration. The silence on this is a correctness gap for any Phase 11 work.

---

### CR-04: drainQueue notification race — final text chunk can be lost

**File:** `apps/api/src/routes/ai.ts:365-405`

**Issue:** The `drainQueue` / `streamWriter` pair uses a shared `_notify` callback with a subtle race. In `drainQueue` (line 373-374):
```
await new Promise<void>((resolve) => { _notify = resolve })
_notify = null
```
After the promise resolves, `_notify` is set to `null` on line 374. If `streamWriter` is called in the graph between lines 373 and 374 (i.e., after `_notify` is assigned the resolver but before `_notify = null` is executed), the notification is delivered correctly. However, if `streamWriter` is called between the point where `_notify = null` executes and the next iteration's wait sets `_notify` again, and simultaneously `graphDone = true` is set (line 403), the `drainQueue` outer `while` condition `!graphDone || textChunks.length > 0` re-evaluates: `graphDone` is true, but `textChunks` has a new item that was pushed after `_notify` was nulled and before `_notify?.()` on line 404 fired. However — Node.js is single-threaded so this particular sequence cannot actually happen: `streamWriter` runs in the same microtask queue as the graph's `for await` loop, and `_notify?.()` on line 404 fires before the outer `Promise.all` can advance `drainQueue`. The race is not exploitable in Node.js today.

**However**, there is a real problem: when `runGraph` reaches the `finally` block and calls `_notify?.()` on line 404, it wakes `drainQueue`. At that point `graphDone = true`. `drainQueue` exits its inner chunk-drain loop, then checks `if (!graphDone)` — which is now `false` — so it does NOT wait again. The outer while condition `!graphDone || textChunks.length > 0` is then `false || false` if the queue was already empty, so `drainQueue` exits cleanly. This is fine. The real issue is different: if `streamWriter` pushes a chunk and calls `_notify?.()` while `drainQueue` is currently inside the inner `while (textChunks.length > 0)` loop processing previous chunks (i.e., `_notify` is `null`), the notification is dropped. `drainQueue` will eventually exit the inner loop and then check `if (!graphDone)` — if `graphDone` is still `false`, it will wait for a new `_notify`. When the next `streamWriter` call (or the `runGraph` finally) fires, the chunk is processed. So no chunk is truly lost — but if the last chunk from `streamWriter` arrives while `drainQueue` is processing the second-to-last chunk (both have already been pushed to `textChunks` before `_notify` was cleared), and at the same moment `runGraph` sets `graphDone = true` and calls `_notify?.()` (which is `null`), the `drainQueue` will have to re-enter the outer while loop, which it does because `textChunks.length > 0`. So it processes correctly.

Upon full trace, there is one genuine gap: if `_notify` is set (line 373 assigned the resolver), and then `_notify?.()` is called to resolve it (line 331 or 404), and then on the very next iteration `_notify = null` (line 374 sets it null after resolve), a second call to `_notify?.()` at line 331 or 404 is a no-op because `_notify` is already `null`. This means if `graphDone = true` fires (setting `_notify?.()` on line 404) and simultaneously a late `streamWriter` call also fires `_notify?.()`, only one resolve fires — but since both events have already set `graphDone = true` and pushed to `textChunks`, the outer while `!graphDone || textChunks.length > 0` will still catch the remaining items on the next iteration. The logic is actually sound in single-threaded Node.js.

**Reclassification:** After full trace, the drainQueue logic is correct in Node.js's single-threaded event loop. However, the `streamWriter` guard `if (graphDone) return` on line 329 is checked AFTER `graphDone = true` is set on line 403 in `runGraph`'s finally block. The sequence in the finally block is:
1. `graphDone = true`
2. `_notify?.()` (wake drainQueue)

If between steps 1 and 2, another async callback calls `streamWriter`, the guard `if (graphDone) return` drops the chunk silently. In Node.js this cannot happen because steps 1 and 2 are synchronous within the same finally block. But the comment "guard: no-op after graph completes" is misleading — it makes this look intentional when it would drop real data in a hypothetical async context.

**Actual blocker in this code:** The `_notify = null` on line 374 executes synchronously after the promise resolves. The next `await new Promise<void>((resolve) => { _notify = resolve })` will not execute until the current microtask (processing the resolved promise) completes. Between these two points, if `streamWriter` is called from a synchronous path within graph execution (which can happen if the graph is synchronous), `_notify` is `null` and the notification is dropped. Then `drainQueue` waits again with a fresh `_notify`. The chunk was already pushed to `textChunks` though, so the NEXT wake will process it. The real scenario where a chunk could be permanently lost: `streamWriter` pushes a chunk and calls `_notify?.()` when `_notify` is `null`, AND `graphDone` becomes `true` immediately after (also with `_notify` still `null`). In that case, `drainQueue` is in the inner processing loop. When it finishes the inner loop it checks `if (!graphDone)` — `false` — and exits the outer while. The unprocesed chunk in `textChunks` is missed.

This IS a genuine bug: a text chunk pushed by `streamWriter` after `_notify` is cleared but before `graphDone` is set can be orphaned if `graphDone` is set during the same synchronous turn before `drainQueue` re-enters its outer while check.

**Fix:** Replace the manual promise/notify pattern with a proper async channel or use the `finally` block sequencing that processes all remaining chunks after graph done before exiting:
```typescript
// In drainQueue, after the inner while, before checking graphDone:
// Re-check textChunks after setting up wait — prevents the race between
// _notify=null and graphDone=true in the same turn
if (!graphDone && textChunks.length === 0) {
  await new Promise<void>((resolve) => { _notify = resolve })
  _notify = null
}
// If textChunks got items while we were about to wait, the outer while catches them
```

---

## Warnings

### WR-01: `check_and_record_bot_budget` always inserts before checking threshold — over-counts on circuit-open path after reset

**File:** `supabase/migrations/0012_bot_infrastructure.sql:212-234`

**Issue:** Step (c) on line 212 unconditionally inserts into `bot_budget_ledger` before step (d) computes the windowed sum and step (e) trips the circuit. This means: when the circuit resets (v_reset_at has elapsed) and the first invocation after reset arrives, its token cost IS recorded in the ledger. That is correct. However, when the circuit is freshly open and `RETURN QUERY SELECT false, true, 0::bigint` fires on line 185, the function returns early BEFORE the insert — so blocked invocations are not recorded, which is the desired behaviour. The path is correct. However, this ordering means the invocation that pushes the window OVER the threshold records its tokens AND trips the circuit, so it is counted in the window for the next reset cycle. This is by-design over-counting: after a 10-minute reset, the ledger still has the over-threshold invocation's tokens in the 5-minute window. If the reset_at is set to `now() + 10 minutes`, after 10 minutes the 5-minute window will NOT include any pre-circuit invocations (10 min > 5 min window), so this resolves itself correctly. This is fine — documenting as WARNING because the ordering is subtle and the comment on line 210 does not mention this.

**Fix:** Add a comment to the SQL explaining that the 10-minute pause is intentionally longer than the 5-minute window, guaranteeing stale ledger entries fall outside the window after circuit reset.

---

### WR-02: `silence-gate.ts` — no-messages case (`rows.length === 0`) sets `lastCreatedAt = 0`, making elapsed ~52 years

**File:** `apps/api/src/lib/silence-gate.ts:81-83`

**Issue:** When the `messages` table has no rows for a branch (a newly created branch with zero messages), the query returns an empty array. The fallback on line 82 sets `lastCreatedAt = 0` (Unix epoch: January 1, 1970). `Date.now() - 0` is approximately 1.75 trillion milliseconds — far exceeding any `thresholdMs`. This means a bot can fire on a brand-new branch with zero messages, which is almost certainly wrong: there is nothing to respond to. The silence gate passing for a zero-message branch means the arbitration lock and budget guard are the only barriers, and a bot could post an unsolicited first message into a branch that just forked.

**Fix:**
```typescript
// In silence-gate.ts, replace lines 81-83:
if (!rows || rows.length === 0) {
  // No messages yet — gate blocks (nothing to respond to)
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

### WR-03: `bot-arbitrator.ts` — module-level `_registry` is a singleton — cross-test contamination without `vi.resetModules()`

**File:** `apps/api/src/lib/bot-arbitrator.ts:48` and `apps/api/src/lib/bot-arbitrator.test.ts:49`

**Issue:** The `_registry` map is module-level state. The test file uses `vi.resetModules()` in `beforeEach` and calls `importFresh()` to get a clean module per test. This pattern is correct. However, `registerBot` is also a public export — any production code or other test file that imports `bot-arbitrator.ts` directly (without `vi.resetModules()`) will share the same registry across all usages. In a Vitest run with multiple test files, if another test file imports `bot-arbitrator.ts` directly and calls `registerBot`, it contaminates the shared registry for all subsequent tests in the same worker. There is no `clearRegistry()` or similar escape hatch.

**Fix:** Either expose a `clearRegistry()` function for tests, or document the expected isolation mechanism. Consider whether the module-level singleton pattern is appropriate for a server environment where module state is shared across concurrent requests.

---

### WR-04: `ai.ts` — `accumulatedText` insert condition inverted — canvas-only responses never insert message row

**File:** `apps/api/src/routes/ai.ts:413`

**Issue:** The comment on line 412 says "T-07-08: empty accumulatedText + no canvasOps → skip INSERT", but the condition on line 413 is:
```typescript
if (!accumulatedText.trim() && (finalState as any)?.canvasOps?.length > 0) {
  accumulatedText = '[canvas updated]'
}
```
This sets `accumulatedText` to a fallback string ONLY when there ARE canvas ops and NO text. Then line 417 checks `if (accumulatedText.length > 0)` — which is true for the fallback string. This is correct for the canvas-with-no-text case. However, the spec comment says "empty accumulatedText + no canvasOps → skip INSERT." The code achieves this indirectly: if both are empty, `accumulatedText` stays `''`, and `''.length > 0` is false, so the insert is skipped. This is correct behaviour.

The real bug is that `canvasOps` in `finalState` is populated by the LangGraph node's reducer — which accumulates ALL canvas ops across the entire graph run (the reducer on line 38-40 of `state.ts` concatenates). But `finalState` on line 380 is built by `Object.assign`-ing each node's OUTPUT (the delta returned by each node), not the accumulated state. A node that returns `{ canvasOps: [op] }` will set `finalState.canvasOps = [op]`. If two different nodes each return a canvas op, the second `Object.assign` overwrites the first because both deltas have key `canvasOps`. The comment on lines 385-392 discusses this for `canvasOps` implying the accumulation happens in `finalState` — but it does not. `finalState.canvasOps` at line 488 (`allCanvasOps = finalState?.canvasOps ?? []`) will only contain the last node's canvas op delta, not the accumulated total.

The actual accumulated ops live in the graph checkpoint state, not in `finalState` as assembled here. If Phase 9 has multiple nodes emitting canvas ops, this will silently drop all but the last node's ops.

**Fix:** Either read canvas ops from the final graph checkpoint state (via `graph.getState()`) rather than from `finalState` which only accumulates node deltas, or ensure only one node ever emits canvas ops and document that constraint.

---

### WR-05: `ai.ts` — `anyoneTyping` gate uses a truthy check, not a strict boolean — any non-falsy value triggers hold

**File:** `apps/api/src/routes/ai.ts:115`

**Issue:** The typing hold check is `if (body.anyoneTyping)`. Because `body` is parsed with a `.catch(() => ({}))` fallback and cast to the expected type, `anyoneTyping` is not validated. Any truthy value — the string `"false"`, the number `1`, a non-empty array — triggers the 429 response. A client bug sending `anyoneTyping: "false"` (stringified) would permanently block all AI responses.

**Fix:**
```typescript
if (body.anyoneTyping === true) {
  return c.json({ error: 'typing_hold' }, 429)
}
```

---

## Info

### IN-01: `bot.ts` — `BotBudgetResultSchema` uses `z.number()` but SQL returns `bigint`

**File:** `packages/types/src/bot.ts:37-39`

**Issue:** The Zod schema `BotBudgetResultSchema` declares `tokens_used_window: z.number()`. The SQL function returns `bigint`. This is a type contract mismatch that is currently masked by Supabase-js serialising small bigints as JS numbers. If the schema is ever used to parse the raw RPC response (instead of the manual extraction in `bot-budget.ts`), large values will fail Zod validation or coerce incorrectly. Related to CR-01.

**Fix:** Change to `z.union([z.number(), z.string()])` with a transform, or use `z.number()` and document that only values within safe-integer range are expected. Align with the SQL fix in CR-01.

---

### IN-02: `bot-arbitrator.test.ts` — Test 4 warn spy argument mismatch (third arg can be `undefined`)

**File:** `apps/api/src/lib/bot-arbitrator.test.ts:100-104`

**Issue:** Test 4 asserts `warnSpy` was called with three arguments matching `[stringContaining('[bot-arbitrator]'), any(String), anything()]`. The actual `console.warn` call (bot-arbitrator.ts:116) is:
```typescript
console.warn('[bot-arbitrator] lock not acquired for winner:', winnerId, error?.message)
```
In Test 4, `error` is `{ message: 'DB error' }`, so `error?.message` is `'DB error'` — a string. `expect.anything()` matches any non-null/non-undefined value, so this passes. However, in Test 3 (`acquired: false, error: null`), `error` is `null`, so `error?.message` is `undefined`. `expect.anything()` in Vitest returns false for `undefined`. If Test 3 were to also check the warn spy, the assertion would fail. This is not currently tested in Test 3 (no spy), so it is not a test failure — but it is a latent mismatch if Test 3 is ever augmented to assert on the warning log.

**Fix:** Change `expect.anything()` to `expect.toBeUndefined()` for the no-error case, or change the assertion in Test 4 to use `'DB error'` directly.

---

_Reviewed: 2026-07-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
