# Deferred Items — quick-260719-dr9

## Pre-existing failing tests in apps/api/src/routes/ai.test.ts (out of scope)

- **Tests:** `POST /api/sessions/:id/invoke — SSE stream (SC-2) > delivers text_delta events and done event via SSE without hanging`, `POST /api/sessions/:id/invoke — abort propagation (SC-3) > passes c.req.raw.signal to graph.stream() config as an AbortSignal`
- **Symptom:** `expected 404 to be 200` — the request never reaches the mocked SSE handler.
- **Confirmed pre-existing:** Verified by diffing the checked-out `ai.test.ts` against the pre-task base commit (`f484b817377643d6dabb1d2c2f9db19c7964b52a`) — byte-identical, and the failure reproduces with zero task changes applied (only Task 1's one-line `sessionId:` addition to `ai.ts` present). Not caused by this plan's changes.
- **Scope decision:** Out of scope per executor SCOPE BOUNDARY rule — not touched by this plan's task files, and root-causing a routing-level 404 is a structural investigation, not a Rule 1/2/3 auto-fix.
- **Follow-up:** File a `/gsd-debug` session to investigate the SC-2/SC-3 route-not-found regression in `apps/api/src/routes/ai.test.ts` (likely env/middleware ordering issue causing `app.fetch()` to 404 before reaching the invoke handler).
