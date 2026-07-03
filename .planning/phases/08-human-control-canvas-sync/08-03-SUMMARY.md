---
phase: 08-human-control-canvas-sync
plan: 03
subsystem: api
tags: [langgraph, agent-node, phase-signal, graph-state, typescript]

# Dependency graph
requires:
  - phase: 08-human-control-canvas-sync
    plan: 01
    provides: phase_signal field in GraphStateAnnotation + canvasMutationTool extended with phase_signal property
provides:
  - AgentNode that extracts phase_signal from raw LLM tool input before CanvasOpSchema.safeParse
  - All agentNode exit paths return phase_signal (tool_use path: rawPhaseSignal, fallback: null)
  - MutationGateNode confirmed not resetting phase_signal via D-08 design comment
affects:
  - 08-04 (ai.ts route reads finalState.phase_signal post-graph — now always present)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read advisory LLM fields from rawInput (event.input as Record<string, unknown>) BEFORE CanvasOpSchema.safeParse — prevents silent field stripping by strict Zod parsing (RESEARCH.md Pitfall 2/4)"
    - "Every agentNode exit path must return phase_signal — ensures GraphStateAnnotation overwrite reducer receives the value on all code paths"
    - "MutationGateNode returning {} does NOT reset overwrite-style fields — LangGraph only calls reducer for fields present in the return object"

key-files:
  created: []
  modified:
    - apps/api/src/graph/nodes/agent.ts
    - apps/api/src/graph/nodes/mutation-gate.ts

key-decisions:
  - "rawPhaseSignal extracted from event.input BEFORE CanvasOpSchema.safeParse — strict Zod parsing strips unknown fields silently (RESEARCH.md Pitfall 2/4)"
  - "Fallback return at end of agentNode returns phase_signal: null — ensures all non-tool-use paths (DOMAIN_DRIFT, streaming-only) still set the field"
  - "MutationGateNode unchanged except for D-08 design comment — returning {} from mutationGateNode is correct behavior; overwrite reducer preserves AgentNode's phase_signal value"

requirements-completed:
  - HUMAN-02

# Metrics
duration: ~3min
completed: 2026-07-03
---

# Phase 8 Plan 03: Agent Node phase_signal Extraction Summary

**AgentNode reads phase_signal from raw LLM tool input before Zod safeParse strips it, returning it as a top-level graph state field on all code paths; MutationGateNode confirmed not to reset the value**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-07-03T12:30:32Z
- **Completed:** 2026-07-03T12:33:12Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `rawPhaseSignal` extraction from `event.input` before `CanvasOpSchema.safeParse()` in the `tool_use` handler of `agentNode` — prevents silent field stripping by strict Zod schema
- Replaced `break` with `return { agentOutput, agentConfidence, phase_signal: rawPhaseSignal }` in the tool_use path
- Added `phase_signal: null` to the fallback return at the end of `agentNode` (covers DOMAIN_DRIFT, streaming-only, and safeParse-failure paths)
- Verified `mutationGateNode` does not include `phase_signal` in any return value; added D-08 design comment explaining why the overwrite reducer preserves AgentNode's value through MutationGateNode execution
- TypeScript typecheck passes with zero errors; all 5 graph tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract phase_signal in AgentNode before safeParse** - `7ed1034` (feat)
2. **Task 2: Verify MutationGateNode does not reset phase_signal** - `c2b0e0d` (feat)

## Files Created/Modified

- `apps/api/src/graph/nodes/agent.ts` — Added rawPhaseSignal extraction before safeParse in tool_use handler; replaced `break` with early return including `phase_signal: rawPhaseSignal`; updated fallback return to include `phase_signal: null`
- `apps/api/src/graph/nodes/mutation-gate.ts` — Added D-08 design comment at top of function body; no logic changes (confirmed correct as-is)

## Decisions Made

- `rawPhaseSignal` read from `event.input as Record<string, unknown>` before `safeParse` — this is the required pattern because `CanvasOpSchema` uses strict Zod parsing that strips unknown fields. This matches RESEARCH.md Pitfall 2 and Pitfall 4.
- All exit paths from `agentNode` must include `phase_signal`. Without `phase_signal: null` on the fallback path, the state field would remain at its previous value rather than being reset — causing stale signals from prior invocations to persist.
- `mutationGateNode` intentionally omits `phase_signal` from all return values. LangGraph's `(_, v) => v` reducer only fires when the returned object contains the key — returning `{}` or `{ canvasOps: [...] }` leaves `phase_signal` in state untouched.

## Deviations from Plan

None — plan executed exactly as written. Task 1 changes matched the plan's specified code patterns precisely. Task 2 confirmed mutation-gate.ts was already correct, and the D-08 comment was the only addition.

## Issues Encountered

- **Pre-existing test failure in ai-provider.test.ts:** One test (`widget_type.enum` snapshot) fails due to an enum mismatch from a prior phase's widget additions. This failure is pre-existing and unrelated to Plan 03 changes. The graph tests targeted by this plan (`graph.test.ts`) all pass.

## Known Stubs

None — both changes are complete implementations. `phase_signal` flows correctly from raw LLM tool output through `agentNode` into `GraphStateAnnotation`. Plan 04 (ai.ts route) will consume `finalState.phase_signal` post-graph.

## Threat Flags

No new threat surface introduced. T-08-03-A (elevation of privilege via LLM-controlled `phase_signal`) is mitigated by design: `phase_signal` is advisory only and triggers an SSE event to the frontend; the human must make a separate HTTP PATCH to advance the phase. AgentNode has no path to write `sessions.current_phase` directly.

## Self-Check: PASSED

- FOUND: apps/api/src/graph/nodes/agent.ts
- FOUND: apps/api/src/graph/nodes/mutation-gate.ts
- FOUND: 08-03-SUMMARY.md
- FOUND: commit 7ed1034 (Task 1)
- FOUND: commit c2b0e0d (Task 2)
