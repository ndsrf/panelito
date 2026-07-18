---
phase: 14-polish-triggerengine-wiring
plan: 04
subsystem: api
tags: [langgraph, langfuse, node-timers-promises, trigger-engine, auto-freeze, phase-readiness, byok-cost]

# Dependency graph
requires:
  - phase: 11-personality-basic-triggers
    provides: silence-scan.ts interim single-trigger loop (D-15, TRIGGER-01), Phase 10 chain (checkSilenceGate/runArbitration/checkBotBudget)
  - phase: 13-user-profiles-phase-signal
    provides: phaseReadinessSkill (TRIGGER-02), config.configurable supabase/serviceClient/branchId reachability pattern (ai.ts)
provides:
  - "trigger-engine.ts: renamed/generalized TriggerEngine loop — node:timers/promises async-iterator setInterval + AbortController, ~1min interval (D-02), returns a stop function"
  - "Per-request Langfuse CallbackHandler tagged trigger:silence_gate on the proactive graph.invoke() call (D-14 inherited tracing gap closed, COST-03)"
  - "supabase/serviceClient/branchId added to the proactive path's config.configurable (Pitfall 5 reachability fix)"
  - "Blueprint-opt-in phase-readiness coupling on silence fires (D-03/D-04), advisory only (HUMAN-02/T-13-11)"
  - "server.ts SIGTERM/SIGINT graceful shutdown: stops the TriggerEngine loop + clearAllTrackers() before exit"
  - "auto-freeze.ts FREEZE_AFTER_MS default lowered 900000 -> 300000 (D-05, bounds new proactive BYOK spend)"
affects: [15-*, any future phase touching apps/api/src/lib/trigger-engine.ts or apps/api/src/server.ts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "node:timers/promises async-iterator setInterval + AbortController for drift-aware, cancellable persistent loops (no manual Date.now() bookkeeping, no tick-overlap hazard)"
    - "Per-request Langfuse CallbackHandler construction (never module-level) at every graph.invoke() call site, mirroring ai.ts's own pattern"
    - "Advisory Skill guidance reaching a proactive graph.invoke() by splicing a role:'user' ProviderMessage into the initial messages array (only role guaranteed to reach all 3 BYOK providers unfiltered — Anthropic maps 'system'->'user', Gemini drops 'system' from contents)"

key-files:
  created: []
  modified:
    - apps/api/src/lib/trigger-engine.ts (renamed from silence-scan.ts)
    - apps/api/src/lib/trigger-engine.test.ts (renamed from silence-scan.test.ts)
    - apps/api/src/server.ts
    - apps/api/src/lib/auto-freeze.ts
    - apps/api/src/lib/auto-freeze.test.ts
    - apps/api/src/graph/nodes/facilitation-agent.ts (doc-comment rename only)
    - apps/api/src/graph/nodes/trigger-gate.ts (doc-comment rename only)
    - apps/api/src/graph/state.ts (doc-comment rename only)
    - apps/api/src/lib/bot-arbitrator.ts (doc-comment rename only)
    - apps/api/src/lib/bot-registration.ts (doc-comment rename only)
    - apps/api/src/lib/bot-registration.test.ts (doc-comment rename only)
    - apps/api/src/lib/moderation-count.test.ts (doc-comment rename only)
    - apps/api/src/lib/skills/silence-break.ts (doc-comment rename only)

key-decisions:
  - "Doc-comment references to the old 'silence-scan.ts' filename across 8 non-files_modified files (bot-registration.ts, bot-arbitrator.ts, state.ts, silence-break.ts, facilitation-agent.ts, trigger-gate.ts, and 2 test files) were also renamed in Task 1's commit — the plan's own verify command (`grep -rn \"silence-scan\" apps/api/src` returns zero) is repo-wide, not scoped to files_modified, so this was required to satisfy Task 1's stated acceptance criteria (Rule 3, blocking verification gate)"
  - "Phase-readiness guidance is spliced into the proactive invoke's messages array as an extra role:'user' ProviderMessage (not routed through facilitationAgentNode's existing COACH_SKILLS-only firingSkillId lookup, since phaseReadinessSkill is an ANALYST skill and facilitation-agent.ts was deliberately left out of files_modified) — this keeps the change fully contained to trigger-engine.ts as the plan's file list specifies"
  - "auto-freeze.test.ts Test 3's mid-countdown reconnect point moved from the old 5-minute mark to a new 2-minute mark, because the old 5-min mark now exactly coincides with the new 5-minute FREEZE_AFTER_MS default, which would race against the freeze timer firing in the same fake-timer advance call"

patterns-established:
  - "Drift-aware persistent loop pattern (node:timers/promises + AbortController) is now the reference implementation for any future persistent scan/poll loop in apps/api"

requirements-completed: [TRIGGER-07, COST-03]

# Metrics
duration: ~20min
completed: 2026-07-18
---

# Phase 14 Plan 04: TriggerEngine Generalization + Graceful Shutdown Summary

**Renamed the Phase 11 interim `silence-scan.ts` into a drift-aware, cancellable `trigger-engine.ts` (node:timers/promises + AbortController, 1-minute interval), closed its Langfuse tracing gap with a per-request `trigger:silence_gate`-tagged CallbackHandler, added Blueprint-opt-in phase-readiness coupling to silence fires, and wired SIGTERM/SIGINT graceful shutdown alongside a 5-minute auto-freeze default.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-18T05:43:00Z (approx, first plan read)
- **Completed:** 2026-07-18T05:56:51Z
- **Tasks:** 3/3 completed
- **Files modified:** 13 (5 declared in `files_modified` + 8 doc-comment-only renames required by the plan's repo-wide grep verification)

## Accomplishments
- `startTriggerEngine` (renamed from `startSilenceScanLoop`) now returns a stop function; the scan loop uses `node:timers/promises`'s async-iterator `setInterval` driven by an `AbortController` instead of a raw callback `setInterval`, eliminating the tick-overlap hazard and enabling graceful shutdown
- `SCAN_INTERVAL_MS` default changed 15000 → 60000 (D-02, ~1 minute silence re-evaluation, decoupled from auto-freeze)
- Every proactive `graph.invoke()` call on the silence path now carries a per-request Langfuse `CallbackHandler` tagged `session:*`, `branch:*`, `trigger:silence_gate` — closing the confirmed tracing gap on this path (COST-03)
- `supabase`/`serviceClient`/`branchId` added to the proactive path's `config.configurable` so Coach participant-profile personalization (Phase 13) can reach this call site for the first time; `botOverrides` deliberately NOT added (dead key — `routeFromStart` bypasses `TriggerGateNode` for `silence_gate`)
- Blueprint-opt-in phase-readiness coupling: when `blueprint.silence_phase_readiness_coupling_enabled` is true, `phaseReadinessSkill.detect()`/`buildPromptGuidance()` (reused as-is) run before the silence-fire invoke, and firing guidance is spliced into the messages the Coach sees — advisory only, never auto-advances the phase
- `server.ts` registers `SIGTERM`/`SIGINT` handlers that stop the TriggerEngine loop and call `clearAllTrackers()` (previously exported with zero callers) before `process.exit(0)`
- `auto-freeze.ts`'s `FREEZE_AFTER_MS` default lowered from 900000ms (15min) to 300000ms (5min, D-05) to bound the new ~1-minute proactive fire cadence's BYOK spend surface; `GRACE_MS` unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Rename/generalize silence-scan.ts into a drift-aware, traced, cancellable trigger-engine.ts** - `b52fa3f` (feat)
2. **Task 2: Add Blueprint-opt-in phase-readiness coupling to silence fires (D-03/D-04)** - `0fb9504` (feat)
3. **Task 3: Graceful shutdown wiring + 5-minute auto-freeze (D-05)** - `0aa5a2a` (feat)

**Plan metadata:** (this commit, SUMMARY.md + REQUIREMENTS.md only — worktree mode excludes STATE.md/ROADMAP.md, orchestrator owns those)

## Files Created/Modified
- `apps/api/src/lib/trigger-engine.ts` (renamed from `silence-scan.ts`) - generalized TriggerEngine loop, Langfuse tracing, phase-readiness coupling
- `apps/api/src/lib/trigger-engine.test.ts` (renamed from `silence-scan.test.ts`) - 10 tests: original 5 orchestration behaviors + stop-function/abort test + 3 new phase-readiness coupling tests (with 2 net new relative to plan's minimum ask)
- `apps/api/src/server.ts` - SIGTERM/SIGINT graceful shutdown wiring
- `apps/api/src/lib/auto-freeze.ts` - FREEZE_AFTER_MS default 900000 → 300000
- `apps/api/src/lib/auto-freeze.test.ts` - rebased timer assertions onto the 5-minute window
- 8 additional files (doc-comments only) - renamed "silence-scan" references to satisfy the plan's repo-wide grep verification

## Decisions Made
- See `key-decisions` in frontmatter above (doc-comment rename scope, phase-readiness guidance delivery mechanism, auto-freeze test timing rebase)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Renamed "silence-scan" doc-comment references across 8 files outside Task 1's declared `files_modified`**
- **Found during:** Task 1 (running the task's own `<verify>` grep command)
- **Issue:** Task 1's acceptance criteria and the plan's overall `<verification>` both require `grep -rn "silence-scan" apps/api/src` to return zero matches. The literal string appeared in doc comments across `bot-registration.ts`, `bot-arbitrator.ts`, `graph/state.ts`, `skills/silence-break.ts`, `graph/nodes/facilitation-agent.ts`, `graph/nodes/trigger-gate.ts`, and two `.test.ts` files — none of which are in the plan's declared `files_modified` list (which covers only trigger-engine.ts/.test.ts, server.ts, auto-freeze.ts/.test.ts)
- **Fix:** Mechanical sed rename of "silence-scan"/"silence-scan.ts"/"startSilenceScanLoop" strings in comments only (zero behavior change) across the 8 files
- **Files modified:** `apps/api/src/lib/bot-registration.ts`, `apps/api/src/lib/bot-arbitrator.ts`, `apps/api/src/lib/moderation-count.test.ts`, `apps/api/src/lib/bot-registration.test.ts`, `apps/api/src/graph/state.ts`, `apps/api/src/lib/skills/silence-break.ts`, `apps/api/src/graph/nodes/facilitation-agent.ts`, `apps/api/src/graph/nodes/trigger-gate.ts`
- **Verification:** `grep -rn "silence-scan" apps/api/src` returns zero; all affected test suites re-run green
- **Committed in:** `b52fa3f` (Task 1 commit)

**2. [Rule 1 - Bug] Rebased auto-freeze.test.ts Test 3's mid-countdown reconnect timing**
- **Found during:** Task 3 (running `auto-freeze.test.ts` after lowering FREEZE_AFTER_MS to 300000)
- **Issue:** Test 3 reconnected "at the 5-min mark" of what was previously a 15-min countdown — with the new 5-minute default, that reconnect point now exactly coincides with when the freeze timer itself fires, racing against `vi.advanceTimersByTime`'s synchronous callback execution within the same call
- **Fix:** Moved the reconnect point to the 2-minute mark (safely within the new 5-minute window) and updated the "advance past where freeze would fire" step to 5 minutes
- **Files modified:** `apps/api/src/lib/auto-freeze.test.ts`
- **Verification:** `npx vitest run src/lib/auto-freeze.test.ts` — all 4 tests pass
- **Committed in:** `0aa5a2a` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking/verification-required rename, 1 bug/test-timing fix)
**Impact on plan:** Both fixes were required for the plan's own stated verification commands to pass; no scope creep beyond what the plan's `<verify>`/`<verification>` blocks explicitly demand.

## Issues Encountered
- The worktree had no `node_modules` (git worktrees don't carry installed dependencies). Symlinked `node_modules` at the repo root, `apps/api/`, `apps/web/`, and `packages/types/` into the worktree from the main checkout to run `vitest`/`tsc` locally — these symlinks are gitignored (top-level `node_modules/` pattern) and were never staged/committed.
- `vi.useFakeTimers()` does not reliably intercept `node:timers/promises`'s internal timer bindings (no existing precedent in this codebase), so the Behavior 6 stop-function test instead mocks `node:timers/promises` itself with a deterministic single-tick-then-await-forever-until-abort generator — avoids flaky real-time waits while still exercising `startTriggerEngine`'s actual loop/stop-function contract.
- Full `apps/api` test suite run (`npx vitest run`, no path filter) surfaced 2 pre-existing failures unrelated to this plan's files (`src/routes/keys.test.ts` — DB fixture `blueprint_id` not-null constraint; `src/routes/ai.test.ts` — 2 tests expecting 200 got 404). Neither `ai.ts`/`ai.test.ts`/`keys.ts`/`keys.test.ts` import anything from `trigger-engine.ts`, `auto-freeze.ts`, `server.ts`, or `phase-readiness.ts`; these appear to be environment/DB-fixture issues out of this plan's scope boundary (not fixed, per the scope-boundary rule — logged here for visibility, not to `deferred-items.md` since they were observed only in an incidental full-suite run, not blocking this plan's own declared verification).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TRIGGER-07 and COST-03 requirements satisfied: all 6 trigger types now fire (5 reactive from Phases 12-13 + the timer-based silence re-evaluation here), and the silence-fire path is Langfuse-traced
- `server.ts` now has a real graceful-shutdown story (SIGTERM/SIGINT) for the standalone Node process — previously `clearAllTrackers()` had zero callers
- The `<developer_flag>` in the plan is unresolved by design: `participantId` resolution for silence-fires was intentionally NOT implemented in this plan (Coach personalization degrades gracefully to a generic summary without it, never throws) — flagged for a future developer decision, not a blocker for this plan's completion
- Pre-existing `keys.test.ts`/`ai.test.ts` failures (see Issues Encountered) may warrant investigation in a future phase, but are unrelated to TriggerEngine wiring

---
*Phase: 14-polish-triggerengine-wiring*
*Completed: 2026-07-18*
