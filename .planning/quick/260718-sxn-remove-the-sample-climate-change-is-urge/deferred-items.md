# Deferred Items — 260718-sxn

Out-of-scope failures observed during `pnpm vitest run` for `apps/api` while verifying
this plan's changes. Neither file touched by this plan; failures are unrelated to the
Langfuse smoke-test gate or Generation `input` changes.

## src/routes/ai.test.ts (2 failures)
- `POST /api/sessions/:id/invoke — SSE stream (SC-2) > delivers text_delta events and done event via SSE without hanging`
- `POST /api/sessions/:id/invoke — abort propagation (SC-3) > passes c.req.raw.signal to graph.stream() config as an AbortSignal`

## src/routes/keys.test.ts (6 failures)
- `POST /api/keys/verify > Test 1: valid key -> 200 { success: true }, DB row persisted`
- `POST /api/keys/verify > Test 2: invalid key -> 400 { success: false, error: "invalid_key" }, no row written`
- `GET /api/keys/status > Test 4: returns { has_api_key: true, last4 } after verify; never the full key`
- `DELETE /api/keys > Test 5: nulls column; subsequent GET /status returns { has_api_key: false, last4: null }`
- `GET /api/settings > Test 6: returns { user_id, has_api_key: true, api_response_cap: 150, updated_at } after verify`
- `POST /api/sessions/:id/invoke > Test 9: returns 501 { status: "scaffolded", prompt_array_length, cache_breakpoint_position }`

Symptoms (e.g. "expected 400 to be 501", "invalid key -> 400" on what should be a valid
key) are consistent with a missing/misconfigured test-environment dependency (e.g.
Supabase env vars or a live key-verification network call) in this worktree, not with
any code path this plan modified. `git diff` confirms `ai.test.ts` and `keys.test.ts`
are untouched by this plan's commits. Not fixed per scope-boundary rule — flagging for
separate investigation if still failing outside this worktree.
