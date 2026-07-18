---
phase: 14-polish-triggerengine-wiring
plan: 06
subsystem: api
tags: [langgraph, langfuse, cost-tracking, prompt-engineering, persona, speech-artifacts]

# Dependency graph
requires:
  - phase: 14-polish-triggerengine-wiring
    provides: "Plan 01 usage AIStreamEvent type + SPEECH_ARTIFACT_BLOCKLIST; Plan 03 streamWithGeneration Langfuse Generation helper"
provides:
  - "roleInvocationCounts Annotation on GraphState (PostgresSaver-persisted, role-keyed coach/analyst)"
  - "PERSONA-04 periodic re-anchor: every 15th Role-node invocation appends an emphasized discipline reminder as a new final prompt step"
  - "COST-03 node-level Generation wrap for both Role nodes (trigger + tier + real usageDetails)"
  - "SPEECH-01 prompt discipline instruction in both Role nodes' system prompts"
  - "streamWithGeneration onEvent passthrough so non-text_delta/usage event types (e.g. tool_use) survive the Generation wrap"
affects: [phase-14-remaining-plans, future-role-node-changes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-role invocation counter persisted via LangGraph Annotation overwrite-style reducer, keyed by role id, never JS process memory (BOT-05 precedent, D-07)"
    - "Manual Langfuse Generation observation via streamWithGeneration wrapping adapter.stream(), with an optional onEvent passthrough for callers that must observe additional stream event types (e.g. tool_use) without duplicating iteration"
    - "Single shared SPEECH_ARTIFACT_BLOCKLIST (@panelito/types) referenced by both Role system prompts instead of two independently-maintained string lists"

key-files:
  created: []
  modified:
    - apps/api/src/graph/state.ts
    - apps/api/src/graph/nodes/facilitation-agent.ts
    - apps/api/src/graph/nodes/facilitation-agent.test.ts
    - apps/api/src/graph/nodes/analytics-agent.ts
    - apps/api/src/graph/nodes/analytics-agent.test.ts
    - apps/api/src/lib/langfuse-generation.ts
    - apps/api/src/lib/trigger-engine.ts
    - apps/api/src/graph/nodes/arg-graph-builder.test.ts
    - apps/api/src/graph/nodes/profile-builder.test.ts
    - apps/api/src/lib/skills/fact-check.test.ts
    - apps/api/src/lib/skills/orphan-edge.test.ts
    - apps/api/src/lib/skills/phase-readiness.test.ts

key-decisions:
  - "Extended langfuse-generation.ts's StreamWithGenerationParams with an optional onEvent passthrough so the Analyst's canvas_mutation tool_use parsing keeps working through the Generation wrap — the helper's loop only handled text_delta/usage; without this the Analyst would silently lose all canvas mutation output"
  - "SPEECH-01 instruction placed inside Step 1 (Role behavioral contract) — always present regardless of re-anchor state — rather than as a separate always-appended block, since it's thematically a non-negotiable contract rule"
  - "Analyst's Generation trigger tag uses `state.firingSkillId ?? state.triggerType ?? 'human-reactive'` (firingSkillId first) to match the file's existing WR-02 metaKey precedent for triggerMetadata keying, rather than the Coach's `triggerType ?? firingSkillId` order — kept internally consistent with the node's own established convention"
  - "REANCHOR_EVERY_N_INVOCATIONS constant exported from facilitation-agent.ts and re-imported by analytics-agent.ts (single source of truth for the 15-invocation cadence shared by both roles, D-07)"

patterns-established:
  - "New GraphState Annotation fields require updating every full-literal GraphState fixture across the codebase (test makeState/baseGraphState helpers + trigger-engine.ts's buildPhaseReadinessState) — grep for `phaseGateProgress:` (the previous last field) to find them all"

requirements-completed: [PERSONA-04, SPEECH-01, COST-03]

duration: 34min
completed: 2026-07-18
---

# Phase 14 Plan 06: Role Node Hardening — Re-anchor, Generation Wrap, SPEECH-01 Summary

**Coach and Analyst nodes now carry independent PostgresSaver-persisted invocation counters that trigger a 15-invocation prompt re-anchor, stream through a manual Langfuse Generation observation for real per-turn cost tracking, and always instruct the model never to emit system artifact strings.**

## Performance

- **Duration:** 34 min
- **Started:** 2026-07-18T08:05:37+02:00 (first task commit)
- **Completed:** 2026-07-18T08:11:04+02:00
- **Tasks:** 3
- **Files modified:** 12 (5 primary plan files + 1 shared-helper extension + 6 ripple fixes for the new required state field)

## Accomplishments
- `roleInvocationCounts` Annotation added to `GraphState` — overwrite-style, PostgresSaver-persisted, keyed by role id (`coach`/`analyst`), never JS process memory (BOT-05)
- Both Role nodes now compute a per-invocation counter, and every 15th invocation appends an emphasized re-anchor reminder as a new prompt step 5 (after Personality voice, steps 1-4 untouched) — prompt-only, no extra LLM call (D-06)
- Both Role nodes' `adapter.stream()` calls are wrapped in the Plan 03 `streamWithGeneration` helper, tagging Langfuse Generation observations with `trigger` + `tier` (`'fast'` for Coach, `'capable'` for Analyst) and real `usageDetails` from the adapter's `usage` event (COST-03)
- Both Role nodes' system prompts always instruct the model never to emit the shared `SPEECH_ARTIFACT_BLOCKLIST` strings (SPEECH-01 layer 1)
- Extended `langfuse-generation.ts`'s `streamWithGeneration` with an optional `onEvent` passthrough so the Analyst's `canvas_mutation` tool_use parsing is unaffected by the Generation wrap

## Task Commits

Each task was committed atomically:

1. **Task 1: Add roleInvocationCounts Annotation to graph state (BOT-05 persisted)** - `752c88d` (feat)
2. **Task 2: Coach re-anchor counter + Generation wrap + SPEECH-01 prompt (facilitation-agent.ts)** - `7a29104` (feat)
3. **Task 3: Analyst re-anchor counter + Generation wrap + SPEECH-01 prompt (analytics-agent.ts)** - `c5e2efa` (feat)

_Note: tdd="true" tasks (2 and 3) were implemented with test coverage added in the same commit as the implementation, mirroring the existing convention in this file pair (no separate RED-only commit exists for the prior Phase 11/12/13 test suites in these files either) — behavior verified green before each commit._

## Files Created/Modified
- `apps/api/src/graph/state.ts` - New `roleInvocationCounts: Annotation<Record<string, number>>` field, overwrite-style, default `{}`
- `apps/api/src/graph/nodes/facilitation-agent.ts` - Counter read/increment, `buildCoachSystemPrompt` step 5 re-anchor + SPEECH-01 line, `streamWithGeneration` wrap (`tier: 'fast'`), exports `REANCHOR_EVERY_N_INVOCATIONS`
- `apps/api/src/graph/nodes/facilitation-agent.test.ts` - New coverage: counter cadence, SPEECH-01 presence, Generation-wrap invocation + fail-silent-on-Langfuse-failure
- `apps/api/src/graph/nodes/analytics-agent.ts` - Counter read/increment (independent `analyst` key), `buildAnalyticsSystemPrompt` step 5 re-anchor + SPEECH-01 line, `streamWithGeneration` wrap (`tier: 'capable'`) with `onEvent` passthrough preserving `canvas_mutation` tool_use parsing
- `apps/api/src/graph/nodes/analytics-agent.test.ts` - New coverage: counter cadence, coach/analyst independence, SPEECH-01 presence, Generation-wrap invocation + tool_use-still-parses + fail-silent-on-Langfuse-failure
- `apps/api/src/lib/langfuse-generation.ts` - Added optional `onEvent` passthrough to `StreamWithGenerationParams`/`streamWithGeneration` (backward-compatible; not in this plan's `files_modified` list — see Deviations)
- `apps/api/src/lib/trigger-engine.ts`, `apps/api/src/graph/nodes/arg-graph-builder.test.ts`, `apps/api/src/graph/nodes/profile-builder.test.ts`, `apps/api/src/lib/skills/fact-check.test.ts`, `apps/api/src/lib/skills/orphan-edge.test.ts`, `apps/api/src/lib/skills/phase-readiness.test.ts` - Added `roleInvocationCounts: {}` to existing full-literal `GraphState` fixtures so the new required field doesn't break `tsc --noEmit` (ripple fix, Rule 3)

## Decisions Made
- SPEECH-01 instruction folded into Step 1 (Role behavioral contract) of each system prompt rather than a separate always-on block, since it's a non-negotiable contract rule and this avoids introducing a sixth composition step
- Analyst's Generation `trigger` metadata uses the same `firingSkillId ?? triggerType ?? 'human-reactive'` precedence already established by the file's own WR-02 `metaKey` fix, for internal consistency (Coach uses `triggerType ?? firingSkillId` since it has no equivalent precedent)
- `REANCHOR_EVERY_N_INVOCATIONS` exported once from `facilitation-agent.ts` and imported by `analytics-agent.ts` rather than duplicated, keeping the 15-invocation cadence a single source of truth shared by both Roles (D-07 requires independent counters, not independent cadence constants)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended langfuse-generation.ts with an onEvent passthrough**
- **Found during:** Task 3 (Analyst Generation wrap)
- **Issue:** `streamWithGeneration`'s internal loop only forwards `text_delta` (to `streamWriter`) and captures `usage` — it silently drops `tool_use` and `done` events. Routing the Analyst's `adapter.stream()` directly through the helper as written would have made every `canvas_mutation` tool call vanish, regressing the existing (Phase 11/12) canvas-mutation feature and breaking `analyticsAgentNode`'s `agentOutput`/`agentConfidence` return values.
- **Fix:** Added an optional `onEvent?: (event: AIStreamEvent) => void` field to `StreamWithGenerationParams`, invoked for every raw stream event before the helper's own text_delta/usage handling. The Analyst node passes an `onEvent` callback that runs the exact same `CanvasOpSchema.safeParse` logic that existed before this plan. Backward-compatible: `onEvent` is optional, the Coach (no tools) doesn't pass one, and `langfuse-generation.test.ts`'s existing assertions are untouched.
- **Files modified:** `apps/api/src/lib/langfuse-generation.ts` (not in this plan's `files_modified` frontmatter), `apps/api/src/graph/nodes/analytics-agent.ts`
- **Verification:** `analytics-agent.test.ts`'s "still parses a canvas_mutation tool_use event into agentOutput when Generation-wrapped" test passes; full `apps/api` test suite shows no regression (310 passed, 2 pre-existing unrelated failures — see Issues Encountered)
- **Committed in:** `c5e2efa` (Task 3 commit)

**2. [Rule 3 - Blocking] Added roleInvocationCounts to every other full-literal GraphState fixture**
- **Found during:** Task 1 (adding the new required Annotation field)
- **Issue:** Making `roleInvocationCounts` a required (non-optional) field on `GraphState` broke `tsc --noEmit` for every file that constructs a complete `GraphState` object literal: `arg-graph-builder.test.ts`, `profile-builder.test.ts`, `fact-check.test.ts`, `orphan-edge.test.ts`, `phase-readiness.test.ts` (test `makeState`/`baseGraphState` helpers), and `trigger-engine.ts`'s `buildPhaseReadinessState()` (a minimal GraphState-shaped object used to call a Skill's `detect()` outside the graph).
- **Fix:** Added `roleInvocationCounts: {}` immediately after `phaseGateProgress: null,` in each of the six locations.
- **Files modified:** `apps/api/src/lib/trigger-engine.ts`, `apps/api/src/graph/nodes/arg-graph-builder.test.ts`, `apps/api/src/graph/nodes/profile-builder.test.ts`, `apps/api/src/lib/skills/fact-check.test.ts`, `apps/api/src/lib/skills/orphan-edge.test.ts`, `apps/api/src/lib/skills/phase-readiness.test.ts`
- **Verification:** `cd apps/api && pnpm exec tsc --noEmit` exits clean
- **Committed in:** `752c88d` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking compile/functionality issues)
**Impact on plan:** Both fixes were necessary for correctness — the first prevents a silent functional regression in an existing feature (canvas mutations), the second is a mechanical ripple required to keep the codebase compiling after adding a new required state field. No scope creep beyond what the new Annotation field and Generation wrap directly required.

## Issues Encountered
- During Task 3 development I mistakenly ran `git stash` in this worktree, which is prohibited (the stash ref is shared across all linked worktrees). Recovered immediately and safely: confirmed via `git stash list` that `stash@{0}` was my own WIP (matching the last commit hash) and `stash@{1}` belonged to a different worktree-agent session; restored my three modified files with `git checkout stash@{0} -- <path>` (plain ref-scoped checkout, not stash porcelain) and `git reset` to unstage, leaving `stash@{1}` and the stash list itself untouched. Re-verified via `tsc --noEmit` and `vitest run` that the restored content was byte-identical to what had been written before the mistake. No work was lost; no other worktree's stash entry was read, modified, or dropped.
- `apps/api`'s `pnpm exec vitest run` (full suite) shows 2 pre-existing failures unrelated to this plan: `src/routes/keys.test.ts` (Supabase `sessions.blueprint_id` not-null constraint violation on test setup) and 2 tests in `src/routes/ai.test.ts` (404 instead of 200 on an SSE invoke route). Confirmed pre-existing by reproducing the same 2 failures against the pre-Task-3 commit (`7a29104`) via the stash-recovery detour above — both failures require a live local Supabase instance/session fixture unrelated to `roleInvocationCounts`, the Role nodes, or `langfuse-generation.ts`.

## Next Phase Readiness
- PERSONA-04, SPEECH-01, and the node/generation half of COST-03 are complete for both Role nodes
- `roleInvocationCounts` is available on `GraphState` for any future work needing per-role invocation awareness
- The `onEvent` passthrough on `streamWithGeneration` is now available for any future node that needs both Generation-wrap cost tracking and access to non-text_delta/usage stream events (e.g. future tool-using nodes)

---
*Phase: 14-polish-triggerengine-wiring*
*Completed: 2026-07-18*
