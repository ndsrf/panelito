---
phase: 260718-sxn
plan: 01
subsystem: observability
tags: [langfuse, otel, vitest, testing, coach, analyst]

# Dependency graph
requires:
  - phase: 14-polish-triggerengine-wiring
    provides: streamWithGeneration Langfuse Generation-wrap helper (COST-03) used at both agent call sites
provides:
  - Langfuse OTel smoke test (Test B) gated behind an explicit RUN_LANGFUSE_SMOKE_TEST=true opt-in
  - Coach and Analyst Generation traces now record { system, messages } instead of just system prompt
affects: [langfuse, graph.integration.test.ts, facilitation-agent, analytics-agent]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Opt-in env-var gate (RUN_LANGFUSE_SMOKE_TEST) for tests with real external network side effects, layered on top of existing skipIf credential gates"

key-files:
  created: []
  modified:
    - apps/api/src/graph/graph.integration.test.ts
    - apps/api/src/graph/nodes/facilitation-agent.ts
    - apps/api/src/graph/nodes/analytics-agent.ts
    - apps/api/src/graph/nodes/facilitation-agent.test.ts
    - apps/api/src/graph/nodes/analytics-agent.test.ts

key-decisions:
  - "Test B (Langfuse OTel smoke) now requires RUN_LANGFUSE_SMOKE_TEST=true in addition to the existing SUPABASE/LANGFUSE credential gates, so ordinary `pnpm vitest run` never emits a real trace to the user's live Langfuse project"
  - "Generation input at both agent call sites changed from a bare system string to { system, messages } using the exact same slice already passed to adapter.stream() (CONTEXT_WINDOWS.facilitation / CONTEXT_WINDOWS.analytics) — no new context-window logic introduced"

patterns-established:
  - "Pattern: real-network-side-effect tests get an explicit RUN_*_TEST=true opt-in gate layered on skipIf credential checks, not just credential presence"

requirements-completed: [QUICK-260718-sxn]

# Metrics
duration: 3min
completed: 2026-07-18
---

# Phase 260718-sxn: Gate Langfuse Smoke Test + Enrich Agent Generation Input Summary

**Gated the Langfuse OTel smoke test behind RUN_LANGFUSE_SMOKE_TEST=true and enriched Coach/Analyst Langfuse Generation traces to include the actual conversation window, not just the system prompt.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-18T18:56:00Z
- **Completed:** 2026-07-18T18:58:08Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Test B (`graph.integration.test.ts`) no longer fires automatically whenever `LANGFUSE_PUBLIC_KEY`/`SECRET_KEY` happen to be present in a normal dev `.env` — it now requires an explicit `RUN_LANGFUSE_SMOKE_TEST=true` opt-in, stopping the recurring "Climate change is urgent." trace from polluting the user's live Langfuse project on every test run
- Coach (`facilitation-agent.ts`) and Analyst (`analytics-agent.ts`) Generation traces now record `{ system, messages }` — the exact conversation window sent to the model — instead of only the system prompt, making agent traces useful for debugging
- Strengthened both agent test suites' `mockStartObservation` assertions to lock in the new `input` shape, preventing a future regression back to `input: system`

## Task Commits

Each task was committed atomically:

1. **Task 1: Gate the Langfuse OTel smoke test behind an explicit opt-in env var** - `0d01e03` (fix)
2. **Task 2: Include the conversation window in Coach and Analyst Generation input** - `5523c74` (feat)

**Plan metadata:** (pending — orchestrator commits docs separately)

## Files Created/Modified
- `apps/api/src/graph/graph.integration.test.ts` - Added `RUN_LANGFUSE_SMOKE` env-var gate; Test B's `describe.skipIf` now also requires it; updated header + Test B banner doc comments
- `apps/api/src/graph/nodes/facilitation-agent.ts` - `streamWithGeneration` call's `input` now `{ system, messages: state.messages.slice(-CONTEXT_WINDOWS.facilitation) }`
- `apps/api/src/graph/nodes/analytics-agent.ts` - `streamWithGeneration` call's `input` now `{ system, messages: state.messages.slice(-CONTEXT_WINDOWS.analytics) }`
- `apps/api/src/graph/nodes/facilitation-agent.test.ts` - Strengthened Generation-wrap assertion to include `input: expect.objectContaining({ system: expect.any(String), messages: expect.any(Array) })`
- `apps/api/src/graph/nodes/analytics-agent.test.ts` - Same strengthened assertion for the Analyst call site

## Decisions Made
- Layered the opt-in `RUN_LANGFUSE_SMOKE_TEST` flag on top of the existing `HAS_SUPABASE`/`HAS_LANGFUSE` credential gates rather than replacing them, so the test still requires real infra to be reachable in addition to being deliberately requested.
- Reused the exact same `state.messages.slice(-CONTEXT_WINDOWS.*)` expression already passed to `adapter.stream()` at each call site rather than recomputing a separate window, guaranteeing the trace always reflects what was actually sent to the model.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- This worktree had no `node_modules` installed (git worktrees don't carry node_modules, which is gitignored). Symlinked `node_modules` at the repo root and in `apps/api`, `apps/web`, and `packages/types` to the main checkout's installed `node_modules` to run `vitest`/`tsc`. Added `node_modules` to the shared `.git/info/exclude` (local-only, non-tracked) so these symlinks never show as untracked files in `git status`. No tracked files were changed by this workaround.
- Full `pnpm vitest run` for `apps/api` surfaced 8 pre-existing failures in `src/routes/ai.test.ts` (2) and `src/routes/keys.test.ts` (6) — neither file was touched by this plan (confirmed via `git diff bcaaf27..HEAD --stat`). Symptoms (e.g. "expected 400 to be 501", key verification returning 400 for a valid key) look environmental (missing/misconfigured test dependency in this worktree), not a regression from this plan's changes. Logged to `deferred-items.md` per the scope-boundary rule; not fixed here.

## User Setup Required

None - no external service configuration required. To run the OBS-01/02 smoke test deliberately going forward: `RUN_LANGFUSE_SMOKE_TEST=true pnpm vitest run src/graph/graph.integration.test.ts` (from `apps/api`, with `SUPABASE_DIRECT_URL`/`LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` set).

## Next Phase Readiness
- Both defects from the user's report are fixed and verified: no more spurious Langfuse traces on ordinary test runs, and Coach/Analyst Generation traces now show the real conversation input.
- Unrelated pre-existing test failures in `ai.test.ts`/`keys.test.ts` remain — see `deferred-items.md` for detail; recommend investigating in a separate task if they also fail outside this worktree.

---
*Phase: 260718-sxn*
*Completed: 2026-07-18*

## Self-Check: PASSED

All modified files and both task commits (0d01e03, 5523c74) verified present.
