---
phase: 09-graph-canvas-frontend
plan: "02"
subsystem: frontend-store-realtime
tags: [canvas, realtime, zustand, branch-switch, reconnect, canvas-view-mode, tdd]
dependency_graph:
  requires: [09-01]
  provides: [mergeCanvasData-store-action, canvas-reconnect-fetch, branch-switch-canvas-fetch, canvasViewMode-prop]
  affects: [session-store, use-session-channel, workspace, page-server-component, branch-navigator]
tech_stack:
  added: []
  patterns: [zustand-map-upsert, supabase-subscribed-callback, apiFetch-fail-silent, server-component-prop-pattern]
key_files:
  created: []
  modified:
    - apps/web/store/session-store.ts
    - apps/web/store/session-store.test.ts
    - apps/web/hooks/use-session-channel.ts
    - apps/web/app/(protected)/sessions/[id]/workspace.tsx
    - apps/web/app/(protected)/sessions/[id]/page.tsx
    - apps/web/components/workspace/BranchNavigator.tsx
decisions:
  - "mergeCanvasData uses Map-based upsert (not array concat) for O(n) correctness with updates"
  - "BranchNavigator receives onBranchSwitch? prop from Workspace — Workspace owns canvas fetch logic"
  - "page.tsx queries domain_blueprints directly via createServerClient (no Blueprint HTTP API)"
  - "canvasViewMode defaults to 'chart' on any failure — fail-silent preserves existing panel behavior"
metrics:
  duration: "9m 38s"
  completed: "2026-07-05"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 6
---

# Phase 9 Plan 2: Canvas Reconciliation and Panel-Routing Plumbing Summary

Client-side canvas reconciliation wired: merge-by-id store action for live broadcasts, full-replace reconnect fetch on Supabase SUBSCRIBED, full-replace fetch on branch switch, and server-side canvas_view_mode resolution passed as prop to Workspace.

## What Was Built

### Task 1: mergeCanvasData store action (TDD)

Added `mergeCanvasData(nodes, edges)` to `SessionStoreState` interface and implementation in `session-store.ts`. The action uses a `Map` keyed by node/edge id — existing entries as the base, incoming entries overwrite (upsert semantics). `setCanvasData` remains unchanged as a full-replace for branch-switch and reconnect use cases.

**TDD cycle:** RED (failing tests committed as `test(09-02)`) then GREEN (implementation committed as `feat(09-02)`) then no REFACTOR needed (implementation matched the pattern exactly).

**5 behavior tests cover:** add new nodes (union), update existing on collision (incoming wins without dropping others), empty arrays no-op, edge merge by id, setCanvasData regression guard.

### Task 2: canvas_update merge + SUBSCRIBED reconnect fetch

Modified `use-session-channel.ts`:

1. **canvas_update handler:** Changed `setCanvasData(nodes, edges)` to `mergeCanvasData(nodes, edges)`. Fixes Pitfall 3: live broadcasts carry only the current invocation's rows. Without this, each broadcast wiped all prior-invocation nodes. The existing `Array.isArray()` guards on payload are retained (T-09-05 mitigation).

2. **`.subscribe((status) => {...})` callback added:** On `status === 'SUBSCRIBED'`, reads `activeBranchId` from the store, calls `apiFetch GET /api/sessions/${sessionId}/canvas?branch_id=${activeBranchId}`, then `setCanvasData` (full replace). Ghost nodes are intentionally dropped on reconnect per D-03. `.catch(() => {})` fail-silent.

### Task 3: Branch-switch canvas fetch + server-side canvasViewMode prop

**workspace.tsx changes:**
- Added `canvasViewMode?: 'graph' | 'chart'` to `WorkspaceProps` (D-08, CANVAS-04)
- Added `fetchCanvas(branchId)` helper using `apiFetch GET /canvas?branch_id=` then `setCanvasData` full replace, `.catch(() => {})` fail-silent
- Added `handleBranchSwitch(branchId)` callback: calls `setBranchId(branchId)` then `fetchCanvas(branchId)` atomically (D-13)
- Passes `onBranchSwitch={handleBranchSwitch}` to BranchNavigator

**BranchNavigator.tsx changes:**
- Added `onBranchSwitch?: (branchId: string) => void` prop
- Branch chip `onClick` uses `onBranchSwitch(id)` when provided, falls back to `setBranchId(id)` otherwise

**page.tsx changes:**
- After branches fetch, reads `domain_blueprints` directly via `createServerClient` (no Blueprint HTTP API exists)
- Extracts `canvas_view_mode` from `blueprintRow.definition`; validates it is `'graph'` or `'chart'`
- Defaults to `'chart'` on any failure (missing blueprint_id, DB error, invalid value)
- Passes `canvasViewMode={canvasViewMode}` to `<Workspace>`

## Deviations from Plan

### Auto-fix: BranchNavigator needs onBranchSwitch prop

The plan stated "call `fetchCanvas(newBranchId)` immediately AFTER the existing `setBranchId(newBranchId)` in the branch-switch handler" in workspace.tsx. However, the actual branch switch (`setBranchId`) happens in `BranchNavigator.tsx` via a direct store call, not in workspace.tsx. workspace.tsx lines 155-176 contain the auto-unfreeze logic, not a branch switch handler.

**Fix:** Added `onBranchSwitch?: (branchId: string) => void` prop to BranchNavigator. Workspace.tsx defines `handleBranchSwitch` that calls both `setBranchId` and `fetchCanvas`, and passes it to BranchNavigator. BranchNavigator uses the callback if provided, falls back to `setBranchId` otherwise. This matches the plan's intent of having canvas fetch logic in workspace.tsx.

**Files modified:** `apps/web/components/workspace/BranchNavigator.tsx`
**Rule:** Rule 1 — Bug fix (plan's mental model of code structure was incorrect; fix applied automatically)

### Blueprint loading via Supabase server client (not loadBlueprint import)

The plan said "prefer a direct `loadBlueprint(session.blueprint_id)` import from the api package if importable from the server component". After reading `apps/api/src/lib/blueprint-loader.ts`, it was clear the function imports `createServiceClient` from the API's Supabase lib and `Ajv` — cross-package imports with server-only dependencies not available in the web package.

**Fix:** Used `createServerClient` (already imported in page.tsx) to query `domain_blueprints` directly, extracting `canvas_view_mode` with a lightweight type guard. Only the `canvas_view_mode` field is read; a literal comparison guards against invalid values. Full Ajv validation is unnecessary since only one field is extracted.

**Rule:** Rule 1 — Bug fix (cross-package import would have caused a build error at runtime)

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test) | `8f8582d` test(09-02): add failing tests for mergeCanvasData upsert-by-id semantics | PASS |
| GREEN (feat) | `6dff459` feat(09-02): implement mergeCanvasData upsert-by-id store action | PASS |
| REFACTOR | N/A — implementation was clean on first pass | N/A |

## Known Stubs

None. All functionality is wired to real data sources:
- `mergeCanvasData` operates on live Zustand store state
- `fetchCanvas` calls the real API endpoint built in 09-01
- `canvasViewMode` reads from the real `domain_blueprints` table

## Threat Flags

None — all changes are within the threat model defined in the plan:
- T-09-05 (canvas_update payload tampering): existing `Array.isArray()` guards retained in merge handler
- T-09-06 (canvasViewMode disclosure): server-side resolution only, fail-silent, non-sensitive field
- T-09-07 (reconnect storm DoS): SUBSCRIBED fires on subscribe only, fetch is bounded

## Self-Check: PASSED

Files exist: session-store.ts FOUND, session-store.test.ts FOUND, use-session-channel.ts FOUND, workspace.tsx FOUND, page.tsx FOUND, BranchNavigator.tsx FOUND

Commits exist: 8f8582d FOUND, 6dff459 FOUND, 6548057 FOUND, ecfac8c FOUND

Tests: 9/9 pass (pnpm --filter @panelito/web test -- session-store.test.ts)
TypeScript: pnpm --filter @panelito/web exec tsc --noEmit exits 0
