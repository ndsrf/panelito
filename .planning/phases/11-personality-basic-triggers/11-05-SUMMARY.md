---
phase: 11-personality-basic-triggers
plan: 05
subsystem: api
tags: [langgraph, conditional-edges, routing, typescript, vitest]

# Dependency graph
requires:
  - phase: 11-personality-basic-triggers
    plan: 01
    provides: state.triggerType (string | null routing carrier), GraphState schema
  - phase: 11-personality-basic-triggers
    plan: 03
    provides: argGraphBuilderNode
  - phase: 11-personality-basic-triggers
    plan: 04
    provides: facilitationAgentNode (Coach), analyticsAgentNode (Analyst/Fact-Checker)
provides:
  - "routeFromStart(state) — conditional START edge router: 'silence_gate' -> facilitation, 'analysis_request' -> argGraphBuilder->analysis, null/undefined -> orchestrator (unchanged human path), any other defined value -> console.error + throw"
  - "createGraph() extended with argGraphBuilder/facilitation/analysis nodes and edges; fixed START->orchestrator edge removed (Pitfall 2)"
  - "Empirical proof (not assumption) of LangGraph 1.4.7 conditional-edge router error-propagation behavior, documented as permanent regression tests"
affects: [11-06, 11-07, 12-graph-coherence-extended-triggers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional START edge as the graph entry-point router, exhaustively pathsMap'd for every normally-returned value; a bug-path value throws instead of needing a pathsMap entry"
    - "Graph-level SPIKE regression tests promoted from throwaway investigation into permanent coverage, documenting empirically-observed third-party library behavior directly in test code (not just prose)"

key-files:
  created: []
  modified:
    - apps/api/src/graph/graph.ts
    - apps/api/src/graph/graph.test.ts

key-decisions:
  - "routeFromStart reads state.triggerType (Plan 01's actual GraphState field) — NOT state.triggerMetadata.trigger_type as 11-AI-SPEC.md's illustrative sample and 11-RESEARCH.md's Finding 6 prose used. The plan's own <interfaces> section explicitly names state.triggerType as the Plan 01 contract, and state.ts's own field comment confirms triggerType is 'the routing carrier read by the conditional START edge (Plan 05)... NOT the same as triggerMetadata'. Followed the authoritative interface over the illustrative AI-SPEC sample."
  - "Empirically corrected 11-RESEARCH.md Pitfall 3's assumption: in this installed LangGraph 1.4.7, a router return value absent from the pathsMap does NOT silently drop the invocation — it throws 'Branch condition returned unknown or null destination', rejecting graph.invoke(). Both failure modes (thrown router error, unmapped pathsMap key) surface identically as a rejected promise. This is documented in graph.ts's routeFromStart doc comment and as permanent SPIKE regression tests in graph.test.ts, superseding the unverified research assumption for this codebase's dependency version."
  - "Chosen error-handling strategy for an unrecognized triggerType: console.error (greppable, satisfies ROADMAP success criterion 2) followed by an explicit throw — not a distinguishable dead-end pathsMap key. Since LangGraph itself already throws for genuinely unmapped router returns, explicitly throwing for a known-bad value is more direct/traceable (a clear Error message) than relying on the implicit unmapped-key throw, and needs no extra pathsMap entry for a value that never gets returned."

patterns-established:
  - "SPIKE-then-promote: when a plan requires empirically verifying third-party library behavior before committing to an implementation strategy, write the spike as real test code (not scratch scripts), run it, correct any research assumptions it disproves, and keep it as permanent regression coverage rather than deleting it once the answer is known."

requirements-completed: [PERSONA-01, PERSONA-02]

# Metrics
duration: 20min
completed: 2026-07-14
---

# Phase 11 Plan 05: Conditional START Edge Summary

**Wired LangGraph's conditional START edge (`routeFromStart`) that routes `silence_gate` → Coach, `analysis_request` → ArgGraphBuilder → Analyst, and the human path → the existing orchestrator pipeline unchanged — with an unrecognized-`triggerType` value now `console.error`-ing and throwing instead of silently defaulting, and LangGraph 1.4.7's actual router error-propagation behavior empirically proven (and found to contradict a research assumption) rather than assumed.**

## Performance

- **Duration:** ~20 min (including a stale-worktree fast-forward merge + fresh `pnpm install` before starting, per the established pattern from Plans 03/04 in this wave)
- **Started:** 2026-07-14T16:58:00+02:00 (approx, after merge/install)
- **Completed:** 2026-07-14T19:02:54+02:00 (Task 3 GREEN commit)
- **Tasks:** 3 completed
- **Files modified:** 2 (`graph.ts`, `graph.test.ts` — exactly the plan's declared `files_modified`)

## Accomplishments
- **Task 1 (spike):** Wrote a minimal throwaway `StateGraph` with a conditional START edge to empirically observe LangGraph 1.4.7's router-function error-propagation behavior — both a thrown router error and a pathsMap-unmapped return value reject `graph.invoke()`'s promise in this installed version. This **contradicts** 11-RESEARCH.md Pitfall 3's assumption of a "silent drop" for unmapped keys (that assumption was explicitly flagged as unverified — Open Question 3 / Assumption A2 — and is now empirically corrected). Kept as permanent regression tests, not deleted.
- **Task 2:** Implemented `routeFromStart(state)` reading `state.triggerType` (Plan 01's actual field — not the AI-SPEC sample's `state.triggerMetadata.trigger_type`); routes `'silence_gate'` → `facilitation`, `'analysis_request'` → `analysis` (via `argGraphBuilder`), `null`/`undefined` → `orchestrator`. A defined-but-unrecognized value `console.error`s a distinguishable message and throws, never falling through to the human path (Finding 6 / ROADMAP success criterion 2). Removed the fixed `.addEdge(START, 'orchestrator')` (Pitfall 2) and replaced it with `.addConditionalEdges(START, routeFromStart, {...})`; registered `argGraphBuilder`/`facilitation`/`analysis` nodes and their edges (`argGraphBuilder→analysis`, `facilitation→END`, `analysis→END`).
- **Task 3:** Extended `graph.test.ts`'s `makeConfig` helper with `facilitationAdapter`/`analyticsAdapter`/`argGraphAdapter`/`branchId`/`streamWriter` seams and added four new describe blocks covering all `routeFromStart` outcomes: facilitation (Coach output captured via `streamWriter` ends with `?`), analysis (`argGraphBuilder` populates `state.argGraph` before `AnalyticsAgentNode` runs — proven by asserting the Analyst's captured system prompt cites the extracted speaker), orchestrator-fallback (regression-identical to D-11 Path 1), and unrecognized-trigger (asserts rejection + `console.error` call + absence of an orchestrator-route info log).
- All 101 relevant `apps/api` tests pass (11/11 in `graph.test.ts`); `tsc --noEmit` clean except the pre-existing, documented `bot-arbitrator.test.ts:136` error (unrelated to this plan, tracked since Plan 01).

## Task Commits

1. **Task 1: Spike — LangGraph conditional-edge router error propagation**
   - `4f0ea0e` (test) — SPIKE describe block in `graph.test.ts`, empirically verifying both failure modes; promoted to permanent regression tests with an in-code "CHOSEN STRATEGY" doc comment

2. **Task 2: Conditional START edge + routeFromStart + node/edge wiring** (TDD RED→GREEN skipped — this task's own acceptance criteria are static/grep-based per its `<verify>` block, not a `<behavior>`-driven red/green cycle; verified directly against `tsc`/grep gates)
   - `883e34b` (feat) — `routeFromStart`, node registration, conditional START edge, fixed-edge removal, new edges

3. **Task 3: Extend graph.test.ts with the new START-path describe blocks**
   - `f1a6e16` (test) — four new describe blocks + `makeConfig` extension; all 11 `graph.test.ts` tests green

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/api/src/graph/graph.ts` — `routeFromStart` conditional START-edge router; `createGraph()` extended with `argGraphBuilder`/`facilitation`/`analysis` node registration and edges; fixed `START→orchestrator` edge removed
- `apps/api/src/graph/graph.test.ts` — SPIKE regression tests (router error propagation); `makeConfig` extended with new adapter seams; four new `routeFromStart` path describe blocks

## Decisions Made
- Used `state.triggerType` (Plan 01's real `GraphState` field, confirmed by both the plan's `<interfaces>` section and `state.ts`'s own field comment) instead of `state.triggerMetadata.trigger_type` from 11-AI-SPEC.md's illustrative sample code / 11-RESEARCH.md's Finding 6 prose — the plan text is the authoritative interface contract, the AI-SPEC sample was written before Plan 01 finalized the actual field name.
- Empirically corrected the research's "silent drop" assumption for unmapped pathsMap keys: this LangGraph 1.4.7 install throws `"Branch condition returned unknown or null destination"` instead. Documented in code comments and as permanent tests rather than only in this SUMMARY, so future readers see the correction at the point of use.
- `routeFromStart` throws explicitly (with `console.error` first) for an unrecognized `triggerType`, rather than routing to a distinguishable dead-end pathsMap key — simpler, produces a clearer Error message, and needs no extra pathsMap entry since the value is never actually returned.

## Deviations from Plan

None — plan executed exactly as written. The one substantive judgment call (state field name: `triggerType` vs `triggerMetadata.trigger_type`) was resolved by following the plan's own `<interfaces>` section, which is the load-bearing contract, over an illustrative code sample in a research artifact — not a deviation from the plan itself.

## Issues Encountered

**Worktree was stale at spawn time** (same pattern as Plans 01/03/04 in this wave). The worktree branch (`worktree-agent-aad142e8cc8080f81`) was forked before Wave 2's merge (`df6ee77`) landed on `main`, so `11-05-PLAN.md`, `11-03-SUMMARY.md`, `11-04-SUMMARY.md`, and the `arg-graph-builder.ts`/`facilitation-agent.ts`/`analytics-agent.ts` node files this plan depends on did not exist in the worktree. Confirmed via `git merge-base --is-ancestor HEAD main` that this was a pure fast-forward situation (no divergent commits on this branch) before running `git merge --ff-only main` — a clean, non-destructive fast-forward (37 files, no conflicts). `node_modules` were also absent (fresh worktree checkout); ran `pnpm install --frozen-lockfile` (lockfile-pinned, not a new-package install) before running any tests.

**The empirical spike disproved a research assumption.** 11-RESEARCH.md's Pitfall 3 assumed an unmapped `pathsMap` key silently drops the invocation (a `[CITED]` claim sourced from general LangGraph JS documentation, not this specific installed version). The Task 1 spike proved this installed version (`@langchain/langgraph@1.4.7`) actually throws in that case too. This did not block the plan — if anything it simplified the error-handling decision (both failure modes behave the same way) — but it is worth flagging since a future dependency upgrade could reintroduce a version where the original research assumption holds; the SPIKE regression tests in `graph.test.ts` will catch that if it ever changes.

## Known Issues (pre-existing, out of scope)

- `apps/api/src/lib/bot-arbitrator.test.ts:136` — pre-existing `TS2532` strict-mode array-index issue from Phase 10 (documented in Plan 01/03/04's summaries and `deferred-items.md`). Unrelated to this plan's changes.
- 7 `apps/api` test files fail with "Missing or invalid environment variables" (no `.env` in this worktree) — pre-existing, unrelated to this plan.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The conditional START edge — flagged in STATE.md as the single highest-risk topology change of v3.0 — is now proven: all four `routeFromStart` outcomes (facilitation, analysis, orchestrator-fallback, unrecognized-trigger) are covered by green graph-level tests using `MemorySaver` + mock adapters, matching this codebase's established graph-level-only testing convention (Pattern 3).
- Plans 06/07 (and Phase 12+) can now invoke the graph with `triggerType: 'silence_gate'` or `'analysis_request'` in the initial state to exercise the proactive bot paths — the caller is responsible for setting `config.configurable.branchId` (required by `argGraphBuilderNode`) and a `streamWriter` closure (required by `facilitationAgentNode`/`analyticsAgentNode` for text delivery, per D-16 — neither node writes to the DB directly).
- Open item for a downstream plan (unchanged from Plan 03's note): `ProviderMessage` still carries no message `id` field, so `ArgNode.message_id` depends entirely on the model's self-reported value in production — the real invocation path that builds `state.messages` for a proactive fire (Plan 06's silence-scan loop) will need to decide how real message identity reaches the extraction/analysis prompts.
- No blockers for downstream plans in this wave.

---
*Phase: 11-personality-basic-triggers*
*Completed: 2026-07-14*
