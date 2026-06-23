---
phase: quick-260624-1pn
plan: "01"
subsystem: panel-widgets
tags: [widgets, recharts, react-simple-maps, line-chart, timeline, map, bar, layout]
dependency_graph:
  requires: [packages/types/src/panel.ts, apps/web/components/workspace/widgets/widget-registry.ts]
  provides: [LineWidget, TimelineWidget, MapWidget, BarWidget, LayoutWidget]
  affects: [apps/web, apps/api, packages/types]
tech_stack:
  added: [react-simple-maps@^3.0.0]
  patterns: [D-06 widget registry, BasePanelWidgetSchema discriminated union, Recharts ResponsiveContainer]
key_files:
  created:
    - apps/web/components/workspace/widgets/LineWidget.tsx
    - apps/web/components/workspace/widgets/TimelineWidget.tsx
    - apps/web/components/workspace/widgets/MapWidget.tsx
    - apps/web/components/workspace/widgets/BarWidget.tsx
    - apps/web/components/workspace/widgets/LayoutWidget.tsx
  modified:
    - packages/types/src/panel.ts
    - packages/types/src/ai.ts
    - packages/types/src/index.ts
    - apps/web/components/workspace/widgets/widget-registry.ts
    - apps/web/package.json
    - apps/api/src/routes/ai.ts
decisions:
  - "line variant uses line_points (not points) to avoid collision with scatter's points field in renderPanelTool JSON Schema"
  - "BasePanelWidgetSchema introduced to avoid self-referential type error for layout's widgets[] items"
  - "react-simple-maps 3.0 works with React 19 despite peer warning (conservative version range)"
  - "Natural Earth (geoNaturalEarth1) projection chosen for better geographic proportions"
  - "1av changes (bar, layout, BarWidget, LayoutWidget) included in this task since that branch is not yet merged to main"
metrics:
  duration: "5 min"
  completed: "2026-06-23T23:23:39Z"
  tasks_completed: 2
  files_count: 11
---

# Phase quick-260624-1pn Plan 01: Line, Timeline, and Map Widgets Summary

**One-liner:** Added LineWidget (Recharts), TimelineWidget (pure Tailwind), and MapWidget (react-simple-maps Natural Earth) plus BarWidget/LayoutWidget from prior unmerged task — all registered via D-06 widgetRegistry with full Zod schema coverage in BasePanelWidgetSchema.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| Task 1 | Extend types: BasePanelWidgetSchema with bar/line/timeline/map; renderPanelTool enum updated | 988f024 |
| Task 2 | Create 5 widget components + register; update AI system prompt | ed52ac2 |
| Chore | Add react-simple-maps to apps/web/package.json | 1c9b78f |

## What Was Built

### New Widget Types (Zod schemas in BasePanelWidgetSchema)

- **bar** — `bars: [{label, value}]` min 2, max 12
- **line** — `line_points: [{x, y}]` min 2, max 50 (field named `line_points` not `points` to avoid collision with scatter)
- **timeline** — `events: [{date, label, description?}]` min 1, max 20
- **map** — `countries: [{code, label, value?}]` min 1, max 50; `highlight_color` optional hex

All 4 base variants are valid inside `layout.widgets[]` (BasePanelWidgetSchema).

### Widget Components

- **BarWidget** — Recharts BarChart, indigo cells with descending opacity, rotated XAxis labels
- **LayoutWidget** — CSS grid 2-col or 3-col; min-h-0 cells for correct Recharts height measurement
- **LineWidget** — Recharts LineChart, monotone curve, dots shown when ≤10 points, indigo line
- **TimelineWidget** — Pure CSS/Tailwind, horizontal scrollable, indigo dots with connector line, date/label/description stack
- **MapWidget** — react-simple-maps ComposableMap, Natural Earth projection, topojson from jsDelivr CDN, country legend below map

### AI Tooling Updates

- `renderPanelTool.enum` extended: `['bento','radar','scatter','pie','bar','layout','line','timeline','map']`
- New parameter docs: `bars`, `widgets`, `line_points`, `events`, `countries`, `highlight_color`
- `BASE_SYSTEM_PROMPT` updated to mention line, timeline, map, and layout guidance

## Deviations from Plan

### Auto-included Issues

**1. [Rule 2 - Missing functionality] Included 1av BarWidget/LayoutWidget since unmerged**
- **Found during:** Task 2
- **Issue:** The plan's constraint notes referenced 1av changes (bar, layout, BasePanelWidgetSchema) as already applied, but the 1av branch was not yet merged to main. The worktree was based on main.
- **Fix:** Included BarWidget, LayoutWidget, and BasePanelWidgetSchema structure directly in this task's commits — additive, no conflict.

**2. [Rule 3 - Blocking] worktree package.json not updated by pnpm --filter**
- **Found during:** Task 2
- **Issue:** `pnpm --filter @panelito/web add react-simple-maps` updated the main repo's `apps/web/package.json` (different inode from worktree's copy).
- **Fix:** Manually edited worktree `apps/web/package.json` and committed separately.

## Verification

- `pnpm --filter @panelito/types typecheck` — PASS
- `pnpm --filter @panelito/web typecheck` — PASS
- `pnpm --filter @panelito/api typecheck` — PASS
- All 5 new widget components exist and are registered in widgetRegistry
- BasePanelWidgetSchema discriminated union includes line, timeline, map, bar variants
- renderPanelTool enum includes all 9 widget types

## Threat Surface Scan

T-1pn-01 through T-1pn-SC threats from plan's threat model addressed:
- `highlight_color` used only as SVG fill attribute — React escapes it
- Country codes used as Map lookup keys only — no code execution from AI payload
- CDN topojson fetch: static asset, blank map on unavailable CDN

No new threat surface beyond what was in the plan's threat model.

## Self-Check: PASSED

- LineWidget.tsx: FOUND
- TimelineWidget.tsx: FOUND
- MapWidget.tsx: FOUND
- BarWidget.tsx: FOUND
- LayoutWidget.tsx: FOUND
- Commits 988f024, ed52ac2, 1c9b78f: VERIFIED in git log
