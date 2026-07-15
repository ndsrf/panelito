# Deferred Items — Phase 12

Issues discovered during execution that are out of scope for the current task
(pre-existing, unrelated to the task's changes) and therefore not auto-fixed.

## 12-01 Task 2

- **File:** `apps/api/src/lib/bot-arbitrator.test.ts:139`
- **Error:** `TS2532: Object is possibly 'undefined'` on `mockSupabase.rpc.mock.calls[0][1]`
  (array-index access under TS's strict indexed-access checking).
- **Confirmed pre-existing:** reproduced with Phase 12 Task 2's `state.ts`/`skills.ts`
  changes reverted (via `git stash` of only the touched files) — the error is present
  on the unmodified `HEAD` version of this line, unrelated to the new `firingSkillId`/
  `firingSkillRole`/`skillMeta`/`triggerGateComplete` GraphState fields or the
  `drift_detection_enabled` Blueprint field added in this plan.
- **Action:** Not fixed (SCOPE BOUNDARY — only auto-fix issues directly caused by the
  current task's changes). Recommend a future cleanup task add a bounds check or
  non-null assertion with a comment at this call site.

- **File:** `apps/api/src/lib/silence-scan.test.ts` (Behaviors 3, 4a, 4b, 5)
- **Error:** 5 assertion failures (`toHaveBeenCalledWith`/`toHaveBeenCalledTimes` mismatches
  around `graph.getState`/`runArbitration`/`checkBotBudget`/`graph.invoke` mocks).
- **Confirmed pre-existing:** reproduced with this plan's one-line `drift_detection_enabled: true`
  fixture addition reverted (`git stash` of only this file) — same 5 failures present on the
  unmodified `HEAD` version.
- **Action:** Not fixed (SCOPE BOUNDARY).

- **File:** `apps/api/src/routes/ai.test.ts`
- **Error:** In this worktree's fresh `pnpm install`, the whole suite fails at import time with
  `Cannot find module 'hono/streaming'`. Reproduced independently in the main repo checkout
  (different failure mode there — SC-3 assertion returns 404 instead of 200) — confirms this
  is a pre-existing environment/module-resolution flake in this test file, not caused by this
  plan's one-line `drift_detection_enabled: true` fixture addition.
- **Action:** Not fixed (SCOPE BOUNDARY).

## 12-04 (re-confirmation)

- **File:** `apps/api/src/lib/silence-scan.test.ts` (Behaviors 3, 4a, 4b, 5).
- **Re-confirmed pre-existing** while executing Plan 04 (already logged under 12-01 Task 2
  above, same 5 failures, same root cause) — Plan 04 added only new files under
  `apps/api/src/lib/skills/` and never touched `silence-scan.ts`/`silence-scan.test.ts`;
  `git diff` against this worktree's base commit confirms zero changes to either file.
- **Action:** Not fixed (SCOPE BOUNDARY).

## Post-merge gate (Wave 1)

- **File:** `apps/api/src/routes/keys.test.ts`
- **Error:** Suite setup fails — `Failed to create session: null value in column "blueprint_id" of relation "sessions" violates not-null constraint`.
- **Confirmed pre-existing:** identical failure already logged in Phase 11's
  `.planning/phases/11-personality-basic-triggers/deferred-items.md` (and `11-06-SUMMARY.md`),
  unrelated to that phase's files too. The `blueprint_id NOT NULL` FK constraint originates in
  migration `0008_nsai_foundation.sql`, long before Phase 12. Not caused by Wave 1 changes.
- **Action:** Not fixed (SCOPE BOUNDARY — pre-existing, unrelated to Phase 12). Recommend a
  future cleanup task update this test's session fixture to supply a `blueprint_id`.

- **File:** `apps/api/src/routes/ai.test.ts`
- **Error:** SC-2 and SC-3 tests expect 200, get 404.
- **Confirmed pre-existing:** same root cause already flagged by the 12-01 executor (module-resolution/environment flake, reproduced independently of this plan's changes) and by Phase 11's deferred-items.md.
- **Action:** Not fixed (SCOPE BOUNDARY).

## 12-06 Task 1 (re-confirmation)

- **Files:** `apps/api/src/routes/ai.test.ts`, `apps/api/src/routes/keys.test.ts`
- **Error:** Whole-suite import failure — `Cannot find module 'hono/streaming' imported from
  .../apps/api/src/routes/ai.ts` — surfaced this time after a fresh `pnpm install` in a newly
  spawned worktree (`agent-a7faa64addfe48af2`), same root cause already logged above (12-01
  Task 2, Post-merge gate). `git diff --stat` for Task 1 of this plan touches only
  `apps/api/src/lib/bot-arbitrator.ts`, `apps/api/src/lib/bot-registration.ts`, and two new
  files under `apps/api/src/graph/nodes/trigger-gate.*` — none of which import or affect
  `hono`/`ai.ts`/`keys.ts`. Confirmed present before any of this plan's edits.
- **Action:** Not fixed (SCOPE BOUNDARY). Full `pnpm --filter api test` otherwise green:
  222 passed / 2 pre-existing failing suites (11 total tests across the two failing suites
  never execute due to the import-time module-resolution error, not a logic failure).
