---
phase: quick-260719-e9x
plan: 01
subsystem: observability
tags: [langfuse, tracing, ai-invoke, trigger-engine, trigger-gate, byok, skills]

# Dependency graph
requires:
  - phase: quick-260719-dr9
    provides: Langfuse sessionId attribution on CallbackHandler (both reactive and proactive paths)
provides:
  - Confirmed, file:line-cited root cause for why untagged (and unreacted) human messages
    produce zero Langfuse trace activity — corrected mid-execution from an observability gap
    to an evaluation gap (moderation/fact-check Skills never run at all for those messages,
    not merely untraced)
  - User-resolved decision on the "how to fix" checkpoint: refined reactive-eval (evaluate +
    trace every message via the existing cheap-tier heuristic gate), escalated to a planned
    phase per this quick task's own scope constraints
  - A "Handoff to planned phase" section in ROOT-CAUSE.md with concrete shape-of-change,
    existing cost-safety infrastructure to reuse, and explicit open questions for
    /gsd:plan-phase to resolve
affects: [ai-invoke-route, trigger-engine, trigger-gate, langfuse-observability, skills]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/quick/260719-e9x-investigate-why-non-tagged-agent-message/260719-e9x-ROOT-CAUSE.md
  modified: []

key-decisions:
  - "Root cause CORRECTED: moderation and fact-check Skills are never evaluated at all for untagged/unreacted messages (not merely untraced) — TriggerGateNode, which consolidates all Skill detect() calls, is unreachable without a full graph invocation, and the graph is invoked reactively in exactly two frontend-gated places (@analista tag match, power-reaction emoji) — confirmed exhaustive via a full codebase grep of createGraph/graph.invoke/graph.stream/ /invoke callers, with no DB webhook path found."
  - "USER DECISION on Task 2's checkpoint: refined reactive-eval — evaluate AND emit a Langfuse entry for every message, even when heuristics fire on nothing. This is cheaper than the original reactive-eval framing because the zero-cost tier-1 heuristics (checkModerationHeuristic, looksLikeCheckableClaim) already exist and already gate the expensive LLM tiers — the missing piece is a per-message invocation path reaching TriggerGateNode for every message, not a new evaluator."
  - "Per the plan's own success criteria, implementation of the refined reactive-eval is explicitly deferred to a dedicated planned phase — NOT implemented in this quick task. ROOT-CAUSE.md Section 7.5 is the handoff artifact for that phase's planning."

patterns-established: []

requirements-completed: [DIAG-E9X]

# Metrics
duration: ~45min (Task 1 + correction pass; Task 2 decision resolved by user, implementation deferred)
completed: 2026-07-19
---

# Quick Task 260719-e9x Plan 01: Root-Cause Investigation Summary

**Confirmed via live-code re-verification (twice — an initial pass and a corrected pass) that untagged/unreacted messages not only produce no Langfuse trace but never reach TriggerGateNode at all, meaning moderation and fact-check Skills are never evaluated for them; user resolved the Task 2 decision checkpoint as a refined, cheaper "evaluate + trace every message" reactive-eval, with implementation explicitly deferred to a planned phase.**

## Performance

- **Duration:** ~45 min total (Task 1 initial investigation + a correction pass after
  additional orchestrator/user investigation surfaced a more precise finding)
- **Completed:** 2026-07-19T10:34:46+02:00 (final ROOT-CAUSE.md commit)
- **Tasks:** 2 of 2 — Task 1 (root-cause confirmation) complete; Task 2
  (`checkpoint:decision`) resolved by the user as "refined reactive-eval," with actual
  implementation deliberately deferred to a future planned phase per the plan's own scope
  constraint
- **Files modified:** 1 created (amended once with a correction)

## Status: QUICK TASK COMPLETE (decision made; implementation deferred to a planned phase)

Both tasks in the plan are now resolved. Task 1's findings document was corrected mid-flow
after further investigation (by the orchestrator/user) sharpened the root cause. Task 2's
decision checkpoint has been answered by the user. No behavior-changing code was written in
this quick task — per the plan's `reactive-eval` framing, that work is explicitly escalated
to a dedicated planned phase, for which ROOT-CAUSE.md Section 7.5 is a ready-to-consume
handoff.

## Accomplishments

- Re-opened and re-verified every code location cited in the plan's `<interfaces>` block
  against the live codebase — all citations confirmed accurate.
- Confirmed the reactive gate: `workspace.tsx:60` (`ANALISTA_PATTERN`), `workspace.tsx:264-273`
  (`handleAfterSend`) only calls `openAIStream` (→ POST `/invoke`) when the regex matches;
  untagged content only triggers `refreshMessages()`.
- Discovered and documented the power-reaction reactive path (🔥📌🎯 via `use-reactions.ts` /
  `apps/api/src/routes/reactions.ts:104`), not in the original planning brief.
- Confirmed `ai.ts:65/378/411` and `graph.ts:113-134` (`routeFromStart`): once `/invoke` runs,
  the graph proceeds unconditionally to a response — there is no silent-evaluation branch.
- Confirmed `trigger-engine.ts::scanBranch()` early-returns at four gates (`:271`, `:275-278`,
  `:282`, and a fourth — the budget guard at `:284-291`, not previously cited — before any
  `CallbackHandler` exists, so every "evaluated, declined" proactive tick is silent.
- **Correction pass:** confirmed `apps/api/src/graph/nodes/trigger-gate.ts` consolidates ALL
  Skill `detect()` calls (moderation, fact-check, phase-readiness, orphan-edge,
  silence-break) into one node, reached on the human-message path via
  `agent → mutationGate → argGraphBuilder → profileBuilder → triggerGate` (confirmed against
  `graph.ts`'s actual edge wiring, lines 220-293).
- Confirmed `apps/api/src/lib/skills/moderation.ts::checkModerationHeuristic` and
  `apps/api/src/lib/skills/fact-check.ts::looksLikeCheckableClaim` are pure, zero-I/O,
  zero-adapter-call tier-1 heuristics that already gate every paid LLM tier — this cost-safety
  infrastructure already exists and does not need to be rebuilt.
- Re-grepped the entire codebase for every `createGraph`/`graph.invoke`/`graph.stream`/
  `/invoke` call site (both `apps/api` and `apps/web`) and confirmed exactly two reactive
  graph-invocation entry points exist, with no Supabase DB webhook or other server-side path.
  This upgraded the finding from "untraced" to "never evaluated" — a stronger, corrected
  conclusion.
- Recorded the user's resolved decision on Task 2's checkpoint (refined `reactive-eval`) and
  added a "Handoff to planned phase" section (ROOT-CAUSE.md Section 7.5) with the shape of the
  change, existing cost-safety infrastructure to reuse, and four explicit open questions
  (inline vs. async, endpoint/transport shape, frontend wiring, trace-volume sizing) for a
  future `/gsd:plan-phase` to resolve.
- No application code was modified — this task's deliverable is entirely the findings
  document, per plan constraint.

## Task Commits

Each task was committed atomically:

1. **Task 1: Confirm root cause in code and write ROOT-CAUSE.md** - `7b3f2d3` (docs)
2. **Task 1 correction: correct root cause to evaluation gap + record user decision** - `2fdd5f2` (docs)

**Task 2 (`checkpoint:decision`):** Resolved by user selection (refined `reactive-eval`); no
separate commit — the decision and its rationale are recorded in `2fdd5f2` (ROOT-CAUSE.md
Sections 7.4-7.5).

_Plan metadata commit (STATE.md/SUMMARY.md) is handled by the orchestrator, not this executor,
per task constraints._

## Files Created/Modified

- `.planning/quick/260719-e9x-investigate-why-non-tagged-agent-message/260719-e9x-ROOT-CAUSE.md` - Confirmed root-cause writeup (four reactive/proactive invocation paths with file:line citations), a corrected Section 7 establishing this is an evaluation gap (not just a tracing gap) for moderation/fact-check Skills, the user's resolved decision, and a planned-phase handoff section.

## Decisions Made

- Re-verification (not blind trust of prior citations) surfaced the power-reaction reactive
  path and the budget-guard early-return during the initial pass, and — during the correction
  pass — the stronger "TriggerGateNode is unreachable, so Skills never run" finding, confirmed
  exhaustive via a full-codebase grep for every graph-invocation call site.
- **User decision (resolves Task 2):** evaluate AND trace every message, even when nothing
  fires — a refined, cheaper version of the plan's original `reactive-eval` option, since the
  zero-cost heuristic tiers already exist. Per the plan's own scope constraint, actual
  implementation (new reactive invocation path reaching TriggerGateNode for every message,
  plus a per-request Langfuse CallbackHandler on that path) is explicitly deferred to a
  dedicated planned phase — not built in this quick task.

## Deviations from Plan

### Auto-fixed Issues

None — no code was changed, so no Rule 1-3 auto-fixes applied.

### Content Correction (not a deviation rule — a mid-flight finding correction, requested by the orchestrator/user)

**1. Corrected root-cause finding: evaluation gap, not just tracing gap**
- **Found during:** Post-Task-1-checkpoint, before Task 2 was resolved
- **Issue:** The original ROOT-CAUSE.md (commit `7b3f2d3`) correctly explained why nothing
  traces for untagged messages, but framed it purely as an observability/tracing gap. Further
  investigation (by the orchestrator/user, then re-verified by this executor) established
  that moderation and fact-check Skills are never *evaluated* at all for untagged/unreacted
  messages — a stronger, more precise finding — because `TriggerGateNode` (which runs all
  Skill `detect()` calls) is unreachable without a full graph invocation, and the graph is
  reactively invoked in exactly two gated places.
- **Fix:** Added ROOT-CAUSE.md Section 7 ("Correction: moderation/fact-check evaluation is
  also gated, not just tracing") re-verifying all new citations (`trigger-gate.ts`,
  `graph.ts` edge wiring, `moderation.ts`, `fact-check.ts`) against live code, plus a
  full-codebase grep confirming exactly two reactive graph-invocation entry points exist. Also
  corrected a misattributed quote in the incoming correction request (the "Five of the six
  trigger types..." sentence is `trigger-engine.ts`'s header comment, not
  `trigger-gate.ts`'s — noted explicitly in Section 7.1 so the citation trail stays accurate).
  Recorded the user's resulting decision and added a planned-phase handoff section.
- **Files modified:** `260719-e9x-ROOT-CAUSE.md`
- **Verification:** All new citations (`trigger-gate.ts:1-12`, `graph.ts:220-293`,
  `moderation.ts:70`, `fact-check.ts:59/93/143`) re-opened and confirmed line-for-line;
  full-codebase grep for `createGraph`/`graph.invoke`/`graph.stream`/`/invoke` callers
  confirmed exhaustive (exactly two entry points, no DB webhook path).
- **Committed in:** `2fdd5f2`

---

**Total deviations:** 0 auto-fixed (no code changed); 1 content correction to the findings
document itself, requested and directed by the orchestrator/user mid-execution.
**Impact on plan:** No scope creep — the correction sharpens the same findings-only
deliverable the plan specified; still no application code touched.

## Issues Encountered

None beyond the finding-correction described above, which was itself the intended purpose of
this second pass (get the root cause exactly right before any implementation decision is
locked in).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ROOT-CAUSE.md is complete, corrected, committed, and contains a ready-to-consume "Handoff to
  planned phase" section (Section 7.5) for the refined `reactive-eval` the user selected.
- A future `/gsd:plan-phase` should scope: a new reactive invocation path reaching
  `TriggerGateNode` for every human message (independent of the `@analista`/power-reaction
  gate), a per-request Langfuse `CallbackHandler` on that path even when no Skill fires, and
  resolution of the four open questions in Section 7.5 (inline-blocking vs. async,
  endpoint/transport shape, frontend wiring location, and Langfuse trace-volume sizing against
  the user's plan tier).
- This quick task is complete — no further action needed here. The `accept` and
  `proactive-trace` options from the original Task 2 framing were not selected and require no
  follow-up.

---
*Phase: quick-260719-e9x*
*Completed: 2026-07-19*
