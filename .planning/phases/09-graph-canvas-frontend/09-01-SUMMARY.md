---
phase: 09-graph-canvas-frontend
plan: 01
subsystem: backend
tags: [canvas, ghost-nodes, api-routes, pg-cron, panel-types, dagre]
dependency_graph:
  requires: [08-05]
  provides: [canvas-api-endpoints, ghost-persistence, graph-panel-type, ghost-expiry-job]
  affects: [ai.ts, canvas_nodes, panel.ts, widget-registry]
tech_stack:
  added: ["@dagrejs/dagre@3.0.0"]
  patterns:
    - "Hono router split: canvasSessionRouter + canvasNodesRouter"
    - "Session membership check via messages table count (ASVS V4)"
    - "Ghost ops upserted in same code path as committed ops, different status value"
    - "canvas_update broadcast includes both committed and ghost rows (D-02)"
    - "panel_update broadcast with widget_type='graph' triggers panel switch (D-07)"
key_files:
  created:
    - apps/api/src/routes/canvas.ts
    - apps/api/src/routes/canvas.test.ts
    - supabase/migrations/0011_ghost_expiry.sql
  modified:
    - packages/types/src/panel.ts
    - packages/types/src/ai.ts
    - packages/types/src/ai.test.ts
    - apps/api/src/routes/ai.ts
    - apps/api/src/index.ts
    - apps/api/src/lib/ai-provider.test.ts
    - apps/web/package.json
decisions:
  - "canvasSessionRouter handles GET /:id/canvas; canvasNodesRouter handles PATCH /:id — mounted separately to avoid /sessions nesting requirement"
  - "Session membership for PATCH verified via messages table count (creator OR participant with >=1 message)"
  - "Ghost ops use separate ghostNodeIdMap to allow ghost edges referencing ghost nodes within same invocation"
  - "panel_update fires only when canvas rows were actually written (allNodeRows.length > 0 guard)"
metrics:
  duration: "11 minutes"
  completed_date: "2026-07-05"
  tasks_completed: 4
  tasks_total: 5
  files_modified: 9
  files_created: 3
---

# Phase 9 Plan 1: Backend Foundation Summary

## One-liner

Canvas API endpoints (GET committed + PATCH status), ghost-node persistence reversal in ai.ts with combined canvas_update broadcast, panel_update('graph') trigger, and pg_cron 60-second ghost expiry migration.

## What Was Built

### Task 1: 'graph' PanelWidget type + @dagrejs/dagre

Added `z.literal("graph")` to `BasePanelWidgetSchema` in `packages/types/src/panel.ts`. Since `PanelWidgetSchema` uses `...BasePanelWidgetSchema.options`, 'graph' is present in both schemas. The variant carries no data payload (D-06: GraphCanvas reads from sessionStore directly). `@dagrejs/dagre@3.0.0` added to `apps/web/package.json`. Types build passes.

### Task 2: Canvas endpoints (canvas.ts router)

Created `apps/api/src/routes/canvas.ts` with two exported routers:

- `canvasSessionRouter`: `GET /:id/canvas` — returns committed-only nodes and edges for a branch (D-03). Uses `Promise.all` for parallel node/edge queries filtered by `status='committed'`.
- `canvasNodesRouter`: `PATCH /:id` — validates `z.enum(['committed','silent'])` (T-09-02), fetches node.session_id, verifies caller is creator or has sent at least one message in the session (T-09-01, ASVS V4), updates status, broadcasts `canvas_update` fire-and-forget.

Both routers registered in `apps/api/src/index.ts`. Final paths: `/api/sessions/:id/canvas` and `/api/canvas_nodes/:id`. Test file created with 200/400/403/404 coverage.

### Task 3: Ghost-node persistence + panel_update in ai.ts

Modified `apps/api/src/routes/ai.ts` to implement Phase 9 D-01 reversal of Phase 8 D-14:

- Added `ghostOps` filter on `op.status === 'ghost'`
- Ghost ADD_NODE ops upserted with `status='ghost'`, `position_x=null`, server-generated UUIDs
- Separate `ghostNodeIdMap` used for ghost ADD_EDGE → ADD_NODE ordering (D-17)
- `canvas_update` broadcast now sends `[...committedNodeRows, ...ghostNodeRows]` (D-02)
- `panel_update` broadcast with `{ widget_type: 'graph' }` fires after canvas upserts (D-07)
- `'graph'` added to `renderPanelTool.parameters.widget_type.enum` in `packages/types/src/ai.ts` (Pitfall 6)

### Task 4: pg_cron ghost expiry migration 0011

Created `supabase/migrations/0011_ghost_expiry.sql`:
- `cron.schedule('canvas-ghost-expiry', '* * * * *', ...)` deletes ghosts older than 60 seconds
- No `CREATE EXTENSION` (pg_cron already enabled in 0004)
- No `ALTER TABLE` (status CHECK already includes 'ghost' from 0008)

### Task 5: Push migration to Supabase (PENDING — human action required)

Migration 0011 has NOT been pushed to the live Supabase project. This is a blocking checkpoint that requires human action (see checkpoint response below).

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 7cda8c0 | feat(09-01): add 'graph' PanelWidget type + install @dagrejs/dagre |
| 2 | 3d038e9 | feat(09-01): canvas read + status-PATCH endpoints |
| 3 | d202eb7 | feat(09-01): ghost-node persistence + panel_update in ai.ts |
| 4 | f7fbee4 | feat(09-01): pg_cron ghost expiry migration 0011 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed stale widget_type enum in ai-provider.test.ts**
- **Found during:** Task 3 (adding 'graph' to renderPanelTool enum)
- **Issue:** `apps/api/src/lib/ai-provider.test.ts` expected only `['bento','radar','scatter','pie']` when the actual enum had grown to 9 values (bar, layout, line, timeline, map added in prior phases). The test also incorrectly expected 'data' in `required` when the actual required array only contains 'widget_type'.
- **Fix:** Updated enum expectation to match current reality (all 10 values including 'graph'); removed stale 'data' required check
- **Files modified:** `apps/api/src/lib/ai-provider.test.ts`
- **Commit:** d202eb7

**2. [Rule 2 - Missing functionality] Updated renderPanelTool enum to include 'graph'**
- **Found during:** Task 3 (Pitfall 6 from RESEARCH.md)
- **Issue:** Without 'graph' in the renderPanelTool enum, the AI cannot select the graph widget type. The PanelWidgetSchema safeParse would reject `{ widget_type: 'graph' }` at the AI output parsing stage.
- **Fix:** Added 'graph' to `packages/types/src/ai.ts` renderPanelTool enum; updated `packages/types/src/ai.test.ts` accordingly
- **Files modified:** `packages/types/src/ai.ts`, `packages/types/src/ai.test.ts`
- **Commit:** d202eb7

### Pre-existing Failures (Out of Scope)

The following test failures existed BEFORE this plan and are NOT caused by these changes (verified by reverting and re-running):
- `ai.test.ts` SC-2 and SC-3 (SSE stream + abort signal): getting 404 from mocked invoke route — pre-existing mock routing issue
- `keys.test.ts`: `null value in column "blueprint_id"` — DB schema constraint issue unrelated to canvas work

These are logged to deferred items per deviation rule scope boundary.

## Known Stubs

None. All implementations wire to real DB operations.

## Threat Flags

None beyond those in the plan's threat_model. The session membership check (T-09-01) is implemented as specified.

## Self-Check: PASSED

Files created/modified:
- [x] apps/api/src/routes/canvas.ts — EXISTS
- [x] apps/api/src/routes/canvas.test.ts — EXISTS
- [x] supabase/migrations/0011_ghost_expiry.sql — EXISTS
- [x] packages/types/src/panel.ts — MODIFIED (z.literal("graph") added)
- [x] packages/types/src/ai.ts — MODIFIED ('graph' in enum)
- [x] apps/api/src/routes/ai.ts — MODIFIED (ghost persistence + panel_update)
- [x] apps/api/src/index.ts — MODIFIED (canvas routes registered)
- [x] apps/web/package.json — MODIFIED (@dagrejs/dagre added)

Commits verified:
- [x] 7cda8c0 — Task 1 commit
- [x] 3d038e9 — Task 2 commit
- [x] d202eb7 — Task 3 commit
- [x] f7fbee4 — Task 4 commit
