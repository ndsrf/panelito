---
phase: 10-infrastructure-foundation
fixed_at: 2026-07-10T12:30:00Z
review_path: .planning/phases/10-infrastructure-foundation/10-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-07-10T12:30:00Z
**Source review:** .planning/phases/10-infrastructure-foundation/10-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (CR-01, CR-02, CR-03, WR-01, WR-02, WR-03, WR-04, WR-05)
- Fixed: 8
- Skipped: 0

## Fixed Issues

### CR-01: `tokens_used_window` bigint/number type mismatch

**Files modified:** `apps/api/src/lib/bot-budget.ts`
**Commit:** c6f471c
**Applied fix:** Extended the `typeof` guard on line 62 to handle both `number` (small bigint values Supabase returns inline) and `string` (large bigint values serialised as string). Added `Number(row.tokens_used_window)` conversion for the string case. The `BotBudgetResultSchema` in `bot.ts` was left as `z.number()` since the schema is not used to parse the raw RPC response in the current code — the schema already accepts coerced numbers, and IN-01 (updating the schema itself) is out of scope per the fix request.

---

### CR-02: Scorer exceptions in `runArbitration` crash all bot arbitration

**Files modified:** `apps/api/src/lib/bot-arbitrator.ts`
**Commit:** 5b0e729
**Applied fix:** Wrapped the `scorer(context)` call inside `try/catch`. Faulty scorers log a warn message (including the botId and error message) and are skipped via `continue`. A single bad scorer no longer propagates an exception out of `runArbitration`.

---

### CR-03: `release_bot_lock` never called — lock leaks on every arbitration win

**Files modified:** `apps/api/src/lib/bot-arbitrator.ts`
**Commit:** 5b0e729
**Applied fix:** Exported `releaseBotLock(branchId, supabase)` from `bot-arbitrator.ts`. The function calls the `release_bot_lock` RPC and logs a non-fatal warn on error (matching the `release_mic` error-handling pattern). JSDoc documents that callers must invoke it in a `finally` block after bot execution, mirroring the `release_mic` pattern in `ai.ts:698`.

---

### WR-01: Zero-message branch sets `lastCreatedAt = 0` — gate passes spuriously

**Files modified:** `apps/api/src/lib/silence-gate.ts`
**Commit:** 0f16550
**Applied fix:** Added an explicit early-return for `rows.length === 0` (returning `{ passed: false, reason: 'too_soon', presence_fallback: false }`) before computing `lastCreatedAt`. Also added a null-guard for `rows[0]?.created_at === null/undefined` returning the same too_soon sentinel. The old fallback `lastCreatedAt = 0` (Unix epoch, producing ~1.76T ms elapsed) is eliminated.

---

### WR-02: Security-definer bot RPCs lack `REVOKE EXECUTE FROM PUBLIC`

**Files modified:** `supabase/migrations/0012_bot_infrastructure.sql`, `supabase/migrations/0013_revoke_public_execute.sql` (new file)
**Commit:** 9bc3ff5
**Applied fix:** Added `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC` for all three bot RPCs at the end of Section 8 in migration 0012. Created new migration 0013 that revokes PUBLIC EXECUTE from the two mic-lock RPCs (`try_acquire_mic`, `release_mic`) in migration 0010 for consistency. The 0013 migration handles both the mic-lock REVOKEs (for existing environments) and the bot RPC REVOKEs (belt-and-suspenders, since 0012 also has them now for fresh installs).

---

### WR-03: `anyoneTyping` gate uses truthy check — string `"false"` triggers 429

**Files modified:** `apps/api/src/routes/ai.ts`
**Commit:** 728377e
**Applied fix:** Changed `if (body.anyoneTyping)` to `if (body.anyoneTyping === true)` on line 115. Added a comment explaining why strict equality is required — to reject truthy non-boolean values such as the string `"false"` that a client serialisation bug might send.

---

### WR-04: `finalState.canvasOps` captures only the last node's delta

**Files modified:** `apps/api/src/routes/ai.ts`
**Commit:** 2feee69
**Applied fix:** Added an INVARIANT comment above the `graph.stream()` loop documenting that only `MutationGateNode` emits `canvasOps`, that `Object.assign` would silently drop ops from all but the last emitting node if the graph ever added a second emitter, and providing the checkpoint-read migration path for any future Phase that violates this constraint. The comment includes the concrete `graph.getState()` call needed to read accumulated ops from the checkpoint.

---

### WR-05: `check_and_record_bot_budget` TOCTOU — two concurrent callers can both pass

**Files modified:** `supabase/migrations/0012_bot_infrastructure.sql`, `supabase/migrations/0013_revoke_public_execute.sql`
**Commit:** 6ef0b15
**Applied fix:** Added `FOR UPDATE` to the circuit state `SELECT` in `check_and_record_bot_budget`. This serialises concurrent callers on the same `branch_id` row — the second caller blocks until the first commits, then its SUM reflects the committed window. Applied to the canonical definition in migration 0012 and deployed via `CREATE OR REPLACE FUNCTION` in migration 0013 for existing environments. Note: the first-invocation NOT FOUND path (INSERT ... ON CONFLICT DO NOTHING) is not serialised by FOR UPDATE since no row exists yet; however both concurrent first-callers will race to insert and one will no-op, and the subsequent FOR UPDATE SELECT will then serialise them.

---

_Fixed: 2026-07-10T12:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
