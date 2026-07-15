---
phase: 12-graph-coherence-extended-triggers
plan: 01
subsystem: api
tags: [zod, langgraph, typescript, skills, blueprint, langgraph-state]

# Dependency graph
requires:
  - phase: 11-personality-basic-triggers
    provides: Role/Personality split (Coach/Analyst nodes), GraphState overwrite-reducer idiom, TriggerMetadata
provides:
  - SkillDetectionResultSchema + SkillDetectionResult type (@panelito/types)
  - factCheckClassificationTool ProviderTool (tier-2 fact-check classifier contract)
  - Blueprint.drift_detection_enabled boolean field (default true)
  - GraphState fields firingSkillId/firingSkillRole/skillMeta/triggerGateComplete
  - Skill/SkillContext interfaces + empty COACH_SKILLS/ANALYST_SKILLS registries (apps/api/src/lib/skills.ts)
affects: [12-02, 12-03, 12-04, 12-05, 12-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Co-located Zod schema + inferred type (packages/types/src/skill.ts, mirrors TriggerMetadataEntrySchema)"
    - "Skill capability abstraction: plain TS interface (not Zod) for async-method contracts, mirrors AIProvider"
    - "Additive optional-with-default Blueprint field (drift_detection_enabled mirrors drift_reply_probability precedent)"
    - "GraphState overwrite-reducer idiom (reducer: (_, v) => v, default: () => null) applied to 4 new fields"

key-files:
  created:
    - packages/types/src/skill.ts
    - packages/types/src/fact-check-tool.ts
    - packages/types/src/skill.test.ts
    - apps/api/src/lib/skills.ts
    - .planning/phases/12-graph-coherence-extended-triggers/deferred-items.md
  modified:
    - packages/types/src/blueprint.ts
    - packages/types/src/index.ts
    - apps/api/src/graph/state.ts
    - apps/api/src/graph/graph.integration.test.ts
    - apps/api/src/graph/graph.test.ts
    - apps/api/src/graph/nodes/analytics-agent.test.ts
    - apps/api/src/graph/nodes/arg-graph-builder.test.ts
    - apps/api/src/graph/nodes/facilitation-agent.test.ts
    - apps/api/src/lib/bot-arbitrator.test.ts
    - apps/api/src/lib/silence-scan.test.ts
    - apps/api/src/routes/ai.test.ts

key-decisions:
  - "drift_detection_enabled placed directly adjacent to drift_reply_probability in blueprint.ts (same semantic cluster), per plan instruction"
  - "Skill/SkillContext kept as plain TypeScript interfaces (not Zod) — only Skill.detect()'s return value (SkillDetectionResult) is Zod-validated, mirroring how AIProvider stays a plain interface"
  - "COACH_SKILLS/ANALYST_SKILLS are fixed exported arrays, not a mutable Map registry — Skills assembled once per Role (D-02), no dynamic (de)registration needed"
  - "Existing test fixtures (8 files) updated with drift_detection_enabled: true and the 4 new GraphState fields — required for tsc --noEmit to stay clean after the new required schema/state fields; not a scope expansion, a direct consequence of Task 1/2's additive-but-required TypeScript changes"

patterns-established:
  - "SkillDetectionResult is the single shared validation gate for all Skill detect() outputs (T-12-02 threat mitigation) — confidence bounded [0,1] via Zod"
  - "Skill interface: { id, role, detect(context) -> Promise<SkillDetectionResult>, buildPromptGuidance(context) -> string }, SkillContext carries { state, blueprint, config } test-injection seam"

requirements-completed: [TRIGGER-03, TRIGGER-05, GRAPH-03, COST-02]

# Metrics
duration: 36min
completed: 2026-07-15
---

# Phase 12 Plan 01: Skill Contracts + GraphState Fields Summary

**SkillDetectionResult Zod schema, fact-check tier-2 classifier tool, Blueprint drift_detection_enabled opt-out flag, and four new GraphState fields plus empty Skill/SkillContext interfaces + Role registries — the shared contracts every downstream Phase 12 plan (Skills, TriggerGateNode, Role-node injection) imports.**

## Performance

- **Duration:** ~36 min (13:11–13:46, includes one mid-task usage-limit interruption and resume)
- **Started:** 2026-07-15T13:11:18Z
- **Completed:** 2026-07-15T13:46:43Z
- **Tasks:** 2 completed
- **Files modified:** 16 (5 created, 11 modified)

## Accomplishments
- `SkillDetectionResultSchema`/`SkillDetectionResult` — the single shared validation gate every Skill's `detect()` output will cross (T-12-02 threat mitigation, confidence bounded [0,1])
- `factCheckClassificationTool` — tier-2 fact-check classifier `ProviderTool` contract (TRIGGER-05, COST-02), `parameters` shape (not `input_schema`), matches `arg-graph-tool.ts` precedent
- `Blueprint.drift_detection_enabled` — additive opt-out field (D-09), default `true`, existing seeded Blueprints still parse
- Four new `GraphState` fields (`firingSkillId`, `firingSkillRole`, `skillMeta`, `triggerGateComplete`) using the exact overwrite-reducer idiom, all default `null`
- `Skill`/`SkillContext` interfaces + empty `COACH_SKILLS`/`ANALYST_SKILLS` registries in `apps/api/src/lib/skills.ts` — ready for Plan 05 to populate

## Task Commits

Each task was committed atomically (Task 1 followed the TDD RED→GREEN cycle):

1. **Task 1 RED: failing tests for SkillDetectionResultSchema + drift_detection_enabled** - `f2245d5` (test)
2. **Task 1 GREEN: SkillDetectionResult schema, fact-check tool, Blueprint drift flag, barrel exports** - `7816907` (feat)
3. **Task 2: GraphState fields + Skill/SkillContext interfaces + empty Role registries** - `65963c8` (feat)

**Plan metadata:** commit created after this SUMMARY.md (see final commit below)

## Files Created/Modified
- `packages/types/src/skill.ts` - `SkillDetectionResultSchema` (fires/confidence/meta) + inferred type
- `packages/types/src/fact-check-tool.ts` - `factCheckClassificationTool` ProviderTool (tier-2 escalation gate contract)
- `packages/types/src/skill.test.ts` - behavior tests for SkillDetectionResultSchema + Blueprint drift_detection_enabled default/override
- `packages/types/src/blueprint.ts` - added `drift_detection_enabled: z.boolean().default(true)` adjacent to `drift_reply_probability`
- `packages/types/src/index.ts` - barrel re-exports for `./skill` and `./fact-check-tool`
- `apps/api/src/graph/state.ts` - `firingSkillId`/`firingSkillRole`/`skillMeta`/`triggerGateComplete` GraphState fields
- `apps/api/src/lib/skills.ts` - `Skill`/`SkillContext` interfaces + empty `COACH_SKILLS`/`ANALYST_SKILLS` arrays
- `.planning/phases/12-graph-coherence-extended-triggers/deferred-items.md` - logs 3 confirmed pre-existing, out-of-scope failures found while verifying (see Deviations)
- 8 existing test fixture files (`graph.integration.test.ts`, `graph.test.ts`, `analytics-agent.test.ts`, `arg-graph-builder.test.ts`, `facilitation-agent.test.ts`, `bot-arbitrator.test.ts`, `silence-scan.test.ts`, `ai.test.ts`) - added `drift_detection_enabled: true` and/or the 4 new GraphState fields to Blueprint/GraphState literal fixtures so `tsc --noEmit` stays clean after Task 1/2's new required fields

## Decisions Made
- `drift_detection_enabled` placed directly adjacent to `drift_reply_probability` (same semantic cluster), matching the plan's explicit instruction and the `bot_defaults`/`role_personalities` grouping precedent.
- `Skill`/`SkillContext` kept as plain TypeScript interfaces, not Zod schemas — only the `SkillDetectionResult` return value is Zod-validated. Mirrors how `AIProvider` (method-bearing interface) lives in `packages/types` as a plain interface.
- `COACH_SKILLS`/`ANALYST_SKILLS` are plain fixed arrays (not a mutable `Map` registry) — Skills are assembled once per Role per D-02; no dynamic (de)registration is needed this phase.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated 8 existing test fixtures for the new required Blueprint/GraphState fields**
- **Found during:** Task 2 verification (`pnpm --filter api exec tsc --noEmit`)
- **Issue:** Adding `drift_detection_enabled` to `BlueprintSchema`'s inferred output type (Task 1) and 4 new fields to `GraphState` (Task 2) made these fields required on any variable typed as `Blueprint`/`GraphState` (as opposed to parsed via `.parse()`). 8 existing test files construct `Blueprint`/`GraphState` fixtures as literal-typed objects (not via `.parse()`), so `tsc --noEmit` failed with `TS2741`/`TS2322` errors across those files — a direct, mechanical consequence of Task 1/2's additive-but-required TypeScript changes, not a design flaw.
- **Fix:** Added `drift_detection_enabled: true` to 6 Blueprint fixtures (`graph.integration.test.ts`, `graph.test.ts`, `analytics-agent.test.ts`, `facilitation-agent.test.ts`, `bot-arbitrator.test.ts`, `silence-scan.test.ts`, `ai.test.ts`) and the 4 new GraphState fields (all `null`) to 3 `makeState()`/`baseState()` test helpers (`analytics-agent.test.ts`, `facilitation-agent.test.ts`, `arg-graph-builder.test.ts`).
- **Files modified:** see Files Created/Modified list above.
- **Verification:** `pnpm --filter api exec tsc --noEmit` clean except one confirmed pre-existing unrelated error (see below).
- **Committed in:** `65963c8` (Task 2 commit)

**Total deviations:** 1 auto-fixed (1 blocking-type-error fix spanning 8 files)
**Impact on plan:** Necessary for Task 1/2's own stated verification (`tsc --noEmit` clean) to pass. No scope creep — no behavioral test assertions were changed, only fixture literals extended with the new fields' safe defaults.

## Issues Encountered

Three pre-existing, out-of-scope failures were discovered while running full verification (not caused by this plan's changes — confirmed by reverting this plan's edits to each specific file and reproducing the same failure on unmodified `HEAD`). Logged in `deferred-items.md`, not fixed, per the SCOPE BOUNDARY rule:

1. `apps/api/src/lib/bot-arbitrator.test.ts:139` — `TS2532: Object is possibly 'undefined'` on `mockSupabase.rpc.mock.calls[0][1]` array-index access. Confirmed pre-existing (same line, unmodified, fails identically with this plan's `state.ts`/`skills.ts` changes reverted).
2. `apps/api/src/lib/silence-scan.test.ts` — 5 pre-existing assertion failures (Behaviors 3, 4a, 4b, 5) around `graph.getState`/`runArbitration`/`checkBotBudget`/`graph.invoke` mock call assertions. Confirmed pre-existing (same 5 failures with this plan's one-line fixture edit reverted).
3. `apps/api/src/routes/ai.test.ts` — module resolution error (`Cannot find module 'hono/streaming'`) in this worktree's fresh `pnpm install`; reproduced independently in the main repo checkout with a different failure mode (SC-3 assertion returns 404 instead of 200) — confirms a pre-existing environment/test flake, not caused by this plan.

None of these block Task 1 or Task 2's stated `<verify>` commands, which are scoped to `@panelito/types` build/test and `apps/api tsc --noEmit` respectively — both pass cleanly (the `bot-arbitrator.test.ts` type error is the sole exception, confirmed pre-existing and unrelated).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All four downstream-consumed contracts (`SkillDetectionResult`, `factCheckClassificationTool`, `drift_detection_enabled`, four `GraphState` fields + `Skill`/`SkillContext` interfaces) exist, compile, and are importable — Plans 02–06 can now build against them without a scavenger hunt.
- `COACH_SKILLS`/`ANALYST_SKILLS` are empty arrays awaiting Plan 05's population — any node currently reading them (none yet) sees a safe empty list.
- No blockers. The 3 deferred pre-existing issues (see Issues Encountered) should be triaged in a future cleanup task but do not block Plan 02+.

---
*Phase: 12-graph-coherence-extended-triggers*
*Completed: 2026-07-15*
