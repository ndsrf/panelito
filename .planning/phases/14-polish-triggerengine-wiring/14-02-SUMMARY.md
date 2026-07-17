---
phase: 14-polish-triggerengine-wiring
plan: 02
subsystem: api
tags: [langfuse, hono, sse, supabase, observability, cost-tagging]

# Dependency graph
requires:
  - phase: 07
    provides: "The human /invoke route (apps/api/src/routes/ai.ts) this plan edits"
  - phase: 13
    provides: "Step 8.55 last-human-author resolution and Step 8.5 branch-UUID resolution that this plan's regression test now exercises for the first time"
provides:
  - "trigger:human-reactive Langfuse tag on the only existing human-path CallbackHandler, giving reactive LLM calls the same trigger-attributed tracing as proactive fires (COST-03)"
  - "Removal of the last '[canvas updated]' placeholder-text write; canvas-only bot turns now write zero chat rows (SPEECH-01, backend half of SPEECH-03)"
  - "Regression test proving the skip-insert behavior, plus test-infra fixes (worktree module/env resolution) needed to actually run apps/api tests in a Claude Code linked worktree"
affects: [14-03, 14-04, 14-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CallbackHandler tags array is the verbatim template Plan 04's TriggerEngine CallbackHandler copies — kept flat and readable"
    - "Supabase mock chains that are dual-purpose in real supabase-js (terminal-await AND further-chainable, e.g. .limit().maybeSingle()) must mock both a thenable and the chain method, not just mockResolvedValue"

key-files:
  created: []
  modified:
    - apps/api/src/routes/ai.ts
    - apps/api/src/routes/ai.test.ts
    - apps/api/vitest.config.ts

key-decisions:
  - "No environment or model-tier tag added to the human-path CallbackHandler — environment belongs on the Langfuse processor (Plan 03), tier belongs on per-node Generation observations (Plan 06)"
  - "Canvas-only bot turns write NO message row at all (not even a placeholder) — the existing `if (accumulatedText.length > 0)` INSERT guard now does double duty for both the no-canvasOps case (T-07-08) and the canvasOps-present case (D-10/D-11)"
  - "SC-2/SC-3 pre-existing branch_not_found failures left unfixed (out of scope) — documented in deferred-items.md rather than patched, since they predate this plan and are unrelated to COST-03/SPEECH-01"

patterns-established:
  - "Worktree vitest.config.ts alias hacks (mainRepoNodeModules, .env fallback) must check for a real local install / correct ancestor depth before applying — a flat alias-to-directory breaks package.json exports subpath resolution (e.g. hono/streaming)"

requirements-completed: [COST-03, SPEECH-01, SPEECH-03]

# Metrics
duration: 55min
completed: 2026-07-17
---

# Phase 14 Plan 02: Human-path trigger tag + canvas-only turn no-write Summary

**Tagged the human /invoke route's Langfuse CallbackHandler with `trigger:human-reactive` and deleted the `'[canvas updated]'` fallback so canvas-only bot turns write zero chat rows — closing the last known SPEECH-01 violation in the codebase.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-07-17T17:52:00Z (worktree branch check)
- **Completed:** 2026-07-17T16:46:25Z
- **Tasks:** 2
- **Files modified:** 3 (ai.ts, ai.test.ts, vitest.config.ts) + 1 new (deferred-items.md)

## Accomplishments
- Human-reactive LLM calls now carry `trigger:human-reactive` in the same Langfuse tags array as `session:` and `branch:`, without hoisting the per-request `CallbackHandler` construction to module scope
- Deleted the only remaining `'[canvas updated]'` placeholder-text write; the existing empty-content INSERT guard now skips the row unconditionally whenever `accumulatedText` is empty, regardless of `canvasOps`
- Added a regression test proving: canvas-only turn → no `messages` INSERT, no placeholder string anywhere in the SSE payload
- Along the way, fixed two worktree-only test-infrastructure bugs (module resolution, .env discovery) that were silently preventing `apps/api` tests from ever running inside a Claude Code linked worktree — documented as deviations below

## Task Commits

Each task was committed atomically:

1. **Task 1: Add trigger-type tag to the human-path CallbackHandler** - `fbd8168` (feat)
2. **Task 2: Remove the '[canvas updated]' fallback so canvas-only turns write no row** - `23ea11c` (fix)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/api/src/routes/ai.ts` - Added `trigger:human-reactive` to the CallbackHandler tags array; deleted the `'[canvas updated]'` fallback branch
- `apps/api/src/routes/ai.test.ts` - Added the canvas-only-turn regression test; extended the shared Supabase mock (`makeMessagesChain`'s `.limit()`, the `rpc` default) so the test can actually exercise the code path past Steps 8.5/8.55/8.6
- `apps/api/vitest.config.ts` - Fixed the worktree node_modules-alias fallback to prefer a real local install (subpath-exports-safe) and fixed the `.env` fallback to scan the same ancestor-depth range already used for node_modules
- `.planning/phases/14-polish-triggerengine-wiring/deferred-items.md` - New file logging the pre-existing, unrelated SC-2/SC-3 `branch_not_found` test failure

## Decisions Made
- Kept the CallbackHandler tags array flat/readable since Plan 04's TriggerEngine copies it verbatim
- Did not add `environment` or model-tier tags here — those belong to the processor (Plan 03) and per-node Generation observations (Plan 06) respectively
- The canvas-only-turn regression test supplies an explicit `branchId` in its request body to route around the pre-existing branch-resolution mock gap (SC-2/SC-3), rather than patching the shared `'branches'` mock case — keeps the fix scoped to what Task 2 actually needed to verify

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree `vitest.config.ts` node_modules alias broke `hono/streaming` resolution**
- **Found during:** Task 2 (running `npx vitest run src/routes/ai.test.ts` per acceptance criteria)
- **Issue:** The worktree lacked its own `node_modules`. A `pnpm install --frozen-lockfile` (no new packages — matches the existing lockfile) fixed that, but `vitest.config.ts`'s pre-existing worktree-detection hack unconditionally aliased every top-level package name (e.g. `hono`) to the main repo's `apps/api/node_modules/<pkg>` directory, regardless of whether a local install was already present. That flat alias doesn't honor `package.json` `exports` subpath maps, so `import { streamSSE } from 'hono/streaming'` (already in `ai.ts` before this plan) failed to resolve inside any worktree, for any test file that imports it — a latent bug, not something introduced by this plan.
- **Fix:** Added a guard in `detectWorktree()`: if the worktree already has its own populated `node_modules` (checked via `@anthropic-ai` presence), skip the alias-building step entirely and let normal Node/Vite resolution — which does honor `exports` — handle it.
- **Files modified:** `apps/api/vitest.config.ts`
- **Verification:** `hono/streaming` resolves; `npx tsc --noEmit` and vitest both load without module errors
- **Committed in:** `23ea11c` (Task 2 commit)

**2. [Rule 3 - Blocking] Worktree `vitest.config.ts` `.env` fallback only tried 3 ancestor levels, missing the 5-level-deep Claude Code layout**
- **Found during:** Task 2, same verification pass — after fixing #1, tests reached `env.KEY_ENCRYPTION_SECRET` and threw a generic zod validation `Error`, mis-logged by `ai.ts`'s catch block as `[ai] key decrypt error` (misleading — the real `decryptKey` mock was never even reached)
- **Issue:** `loadDotEnv()`'s candidate list was `[.env, ../../../apps/api/.env]` (3 levels up) — correct for a top-level sibling worktree, but this repo's worktrees live at `.claude/worktrees/<id>/apps/api`, which needs 5 levels up to reach the main repo's `apps/api/.env`. The exact same nesting-depth problem was already identified and fixed for `mainRepoNodeModules` resolution in this same file (comment: "Nesting depth ... varies") but the fix was never applied to `.env` loading.
- **Fix:** Scan ancestor depths 2–8 (mirroring the existing node_modules candidate loop) instead of hardcoding 3 levels.
- **Files modified:** `apps/api/vitest.config.ts`
- **Verification:** `KEY_ENCRYPTION_SECRET` and other required env vars load correctly; the mocked `decryptKey` is reached as intended (confirmed via a throwaway debug test, since removed)
- **Committed in:** `23ea11c` (Task 2 commit)

**3. [Rule 3 - Blocking] `ai.test.ts` shared Supabase mock incomplete for code paths this task's test needed to reach**
- **Found during:** Task 2, writing the canvas-only-turn regression test
- **Issue:** Once module/env resolution was fixed, the new test (which supplies `branchId` to route around the pre-existing `branch_not_found` gap — see Issues Encountered) hit two further gaps in the shared mock: (a) `makeMessagesChain()`'s `.limit()` only supported the terminal-await usage (`.limit(8)` for the sliding-window fetch), not the further-chained `.limit(1).maybeSingle()` usage in Step 8.55's last-human-author lookup, throwing `maybeSingle is not a function`; (b) the shared `rpc` mock always resolved `{ data: null, error: null }`, so `try_acquire_mic` (Step 8.6) always read as "not acquired" and 500'd.
- **Fix:** `makeMessagesChain()`'s `.limit()` now returns an object that is both thenable (resolves `{data: [], error: null}` for the terminal case) and exposes `.maybeSingle()` (resolves `{data: null, error: null}`, i.e. "no last human message found", falling back to `user.id` per WR-04). The shared `rpc` mock now defaults to `{ data: [{ acquired: true }], error: null }`.
- **Files modified:** `apps/api/src/routes/ai.test.ts`
- **Verification:** New canvas-only-turn test passes; SC-1 (unaffected, unchanged) still passes
- **Committed in:** `23ea11c` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking test-infrastructure issues)
**Impact on plan:** All three were necessary to run `apps/api` tests at all inside this worktree layout, and to reach the code path Task 2 actually changed. No scope creep into `ai.ts`'s application logic beyond what Task 2 specified. None of the three affect the pre-existing SC-2/SC-3 failure (see Issues Encountered) — verified by reproducing that failure against the unmodified file.

## Issues Encountered

**Pre-existing, unrelated test failures: SC-2 and SC-3 (`branch_not_found`).** Reproduced this against the original, unmodified `ai.ts`/`ai.test.ts` (i.e. with none of this plan's changes applied) — both fail identically with `404 { error: 'branch_not_found' }`, because `ai.ts`'s Step 8.5 (added in an earlier phase) falls back to a `supabase.from('branches')...single()` lookup when the request omits `branchId`, and the shared `buildSupabaseMock()`'s `'branches'` case always resolves not-found. Neither SC-2 nor SC-3 supply a `branchId`, so both 404 before ever reaching the graph-stream logic they're meant to test. This is out of scope for Plan 14-02 (unrelated to COST-03/SPEECH-01, predates this plan) — left unfixed per the executor's scope boundary and logged to `.planning/phases/14-polish-triggerengine-wiring/deferred-items.md` with a recommended follow-up. **Full `apps/api` suite run for this plan: `src/routes/ai.test.ts` reports 2 passed / 2 failed (the 2 failures are this pre-existing, documented gap) — Task 1 and Task 2's own verification (grep checks, tsc, and the new SPEECH-01 regression test) all pass.**

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- COST-03's reactive-side tagging is done; Plan 04's TriggerEngine CallbackHandler can copy the same tags-array template for the proactive side
- SPEECH-01's backend half (no placeholder message rows) is closed; Plan 05's frontend half remains
- Follow-up recommended (not blocking): fix `buildSupabaseMock()`'s `'branches'` case in `ai.test.ts` so SC-2/SC-3 pass — tracked in `deferred-items.md`

---
*Phase: 14-polish-triggerengine-wiring*
*Completed: 2026-07-17*
