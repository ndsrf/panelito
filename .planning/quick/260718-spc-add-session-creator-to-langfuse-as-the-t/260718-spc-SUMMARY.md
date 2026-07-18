---
phase: quick-260718-spc
plan: 01
subsystem: observability
tags: [langfuse, callbackhandler, supabase-auth, cost-attribution]

requires: []
provides:
  - "resolveCreatorLangfuseUserId(supabase, creatorId) — email-first, never-throw Langfuse userId resolver"
  - "Both AI trace-creation paths (human-reactive /invoke, proactive silence-gate) attach session-creator identity as Langfuse userId"
affects: [langfuse-dashboard-cost-attribution]

tech-stack:
  added: []
  patterns:
    - "Never-throw identity resolver mirroring langfuse-generation.ts / langfuse-otel.ts contract — a Langfuse-identity lookup failure never aborts the AI turn"
    - "Resolve-once-per-session, reuse-per-branch pattern in trigger-engine.ts to bound Supabase admin-API call volume"

key-files:
  created:
    - apps/api/src/lib/langfuse-user.ts
    - apps/api/src/lib/langfuse-user.test.ts
  modified:
    - apps/api/src/routes/ai.ts
    - apps/api/src/lib/trigger-engine.ts

key-decisions:
  - "Resolution priority is email-first (creator's auth email), then user_metadata.full_name, then creator_id UUID as stable last-resort — deliberately reverses the sessions.ts precedent (which orders full_name before email), per explicit user instruction for Langfuse user-tracking."
  - "trigger-engine.ts resolves the creator's langfuseUserId once per session in scanSession (not per branch) since runSilenceScan iterates many sessions/branches per tick; the resolved value is threaded through scanBranch and reused for every branch's CallbackHandler."

patterns-established:
  - "Identity resolvers passed to third-party observability constructors (CallbackHandler) must be never-throw and default to a stable non-empty identifier."

requirements-completed: [OBS-USER-01]

duration: 3min
completed: 2026-07-18
---

# Quick Task 260718-spc: Add session creator to Langfuse as the tracked user Summary

**Every Langfuse trace for an AI call now carries the session creator's identity (email-first, never-throw resolved) as `userId`, enabling Langfuse's Users feature to group and attribute cost/usage by person across both the human-reactive `/invoke` path and the proactive silence-gate trigger path.**

## Performance

- **Duration:** ~3 min (commit-to-commit)
- **Started:** 2026-07-18T20:45:39+02:00
- **Completed:** 2026-07-18T20:47:22+02:00
- **Tasks:** 2 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- Created a shared, never-throw `resolveCreatorLangfuseUserId` helper with full unit-test coverage of the email → full_name → UUID priority chain and the error/no-data fallback path.
- Wired the resolver into both existing `CallbackHandler` trace-creation sites (`ai.ts` /invoke, `trigger-engine.ts` silence-gate scan) without touching existing tags, thread_id, or graph config.
- Bounded the auth-call volume on the proactive path by resolving identity once per session and reusing it across all branches of that session.

## Task Commits

Each task was committed atomically (TDD gate sequence for Task 1):

1. **Task 1 (RED): failing tests for resolver** - `0b69618` (test)
2. **Task 1 (GREEN): implement resolver** - `08aac86` (feat)
3. **Task 2: wire userId into both CallbackHandler sites** - `5dce9ea` (feat)

_Plan metadata commit (SUMMARY.md, STATE.md) is created separately by the orchestrator, not by this executor, per quick-task constraints._

## TDD Gate Compliance

- RED gate: `0b69618` (test commit, verified failing — module-not-found — before implementation existed)
- GREEN gate: `08aac86` (feat commit, all 4 tests passing after implementation)
- No REFACTOR commit was needed (implementation required no cleanup pass).

## Files Created/Modified
- `apps/api/src/lib/langfuse-user.ts` - `resolveCreatorLangfuseUserId(supabase, creatorId)`: email-first, never-throw Langfuse userId resolver
- `apps/api/src/lib/langfuse-user.test.ts` - 4 unit tests: email-wins, full_name fallback, UUID last-resort, never-throw on admin API error/null-data
- `apps/api/src/routes/ai.ts` - human-reactive `/invoke` path: resolves `langfuseUserId` per request, passes `userId` to `new CallbackHandler({...})` alongside existing tags
- `apps/api/src/lib/trigger-engine.ts` - proactive silence-gate path: resolves `langfuseUserId` once per session in `scanSession`, threads it through `scanBranch`'s parameter list into that branch's `CallbackHandler`

## Decisions Made
- Email-first priority order (deliberately reverses `sessions.ts`'s full_name-first precedent) per the user's explicit instruction for Langfuse user-tracking.
- Resolve-once-per-session (not per-branch) in `trigger-engine.ts` to avoid multiplying Supabase auth-admin calls across every branch on every scan tick.

## Deviations from Plan

None — plan executed exactly as written.

## Known Issues (Pre-existing, Out of Scope)

`apps/api/src/routes/ai.test.ts` has 2 pre-existing failing tests (`SC-2` "delivers text_delta events...", `SC-3` "passes c.req.raw.signal...") that return HTTP 404 instead of 200. Verified via isolated re-run with `ai.ts` reverted to its pre-task state (`git checkout -- apps/api/src/routes/ai.ts`) — the same 2 tests fail identically without this task's changes. Not caused by this task; out of scope per the deviation-rules scope boundary. Not fixed here.

## Verification Results

- `npx vitest run src/lib/langfuse-user.test.ts` — 4/4 tests pass.
- `npx tsc --noEmit` (apps/api) — clean, no errors.
- `grep -n "userId" apps/api/src/routes/ai.ts apps/api/src/lib/trigger-engine.ts` — both `CallbackHandler` sites pass `userId`.
- `npx vitest run src/lib/trigger-engine.test.ts` — 11/11 tests pass (unaffected by this change).
- `npx vitest run src/routes/ai.test.ts` — 13/15 tests pass; the 2 failures are pre-existing (confirmed above), not introduced by this task.

## Self-Check: PASSED

- FOUND: apps/api/src/lib/langfuse-user.ts
- FOUND: apps/api/src/lib/langfuse-user.test.ts
- FOUND commit 0b69618 in git log
- FOUND commit 08aac86 in git log
- FOUND commit 5dce9ea in git log
