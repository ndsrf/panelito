---
phase: quick-260718-cto
plan: 01
subsystem: auth
tags: [byok, supabase, provider-keys, onboarding]

requires: []
provides:
  - "POST /api/keys/verify auto-activates the verified provider on a creator's first-ever key"
  - "Existing creators with another provider already keyed keep their active_provider unchanged"
affects: [byok, onboarding, trigger-engine, ai-routes]

tech-stack:
  added: []
  patterns:
    - "Cap-preserving upsert extended with a hasOtherProviderKey guard before writing active_provider"

key-files:
  created: []
  modified:
    - apps/api/src/routes/keys.ts
    - apps/api/src/routes/keys.test.ts

key-decisions:
  - "Backend-only fix in POST /verify (not the onboarding form) — atomic, single round-trip, reuses the existing-row lookup already in the route"
  - "active_provider is only auto-set when no OTHER provider column is already populated, so a returning creator's deliberate provider choice is never silently overridden"

patterns-established: []

requirements-completed: [BYOK-FIX-ACTIVATE]

duration: ~15min
completed: 2026-07-18
---

# Quick Task 260718-cto: Fix BYOK onboarding activation gap Summary

**`POST /api/keys/verify` now writes `active_provider` on a creator's first-ever key instead of leaving it stuck on the DB's `'anthropic'` default.**

## Note on this file

This SUMMARY.md was reconstructed by the orchestrator after the original (written by the executor inside its isolated worktree) was lost — the worktree was force-removed during cleanup before its uncommitted docs were rescued, an orchestrator process error, not an executor failure. Reconstructed from the executor's structured completion report plus direct inspection of the merged commits (`ad992e9`, `b3675eb`) on `main`. Content below is accurate to those sources but may be thinner than the executor's original on the "Issues Encountered" narrative detail.

## Performance

- **Duration:** ~15 min
- **Tasks:** 2/2
- **Files modified:** 2 (`apps/api/src/routes/keys.ts`, `apps/api/src/routes/keys.test.ts`)

## Accomplishments

- Fresh creators who verify a non-default provider key (OpenAI/Gemini) immediately get `active_provider` set to that provider — no more silent fallback to the empty `anthropic_api_key` column.
- Returning creators who already have one provider keyed keep their existing `active_provider` when adding a second key.
- Two regression tests added and passing, exercising both paths directly against the DB.

## Task Commits

1. **Task 1: Auto-activate verified provider on first-ever key in POST /verify** - `ad992e9` (feat)
2. **Task 2: Regression tests for first-key auto-activation and no-silent-override** - `b3675eb` (test)

## Files Created/Modified

- `apps/api/src/routes/keys.ts` — `POST /verify`'s persistence block now selects all three provider key columns on the existing-row lookup, computes `hasOtherProviderKey`, sets `active_provider: provider` on insert (first-ever key) unconditionally, and on update only when `hasOtherProviderKey` is false.
- `apps/api/src/routes/keys.test.ts` — new `describe('POST /api/keys/verify — active_provider activation', ...)` block: Test A (fresh creator verifying openai → `active_provider === 'openai'`), Test B (anthropic-keyed creator verifying openai → `active_provider` stays `'anthropic'`, openai key persists). Mocks `verifyOpenAIKey`/`verifyGeminiKey` from `../lib/verify-key`.

## Decisions Made

- Chose the backend-only fix (approach (a) from the bug report) over touching the onboarding form — single round-trip, no client-side existence probe needed, and testable entirely at the route level.
- `active_provider` write is conditional on `hasOtherProviderKey`, not unconditional-on-first-request, so a creator who removes and re-adds their only key doesn't get a different outcome than intended, and a returning multi-provider creator is never silently switched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing `node_modules` in the worktree**
- **Found during:** Task 1 verification (`tsc --noEmit`)
- **Issue:** Fresh git worktree had no `node_modules` (gitignored, not carried over)
- **Fix:** Ran `pnpm install --frozen-lockfile` in the worktree
- **Verification:** `tsc --noEmit` ran clean afterward

**2. [Rule 3 - Blocking] `blueprint_id` NOT NULL violation in `keys.test.ts`'s shared `beforeAll`**
- **Found during:** Task 2 test run
- **Issue:** The file's shared `beforeAll` session-creation helper omitted `blueprint_id`, violating a NOT NULL constraint and blocking every test in the file, including the new ones
- **Fix:** One-line addition of `blueprint_id: 'debate-strategy-v1'` to the shared session-insert payload
- **Files modified:** `apps/api/src/routes/keys.test.ts`
- **Committed in:** `b3675eb` (Task 2 commit)

**3. [Rule 1 - Test-infra correctness] Shared Supabase test client auth-context mutation**
- **Found during:** Task 2 (writing Test A / Test B)
- **Issue:** `creator_settings` has no DELETE RLS policy, and the shared test Supabase client's auth context mutates after `signInWithPassword`, making a shared-client cleanup-then-reseed pattern unreliable across the two new tests
- **Fix:** Rewrote the new tests to mint dedicated per-test users and use fresh `createServiceClient()` instances rather than reusing the file's shared client/session state
- **Files modified:** `apps/api/src/routes/keys.test.ts`
- **Committed in:** `b3675eb` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 test-infra correctness)
**Impact on plan:** All three were necessary to get the worktree runnable and the new tests reliably isolated. No scope creep — `keys.ts`/`keys.test.ts` only, as required.

## Issues Encountered

None beyond the three auto-fixed deviations above (per the executor's completion report; original narrative detail was lost with the SUMMARY.md — see note at top of this file).

Six pre-existing, out-of-scope test failures in `keys.test.ts` (schema drift predating this task — some tests use the older single-key `{ key }` request shape and stale `encrypted_api_key`/`has_api_key` assertions from before migration 0006's multi-provider columns) were observed but explicitly left unfixed, per plan scope. The executor's `deferred-items.md` logging the specific failing test names was also lost in the same worktree-cleanup incident; re-run `cd apps/api && npx vitest run src/routes/keys.test.ts` to regenerate the list if needed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Fix is merged to `main` (commits `ad992e9`, `b3675eb`), verified independently by the orchestrator post-merge: `tsc --noEmit` clean, both new activation tests pass (`npx vitest run src/routes/keys.test.ts -t "activation"` → 2/2).
- Unblocks the Phase 14 (`14-07`) live verification checkpoint that was paused on this bug — the user should now retry entering their OpenAI key through onboarding and confirm TriggerEngine fires without a manual `/settings` visit.
- The 6 pre-existing `keys.test.ts` failures remain open as separate, unscoped tech debt (schema drift from a prior migration) — not blocking, not newly introduced.

---
*Quick task: 260718-cto*
*Completed: 2026-07-18*
