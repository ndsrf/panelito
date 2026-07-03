---
phase: 08-human-control-canvas-sync
plan: 05
subsystem: ui
tags: [zustand, supabase-realtime, sse, react, typescript, phase-signal, mic-lock, canvas-sync]

# Dependency graph
requires:
  - phase: 08-human-control-canvas-sync
    plan: 01
    provides: "CanvasNode/CanvasEdge types in @panelito/types; phase_signal in canvasMutationTool"
  - phase: 08-human-control-canvas-sync
    plan: 04
    provides: "mic_acquired/mic_released/canvas_update/phase_advanced Realtime broadcasts; phase_signal SSE event; PATCH /sessions/:id/phase endpoint"
provides:
  - "session-store: micLocked, currentPhase, canvasNodes, canvasEdges state with typed setters"
  - "useAIStream: phase_signal SSE handler; mic_locked 409 disambiguation; phaseSignal/pendingPhaseId in hook return"
  - "useSessionChannel: mic_acquired, mic_released, canvas_update, phase_advanced broadcast handlers"
  - "CreatorControls: AdvancePhaseButton (disabled/enabled/pending states) + currentPhase Badge per UI-SPEC Surface 1"
  - "InputBox: micLocked store read (D-04; no visual in Phase 8)"
  - "workspace.tsx: phaseSignal + pendingPhaseId threaded from useAIStream to CreatorControls"
affects:
  - 09-graph-canvas-frontend (canvasNodes/canvasEdges ready in store for @xyflow/react rendering)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useAIStream returns phaseSignal:boolean and pendingPhaseId:string|null — caller (workspace) threads to CreatorControls via props; hook ownership stays at workspace level"
    - "Branch-scoped mic lock: payload.branch_id === useSessionStore.getState().activeBranchId read at call time via getState() to avoid stale closure (D-04)"
    - "409 body disambiguation: response.json().catch(() => ({})) pattern to safely distinguish mic_locked vs no_persona without crashing on non-JSON 409 responses"
    - "AdvancePhaseButton useEffect([phaseSignal]) for pulsing: avoids render-loop from useState-based previous-value tracking"
    - "canvas_update has no branch filter — canvas is session-wide; mic events have branch filter"

key-files:
  created: []
  modified:
    - apps/web/store/session-store.ts
    - apps/web/hooks/use-ai-stream.ts
    - apps/web/hooks/use-session-channel.ts
    - apps/web/components/workspace/CreatorControls.tsx
    - apps/web/components/workspace/InputBox.tsx
    - apps/web/app/(protected)/sessions/[id]/workspace.tsx

key-decisions:
  - "phaseSignal + pendingPhaseId live in useAIStream component state (not session-store) — SSE events are transient per-invoke signals, not persistent session state; threading via props keeps hook ownership at workspace level"
  - "onPhaseConsumed wired to resetStream — resets all streaming state including phaseSignal/pendingPhaseId after PATCH attempt; acceptable because stream is already done by the time creator clicks"
  - "useEffect([phaseSignal]) used for pulsing state instead of previous-value tracking with useState — avoids React render loop anti-pattern"
  - "AdvancePhaseButton props: phaseSignal and pendingPhaseId passed from workspace.tsx, not read from store — keeps the Advance Phase affordance decoupled from SSE event loop"

patterns-established:
  - "Realtime broadcast handlers: getState() at call time for activeBranchId to avoid stale closures in useEffect/useRef contexts"
  - "mic_locked 409 disambiguation: parse response body with .catch(() => ({}))"

requirements-completed:
  - HUMAN-01
  - HUMAN-02
  - CANVAS-02

# Metrics
duration: 8min
completed: 2026-07-03
---

# Phase 8 Plan 05: Frontend Surface — Mic Lock, phase_signal SSE, Canvas Sync Summary

**Phase 8 human-control loop closed: mic lock state, phase_signal SSE, canvas_update, and phase_advanced broadcasts fully wired from Supabase Realtime into Zustand store and CreatorControls AdvancePhaseButton**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-03T12:43:53Z
- **Completed:** 2026-07-03T12:52:03Z
- **Tasks:** 4 (+ 1 workspace wiring sub-task)
- **Files modified:** 6

## Accomplishments

- Extended session-store with four new Phase 8 state fields (micLocked, currentPhase, canvasNodes, canvasEdges) and three typed setters (setMicLocked, setCurrentPhase, setCanvasData) — fully initialized to false/null/[]/[]
- useAIStream now handles phase_signal SSE event (enables Advance Phase button), mic_locked 409 response (toast + status variant), and exposes phaseSignal + pendingPhaseId in hook return
- useSessionChannel handles all four Phase 8 broadcasts: mic_acquired/mic_released (branch-filtered), canvas_update (session-wide), phase_advanced (toast + store update)
- CreatorControls has full AdvancePhaseButton: disabled outline (Siguiente fase) / enabled indigo primary with animate-pulse (Avanzar fase) / pending spinner (Avanzando...) states; currentPhase Badge; PATCH /sessions/:id/phase on click
- InputBox reads micLocked from store (store integration for Phase 9; no visual change in Phase 8)
- workspace.tsx threads phaseSignal, pendingPhaseId, onPhaseConsumed from useAIStream to CreatorControls

## Task Commits

1. **Task 1: Extend session-store with Phase 8 state** - `f314e0f` (feat)
2. **Task 2: phase_signal SSE + mic_locked 409 in use-ai-stream** - `affc6f8` (feat)
3. **Task 3: Four Realtime broadcast handlers in use-session-channel** - `e29a3cf` (feat)
4. **Task 4: CreatorControls AdvancePhaseButton + InputBox micLocked** - `869959e` (feat)
5. **Workspace wiring: thread phaseSignal to CreatorControls** - `98ea200` (feat)

## Files Created/Modified

- `apps/web/store/session-store.ts` — Added CanvasNode/CanvasEdge imports; 4 state fields + 3 setters + initializers
- `apps/web/hooks/use-ai-stream.ts` — Added 'mic_locked' AIStreamStatus variant; 409 body parser; phase_signal SSE handler; phaseSignal/pendingPhaseId state + return
- `apps/web/hooks/use-session-channel.ts` — Added toast + CanvasNode/CanvasEdge imports; 4 broadcast handlers (mic_acquired, mic_released, canvas_update, phase_advanced)
- `apps/web/components/workspace/CreatorControls.tsx` — Added Badge/ChevronRight/Loader2 imports; phaseSignal/pendingPhaseId/onPhaseConsumed props; AdvancePhaseButton internal component; currentPhase Badge in desktop bar + mobile Sheet "Fase actual" section
- `apps/web/components/workspace/InputBox.tsx` — Added micLocked store read after activeBranchId (D-04, with no-unused-vars eslint suppression)
- `apps/web/app/(protected)/sessions/[id]/workspace.tsx` — Destructured phaseSignal/pendingPhaseId/resetStream from useAIStream; passed to CreatorControls

## Decisions Made

- phaseSignal + pendingPhaseId live in useAIStream component state rather than session-store: SSE signals are transient per-invoke events, not persistent session state. Threading via props keeps workspace as single hook owner.
- onPhaseConsumed wired to resetStream: resets all streaming state (including phaseSignal) after PATCH attempt. Acceptable because AI stream is already done by the time creator clicks.
- useEffect([phaseSignal]) for pulsing: avoids the useState-based previous-value tracking anti-pattern that would cause render loops.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect pulsing state management in AdvancePhaseButton**
- **Found during:** Task 4 (CreatorControls implementation)
- **Issue:** Initial implementation used a confusing `useState(false)` tuple as a previous-value tracker (prevPhaseSignalRef = useState(false)), calling setPulsing() and setPrevPhaseSignal() during render — a React anti-pattern that causes infinite re-render loops
- **Fix:** Replaced with `useEffect([phaseSignal])` pattern: effect runs when phaseSignal changes, sets pulsing true when phaseSignal becomes true, false when it resets
- **Files modified:** `apps/web/components/workspace/CreatorControls.tsx`
- **Verification:** TypeScript check passes; logic is idiomatic React
- **Committed in:** `869959e` (Task 4 commit)

**2. [Rule 2 - Missing Critical] Added workspace.tsx prop threading**
- **Found during:** Task 4 review (reviewing workspace page that renders CreatorControls)
- **Issue:** Plan said "Caller (workspace page) passes them through" and "phaseSignal + pendingPhaseId returned from useAIStream hook; CreatorControls reads them to enable button" — but workspace.tsx was not updated to destructure and pass these new return values from useAIStream
- **Fix:** Added phaseSignal, pendingPhaseId, resetStream to the useAIStream destructuring; passed phaseSignal/pendingPhaseId/onPhaseConsumed={resetStream} to CreatorControls
- **Files modified:** `apps/web/app/(protected)/sessions/[id]/workspace.tsx`
- **Verification:** TypeScript check passes; prop flow complete
- **Committed in:** `98ea200` (separate feat commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug, 1 Rule 2 missing critical wiring)
**Impact on plan:** Both auto-fixes essential for correct operation. No scope creep.

## Issues Encountered

- **tsc not on PATH in worktree:** The worktree does not have its own node_modules. Used `/home/jgm/dev/projects/web-projects/panelito/apps/web/node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json` as the TypeScript check command. TypeScript checks ran from the main project's node_modules against the worktree's source files via the tsconfig path.

## Threat Surface Scan

All STRIDE mitigations from the threat model are implemented:

| Threat ID | Mitigation | Implemented |
|-----------|------------|-------------|
| T-08-05-A (EoP: non-creator PATCH) | Button only renders inside `{isCreator && ...}` in workspace.tsx; server also enforces 403 ownership gate | ✓ |
| T-08-05-B (Tampering: cross-branch mic lock) | `payload.branch_id === activeBranchId` filter in mic_acquired/mic_released handlers | ✓ |
| T-08-05-C (Tampering: malformed phase_signal) | try/catch around JSON.parse; pendingPhaseId remains null on parse failure; button stays disabled | ✓ |
| T-08-05-D (Info: canvas data in store) | Accepted — canvas data is session-scoped, visible to all participants, no PII | accepted |
| T-08-05-SC (Tampering: npm install) | No new packages installed — all changes are source code extensions | ✓ |

No new threat surface introduced beyond what the plan specified.

## Known Stubs

None. All wired data flows are functional — phaseSignal/pendingPhaseId come from real SSE events, mic lock state from real Realtime broadcasts. Canvas nodes/edges will be populated when the backend sends canvas_update broadcasts (Phase 8 backend complete in Plan 04). Phase 9 will render canvasNodes/canvasEdges from store.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 8 complete: all five HUMAN-01/HUMAN-02/CANVAS-02 requirements satisfied
- session-store now holds canvasNodes/canvasEdges — Phase 9 (@xyflow/react) can read from store directly
- Advance Phase button fully wired: creator sees enabled indigo button when LLM emits phase_signal; PATCH fires; toast confirms for all participants
- No blockers for Phase 9 (Graph Canvas Frontend)

## Self-Check: PASSED

- `apps/web/store/session-store.ts` exists and contains micLocked (verified: 3 occurrences)
- `apps/web/hooks/use-ai-stream.ts` contains phase_signal handler (verified: 6 occurrences)
- `apps/web/hooks/use-session-channel.ts` contains 4 broadcast event handlers (verified: 4 event declarations)
- `apps/web/components/workspace/CreatorControls.tsx` contains "Avanzar fase", "Siguiente fase", "Avanzando" (verified: 3)
- `apps/web/components/workspace/InputBox.tsx` contains micLocked (verified: 2 occurrences)
- TypeScript `--noEmit` exits 0 with no errors
- Commits f314e0f, affc6f8, e29a3cf, 869959e, 98ea200 verified in git log

---
*Phase: 08-human-control-canvas-sync*
*Completed: 2026-07-03*
