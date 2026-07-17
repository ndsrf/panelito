# Deferred Items — Phase 14

Out-of-scope discoveries logged during plan execution (not fixed, per executor scope
boundary: pre-existing failures in unrelated test cases are out of scope for the plan
that happens to touch the same file).

## 14-02: `ai.test.ts` SC-2/SC-3 pre-existing failure — `branch_not_found`

**Discovered during:** Plan 14-02, Task 2 (verifying `npx vitest run src/routes/ai.test.ts`)

**Symptom:** `POST /api/sessions/:id/invoke — SSE stream (SC-2)` and
`... abort propagation (SC-3)` both fail with `404 { error: 'branch_not_found' }`.

**Root cause:** `ai.ts` Step 8.5 ("Resolve activeBranchId to a real UUID", added in an
earlier phase per the `RESEARCH.md Pitfall 1` comment at that line) falls back to a
`supabase.from('branches').select('id').eq(...).eq('is_main', true).single()` lookup
whenever the request body omits `branchId`. `ai.test.ts`'s shared `buildSupabaseMock()`
helper hard-codes the `'branches'` table case to always resolve not-found
(`makeSelectSingleChain(null, { message: 'not found' })`), and neither SC-2 nor SC-3
supply a `branchId` in their request bodies — so both hit this gate and 404 before ever
reaching the graph-stream logic they're actually testing.

**Verified pre-existing:** Reproduced against the original, unmodified `ai.ts`/`ai.test.ts`
(commit prior to Plan 14-02) — same two tests fail identically with no changes from this
plan applied. Not caused by Task 1 (CallbackHandler tag) or Task 2 (fallback-text removal).

**Scope decision:** Left unfixed per executor scope boundary (only auto-fix issues
directly caused by the current task's changes). Plan 14-02's new SPEECH-01 regression
test (`canvas-only turn skip-insert`) works around this same gap locally by supplying an
explicit `branchId` in its own request body — that is an in-scope, test-local fix since
it's necessary to exercise the code path Task 2 actually changed, and does not touch the
shared `buildSupabaseMock()`'s `'branches'` case.

**Recommended follow-up:** A future plan (or a `/gsd-quick` task) should update
`buildSupabaseMock()`'s `'branches'` case to resolve a real main-branch row by default,
then re-verify SC-2/SC-3 pass. Until then, this file's `npx vitest run` reports 2
pre-existing failures unrelated to whichever plan next touches `ai.ts`/`ai.test.ts`.
