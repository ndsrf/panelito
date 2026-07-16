---
phase: 13-user-profiles-phase-signal
plan: 03
subsystem: api
tags: [langgraph, supabase, participant-profiles, prompt-injection-defense, graph-topology]

# Dependency graph
requires:
  - phase: 13-user-profiles-phase-signal
    provides: "Plan 01/02 — ParticipantProfileSchema, participant_profiles table + upsert_participant_profile/getParticipantProfile RPC pair (migration 0016)"
  - phase: 11-personality-basic-triggers
    provides: "ArgGraphBuilderNode, ArgNode/ArgEdge types, summarizeArgGraph()/escapeUntrustedText() bot-context.ts precedent"
  - phase: 12-graph-coherence-extended-triggers
    provides: "TriggerGateNode, routeAfterMutationGate/routeAfterArgGraphBuilder conditional-edge precedent (12-06)"
provides:
  - "profileBuilderNode — resolves argGraph speakers to author_id, filters positions/assertions, counts role='user' engagement, upserts participant_profiles per speaker (zero new LLM calls)"
  - "summarizeParticipant() in bot-context.ts — escaped, delimiter-framed profile summary for Coach personalization (PROFILE-02)"
  - "Human-path graph reachability fix (Finding 1): mutationGate -> argGraphBuilder -> profileBuilder -> triggerGate now runs on every real human turn"
affects: [14-polish-triggerengine-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Supabase count-only query via .select('id', { count: 'exact', head: true }) chained .eq() filters"
    - "PostgREST embedded-resource filter (reactions.select('id, messages!inner(branch_id)')) to scope a child table lacking its own branch_id"
    - "routeAfterMutationGate distinguishes state.triggerType to fan a shared node (mutationGate) into two different first-pass destinations without re-entering an already-run node"

key-files:
  created:
    - apps/api/src/graph/nodes/profile-builder.ts
    - apps/api/src/graph/nodes/profile-builder.test.ts
    - apps/api/src/lib/bot-context.test.ts
  modified:
    - apps/api/src/lib/bot-context.ts
    - apps/api/src/graph/graph.ts
    - apps/api/src/graph/graph.test.ts
    - .planning/phases/13-user-profiles-phase-signal/deferred-items.md

key-decisions:
  - "Fixed a routing bug implicit in the plan's literal routeAfterMutationGate recipe: naively returning 'argGraphBuilder' on every first pass (regardless of triggerType) would re-enter argGraphBuilder on the analysis_request path (which already ran it via routeFromStart) and never terminate, since that path's routeAfterArgGraphBuilder branch never reaches triggerGate to set triggerGateComplete. Fixed by branching on state.triggerType: null/undefined (human path) -> 'argGraphBuilder'; any other defined value (currently only 'analysis_request') -> 'triggerGate' directly, exactly as before Phase 13. Verified via a new graph.test.ts test proving the analysis_request path never visits profileBuilder, plus the pre-existing test (d) (analysis_request termination) still passing unmodified."
  - "positions = node labels where type is 'hypothesis' or 'claim'; assertions = all node labels — both capped at the 20 most-recent items via .slice(-20), per the plan's 'Claude's Discretion' note."
  - "reactions_used counts via PostgREST's embedded-resource filter (reactions.select('id, messages!inner(branch_id)').eq('messages.branch_id', branchId)) since the reactions table has no branch_id column of its own (schema fact confirmed in migration 0005)."

patterns-established:
  - "Zero-new-LLM-calls DB-CRUD graph node: profile-builder.ts follows arg-graph-builder.ts's whole-file fail-open skeleton but swaps the AIProvider adapter seam for orphan-edge.ts's serviceClient seam, since D-06 requires no LLM call at all."

requirements-completed: [PROFILE-01, PROFILE-02]

# Metrics
duration: 12min
completed: 2026-07-16
---

# Phase 13 Plan 03: ProfileBuilderNode + Human-Path Graph Reachability Summary

**profileBuilderNode derives real per-participant positions/assertions/engagement from argGraph and upserts them per turn; the human-message path now runs argGraphBuilder → profileBuilder → triggerGate for the first time in this project's history, making state.argGraph load-bearing outside unit tests.**

## Performance

- **Duration:** 12 min (17:09:49 → 17:17:35 UTC+2, per task commit timestamps)
- **Started:** 2026-07-16T17:09:49+02:00
- **Completed:** 2026-07-16T17:17:35+02:00
- **Tasks:** 3 completed
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments

- `summarizeParticipant()` added to `bot-context.ts` — renders a null profile as a fixed sentence, and a real profile as an escaped, `<<<PARTICIPANT_PROFILE_DATA...>>>`-delimited block (positions + engagement), reusing `escapeUntrustedText()` (WR-06, no parallel escaping logic).
- `profileBuilderNode` created — groups `state.argGraph.nodes` by speaker, resolves each group's `author_id` via a `messages` lookup keyed by `message_id`, skips any resolution whose source message has `role !== 'user'` (Pitfall 1 — never attributes AI-authored content to a human's profile), derives capped positions/assertions, counts role='user'-filtered `messages_sent` and branch-scoped `reactions_used`, and upserts via the Plan 02 `upsertParticipantProfile` RPC wrapper. Whole-file + per-speaker fail-open — never throws, always returns `{}`.
- Graph topology extended (Finding 1, 13-RESEARCH.md CRITICAL): the human-message path now runs `mutationGate → argGraphBuilder → profileBuilder → triggerGate` on its first pass, resolving the previously-documented production gap where `state.argGraph` was permanently empty outside `analysis_request`-triggered unit tests. The `analysis_request` proactive path is verified unchanged (still `argGraphBuilder → analysis` directly, never visiting `profileBuilder`).

## Task Commits

Each task was committed atomically (TDD tasks have a `test` RED commit followed by a `feat` GREEN commit):

1. **Task 1: summarizeParticipant() in bot-context.ts (D-11)**
   - `67b6038` test(13-03): add failing test for summarizeParticipant()
   - `3c4e725` feat(13-03): implement summarizeParticipant() (D-11)
2. **Task 2: profileBuilderNode (D-03/D-04/D-05/D-06)**
   - `cdb20bc` test(13-03): add failing test for profileBuilderNode
   - `5dc10bb` feat(13-03): implement profileBuilderNode (D-03/D-04/D-05/D-06)
3. **Task 3: Wire profileBuilder into graph topology (F1/D-12)**
   - `e95da74` feat(13-03): wire profileBuilder into graph topology (Finding 1, human-path reachability)

## Files Created/Modified

- `apps/api/src/graph/nodes/profile-builder.ts` - profileBuilderNode + resolveAuthorId/countMessagesSent/countReactionsUsed/groupBySpeaker helpers (exported for unit testing)
- `apps/api/src/graph/nodes/profile-builder.test.ts` - 7 tests: missing-branchId fail-open, two-speaker upsert, slice(-20) cap, AI-attribution skip, role='user' messages_sent filtering, per-speaker I/O-error resilience, always-returns-{} contract
- `apps/api/src/lib/bot-context.ts` - added `summarizeParticipant()` sibling to `summarizeArgGraph()`
- `apps/api/src/lib/bot-context.test.ts` - 5 tests: null-profile sentence, delimiter framing, guard sentence, empty-positions fallback, WR-06 delimiter-injection neutralization
- `apps/api/src/graph/graph.ts` - registered `profileBuilder` node; rewrote `routeAfterMutationGate`/`routeAfterArgGraphBuilder` to route the human path through `argGraphBuilder → profileBuilder` while preserving the `analysis_request` path exactly; added fixed `profileBuilder → triggerGate` edge; updated topology doc comments
- `apps/api/src/graph/graph.test.ts` - added a `profileBuilderNode` module mock (order-tracking spy) and 2 new tests: human-path visitation order + termination, analysis_request path never visiting profileBuilder
- `.planning/phases/13-user-profiles-phase-signal/deferred-items.md` - logged a pre-existing/environmental note (missing `apps/api/.env` in this worktree) discovered while running the full test suite for verification

## Decisions Made

- **Routing bug fix (Rule 1 — auto-fix, not a plan deviation in scope, but a correction to the plan's literal recipe):** the plan's Task 3 action text describes `routeAfterMutationGate` returning `'argGraphBuilder'` on every first pass keyed only off `triggerGateComplete !== true`. Applied literally, this breaks termination for the `analysis_request` path — that path's `analysis → mutationGate` fixed edge is also a "first pass" (triggerGate never runs on that path until *after* `routeAfterArgGraphBuilder` routes straight to `'analysis'`), so it would re-enter `argGraphBuilder` a second time, loop indefinitely, and double an LLM extraction call. Fixed by additionally branching on `state.triggerType`: only the null/undefined (human) path routes to `'argGraphBuilder'`; `'analysis_request'` routes straight to `'triggerGate'`, exactly matching pre-Phase-13 behavior for that path. Verified via the pre-existing test (d) (`analysis_request` termination, unmodified, still passing) plus a new dedicated test proving `profileBuilderNodeMock` is never called on that path.
- positions/assertions cap of 20 (`.slice(-20)`) applied per the plan's own "Claude's Discretion" note — most-recent items kept.
- `reactions_used` counted via PostgREST's embedded-resource filter syntax (`reactions.select('id, messages!inner(branch_id)').eq('messages.branch_id', branchId)`) since `reactions` has no `branch_id` column (confirmed against migration 0005_reactions_personas.sql).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed an infinite-loop/double-LLM-call bug in the plan's literal `routeAfterMutationGate` recipe**
- **Found during:** Task 3 (graph topology wiring)
- **Issue:** The plan's action text ("update `routeAfterMutationGate` to return `'argGraphBuilder'` on the first pass (`state.triggerGateComplete !== true`)") does not distinguish the human path from the `analysis_request` proactive path, both of which reach `mutationGate` via a fixed edge with `triggerGateComplete` still `null` on their first pass. Applied literally, the `analysis_request` path would re-enter `argGraphBuilder` (a second, redundant LLM extraction call) and then loop indefinitely, since that path's `routeAfterArgGraphBuilder` branch never routes through `triggerGate` to ever set `triggerGateComplete = true`.
- **Fix:** `routeAfterMutationGate` now checks `state.triggerType` in addition to `triggerGateComplete`: human path (`triggerType` null/undefined) routes to `'argGraphBuilder'`; `'analysis_request'` routes straight to `'triggerGate'` (unchanged from pre-Phase-13 behavior).
- **Files modified:** `apps/api/src/graph/graph.ts`, `apps/api/src/graph/graph.test.ts`
- **Verification:** Pre-existing test "(d) Proactive analysis_request path still reaches analysis... and terminates" passes unmodified; new test "(c) analysis_request path is unchanged... never visiting profileBuilder" explicitly asserts `profileBuilderNodeMock` was never called on that path; new test "(a)+(b)" proves the human path visits `argGraphBuilder → profileBuilder → triggerGate` in that exact order and terminates.
- **Committed in:** `e95da74` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix — Rule 1)
**Impact on plan:** Necessary for correctness (the plan's own success criteria requires "without breaking termination" — the literal recipe as written would have broken it for the `analysis_request` path). No scope creep — same three files the plan specified.

## Issues Encountered

- This worktree had no `node_modules` and no `apps/api/.env` (both gitignored, present only in the main repo checkout). Ran `pnpm install --prefer-offline` (fast, served from the local pnpm content-addressable store, no network fetch needed) to unblock `tsc`/`vitest`. Did not copy `.env` — none of this plan's own verification targets (`bot-context`, `profile-builder`, `graph`, `tsc --noEmit`) require Supabase env vars (all Supabase interaction is injected via `config.configurable.serviceClient` in tests). Ran the full `apps/api` test suite once anyway to check for regressions; found 6 pre-existing/environmental failures (`blueprint-loader.test.ts`, `silence-scan.test.ts` x5, plus `ai/keys/branches/messages/sessions.test.ts` suite-collection failures) — confirmed via `git diff fc81032 HEAD -- <those files>` (zero diff) that none of these files were touched by this plan, and logged the missing-`.env` root cause in `deferred-items.md` for the next plan/session.

## User Setup Required

None - no external service configuration required. (Migration 0016 — the `participant_profiles` table and RPCs this plan's `profileBuilderNode` writes to — was already pushed in Plan 02, per participant-profile.ts's own header comment.)

## Next Phase Readiness

- PROFILE-01/PROFILE-02 requirements are now functionally complete: `profileBuilderNode` populates real `participant_profiles` rows on every human turn (not just `analysis_request`-triggered unit tests), and `summarizeParticipant()` is ready for the Coach's `buildPromptGuidance()` splice point (not yet wired into `facilitation-agent.ts` — that splice is presumably a later plan in this phase, per `13-PATTERNS.md`'s file classification table listing `facilitation-agent.ts` as a separate MODIFIED file not touched by this plan).
- The Finding 1 human-path reachability fix also means `argGraphBuilder` now runs (and costs a classification-tier LLM call) on every human turn, not just proactive scans — this was the explicit, called-out cost tradeoff in 13-RESEARCH.md's Finding 1 recommendation, not a new discovery of this plan.
- No blockers for the remaining Phase 13 plans (phase-readiness Skill / TRIGGER-02, per the phase map).

---
*Phase: 13-user-profiles-phase-signal*
*Completed: 2026-07-16*
