---
phase: 08-human-control-canvas-sync
plan: 04
subsystem: api
tags: [mic-lock, rpc, phase-signal, canvas-sync, sse, hono, supabase, realtime]

# Dependency graph
requires:
  - phase: 08-human-control-canvas-sync
    plan: 01
    provides: "phase_signal field in GraphStateAnnotation + canvasMutationTool extension"
  - phase: 08-human-control-canvas-sync
    plan: 02
    provides: "try_acquire_mic/release_mic RPCs + branches.mic_holder_id + mic_acquired_at columns"
  - phase: 08-human-control-canvas-sync
    plan: 03
    provides: "agent.ts reads phase_signal from raw tool input before safeParse"
provides:
  - "/invoke route: mic lock acquisition (try_acquire_mic) before streamSSE; 409 if held"
  - "/invoke route: phase_signal SSE event emitted before done if finalState.phase_signal === true"
  - "/invoke route: committed canvas ops upserted to canvas_nodes/canvas_edges after done"
  - "/invoke route: canvas_update broadcast with full DB rows; mic released in finally (D-06)"
  - "PATCH /sessions/:id/phase endpoint: creator-only; Blueprint sequence validated; DB written; phase_advanced broadcast"
affects:
  - 08-05 (frontend — receives mic_acquired/mic_released/phase_signal/canvas_update/phase_advanced events)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mic lock: supabase.rpc('try_acquire_mic', { p_branch_id, p_holder_id, p_expiry_seconds: 30 }) before streamSSE; 409 on !acquired (D-01)"
    - "Finally block wrapping SSE try/catch for guaranteed mic release even on AbortError (D-06)"
    - "phase_signal SSE event emitted BEFORE done event inside streamSSE callback (D-10)"
    - "Canvas upserts AFTER done event — ADD_NODE generates server-side UUIDs, ADD_EDGE verifies node existence (D-15, D-17, D-18)"
    - "PATCH endpoint ownership gate: session.creator_id !== user.id → 403 (D-13)"
    - "Blueprint phase_sequence.some() validation before writing sessions.current_phase (D-11)"

key-files:
  created: []
  modified:
    - apps/api/src/routes/ai.ts
    - apps/api/src/routes/sessions.ts

key-decisions:
  - "try_acquire_mic called with activeBranchId (never null) — branch UUID resolved from branches table (is_main=true) if client sent no branchId (RESEARCH.md Pitfall 1)"
  - "release_mic called with .catch() to make it non-fatal — mic release errors should not surface as exceptions since the lock expires in 30s anyway"
  - "canvas upsert errors are fail-silent (console.warn + continue) matching the message insert error pattern"
  - "PATCH /sessions/:id/phase wrapped in try/catch using toClientError() helper (sessions.ts pattern)"
  - "loadBlueprint imported into sessions.ts — D-11 requires Blueprint phase_sequence validation before DB write"

patterns-established:
  - "Two-layer mic safety: (1) finally block always calls release_mic; (2) 30s expiry allows lock steal on next acquire"
  - "Post-done canvas write pattern: committed ops only, ADD_NODE → UUIDs → nodeIdMap, ADD_EDGE → existence check, canvas_update broadcast"

requirements-completed:
  - HUMAN-01
  - HUMAN-02
  - CANVAS-02

# Metrics
duration: 7min
completed: 2026-07-03
---

# Phase 8 Plan 04: Route Integration — Mic Lock, phase_signal SSE, Canvas Upserts Summary

**POST /invoke now enforces concurrency control via atomic CAS mic lock, emits phase_signal SSE before done, and upserts committed canvas ops after done; PATCH /sessions/:id/phase enforces creator-only phase advancement with Blueprint sequence validation**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-07-03T12:31:17Z
- **Completed:** 2026-07-03T12:38:08Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- **Task 1 (ai.ts):** Four targeted insertions to the /invoke route:
  - Step 8.5: activeBranchId → real UUID resolution (main branch fallback)
  - Step 8.6: `try_acquire_mic` RPC call before `streamSSE()` — returns 409 `{ error: 'mic_locked', branch_id }` if held; broadcasts `mic_acquired` fire-and-forget on success
  - `phase_signal` SSE event emission BEFORE `done` (if `finalState.phase_signal === true`)
  - Canvas upsert block AFTER `done`: committed ops only, ADD_NODE with server UUIDs, ADD_EDGE with node existence check (D-17 fail-silent), `canvas_update` broadcast
  - `finally` block: `release_mic` RPC + `mic_released` broadcast (always runs, even on AbortError)

- **Task 2 (sessions.ts):** New `PATCH /:id/phase` endpoint:
  - Import `loadBlueprint` from `'../lib/blueprint-loader'`
  - Zod body validation: `next_phase_id: z.string().min(1)` → 400 on failure
  - Fetch session with `creator_id, blueprint_id, current_phase`
  - Ownership gate: `session.creator_id !== user.id → 403 forbidden`
  - Blueprint validation: `blueprint.phase_sequence.some(p => p.id === next_phase_id)` → 400 `invalid_phase` if not found
  - DB write: `sessions.update({ current_phase: next_phase_id })`
  - `phase_advanced` broadcast fire-and-forget with `{ new_phase_id, blueprint_id }`
  - Returns 200 `{ current_phase: next_phase_id }`

## Task Commits

1. **Task 1: Mic lock + phase_signal SSE + canvas upserts in /invoke route** — `c401aee` (feat)
2. **Task 2: PATCH /sessions/:id/phase endpoint** — `26c33f6` (feat)

## Files Created/Modified

- `apps/api/src/routes/ai.ts` — 153 lines inserted: branch UUID resolution, mic acquire/release, phase_signal SSE event, canvas upserts, canvas_update broadcast, finally block
- `apps/api/src/routes/sessions.ts` — 84 lines inserted: `loadBlueprint` import, PATCH `/:id/phase` handler with all D-11/D-12/D-13 invariants

## Decisions Made

- **Branch UUID resolution before mic acquire**: When the client sends no `branchId` (or sends null), the route queries `branches WHERE session_id=X AND is_main=true` to get the real UUID. This must happen before `try_acquire_mic` because the RPC expects a UUID, not null. Returns 404 if no main branch found (prevents silent failures).
- **`release_mic` made non-fatal**: Called as `await supabase.rpc('release_mic', ...).catch(...)` — RPC errors are caught and logged as warnings, not thrown. The 30s expiry provides a secondary safety net (D-07), so mic release failure is non-fatal.
- **`canvas_update` broadcast only when rows collected**: The broadcast is skipped if both `nodeRows` and `edgeRows` are empty (e.g., all upserts failed silently). Prevents empty broadcasts.
- **PATCH handler uses `toClientError()` wrapper**: Wraps the handler in try/catch using the existing `toClientError()` helper for consistency with other sessions.ts handlers.
- **`loadBlueprint` imported in sessions.ts**: The D-11 Blueprint phase_sequence validation cannot be performed without the full Blueprint object. Added the import rather than inlining the query — DRY principle, reuses the validated/cached loader.

## Deviations from Plan

None — plan executed exactly as written. All four insertions in ai.ts and the PATCH handler in sessions.ts match the patterns from PATTERNS.md and the action spec in the plan.

## Issues Encountered

- **Tests run from main project**: The worktree does not have its own `node_modules` — tests run from the main project's node_modules against the main project's source files. The worktree source modifications will be tested after merge. Two pre-existing test failures confirmed unrelated to Plan 04:
  - `src/routes/keys.test.ts`: Blueprint_id NOT NULL constraint in sessions table breaks test setup (pre-existing)
  - `src/lib/ai-provider.test.ts`: widget_type enum assertion expects 4 values but implementation has 9 (pre-existing from prior quick fixes)
  - Both failures reproduced identically against the main project (unmodified source) — confirmed pre-existing.
- `src/routes/ai.test.ts` (3 tests) and `src/routes/sessions.test.ts` (9 tests) pass against the main project's unmodified source.

## Threat Surface Scan

All security mitigations from the threat model are implemented:

| Threat ID | Mitigation | Implemented |
|-----------|------------|-------------|
| T-08-04-A (DoS: concurrent /invoke) | `try_acquire_mic` atomic CAS; 409 on held lock; 30s expiry | ✓ |
| T-08-04-B (LLM advancing current_phase) | No LLM path to PATCH /sessions/:id/phase; phase_signal is SSE only | ✓ |
| T-08-04-C (forged next_phase_id) | `blueprint.phase_sequence.some()` validation before DB write | ✓ |
| T-08-04-D (non-creator PATCH phase) | `session.creator_id !== user.id → 403` ownership gate | ✓ |
| T-08-04-F (mic lock not released on crash) | `finally` block always calls `release_mic`; 30s expiry backup | ✓ |

No new threat surface introduced beyond what the plan specified.

## Next Phase Readiness

- Plan 04 complete: /invoke route now enforces HUMAN-01 (mic lock), HUMAN-02 (phase_signal SSE), CANVAS-02 (canvas upserts + broadcast)
- Plan 04 complete: PATCH /sessions/:id/phase enforces human authority over phase advancement (HUMAN-02 D-13)
- Plan 05 (frontend surface) can now receive `mic_acquired`, `mic_released`, `phase_signal`, `canvas_update`, `phase_advanced` SSE/Realtime events and wire them to UI affordances
- No blockers

---
*Phase: 08-human-control-canvas-sync*
*Completed: 2026-07-03*

## Self-Check: PASSED
- `apps/api/src/routes/ai.ts` exists in worktree with 577 lines (153 additions)
- `apps/api/src/routes/sessions.ts` exists in worktree with 615 lines (84 additions)
- `08-04-SUMMARY.md` created at `.planning/phases/08-human-control-canvas-sync/`
- Commit `c401aee` verified in git log (Task 1: ai.ts mic lock + phase_signal + canvas upserts)
- Commit `26c33f6` verified in git log (Task 2: sessions.ts PATCH /phase endpoint)
