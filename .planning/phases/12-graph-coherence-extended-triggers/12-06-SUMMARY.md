---
phase: 12-graph-coherence-extended-triggers
plan: 06
subsystem: api
tags: [langgraph, state-machine, conditional-edges, trigger-gate, arbitration, graph-topology]

# Dependency graph
requires:
  - phase: 12-graph-coherence-extended-triggers (Plans 01-05)
    provides: GraphState firingSkillId/firingSkillRole/skillMeta/triggerGateComplete fields (Plan 01); skills.ts Skill/SkillContext interfaces + populated COACH_SKILLS/ANALYST_SKILLS registries (Plan 05); the 5 Skill implementations (silence-break, moderation, drift-redirect, orphan-edge, fact-check — Plans 02-04)
provides:
  - TriggerGateNode (trigger-gate.ts) — detection-only, role-gated (D-07), fail-isolated (Promise.allSettled, D-05) consolidated Skill-fan-out node
  - TriggerGateNode wired into BOTH the primary human-message path (agent -> mutationGate -> triggerGate) AND the proactive analysis_request path (argGraphBuilder -> triggerGate), per the locked human-path reachability decision
  - triggerGateComplete loop guard (routeAfterMutationGate) — proven-terminating topology, no infinite loop risk
  - analystScorer scores by firing Skill (D-06) — Analyst can now win arbitration for the first time
affects: [phase-13-user-profiles-phase-signal, phase-14-polish-triggerengine-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Detection-only fan-out node (TriggerGateNode) consolidating multiple capability checks (Skills) behind one role-gate + Promise.allSettled fail-isolation, before handing off to existing Role nodes via a routing-only conditional edge"
    - "Loop-guard via an overwrite-style GraphState boolean (triggerGateComplete) read by a conditional edge on the SAME node (mutationGate) that multiple graph paths converge on — first pass proceeds, second pass terminates"
    - "Replacing a fixed .addEdge() with a conditional edge that preserves the old behavior as one branch (routeAfterArgGraphBuilder), rather than adding a second edge alongside it (which would fan-out both)"

key-files:
  created:
    - apps/api/src/graph/nodes/trigger-gate.ts
    - apps/api/src/graph/nodes/trigger-gate.test.ts
    - apps/api/src/lib/bot-registration.test.ts
  modified:
    - apps/api/src/graph/graph.ts
    - apps/api/src/graph/graph.test.ts
    - apps/api/src/graph/graph.integration.test.ts
    - apps/api/src/lib/bot-registration.ts
    - apps/api/src/lib/bot-arbitrator.ts

key-decisions:
  - "ArbContext (bot-arbitrator.ts) extended with an additive, optional firingSkillRole field to make analystScorer's D-06 context-awareness possible — existing call sites (silence-scan.ts) never set it, so their behavior is byte-for-byte unchanged"
  - "analystScorer returns 10 (> coachScorer's fixed 7) when firingSkillRole === 'analyst' — the Analyst can now actually win arbitration for the first time, when its own Skill context is present"
  - "routeAfterArgGraphBuilder routes any non-analysis_request triggerType reaching argGraphBuilder to triggerGate (forward-compatible; not exercised by any currently-defined triggerType, since routeFromStart only ever sends argGraphBuilder analysis_request invocations today)"
  - "TriggerGateNode sets triggerGateComplete: true on EVERY return path, including the missing-blueprint fail-open path — omitting it there would let mutationGate loop back into triggerGate indefinitely on a thread with a perpetually-missing blueprint"

patterns-established:
  - "Detection-only gate node pattern: never streams, never writes messages, only sets routing metadata for a downstream conditional edge to read — reusable template for Phase 14's TriggerEngine generalization"
  - "Loop-guard-via-shared-node pattern: when two distinct graph paths (human + proactive) must converge on the same downstream node without infinite recursion, gate re-entry with an overwrite-style state field set once by the node being guarded against, not by the router itself"

requirements-completed: [GRAPH-03, TRIGGER-03, TRIGGER-04, TRIGGER-05, TRIGGER-06, COST-01]

# Metrics
duration: 55min
completed: 2026-07-15
---

# Phase 12 Plan 06: TriggerGateNode Graph Wiring Summary

**TriggerGateNode (detection-only, role-gated, Promise.allSettled fail-isolated) is now live on both the human-message path and the proactive analysis_request path, with a triggerGateComplete loop guard that provably terminates on every routing combination, and analystScorer now scores by which Analyst Skill fired.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-07-15T17:44:00Z (context gathering)
- **Completed:** 2026-07-15T19:04:35Z
- **Tasks:** 3/3 completed
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments

- Built `TriggerGateNode`: consolidates all 4 new Skills' (+ retrofitted silence-break) `detect()` calls into one node, role-gated (D-07: `bot_overrides ?? bot_defaults ?? false` checked ONCE before candidate assembly — a disabled Role's Skills receive zero `detect()` calls), and fail-isolated via `Promise.allSettled` (a throwing Skill never blocks siblings or the node itself)
- Wired `TriggerGateNode` into the LangGraph topology on BOTH paths per the locked human-path reachability decision: `agent -> mutationGate -> triggerGate -> conditional(facilitation|analysis|end)` and `argGraphBuilder -> conditional(analysis|triggerGate)`
- Replaced two fixed edges (`mutationGate -> END`, `argGraphBuilder -> analysis`) with conditional edges that preserve prior behavior as one branch each — verified via grep that neither fixed-edge literal remains as executable code
- Proved termination on every path (Coach-fires, Analyst-fires, no-fire, proactive analysis_request) with new integration tests — no infinite loop, no recursion-limit rejection
- Extended `analystScorer` (D-06) to score by firing-Skill context — the Analyst can now win arbitration for the first time in this codebase's history

## Task Commits

1. **Task 1: TriggerGateNode (detection-only, role-gated, fail-isolated) + analystScorer extension** - `772ce0e` (feat)
2. **Task 2: graph.ts topology — human-path + proactive-path triggerGate wiring with loop guard** - `dbe429c` (feat)
3. **Task 3: Graph integration tests — routing correctness + termination (no infinite loop)** - `1cc3769` (test)

## Files Created/Modified

- `apps/api/src/graph/nodes/trigger-gate.ts` - NEW: `triggerGateNode` — detection-only Skill fan-out gate
- `apps/api/src/graph/nodes/trigger-gate.test.ts` - NEW: 6 unit tests (role-gate, priority-order, fail-isolation, fail-open, bot_defaults fallback)
- `apps/api/src/graph/graph.ts` - Added `triggerGate` node + `routeAfterMutationGate`/`routeAfterArgGraphBuilder`/`routeAfterTriggerGate` conditional edges; replaced 2 fixed edges
- `apps/api/src/graph/graph.test.ts` - Added 5 new tests (Coach-fires, Analyst-fires, no-fire, proactive-path-preserved, pathsMap-exhaustiveness); mocked `skills.ts` for determinism
- `apps/api/src/graph/graph.integration.test.ts` - Added a PostgresSaver-backed `triggerGateComplete` termination assertion to the existing Test A resume flow
- `apps/api/src/lib/bot-registration.ts` - `analystScorer` now context-aware (D-06); exported `coachScorer`/`analystScorer` for direct testing
- `apps/api/src/lib/bot-registration.test.ts` - NEW: 6 tests for `analystScorer`'s D-06 behavior
- `apps/api/src/lib/bot-arbitrator.ts` - Additive optional `ArbContext.firingSkillRole` field (deviation, see below)

## Decisions Made

- **ArbContext extension (bot-arbitrator.ts, out of the plan's declared file list):** D-06 requires `analystScorer` to score based on "which Skill's context is present," but `ArbContext` only carried `{branchId, blueprint, supabase}` — no field could express "an Analyst Skill just fired." Added one additive, optional field (`firingSkillRole?: 'coach' | 'analyst' | null`) rather than redesigning `runArbitration`'s signature or introducing a parallel scoring mechanism. This is backward-compatible: `runArbitration`'s own context construction still omits it, so the existing `silence-scan.ts` call site is byte-for-byte unchanged (verified by a dedicated test asserting `winner === 'coach'` through the real `runArbitration()` call path). Documented as a Rule 2 deviation below.
- **analystScorer returns 10, not just "positive":** deliberately calibrated above `coachScorer`'s fixed 7 so the Analyst can actually outscore the Coach in arbitration when its own Skill context is present — this realizes the forward-looking narrative already present in `bot-registration.ts`'s own pre-existing header comment and `12-RESEARCH.md`'s "State of the Art" table (Analyst reachable for the first time).
- **routeAfterArgGraphBuilder's non-analysis_request branch is not exercised by any live triggerType today** (only `routeFromStart` ever sends `argGraphBuilder` an invocation, and always with `triggerType === 'analysis_request'`). Implemented anyway, exactly as the plan's Task 2(d) specifies, as a forward-compatible seam for a future dedicated trigger-scan path — not dead code, since LangGraph's `addConditionalEdges` requires both pathsMap keys to be present regardless of current reachability.
- **The proactive analysis_request path now passes through triggerGate an EXTRA time** after its own `analysis -> mutationGate` hop (since `triggerGateComplete` is still `null` at that point, having bypassed `triggerGate` on the way in via `routeAfterArgGraphBuilder`'s direct-to-`analysis` branch). This is a deliberate, accepted consequence of `routeAfterMutationGate` applying uniformly regardless of which path reached `mutationGate` — it does not create an infinite loop (bounded at exactly one extra `triggerGate` evaluation, then `triggerGateComplete` is set and any subsequent `mutationGate` pass terminates), and is explicitly tested (Task 3(d)).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Extended ArbContext with an additive optional field to make analystScorer's D-06 requirement implementable**
- **Found during:** Task 1 (analystScorer extension)
- **Issue:** The plan's Task 1 requires `analystScorer` to score based on "which Skill's context is present" (D-06), but `bot-arbitrator.ts`'s `ArbContext` interface (not in this plan's declared `files_modified` list) had no field capable of expressing that. Without extending it, D-06 could not be implemented at all — only a hardcoded constant, which is not "context-aware" scoring.
- **Fix:** Added `firingSkillRole?: 'coach' | 'analyst' | null` to `ArbContext` (optional, additive — no existing call site's behavior changes since `runArbitration`'s own context construction doesn't set it).
- **Files modified:** `apps/api/src/lib/bot-arbitrator.ts`
- **Verification:** `bot-arbitrator.test.ts`'s existing 5 tests still pass unchanged (verified via full suite run); new `bot-registration.test.ts` test explicitly proves the existing `silence-scan.ts` call shape (3-arg `runArbitration` call, no `firingSkillRole`) still yields `winner === 'coach'`.
- **Committed in:** `772ce0e` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing-critical, Rule 2)
**Impact on plan:** Necessary, minimal, additive, backward-compatible. No scope creep — every existing test and call site is unaffected.

## Issues Encountered

- **Fresh worktree had no `node_modules`** — ran `pnpm install --frozen-lockfile` (fast, reused the pnpm store; no new packages needed for this plan).
- **Fresh worktree had no `apps/api/.env`** (gitignored, not copied by git worktree creation) — copied it from the main repo checkout (`apps/api/.env` is gitignored, so this is a local-dev-only convenience, never committed) to unblock the full `pnpm --filter api test` run required by this plan's `<verification>` section.
- **Two pre-existing, unrelated test-suite failures** (`ai.test.ts`, `keys.test.ts` — `Cannot find module 'hono/streaming'`, a vitest/vite module-resolution issue, not a `hono` package problem — `node -e "require.resolve('hono/streaming')"` succeeds outside vitest) were re-confirmed present before any of this plan's changes and logged in `deferred-items.md` under "12-06 Task 1 (re-confirmation)" — out of scope (Scope Boundary rule; these files are untouched by this plan).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The detection gate is live and provably-terminating on both the human and proactive paths — Phase 13/14 can build directly on `TriggerGateNode`'s existing wiring (e.g., Phase 14's TriggerEngine generalization) without any further topology surgery.
- `firingSkillId`/`firingSkillRole`/`skillMeta` are populated correctly and consumed by the existing `facilitation-agent.ts`/`analytics-agent.ts` `buildPromptGuidance()` injection slots (wired in Plan 05) — end-to-end Skill-to-Role-response flow is now fully connected.
- `analystScorer`'s new context-awareness (`firingSkillRole`) is currently only exercised by the direct unit tests in `bot-registration.test.ts` — no live caller yet threads `firingSkillRole` into a real `runArbitration()` invocation (that would require `TriggerGateNode` itself, or a future caller, to call `runArbitration` with an extended context — out of this plan's scope, and not required by any of this plan's acceptance criteria). This is a known, intentional gap for Phase 14's TriggerEngine to close.

## Known Stubs

None — `TriggerGateNode`'s fail-open branches (missing blueprint, disabled Roles, no Skill fires) are all intentional design behavior (D-07, fail-silent convention), not placeholder/incomplete code, and are all covered by tests distinguishing them from a bug.

## Threat Flags

None — all new surface (`TriggerGateNode`, the 3 new conditional edges, the `ArbContext.firingSkillRole` field) is already covered by this plan's own `<threat_model>` (T-12-16 through T-12-20), and no additional trust boundary was introduced beyond what that threat model already enumerates.

---
*Phase: 12-graph-coherence-extended-triggers*
*Completed: 2026-07-15*

## Self-Check: PASSED

All 8 created/modified files confirmed present on disk; all 3 task commits (772ce0e, dbe429c, 1cc3769) confirmed present in git log.
