# Deferred Items — Quick Task 260718-t3h

Pre-existing test failures, confirmed unrelated to this task's scope (messages.role
tagging / LLM context filtering). Verified pre-existing by reverting the Task 2 diff
(`apps/api/src/routes/ai.ts`, `apps/api/src/lib/trigger-engine.ts`) and re-running
`npm --prefix apps/api test` — the identical 8 failures reproduce with only Task 1's
changes applied (sessions-helpers.ts / message.ts / migration 0017), which do not
touch these files or routes at all.

- `src/routes/keys.test.ts` — 6 failures (Test 1, 2, 4, 5, 6, 9): key-verify/status/
  settings/invoke response-shape mismatches (e.g. `active_provider` multi-provider
  shape vs legacy `has_api_key` shape, `invalid_request` vs `invalid_key` error code,
  501 vs 400 on `/invoke`). Out of scope — unrelated to session-lifecycle message
  roles.
- `src/routes/ai.test.ts` — 2 failures (SSE stream SC-2, abort propagation SC-3):
  pre-existing SSE/streaming test issues, unrelated to the `.neq('role', 'system')`
  filters added by this task (verified: these 2 tests still fail with Task 2's
  `ai.ts` changes fully reverted).

Not fixed per the executor SCOPE BOUNDARY rule — these failures predate this task and
are not caused by it. Logged here for follow-up rather than fixed inline.
