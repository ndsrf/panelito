---
phase: 07-invoke-route-modification
fixed_at: 2026-07-03T10:22:00Z
review_path: .planning/phases/07-invoke-route-modification/07-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 4
skipped: 1
status: partial
---

# Phase 07: Code Review Fix Report

**Fixed at:** 2026-07-03T10:22:00Z
**Source review:** `.planning/phases/07-invoke-route-modification/07-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (CR-01, WR-01, WR-02, WR-03, WR-04)
- Fixed: 4
- Skipped: 1 (WR-01 and WR-02 applied together in one commit as they touch the same lines)

Note: WR-01 and WR-02 were committed atomically in a single commit since both edits
are in the same try/catch block in `drift-reply.ts`. They count as 2 findings fixed
in 1 commit.

## Fixed Issues

### CR-01: Session ownership gate (T-02-05) is not enforced

**Files modified:** `apps/api/src/routes/ai.ts`
**Commit:** `abab3da`
**Applied fix:** Added `if (session.creator_id !== user.id) return c.json({ error: 'forbidden' }, 403)`
after the session null-check and before the blueprint gate at line 84. The previously fetched
`user` variable was unused, allowing any authenticated user to invoke AI against any session.

### WR-01: driftReplyNode returns driftAction: 'replied' on adapter error

**Files modified:** `apps/api/src/graph/nodes/drift-reply.ts`
**Commit:** `bd1e439` (combined with WR-02)
**Applied fix:** Added `return { driftAction: 'ignored' }` inside the catch block so that a
stream failure does not fall through to return `'replied'`. Previously the catch only logged
the error, then execution fell through to the unconditional `return { driftAction: 'replied' }`
at line 68, producing false observability signals in Langfuse traces.

### WR-02: driftReplyNode strips conversation context from the LLM call

**Files modified:** `apps/api/src/graph/nodes/drift-reply.ts`
**Commit:** `bd1e439` (combined with WR-01)
**Applied fix:** Changed `adapter.stream([lastMessage], [], ...)` to `adapter.stream(state.messages, [], ...)`
to pass the full conversation history. The last message is still obtained for the early-return
guard (`if (!lastMessage)`), but the actual LLM call now receives the complete context array.

### WR-03: providerName cast without Zod validation

**Files modified:** `apps/api/src/routes/ai.ts`
**Commit:** `d572b1b`
**Applied fix:** Replaced `as ProviderName` type assertion with a `ProviderSchema.safeParse()` call.
Added `ProviderSchema` to the import from `@panelito/types`. On parse failure, the route returns
`c.json({ error: 'invalid_provider' }, 500)` with a console error logging the raw DB value.

### WR-04: Test mock emits node-keyed chunks instead of flat values-mode state

**Files modified:** `apps/api/src/routes/ai.test.ts`
**Commit:** `571ab57`
**Applied fix:** Updated the `generateChunks()` async generator in the `createGraph` mock to yield
a flat values-mode state object (`{ blueprintId, currentPhaseId, messages, canvasOps, ... }`)
instead of `{ agent: { canvasOps: [] } }`. The old shape was LangGraph "updates" mode which
nested state under node keys, causing `finalState.canvasOps` to be undefined and preventing
the `[canvas updated]` fallback branch from being exercised in SC-2 and SC-3.

## Verification Results

**TypeScript:** `npx tsc --noEmit` in `apps/api` — passes with no errors.

**Tests:** `pnpm test -- src/routes/ai.test.ts` — all 3 route tests pass (SC-1, SC-2, SC-3).
Two pre-existing test failures exist in unrelated files:
- `src/lib/ai-provider.test.ts`: stale widget_type enum assertion (test expects 4 values,
  code has 9 — pre-existing, unrelated to Phase 7 changes)
- `src/routes/keys.test.ts`: DB constraint failure on setup (pre-existing integration test issue)

## Skipped Issues

None — all 5 in-scope findings (CR-01, WR-01, WR-02, WR-03, WR-04) were fixed.
WR-01 and WR-02 were committed together (same file, adjacent lines) rather than separately.

---

_Fixed: 2026-07-03T10:22:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
