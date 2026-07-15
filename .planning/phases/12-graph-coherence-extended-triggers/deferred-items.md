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
