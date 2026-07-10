---
phase: 10-infrastructure-foundation
plan: 01
subsystem: infra
tags: [typescript, zod, langgraph, types, bot, graph-state]

# Dependency graph
requires:
  - phase: 9-graph-canvas-frontend
    provides: CanvasNode/CanvasEdge types and GraphStateAnnotation pattern established
provides:
  - ArgNode, ArgEdge, BotBudgetResult, TriggerMetadata types + Zod schemas in @panelito/types
  - GraphStateAnnotation extended with argGraph and triggerMetadata fields (overwrite reducers, empty defaults)
  - dual thread_id namespace — human invocations use branch_id:human thread_id in ai.ts
affects: [11-personality-basic-triggers, 12-graph-coherence-extended-triggers, 13-user-profiles-phase-signal, 14-polish-trigger-engine-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zod schema + z.infer type co-location in packages/types/src/*.ts (mirrors canvas.ts pattern)"
    - "LangGraph overwrite-style Annotation reducer: (_, v) => v with typed default for bot state fields"
    - "Dual thread_id namespace: :human suffix appended server-side to prevent bot/human checkpoint write-skew"

key-files:
  created:
    - packages/types/src/bot.ts
    - packages/types/src/bot.test.ts
  modified:
    - packages/types/src/index.ts
    - apps/api/src/graph/state.ts
    - apps/api/src/routes/ai.ts

key-decisions:
  - "argGraph uses overwrite reducer (not accumulator) — each bot invocation replaces the full graph, not appends; matches guardrailResult pattern"
  - ":bot thread_id namespace intentionally NOT created in Phase 10 — reserved for Phase 11 ProactiveInvoker; only :human introduced here (D-11)"
  - "TriggerMetadata is z.record(z.string(), TriggerMetadataEntrySchema) — open key space allows new trigger types in Phases 11–14 without schema migration"

patterns-established:
  - "Bot type file pattern: import z; each type has co-located schema + z.infer export (same as canvas.ts)"
  - "index.ts bot export block: two lines — one export type { ... } from './bot', one export { ...Schema } from './bot'"

requirements-completed: [BOT-04, BOT-05]

# Metrics
duration: 15min
completed: 2026-07-10
---

# Phase 10 Plan 01: Bot Infrastructure Types Summary

**Zod schemas for ArgNode, ArgEdge, BotBudgetResult, TriggerMetadata added to @panelito/types; GraphStateAnnotation extended with argGraph/triggerMetadata; human invocations namespaced to branch_id:human thread_id**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-10T10:27:00Z
- **Completed:** 2026-07-10T10:29:54Z
- **Tasks:** 2 (Task 1 TDD: RED+GREEN; Task 2: auto)
- **Files modified:** 5

## Accomplishments
- Created packages/types/src/bot.ts with five Zod schemas (ArgNodeSchema, ArgEdgeSchema, BotBudgetResultSchema, TriggerMetadataEntrySchema, TriggerMetadataSchema) and their inferred types — the shared type contract for all Phase 11–14 bot code
- Extended GraphStateAnnotation with argGraph (overwrite reducer, default empty graph) and triggerMetadata (overwrite reducer, default empty record) fields imported from @panelito/types
- Changed human invocation thread_id from bare `activeBranchId` to `${activeBranchId}:human` template literal, reserving the `:bot` namespace for Phase 11 ProactiveInvoker without collisions

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing bot tests** - `93a10c1` (test)
2. **Task 1 GREEN: bot.ts + index.ts bot exports** - `80b73ed` (feat)
3. **Task 2: GraphStateAnnotation + dual thread_id** - `544b307` (feat)

_Note: Task 1 used TDD RED/GREEN cycle with separate commits per phase._

## Files Created/Modified
- `packages/types/src/bot.ts` - Five schemas/types: ArgNode, ArgEdge, BotBudgetResult, TriggerMetadataEntry, TriggerMetadata
- `packages/types/src/bot.test.ts` - 9 vitest cases covering parse-success, reject-on-missing-label, null/string values, record/empty-object variants
- `packages/types/src/index.ts` - Added 2-line bot export block after Blueprint block
- `apps/api/src/graph/state.ts` - Import extended + argGraph/triggerMetadata fields with section comment
- `apps/api/src/routes/ai.ts` - Line 344: thread_id changed to template literal with :human suffix

## Decisions Made
- argGraph uses overwrite reducer (not accumulator) — each bot invocation replaces the full graph to avoid stale edge accumulation; mirrors guardrailResult pattern
- :bot thread_id NOT introduced here (D-11 constraint) — Phase 11 will create it in ProactiveInvoker
- TriggerMetadata key space left open via z.record — new trigger types in Phases 11–14 require no schema change

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Worktree node_modules were absent; ran `pnpm install` at the worktree root to populate them before vitest could resolve zod. Standard worktree setup — no plan impact.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- @panelito/types now exports all five bot type/schema pairs — Phase 11 FacilitationAgentNode and ArgGraphBuilderNode can import ArgNode/ArgEdge/TriggerMetadata without new type work
- GraphStateAnnotation carries argGraph and triggerMetadata with correct defaults — human thread invocations produce empty defaults, bot invocations in Phase 11 will overwrite them
- thread_id namespace split complete — `:bot` path ready to wire in Phase 11 ProactiveInvoker

---
*Phase: 10-infrastructure-foundation*
*Completed: 2026-07-10*
