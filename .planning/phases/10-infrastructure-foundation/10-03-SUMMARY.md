---
phase: 10-infrastructure-foundation
plan: "03"
subsystem: bot-infrastructure
tags: [bot-arbitrator, bot-budget, silence-gate, BOT-01, BOT-02, BOT-03, TDD]
dependency_graph:
  requires: [10-01, 10-02]
  provides: [bot-arbitrator-registry, bot-budget-guard, silence-gate-two-signal]
  affects: [apps/api/src/lib]
tech_stack:
  added: []
  patterns:
    - TDD RED/GREEN cycle per module
    - cap-guard error pattern for supabase.rpc fail-closed
    - module-level Map registry (singleton state without Promise)
    - injected callback for testable WSL2 fallback
key_files:
  created:
    - apps/api/src/lib/bot-arbitrator.ts
    - apps/api/src/lib/bot-arbitrator.test.ts
    - apps/api/src/lib/bot-budget.ts
    - apps/api/src/lib/bot-budget.test.ts
    - apps/api/src/lib/silence-gate.ts
    - apps/api/src/lib/silence-gate.test.ts
  modified: []
decisions:
  - "bot-budget uses explicit field extraction not BotBudgetResultSchema.parse — avoids Zod runtime resolution issue in worktree vitest (zod cannot be resolved via the vitest alias chain from @panelito/types import)"
  - "silence-gate too_soon short-circuit fires before presence check, so presence_fallback stays false in too_soon path (matches plan step 2 spec)"
  - "Test 4b adjusted: when elapsed < threshold, presence is never called; presence_fallback:false is correct per plan ordering"
metrics:
  duration: "6 minutes"
  completed: "2026-07-10"
  tasks_completed: 3
  files_changed: 6
---

# Phase 10 Plan 03: Service Modules (bot-arbitrator, bot-budget, silence-gate) Summary

Three application-layer service modules wrapping Plan 02 RPCs and Presence signals into typed, testable functions: BotArbitrator plugin registry (BOT-02), token budget guard (BOT-01), and two-signal silence gate (BOT-03) — all with co-located vitest suites and full TDD RED/GREEN execution.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 RED | bot-arbitrator failing tests | f4b84fd | bot-arbitrator.test.ts |
| 1 GREEN | BotArbitrator implementation | d92949b | bot-arbitrator.ts, bot-arbitrator.test.ts |
| 2 RED | bot-budget failing tests | 3a4eb98 | bot-budget.test.ts |
| 2 GREEN | checkBotBudget implementation | 496aa50 | bot-budget.ts |
| 3 RED | silence-gate failing tests | 8f4be66 | silence-gate.test.ts |
| 3 GREEN | silence-gate implementation | dd1dcc2 | silence-gate.ts, silence-gate.test.ts |

## What Was Built

### bot-arbitrator.ts (BOT-02)

Plugin registry for bot arbitration. `registerBot(botId, scorerFn)` adds a scorer to the module-level `_registry` Map. `runArbitration(branchId, blueprint, supabase)` scores all registered bots, picks the highest, resolves the cooldown duration from `blueprint.bot_cooldowns?.[winnerId]` (D-02, falls back to 30s), then calls `try_acquire_bot_lock` RPC. Returns the winner bot ID or null.

Phase 10 short-circuit (D-03): if `_registry.size === 0`, returns null immediately without any RPC call.

5 test cases: empty-registry, winner-selection, lock-not-granted, rpc-error, cooldown-duration.

### bot-budget.ts (BOT-01)

Thin wrapper over `check_and_record_bot_budget` RPC returning `BotBudgetResult`. Uses explicit field extraction (not Zod schema parse at runtime) to stay compatible with the worktree vitest alias setup.

Fail-closed (T-10-07): RPC error or no-rows returns `{ allowed: false, circuit_open: false, tokens_used_window: 0 }` — bots do not fire when budget state is unknown.

4 test cases: allowed-row, circuit-tripped, rpc-error, empty-rows.

### silence-gate.ts (BOT-03)

Two-signal gate reading `MAX(created_at)` from messages (D-10, order+limit query) and checking `getPresenceTyping()` callback (D-09, injected for testability).

Gate order:
1. Query messages for last `created_at`
2. If elapsed < thresholdMs → `{ passed:false, reason:'too_soon', presence_fallback:false }` (presence never called)
3. Call `getPresenceTyping()` in try/catch → WSL2 fallback if it throws
4. If is_typing → `{ passed:false, reason:'typing', presence_fallback }`
5. Else → `{ passed:true, presence_fallback }`

WSL2 fallback (D-09): on throw, sets `presence_fallback:true` and logs `silence_gate_presence_fallback` for Langfuse observability.

6 test cases: passed, is_typing, too_soon, WSL2-fallback-passes, WSL2-fallback-too_soon, DB-error-fail-safe.

## Verification Results

```
pnpm test -- bot-arbitrator bot-budget silence-gate
  ✓ src/lib/silence-gate.test.ts (6 tests)
  ✓ src/lib/bot-budget.test.ts (4 tests)
  ✓ src/lib/bot-arbitrator.test.ts (5 tests)
  Tests  15 passed (15)
```

TypeScript: `tsc --noEmit` from main repo (which has node_modules) exits 0. Worktree-local tsc shows pre-existing module-not-found errors for all lib files due to missing node_modules in the worktree — same as `auto-freeze.ts`, `cap-guard.ts`, etc. (pre-existing condition).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test assertion mismatch for console.warn arity (bot-arbitrator Test 4)**
- **Found during:** Task 1 GREEN
- **Issue:** Test expected `warnSpy.toHaveBeenCalledWith(stringContaining, anything)` but implementation logs 3 args: prefix string, botId, error.message
- **Fix:** Extended assertion to `toHaveBeenCalledWith(stringContaining, any(String), anything)`
- **Files modified:** bot-arbitrator.test.ts

**2. [Rule 1 - Bug] BotBudgetResultSchema.parse fails in vitest worktree (Zod resolution)**
- **Found during:** Task 2 GREEN
- **Issue:** `@panelito/types` aliased to `packages/types/src/index.ts` in vitest config; when vitest resolves the import it follows `zod` which cannot be found in the worktree (no local node_modules). Using `BotBudgetResultSchema.safeParse` made the test suite fail to load.
- **Fix:** Replaced Zod runtime parse with explicit field extraction (`typeof row.X === type ? row.X : fallback`). Type safety preserved via `BotBudgetResult` TypeScript type import.
- **Files modified:** bot-budget.ts

**3. [Rule 1 - Bug] Test 4b expectation incorrect for too_soon+WSL2 path (silence-gate)**
- **Found during:** Task 3 GREEN
- **Issue:** Test expected `presence_fallback:true` when elapsed < threshold AND presence throws. But the plan spec explicitly returns `presence_fallback:false` in the too_soon case (step 2 short-circuits before presence is called).
- **Fix:** Corrected test expectation to `presence_fallback:false` and added assertion `expect(getPresenceTyping).not.toHaveBeenCalled()` to document the short-circuit behavior.
- **Files modified:** silence-gate.test.ts

## Known Stubs

None — all modules are fully wired. The BotArbitrator registry is intentionally empty in Phase 10 (D-03); the empty state is the correct behavior, not a stub.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. All files are internal service modules calling existing Plan 02 RPCs.

## TDD Gate Compliance

All three tasks followed RED/GREEN cycle:
- RED commits: f4b84fd, 3a4eb98, 8f4be66
- GREEN commits: d92949b, 496aa50, dd1dcc2

## Self-Check

Files exist:
- FOUND: apps/api/src/lib/bot-arbitrator.ts
- FOUND: apps/api/src/lib/bot-arbitrator.test.ts
- FOUND: apps/api/src/lib/bot-budget.ts
- FOUND: apps/api/src/lib/bot-budget.test.ts
- FOUND: apps/api/src/lib/silence-gate.ts
- FOUND: apps/api/src/lib/silence-gate.test.ts

Commits verified in git log:
- f4b84fd: test(10-03): add failing tests for bot-arbitrator plugin registry
- d92949b: feat(10-03): implement BotArbitrator plugin registry with lock acquisition (BOT-02)
- 3a4eb98: test(10-03): add failing tests for bot-budget wrapper
- 496aa50: feat(10-03): implement checkBotBudget token budget guard wrapper (BOT-01)
- 8f4be66: test(10-03): add failing tests for silence-gate two-signal gate
- dd1dcc2: feat(10-03): implement two-signal silence gate with WSL2 Presence fallback (BOT-03)

## Self-Check: PASSED
