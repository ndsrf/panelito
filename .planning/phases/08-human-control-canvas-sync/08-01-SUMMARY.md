---
phase: 08-human-control-canvas-sync
plan: 01
subsystem: api
tags: [langgraph, canvas-tool, graph-state, phase-signal, typescript]

# Dependency graph
requires:
  - phase: 05-foundation
    provides: LangGraph StateGraph setup and ProviderTool type
  - phase: 08-human-control-canvas-sync
    provides: CONTEXT.md D-08/D-09 decisions and PATTERNS.md patterns
provides:
  - canvasMutationTool extended with optional phase_signal boolean property
  - GraphStateAnnotation with phase_signal: boolean | null overwrite-style field
affects:
  - 08-03 (graph nodes — agent.ts reads phase_signal from raw tool input)
  - 08-04 (route — ai.ts reads finalState.phase_signal post-graph)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Overwrite-style Annotation<T> with reducer: (_, v) => v and default: () => null for optional graph state fields"
    - "Optional tool property after required properties in ProviderTool.parameters.properties — not added to required array"

key-files:
  created: []
  modified:
    - packages/types/src/canvas-tool.ts
    - apps/api/src/graph/state.ts

key-decisions:
  - "phase_signal is NOT added to CanvasOpSchema in canvas.ts — it is read from raw tool input before safeParse in agent.ts (Pitfall 2/4, RESEARCH.md D-13)"
  - "GraphStateAnnotation uses overwrite reducer for phase_signal (last-write-wins boolean | null) — same pattern as steeringTextEnabled"

patterns-established:
  - "Optional advisory fields in canvasMutationTool follow the reason-property pattern: type + description only, NOT in required array"
  - "Overwrite-style graph state fields use Annotation<T>({ reducer: (_, v) => v, default: () => null }) — do NOT use bare Annotation<T> which lacks default support"

requirements-completed:
  - HUMAN-01
  - HUMAN-02
  - CANVAS-02

# Metrics
duration: 12min
completed: 2026-07-03
---

# Phase 8 Plan 01: Types and Graph State — phase_signal Extension Summary

**canvasMutationTool extended with advisory boolean phase_signal property; GraphStateAnnotation carries it as overwrite-style boolean | null field — unlocking agent.ts and ai.ts to read and route the signal**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-03T12:20:00Z
- **Completed:** 2026-07-03T12:32:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `phase_signal: boolean` property to `canvasMutationTool.parameters.properties` with description marking it as advisory-only (human must confirm phase advancement)
- Added `phase_signal: Annotation<boolean | null>` to `GraphStateAnnotation` using exact overwrite-style reducer pattern (`(_, v) => v`, `default: () => null`) matching `steeringTextEnabled`
- Both `@panelito/types` build and `@panelito/api` typecheck pass with zero errors after changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Add phase_signal property to canvasMutationTool** - `235d630` (feat)
2. **Task 2: Add phase_signal field to GraphStateAnnotation** - `525e423` (feat)

## Files Created/Modified

- `packages/types/src/canvas-tool.ts` — Added optional `phase_signal: boolean` to `parameters.properties` block after `reason`; `required` array unchanged (still `['op']`)
- `apps/api/src/graph/state.ts` — Added `phase_signal: Annotation<boolean | null>` with overwrite reducer and null default; JSDoc references HUMAN-02 and D-09

## Decisions Made

- `phase_signal` deliberately excluded from `CanvasOpSchema` in canvas.ts — it must be read from the raw tool event input BEFORE `safeParse()` in agent.ts (per RESEARCH.md Pitfall 2/4 and CONTEXT.md D-13). Conflating it with canvas op data would mean the field gets stripped during Zod validation.
- Used `Annotation<boolean | null>({ reducer: (_, v) => v, default: () => null })` rather than bare `Annotation<boolean | null>` — bare annotation form does not support a default value in LangGraph 1.4.7.

## Deviations from Plan

None — plan executed exactly as written. Both edits matched the PATTERNS.md specifications precisely.

## Issues Encountered

- **pnpm node_modules missing in worktree:** The worktree did not have `node_modules` populated on spawn; `tsc: not found` error occurred on first build attempt. Ran `pnpm install --frozen-lockfile` to restore node_modules. This is a worktree setup concern, not a code issue.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 01 complete: `canvasMutationTool` now guides the LLM to optionally emit `phase_signal: true`
- Plan 01 complete: `GraphStateAnnotation` can carry `phase_signal` through the graph pipeline
- Plan 03 (agent.ts) can now read `event.input.phase_signal` from raw tool output and return it as a top-level graph state key without TypeScript errors
- Plan 04 (ai.ts route) can now read `finalState.phase_signal` post-graph for human-gate routing
- No blockers for Plan 02 (migration), Plan 03 (agent/gate nodes), or Plan 04 (route)

---
*Phase: 08-human-control-canvas-sync*
*Completed: 2026-07-03*
