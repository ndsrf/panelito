---
phase: 12-graph-coherence-extended-triggers
plan: 05
subsystem: api
tags: [langgraph, skills, prompt-composition, trigger-gate, coach, analyst]

# Dependency graph
requires:
  - phase: 12-graph-coherence-extended-triggers (Plan 01)
    provides: Skill/SkillContext interfaces, empty COACH_SKILLS/ANALYST_SKILLS registries, firingSkillId/firingSkillRole/skillMeta GraphState fields
  - phase: 12-graph-coherence-extended-triggers (Plan 03)
    provides: silenceBreakSkill, driftRedirectSkill, moderationSkill (Coach Skills)
  - phase: 12-graph-coherence-extended-triggers (Plan 04)
    provides: orphanEdgeSkill, factCheckSkill (Analyst Skills)
provides:
  - Populated COACH_SKILLS = [silenceBreakSkill, moderationSkill, driftRedirectSkill] and ANALYST_SKILLS = [factCheckSkill, orphanEdgeSkill] registries (priority order)
  - FacilitationAgentNode (Coach) buildPromptGuidance injection slot, spliced after argGraph context and before Personality voice
  - AnalyticsAgentNode (Analyst) buildPromptGuidance injection slot, same D-03 slot
  - Live factCheckFraming activation when state.firingSkillId === 'fact-check'
affects: [12-06-trigger-gate-node, 13-user-profiles-phase-signal, 14-trigger-engine-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Skill-guidance injection slot: COACH_SKILLS/ANALYST_SKILLS.find(s => s.id === state.firingSkillId) in the Role node, guidance spliced as an 'Active trigger guidance' labeled section AFTER argGraph context and BEFORE Personality voice (D-03 fixed order, never overrides the Role behavioral contract)"
    - "Live seam activation: boolean flags that were config.configurable-only in Phase 11 (factCheckFraming) now also derive from state.firingSkillId, preserving the original seam as a fallback"

key-files:
  created: []
  modified:
    - apps/api/src/lib/skills.ts
    - apps/api/src/graph/nodes/facilitation-agent.ts
    - apps/api/src/graph/nodes/facilitation-agent.test.ts
    - apps/api/src/graph/nodes/analytics-agent.ts
    - apps/api/src/graph/nodes/analytics-agent.test.ts

key-decisions:
  - "Skill-guidance splice position for BOTH Role nodes follows 12-PATTERNS.md's explicit generic guidance (lines 315-333): a new step 3.5, positioned AFTER argGraph context (step 3) and BEFORE Personality voice (step 4) — identical slot/labeling ('Active trigger guidance:') in facilitation-agent.ts and analytics-agent.ts, rather than task 3's more ambiguous 'same slot as factCheckFraming' phrasing (which would have put Analyst Skill guidance inside step 1). This keeps both Role nodes structurally symmetric and matches the threat model's own wording (T-12-13: 'spliced AFTER Role rules and BEFORE Personality')."
  - "factCheckFraming's existing step-1 conditional block (uncertainty-only language) is left untouched — a firing fact-check Skill both (a) sets factCheckFraming=true live (activating that step-1 block) AND (b) gets its own buildPromptGuidance() output spliced into the new step 3.5 slot (citing the specific claim). Both effects are independently correct and non-conflicting."
  - "buildCoachSystemPrompt/buildAnalyticsSystemPrompt gained an optional trailing skillGuidance param (undefined-safe) so all existing call sites and tests without the new argument are byte-identical to pre-change output — verified with an explicit regression test comparing 3-arg vs 4-arg(undefined) output."

patterns-established:
  - "Skill-guidance injection slot (step 3.5): apply this exact pattern to any future Role node gaining Skill support."

requirements-completed: [TRIGGER-03, TRIGGER-04, TRIGGER-05, TRIGGER-06]

# Metrics
duration: 25min
completed: 2026-07-15
---

# Phase 12 Plan 05: Skill Registries + Role Node Injection Slots Summary

**Populated COACH_SKILLS/ANALYST_SKILLS registries and wired both Role nodes (FacilitationAgentNode, AnalyticsAgentNode) to splice a firing Skill's buildPromptGuidance() output into a new D-03-compliant prompt slot, with fact-check's factCheckFraming now activating live.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-15T17:08:00Z (worktree setup)
- **Completed:** 2026-07-15T17:16:18Z
- **Tasks:** 3 completed (1 auto, 2 TDD)
- **Files modified:** 5

## Accomplishments
- `COACH_SKILLS` and `ANALYST_SKILLS` are populated in priority order (D-02 roster), unblocking TriggerGateNode (Plan 06)
- Both Role nodes (Coach, Analyst) now read `state.firingSkillId`, look up the matching registered Skill, and splice its `buildPromptGuidance()` output into the system prompt in the exact D-03 slot (after argGraph context, before Personality voice) — Role contract structurally dominant, never overridden
- `factCheckFraming` is live: a firing `fact-check` Skill activates the existing uncertainty-framing block without requiring a separate `config.configurable.factCheckFraming` set, realizing the Phase 11 "a future trigger (Phase 12) sets it" seam
- Non-firing turns produce byte-identical prompts to pre-change behavior, verified by explicit regression tests in both node test suites

## Task Commits

Each task was committed atomically:

1. **Task 1: Populate COACH_SKILLS / ANALYST_SKILLS registries in priority order** - `6ccc4a2` (feat)
2. **Task 2: FacilitationAgentNode (Coach) Skill-guidance injection slot** - `5381362` (test, RED) + `638d6e5` (feat, GREEN)
3. **Task 3: AnalyticsAgentNode (Analyst) injection slot + live factCheckFraming** - `d2256a0` (test, RED) + `218dc6c` (feat, GREEN)

**Plan metadata:** (this commit, see below)

_Note: Tasks 2 and 3 are TDD tasks with RED (failing test) commits followed by GREEN (implementation) commits._

## Files Created/Modified
- `apps/api/src/lib/skills.ts` - Imports all five Skill objects; `COACH_SKILLS = [silenceBreakSkill, moderationSkill, driftRedirectSkill]`, `ANALYST_SKILLS = [factCheckSkill, orphanEdgeSkill]`
- `apps/api/src/graph/nodes/facilitation-agent.ts` - `buildCoachSystemPrompt` gains optional `skillGuidance` param spliced as step 3.5; node looks up `COACH_SKILLS.find(s => s.id === state.firingSkillId)` and calls `buildPromptGuidance({ state, blueprint, config })`
- `apps/api/src/graph/nodes/facilitation-agent.test.ts` - 6 new tests: splice-position assertions (unit + integration), regression (undefined guidance = byte-identical), non-firing / non-Coach-Skill firingSkillId leaves prompt unchanged
- `apps/api/src/graph/nodes/analytics-agent.ts` - `buildAnalyticsSystemPrompt` gains optional `skillGuidance` param spliced as step 3.5; `factCheckFraming` derivation extended with `|| state.firingSkillId === 'fact-check'`; node looks up `ANALYST_SKILLS.find(s => s.id === state.firingSkillId)`
- `apps/api/src/graph/nodes/analytics-agent.test.ts` - 6 new tests: splice-position assertion, regression, live factCheckFraming activation, orphan-edge guidance splice, non-firing turn unchanged, existing `config.configurable.factCheckFraming` seam still honored independently

## Decisions Made
- Skill-guidance splice position for both Role nodes follows 12-PATTERNS.md's explicit generic instruction (a new step 3.5 after argGraph, before Personality) rather than Task 3's more ambiguous "same slot as factCheckFraming" phrasing — see `key-decisions` in frontmatter for full rationale. This keeps facilitation-agent.ts and analytics-agent.ts structurally symmetric and matches the threat model's T-12-13 wording verbatim.
- factCheckFraming's step-1 conditional block is untouched; a firing fact-check Skill gets both effects (uncertainty framing activation + its own citation guidance in step 3.5) since they serve different, non-conflicting purposes.

## Deviations from Plan

None - plan executed exactly as written, with one interpretive clarification (splice position for Analyst Skill guidance) resolved in favor of the more specific/authoritative 12-PATTERNS.md guidance and the threat model's own wording over Task 3's looser prose — documented above under Decisions Made, not a functional deviation (acceptance criteria for Task 3 did not mandate a specific slot beyond "the correct slot").

## Issues Encountered
- Worktree had no `node_modules` installed; ran `pnpm install` at the workspace root before any typecheck/test could execute (standard worktree setup step, not a plan deviation).
- Full-suite `vitest run` shows 6 pre-existing failures (`silence-scan.test.ts` x5, `blueprint-loader.test.ts` integration test) and 4 route test files that fail entirely on missing `.env`/live Supabase connection (`ai.test.ts`, `branches.test.ts`, `keys.test.ts`, `messages.test.ts`, `sessions.test.ts`) — all confirmed pre-existing/environment-only via `.planning/phases/12-graph-coherence-extended-triggers/deferred-items.md` (already logged by prior Plan 01/04 executors and Wave 1's post-merge gate) and independent reproduction (`branches.test.ts` throws `Missing or invalid environment variables` from `src/lib/env.ts`, unrelated to this plan's files). Not fixed per SCOPE BOUNDARY.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `COACH_SKILLS`/`ANALYST_SKILLS` registries and both Role nodes' injection slots are ready for Plan 06's `TriggerGateNode`, which will set `state.firingSkillId`/`firingSkillRole`/`skillMeta` before routing into the Role nodes built here.
- No blockers. `pnpm --filter api exec tsc --noEmit` is clean; `pnpm --filter api test -- skills facilitation-agent analytics-agent` (83 tests across 7 files) all pass.

---
*Phase: 12-graph-coherence-extended-triggers*
*Completed: 2026-07-15*
