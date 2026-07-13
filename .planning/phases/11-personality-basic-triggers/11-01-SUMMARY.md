---
phase: 11-personality-basic-triggers
plan: 01
subsystem: api
tags: [zod, langgraph, typescript, bot-infrastructure]

# Dependency graph
requires:
  - phase: 10-infrastructure-foundation
    provides: ArgNode/ArgEdge/TriggerMetadata shapes, GraphStateAnnotation, model-config.ts TASK_MODELS matrix
provides:
  - "ArgNodeSchema extended with message_id + speaker citation fields (PERSONA-02)"
  - "ArgGraphSchema ({ nodes, edges }) exported from @panelito/types"
  - "argGraphExtractionTool raw-JSON tool schema with relaxed string refs"
  - "PersonalitySchema/Personality — voice/tone-only bot Role data model, distinct from persona.ts"
  - "Blueprint.bot_defaults / role_personalities / bot_cooldowns fields"
  - "TASK_MODELS 'facilitation' tier for all three providers"
  - "GraphStateAnnotation.triggerType routing carrier"
  - "bot-context.ts: summarizeArgGraph() + CONTEXT_WINDOWS shared helper"
affects: [11-02-personalities-migration, 11-03-arg-graph-builder, 11-04-facilitation-agent, 11-05-conditional-start-edge]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive Zod schema extension in-place (bot.ts, blueprint.ts) rather than new competing files"
    - "Raw tool-input JSON schema uses relaxed string refs; domain Zod schema keeps .uuid() — ID substitution happens server-side between the two"
    - "Personality (voice/tone) kept structurally and namespace-distinct from Persona (D-06)"

key-files:
  created:
    - packages/types/src/personality.ts
    - packages/types/src/arg-graph-tool.ts
    - apps/api/src/lib/bot-context.ts
    - packages/types/src/arg-graph-tool.test.ts
  modified:
    - packages/types/src/bot.ts
    - packages/types/src/blueprint.ts
    - packages/types/src/index.ts
    - packages/types/src/bot.test.ts
    - apps/api/src/lib/model-config.ts
    - apps/api/src/graph/state.ts
    - apps/api/src/graph/graph.test.ts
    - apps/api/src/graph/graph.integration.test.ts
    - apps/api/src/lib/bot-arbitrator.test.ts
    - apps/api/src/routes/ai.test.ts

key-decisions:
  - "message_id + speaker made REQUIRED on ArgNodeSchema (not optional) — PERSONA-02 citation contract has no valid unattributed-node case"
  - "argGraphExtractionTool.parameters (not input_schema) matches ProviderTool's existing field name convention (canvas-tool.ts precedent)"
  - "bot_defaults/role_personalities/bot_cooldowns added as real BlueprintSchema fields with .default(...) — Finding 5, not the bot_cooldowns TS-only-intersection anti-pattern"
  - "triggerType kept structurally distinct from triggerMetadata — single overwrite-style routing carrier vs. per-trigger cooldown record"

patterns-established:
  - "Zod .default() fields are optional on input but required on the z.infer output type — any TS object literal explicitly typed as the inferred type (e.g. `const x: Blueprint = {...}`) must include the field even though DB-sourced JSON.parse() calls do not need to"

requirements-completed: [PERSONA-01, PERSONA-02, PERSONA-03, GRAPH-01, GRAPH-04]

# Metrics
duration: 15min
completed: 2026-07-13
---

# Phase 11 Plan 01: Personality + Basic Triggers — Shared Contracts Summary

**Extended ArgNode with message_id/speaker citation fields, added ArgGraph + argGraphExtractionTool, a distinct Personality type, real Blueprint bot_defaults/role_personalities fields, a facilitation model tier, a triggerType routing carrier, and a shared summarizeArgGraph() helper — the interface-first foundation for all downstream Phase 11 plans.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-13T17:53:00+02:00
- **Completed:** 2026-07-13T17:58:09+02:00
- **Tasks:** 3 completed
- **Files modified:** 14 (4 created, 10 modified)

## Accomplishments
- `ArgNodeSchema` now requires `message_id`/`speaker` — the citation anchor PERSONA-02's Analyst persona needs to cite a specific prior message
- New `ArgGraphSchema`/`ArgGraph` type + `argGraphExtractionTool` (relaxed string refs, real UUID substitution deferred to the builder node in Plan 03)
- New `Personality`/`PersonalitySchema` — voice/tone-only data model, explicitly kept distinct from the existing `persona.ts` system (D-06)
- `BlueprintSchema` now carries real `bot_defaults`, `role_personalities`, and optional `bot_cooldowns` fields (Finding 5 — Blueprint is the actual DB source of truth, not a TS-only intersection)
- `TASK_MODELS` gained a `facilitation` tier for all three providers (anthropic/openai/gemini)
- `GraphStateAnnotation` gained a `triggerType` routing carrier read by the future conditional START edge (Plan 05)
- New `bot-context.ts` exporting `CONTEXT_WINDOWS` + `summarizeArgGraph()` — the single shared argGraph-to-text path for both Coach and Analyst prompts

## Task Commits

Each task was committed atomically (Task 1 followed the TDD RED → GREEN cycle):

1. **Task 1: Extend argGraph schema + create extraction tool + barrel**
   - `15bb4da` (test) — failing tests for ArgNode citation fields, ArgGraphSchema, argGraphExtractionTool
   - `102e978` (feat) — implementation: bot.ts extension, arg-graph-tool.ts, index.ts barrel
2. **Task 2: Personality type + Blueprint bot_defaults / Role→Personality map** - `c62be5d` (feat)
3. **Task 3: facilitation model tier + triggerType state field + argGraph summary helper** - `4da9a81` (feat)

**Plan metadata:** (this commit, docs: complete plan)

_Task 1 followed RED → GREEN (no REFACTOR needed — implementation matched planned shape on first pass)._

## Files Created/Modified
- `packages/types/src/bot.ts` - ArgNodeSchema extended with message_id/speaker; new ArgGraphSchema/ArgGraph
- `packages/types/src/arg-graph-tool.ts` - argGraphExtractionTool ProviderTool (relaxed string refs)
- `packages/types/src/personality.ts` - PersonalitySchema/Personality (voice/tone only, D-06 distinct from persona.ts)
- `packages/types/src/blueprint.ts` - bot_defaults, role_personalities, bot_cooldowns fields
- `packages/types/src/index.ts` - barrel exports for ArgGraph, argGraphExtractionTool, Personality
- `apps/api/src/lib/model-config.ts` - 'facilitation' TaskType added to TaskType union + all 3 provider matrices
- `apps/api/src/graph/state.ts` - triggerType Annotation field (nullable string, identity reducer)
- `apps/api/src/lib/bot-context.ts` - CONTEXT_WINDOWS + summarizeArgGraph() pure helper
- `packages/types/src/bot.test.ts` - extended with citation-field + ArgGraphSchema tests
- `packages/types/src/arg-graph-tool.test.ts` - new test file for argGraphExtractionTool shape
- `apps/api/src/graph/graph.test.ts`, `graph.integration.test.ts`, `apps/api/src/lib/bot-arbitrator.test.ts`, `apps/api/src/routes/ai.test.ts` - Blueprint fixture literals updated with the two new required-in-output-type fields (Rule 3 fix, see Deviations)

## Decisions Made
- `message_id`/`speaker` are required (not optional) on `ArgNodeSchema` — PERSONA-02 has no valid unattributed-citation case
- `argGraphExtractionTool` uses the `parameters` key (matching `ProviderTool`'s existing field name, same as `canvas-tool.ts` — the plan's "input_schema" wording referred to the JSON-schema concept generically, not a literal field name)
- `bot_cooldowns` included as an optional `BlueprintSchema` field (plan listed it as optional) to carry PERSONA-03's Coach 3/15, Analyst 2/15 cooldown config directly in the Blueprint

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed Blueprint test fixtures broken by additive schema fields**
- **Found during:** Task 2 verification (`pnpm exec tsc --noEmit` in apps/api)
- **Issue:** Adding `bot_defaults`/`role_personalities` to `BlueprintSchema` with `.default(...)` makes them optional on the *input* type but required on the `z.infer` *output* type. Four existing test files declare `const x: Blueprint = {...}` object literals explicitly typed as the inferred `Blueprint` type — these failed to compile once the two new fields were added (same effect the pre-existing `drift_reply_probability` field already has on these same fixtures).
- **Fix:** Added `bot_defaults: {}` and `role_personalities: {}` to each of the 4 fixture literals.
- **Files modified:** `apps/api/src/graph/graph.test.ts`, `apps/api/src/graph/graph.integration.test.ts`, `apps/api/src/lib/bot-arbitrator.test.ts`, `apps/api/src/routes/ai.test.ts`
- **Verification:** `pnpm exec tsc --noEmit` in apps/api passes except one pre-existing unrelated error (see Known Issues); `pnpm exec vitest run` — 68/68 relevant tests pass (7 unrelated files fail on missing `.env`, pre-existing and out of scope)
- **Committed in:** `c62be5d` (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary follow-through of the additive schema change specified by the plan itself. No scope creep — no new fields, behavior, or files beyond what the plan's Task 2 action already specified.

## Issues Encountered

**Worktree was stale at spawn time.** The worktree branch (`worktree-agent-a1167710c25ff52b1`) was created before the phase-planning commits (including `11-01-PLAN.md` itself) landed on `main`. Fast-forward merged `main` into the worktree branch before starting execution — a clean, non-destructive fast-forward (5 docs-only commits, no conflicts).

**Pre-existing, unrelated TS error in `apps/api/src/lib/bot-arbitrator.test.ts:136`** (`TS2532: Object is possibly 'undefined'` on `mockSupabase.rpc.mock.calls[0][1]`) predates this plan (introduced in Phase 10 commit `d92949b`, confirmed via `git show` against the pre-Plan-01 HEAD). This causes `pnpm --filter @panelito/api build` to exit non-zero even though `apps/api`'s test suite passes and `tsc --noEmit` reports no errors caused by this plan's changes. Per the executor's scope-boundary rule, this was left unfixed and logged to `.planning/phases/11-personality-basic-triggers/deferred-items.md` rather than fixed in-scope.

## Known Issues (pre-existing, out of scope)

- `apps/api/src/lib/bot-arbitrator.test.ts:136` — `TS2532` strict-mode array-index access issue, pre-existing since Phase 10. Blocks a clean `pnpm --filter @panelito/api build` exit code, but does not affect `tsc --noEmit` correctness of this plan's changes or `vitest run` test results. See `.planning/phases/11-personality-basic-triggers/deferred-items.md`.
- 7 apps/api test files fail with "Missing or invalid environment variables" (`SUPABASE_URL`, etc.) — no `.env` file exists in this worktree. Pre-existing, unrelated to this plan's code changes; not fixed (would require secrets, not something an executor can/should auto-provision).

## User Setup Required

None - no external service configuration required. (The `.env` gap noted above is a local dev-environment setup step, not new configuration introduced by this plan.)

## Next Phase Readiness

- `packages/types` and `apps/api` both compile cleanly modulo the one pre-existing, unrelated `bot-arbitrator.test.ts` line.
- All shared contracts Plan 02 (migration), Plan 03 (ArgGraphBuilderNode), Plan 04 (Facilitation/Analytics agents), and Plan 05 (conditional START edge) depend on are now in place: `ArgNode.message_id/speaker`, `ArgGraphSchema`, `argGraphExtractionTool`, `Personality`, `Blueprint.bot_defaults/role_personalities/bot_cooldowns`, `TASK_MODELS.*.facilitation`, `GraphStateAnnotation.triggerType`, `summarizeArgGraph()`/`CONTEXT_WINDOWS`.
- No blockers for downstream plans in this wave.

---
*Phase: 11-personality-basic-triggers*
*Completed: 2026-07-13*

## Self-Check: PASSED

All created/modified files verified present on disk; all 5 commits (15bb4da, 102e978, c62be5d, 4da9a81, 3384173) verified in git log.
