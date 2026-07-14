# Deferred Items — Phase 11 Plan 01

## Pre-existing out-of-scope issue

- `apps/api/src/lib/bot-arbitrator.test.ts:134` — `TS2532: Object is possibly 'undefined'` on `mockSupabase.rpc.mock.calls[0][1]`. Pre-existing (unrelated to Plan 01 changes — file not touched by this plan). Not fixed per scope boundary rule.

# Deferred Items — Phase 11 Plan 06

## Pre-existing out-of-scope failures (full `pnpm test` in apps/api, verified pre-existing at commit 8572745 per Plan 07's SUMMARY)

- `apps/api/src/routes/ai.test.ts` — 2 tests fail (`expected 404 to be 200`): "SSE stream (SC-2) delivers text_delta events and done event via SSE without hanging" and "abort propagation (SC-3) passes c.req.raw.signal to graph.stream() config as an AbortSignal". Unrelated to silence-scan.ts / bot-registration.ts / bot-arbitrator.ts changes — not touched by this plan.
- `apps/api/src/routes/keys.test.ts` — suite fails at setup (`Failed to create session: null value in column "blueprint_id" of relation "sessions" violates not-null constraint`). Live-DB-dependent integration test setup issue, unrelated to this plan's files. Not investigated further per scope boundary rule.
