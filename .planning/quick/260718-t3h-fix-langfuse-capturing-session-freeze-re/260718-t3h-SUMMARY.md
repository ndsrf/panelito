---
phase: quick-260718-t3h
plan: 01
subsystem: api
tags: [supabase, langfuse, langgraph, messages, session-lifecycle]

# Dependency graph
requires:
  - phase: 14-polish-triggerengine-wiring
    provides: TriggerEngine proactive-bot path (fetchRecentMessages, trigger-engine.ts)
provides:
  - "messages.role='system' as a first-class value for session-lifecycle control notices"
  - "LLM context and Langfuse traces cleaned of freeze/reactivation/close control notices on both the human /invoke path and the proactive-bot (TriggerEngine) path"
affects: [langfuse-tracing, ai-invoke-route, trigger-engine, message-schema]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Control-plane messages use author_id sentinel (SYSTEM_AUTHOR_ID) AND role='system' — both must line up for query filters relying on either"

key-files:
  created:
    - supabase/migrations/0017_system_message_role.sql
  modified:
    - apps/api/src/lib/sessions-helpers.ts
    - packages/types/src/message.ts
    - apps/api/src/routes/ai.ts
    - apps/api/src/lib/trigger-engine.ts
    - apps/api/src/lib/trigger-engine.test.ts
    - apps/api/src/routes/ai.test.ts

key-decisions:
  - "Backfill scoped to author_id = SYSTEM_AUTHOR_ID sentinel, not a broader heuristic — precisely matches the freeze/unfreeze/close insertion sites and cannot misclassify a real participant message"
  - "Notices remain inserted + broadcast to the chat UI unchanged — only LLM-context and Langfuse-trace queries were filtered, no UI regression"

patterns-established:
  - "Any future message-history query feeding an LLM/Langfuse context must add .neq('role', 'system') alongside its existing path/branch filters"

requirements-completed: [QUICK-260718-t3h]

# Metrics
duration: 6min
completed: 2026-07-18
---

# Quick Task 260718-t3h: Fix Langfuse Capturing Session Freeze/Reactivation as User Messages Summary

**Introduced a `system` message role, tagged freeze/unfreeze/close control notices with it at insertion, and excluded `role='system'` from every message-history query that feeds the LLM generation context and Langfuse traces on both the human /invoke path and the proactive-bot (TriggerEngine) path.**

## Performance

- **Duration:** 6 min (21:01:48 → 21:07:02 UTC+2)
- **Started:** 2026-07-18T19:01:48Z
- **Completed:** 2026-07-18T19:07:02Z
- **Tasks:** 2/2 completed
- **Files modified:** 7 (1 created, 6 modified — 4 source, 2 test)

## Accomplishments
- Session-lifecycle control notices ("Esta sesion se congelo...", "El creador ha reactivado...", cap-freeze, close) are now persisted with `role='system'`, not the default `'user'`.
- Both LLM generation-context loaders (`ai.ts` human /invoke path, `trigger-engine.ts` proactive-bot path) exclude `role='system'` rows, so control notices never reach the model or Langfuse's `callbackHandler` (which traces the same array the model consumes).
- `lastHumanMessage` participantId resolution in `ai.ts` no longer risks resolving to `SYSTEM_AUTHOR_ID` via a misclassified freeze notice — this was already filtering `.eq('role','user')`, so it now correctly excludes notices as a side effect of Task 1's tagging.
- Control notices are still inserted and broadcast to the chat UI unchanged — participants continue to see them; only the AI/Langfuse context was cleaned.

## Task Commits

Each task was committed atomically:

1. **Task 1: Introduce 'system' role and tag control-plane notices at insertion** - `06b2257` (fix)
2. **Task 2: Exclude system notices from LLM context and Langfuse traces (both invocation paths)** - `fa622e2` (fix)

**Plan metadata:** commit pending (orchestrator handles docs commit)

## Files Created/Modified
- `supabase/migrations/0017_system_message_role.sql` - Widens `messages.role` check constraint to include `'system'`; backfills existing `SYSTEM_AUTHOR_ID` rows to `role='system'`
- `apps/api/src/lib/sessions-helpers.ts` - `freezeSession`, `unfreezeSession`, `closeSession` now insert `role: 'system'` on their control-plane notice rows
- `packages/types/src/message.ts` - `MessageSchema.role` enum extended to `['user', 'assistant', 'system']`
- `apps/api/src/routes/ai.ts` - Recent-8 and older/compression message queries add `.neq('role', 'system')`; inline comment added at `lastHumanMessage` noting its dependency on the new tagging
- `apps/api/src/lib/trigger-engine.ts` - `fetchRecentMessages` adds `.neq('role', 'system')`
- `apps/api/src/lib/trigger-engine.test.ts` - Supabase mock chains (`buildSupabaseMock` and the Behavior-5 local override) updated to include a `neq()` step matching the new query shape
- `apps/api/src/routes/ai.test.ts` - `makeMessagesChain` mock updated to include a chainable `neq()` step

## Decisions Made
- Backfill scoped strictly to `author_id = SYSTEM_AUTHOR_ID` (the all-zeros sentinel) rather than any content-pattern match — this is the exact set of rows the three lifecycle helpers ever write, so the backfill cannot misclassify a genuine participant message.
- Did not touch `lastHumanMessage`'s existing `.eq('role', 'user')` filter (plan explicitly called this out) — it now correctly excludes notices for free once they're tagged `role='system'`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated Supabase mock chains in trigger-engine.test.ts and ai.test.ts to support the new `.neq()` call**
- **Found during:** Task 2 verification (`npm --prefix apps/api test`)
- **Issue:** Adding `.neq('role', 'system')` to `fetchRecentMessages` (trigger-engine.ts) and the two message-history queries (ai.ts) broke the hand-rolled chainable Supabase mocks in both test files — the mock objects' `.eq()` return value did not implement a `.neq()` method, so the code under test threw `TypeError: ...eq(...).neq is not a function` at test time. This is not a source-code bug; it's the test mocks not yet reflecting the (correct, per-plan) new query shape.
- **Fix:** Added a `neq: vi.fn().mockReturnValue(self)`-style chain link to `buildSupabaseMock`'s `messages` table branch (trigger-engine.test.ts), the Behavior-5 test's local `from` override (trigger-engine.test.ts), and `makeMessagesChain` (ai.test.ts). No test assertions were changed — only the mock's chain shape.
- **Files modified:** `apps/api/src/lib/trigger-engine.test.ts`, `apps/api/src/routes/ai.test.ts`
- **Verification:** Re-ran `npm --prefix apps/api test`; the 5 trigger-engine.test.ts failures and the 1 new ai.test.ts failure this caused all disappeared, leaving only the 8 pre-existing failures (see Issues Encountered below).
- **Committed in:** `fa622e2` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — test-mock breakage caused directly by this task's legitimate query-shape change)
**Impact on plan:** Necessary to keep the test suite green for the files this task touches. No scope creep — only the two test files whose mocks broke were modified, and only the minimal chain link was added.

## Issues Encountered

`npm --prefix apps/api test` has 8 pre-existing failures unrelated to this task's scope (verified by reverting Task 2's `ai.ts`/`trigger-engine.ts` diff and re-running the suite against Task-1-only state — the identical 8 failures reproduce):
- `src/routes/keys.test.ts` — 6 failures: API-key verify/status/settings/invoke response-shape mismatches (multi-provider `active_provider` shape vs. legacy `has_api_key` shape, `invalid_request` vs `invalid_key` error code, 501 vs 400 on `/invoke`).
- `src/routes/ai.test.ts` — 2 failures: SSE stream (SC-2) and abort propagation (SC-3) tests, unrelated to the `role='system'` filtering added here.

These are out of scope per the SCOPE BOUNDARY rule (pre-existing, not caused by this task's changes) and were not fixed. Logged in `.planning/quick/260718-t3h-fix-langfuse-capturing-session-freeze-re/deferred-items.md` for follow-up. `npm --prefix apps/api run typecheck` passes cleanly with no errors.

Note: this worktree had no `node_modules` installed at session start (fresh worktree checkout) — ran `pnpm install --frozen-lockfile` once, reusing the existing pnpm content-addressable store (2.4s, no network download of new packages beyond what the lockfile already pinned), before typecheck/test could run.

## User Setup Required

None - no external service configuration required. The migration (`0017_system_message_role.sql`) will apply automatically via the project's existing Supabase migration flow; no manual dashboard steps needed.

## Next Phase Readiness

- This is a quick task, not a phase — no next-phase dependency.
- Recommended manual follow-up (not automatable in this environment): after the migration is applied to a live Supabase instance, trigger a freeze/unfreeze cycle and confirm in Langfuse that a subsequent `/invoke` trace's message array contains no freeze/reactivation Spanish text, and confirm `select role from messages where author_id = '00000000-0000-0000-0000-000000000000'` returns only `'system'` rows.
- The `deferred-items.md` pre-existing test failures (`keys.test.ts`, `ai.test.ts` SC-2/SC-3) remain open for a separate quick task or phase; not blocking for this task's goal.

---
*Quick task: 260718-t3h*
*Completed: 2026-07-18*

## Self-Check: PASSED

All created/modified files confirmed present on disk; both task commits (`06b2257`, `fa622e2`) confirmed present in `git log --oneline --all`.
