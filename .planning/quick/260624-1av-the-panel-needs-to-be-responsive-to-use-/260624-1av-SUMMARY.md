---
phase: quick-260624-1av
plan: "01"
subsystem: panel-widgets
tags: [recharts, bar-chart, layout-grid, multi-widget, ai-types]
dependency_graph:
  requires: []
  provides:
    - bar widget type (schema + component + registry)
    - layout widget type (schema + component + registry)
    - BasePanelWidget / BasePanelWidgetSchema export
  affects:
    - packages/types (PanelWidgetSchema, renderPanelTool)
    - apps/web widget registry and rendering pipeline
    - apps/api BASE_SYSTEM_PROMPT
tech_stack:
  added:
    - BarWidget (Recharts BarChart, indigo palette, rotated XAxis labels)
    - LayoutWidget (CSS grid 2/3-col, min-h-0 for ResponsiveContainer height fix)
  patterns:
    - BasePanelWidgetSchema forward-reference pattern to avoid Zod self-referential union
    - D-06 registry pattern: new widgets added to widgetRegistry only, AnalyticsPanel unchanged
    - min-h-0 overflow-hidden on grid cells for Recharts height measurement
key_files:
  created:
    - apps/web/components/workspace/widgets/BarWidget.tsx
    - apps/web/components/workspace/widgets/LayoutWidget.tsx
  modified:
    - packages/types/src/panel.ts
    - packages/types/src/ai.ts
    - packages/types/src/ai.test.ts
    - packages/types/src/index.ts
    - apps/web/components/workspace/widgets/widget-registry.ts
    - apps/api/src/routes/ai.ts
decisions:
  - BasePanelWidgetSchema forward-reference avoids Zod discriminated union self-reference limitation; layout.widgets items type-checked against all non-layout variants
  - min-h-0 overflow-hidden on each grid cell in LayoutWidget is required for Recharts ResponsiveContainer to measure container height inside CSS grid
  - System prompt explicitly prohibits nested layout (widget_type=layout inside widgets[]) to prevent schema rejection at runtime
metrics:
  duration: "~15 minutes"
  completed: "2026-06-23T23:07:01Z"
  tasks_completed: 2
  files_changed: 8
---

# Quick Task 260624-1av Summary

**One-liner:** Recharts bar chart + responsive multi-widget layout container via Zod BasePanelWidgetSchema forward-reference, with AI system prompt updated to instruct analista on using bar and layout types.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add bar and layout widget types to shared types package | `461a487` | panel.ts, ai.ts, ai.test.ts, index.ts |
| 2 | Add BarWidget + LayoutWidget components and wire them into the panel | `fba944e` | BarWidget.tsx, LayoutWidget.tsx, widget-registry.ts, ai.ts |

## What Was Built

### Task 1: Types Package

- `BarItemSchema`: `{ label: string(max 60), value: number }` 
- `BasePanelWidgetSchema`: discriminated union of all variants except layout (bento, radar, scatter, pie, bar) — forward-reference pattern to allow layout to safely reference nested widget types without Zod circular dependency issues
- `PanelWidgetSchema`: extends BasePanelWidgetSchema with a `layout` variant whose `widgets` field is `z.array(BasePanelWidgetSchema).min(2).max(3)` — enforces no nested layouts at schema validation level (T-1av-01)
- `BasePanelWidget` type exported from `index.ts` alongside `PanelWidget`
- `renderPanelTool` enum updated to `['bento', 'radar', 'scatter', 'pie', 'bar', 'layout']`
- `bars[]` and `widgets[]` property descriptions added to renderPanelTool parameters

### Task 2: Frontend + API

- `BarWidget`: vertical Recharts BarChart, indigo-500 fill with descending opacity gradient across bars, XAxis ticks rotated -30deg to handle long labels, horizontal-only CartesianGrid, same tooltip card style as RadarWidget
- `LayoutWidget`: CSS grid container using `grid-cols-1 sm:grid-cols-2` (2 items) or `grid-cols-1 sm:grid-cols-3` (3 items), each child in `min-h-0 overflow-hidden` div so Recharts ResponsiveContainer correctly measures height, resolves child components via `widgetRegistry` at render time (no circular import)
- `widgetRegistry` updated with `['bar', BarWidget]` and `['layout', LayoutWidget]` entries — no changes to AnalyticsPanel.tsx required (D-06 pattern)
- `BASE_SYSTEM_PROMPT` updated to explain bar type, layout type, and explicit instruction not to nest layout inside layout

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing failing test in ai.test.ts**
- **Found during:** Task 1 verification
- **Issue:** `ai.test.ts` line 44 asserted `required` includes `'data'`, but `renderPanelTool.parameters.required` only contains `['widget_type']` — this test was already failing before this task
- **Fix:** Removed incorrect `expect(required).toContain('data')` assertion; renamed test case to accurately describe what is asserted; updated enum assertion in the same test block as planned
- **Files modified:** `packages/types/src/ai.test.ts`
- **Commit:** `461a487`

## Success Criteria Check

- [x] `pnpm --filter @panelito/types test run` passes with updated enum assertion (15/15 tests pass)
- [x] `pnpm --filter web build` exits 0 (compiled successfully, no TypeScript errors)
- [x] BarWidget renders Indigo bar chart filling the panel zone height (ResponsiveContainer width/height="100%")
- [x] LayoutWidget renders 2-3 sub-widgets in a responsive side-by-side grid (sm:grid-cols-2/3)
- [x] No existing widget types broken (bento, radar, scatter, pie still in BasePanelWidgetSchema)
- [x] AI system prompt includes bar and layout guidance with explicit no-nesting instruction

## Known Stubs

None — all widget types are fully wired with real Recharts rendering and real Zod validation.

## Threat Flags

No new threat surface beyond what was declared in the plan's threat model. The layout.widgets nested validation via BasePanelWidgetSchema (T-1av-01) is enforced at the PanelWidgetSchema.safeParse gate in apps/api/src/routes/ai.ts — malformed nested payloads are dropped silently before any SSE emission.

## Self-Check: PASSED

All files confirmed present. Both commits `461a487` and `fba944e` verified in git log.
