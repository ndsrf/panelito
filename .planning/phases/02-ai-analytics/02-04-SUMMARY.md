---
phase: 02-ai-analytics
plan: 04
subsystem: frontend
tags: [recharts, framer-motion, zustand, react, typescript, widget-registry, animation, analytics-panel]

# Dependency graph
requires:
  - phase: 02-ai-analytics
    plan: 03
    provides: usePanelStore (widgetType/widgetData/branchId), AnalyticsPanel.isStreaming prop wired

provides:
  - widgetRegistry Map<widget_type, WidgetComponent> (D-06) — extensible, single extension point
  - BentoGrid, RadarWidget, ScatterWidget, PieWidget — four Recharts-based widget components
  - AnalyticsPanel with 36px header strip (PANEL-03): "Main" branch badge + "Analizando..." pulse
  - AnimatePresence mode="wait" keyed ${widgetType}-${branchId} morph transition (D-08)
  - Dynamic widget zone inside AnalyticsPanelErrorBoundary (LAYOUT-07 preserved)

affects:
  - 02-05 (persona management: panel header strip is visual context for persona-driven widgets)
  - 02-06 (reactions: widget zone morph triggers on 🔥/📌/🎯 reaction-invoked AI updates)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "widgetRegistry = new Map<PanelWidget['widget_type'], WidgetComponent>([...]) — D-06 extensible registry"
    - "TooltipContentProps (default generics) for Recharts 3.x custom tooltips — rendered as functions, not JSX elements"
    - "AnimatePresence mode='wait' + motion.div keyed on '${widgetType}-${branchId}' — D-08 morph"
    - "WidgetZone inner client component pattern — allows class-component ErrorBoundary to wrap hooks-using component"
    - "Recharts TooltipContentProps: pass as function (renderTooltip), not JSX element (<CustomTooltip />) to satisfy ContentType<ValueType, NameType>"

key-files:
  created:
    - apps/web/components/workspace/widgets/BentoGrid.tsx
    - apps/web/components/workspace/widgets/RadarWidget.tsx
    - apps/web/components/workspace/widgets/ScatterWidget.tsx
    - apps/web/components/workspace/widgets/PieWidget.tsx
    - apps/web/components/workspace/widgets/widget-registry.ts
    - apps/web/components/workspace/widgets/widget-registry.test.tsx
  modified:
    - apps/web/components/workspace/AnalyticsPanel.tsx (header strip + AnimatePresence widget zone)

key-decisions:
  - "WidgetZone inner client component: ErrorBoundary (class) must wrap hooks-using component; extracted WidgetZone as a function that reads usePanelStore so the class boundary can wrap it cleanly"
  - "Recharts 3.x custom tooltip: pass render function (not JSX element) as content prop to satisfy ContentType<ValueType, NameType> type constraint — JSX element requires all required props at construction time"
  - "TooltipContentProps default generics: using <number, string> narrows the ContentType which Tooltip's content prop doesn't accept; using default generics satisfies ContentType<ValueType, NameType>"
  - "node_modules symlink created in worktree: worktree's apps/web had no node_modules; symlinked to main repo's apps/web/node_modules per vitest.config.ts comment"

requirements-completed: [PANEL-01, PANEL-02, PANEL-03, PANEL-04]

# Metrics
duration: ~30min
completed: 2026-06-14
---

# Phase 2 Plan 04: Widget Components + AnalyticsPanel Dynamic Zone Summary

**Four Recharts-based widget components (bento/radar/scatter/pie) with an extensible registry Map, and AnalyticsPanel extended with a 36px branch-badge header strip and Framer Motion morph transitions (D-08) inside the LAYOUT-07 error boundary**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-13T23:00:00Z
- **Completed:** 2026-06-13T23:20:00Z
- **Tasks:** 2 auto tasks complete + 1 checkpoint (human-verify) pending
- **Files modified:** 7

## Accomplishments

- Created `BentoGrid.tsx`: CSS grid (2-col mobile / 3-col desktop), shadcn Card per bento card with category/concept/score layout, overflow-y auto
- Created `RadarWidget.tsx`: Recharts `ResponsiveContainer` → `RadarChart` with PolarGrid, PolarAngleAxis (11px muted tick), Radar (Indigo 500, 20% fill opacity), custom tooltip function (Recharts 3.x render-function pattern)
- Created `ScatterWidget.tsx`: Recharts ScatterChart with XAxis "Consenso" / YAxis "Impacto" domains [0,100], CartesianGrid (border at 40% opacity), custom tooltip showing concept + coordinates
- Created `PieWidget.tsx`: Recharts donut PieChart (innerRadius 40% outerRadius 70%), 5-color palette cycling (Indigo/Violet/Sky/Emerald/Amber), Legend, custom tooltip showing label: X%
- Created `widget-registry.ts`: extensible `Map<PanelWidget['widget_type'], WidgetComponent>` (D-06); future types register here only — AnalyticsPanel does not change
- Created `widget-registry.test.tsx`: 6 tests covering all 4 key lookups, unknown key returns undefined, BentoGrid renders one card per cards entry — all passing (TDD RED → GREEN)
- Extended `AnalyticsPanel.tsx`:
  - 36px header strip: "Main" branch Badge (Indigo 500 at 20% opacity bg, 1px Indigo border, Indigo 300 text, 6px Indigo dot), "Analizando..." pulse label shown only while `isStreaming`
  - Widget zone reads `usePanelStore()` → resolves `widgetRegistry.get(widgetType)`
  - `AnimatePresence mode="wait"` keyed `${widgetType}-${branchId}` with D-08 spec: initial/animate/exit opacity+scale+blur, duration 0.28s ease `[0.25,0.46,0.45,0.94]`
  - Empty state (no widget) wrapped in motion.div keyed "empty" with fade
  - Full dynamic zone inside `AnalyticsPanelErrorBoundary` (LAYOUT-07 preserved)

## Task Commits

1. **Task 1 RED: Failing tests for widget registry** - `869d094` (test)
2. **Task 1 GREEN: Four widget components + registry** - `de4ed43` (feat)
3. **Task 2: AnalyticsPanel dynamic widget zone + header strip** - `ec13db9` (feat)

## Files Created/Modified

- `apps/web/components/workspace/widgets/BentoGrid.tsx` — CSS grid bento card layout, shadcn Card
- `apps/web/components/workspace/widgets/RadarWidget.tsx` — Recharts RadarChart, Indigo 500 fill
- `apps/web/components/workspace/widgets/ScatterWidget.tsx` — Recharts ScatterChart, Consenso/Impacto axes
- `apps/web/components/workspace/widgets/PieWidget.tsx` — Recharts donut PieChart, 5-color palette
- `apps/web/components/workspace/widgets/widget-registry.ts` — Map<widget_type, WidgetComponent>
- `apps/web/components/workspace/widgets/widget-registry.test.tsx` — 6 tests, all passing
- `apps/web/components/workspace/AnalyticsPanel.tsx` — Header strip + AnimatePresence widget zone

## Decisions Made

- **WidgetZone inner component:** React Error Boundaries must be class components but hooks (usePanelStore) can only be called in function components. Extracted `WidgetZone` as an inner function component that reads the store; `AnalyticsPanelErrorBoundary` wraps it cleanly.
- **Recharts 3.x tooltip as render function:** Passing `<CustomTooltip />` as JSX to `<Tooltip content={...}>` requires all required props at construction time, causing TS2739 errors. The `ContentType<ValueType, NameType>` accepts either a `ReactElement` OR a render function `(props) => ReactNode`. Using a render function (named `renderTooltip`) satisfies the type.
- **TooltipContentProps default generics:** Narrowing to `<number, string>` conflicts with `ContentType<ValueType, NameType>` (which uses `ValueType = number | string | ReadonlyArray<number | string>`). Default generics (`TooltipContentProps` without type params) satisfies the constraint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Recharts 3.x tooltip type constraint — switched from JSX element to render function**
- **Found during:** Task 1 GREEN phase typecheck
- **Issue:** `<Tooltip content={<CustomTooltip />} />` caused TS2739 errors — the JSX element requires all mandatory props (payload, coordinate, active, accessibilityLayer, activeIndex) at construction. Recharts clones and injects these, but TypeScript doesn't know this.
- **Fix:** Changed all three Recharts custom tooltips (RadarWidget, ScatterWidget, PieWidget) from JSX element pattern (`<CustomTooltip />`) to render function pattern (`renderTooltip`). Also changed `TooltipContentProps<number, string>` to `TooltipContentProps` (default generics) to satisfy `ContentType<ValueType, NameType>`.
- **Files modified:** RadarWidget.tsx, ScatterWidget.tsx, PieWidget.tsx
- **Commit:** `de4ed43`

**2. [Rule 3 - Blocking] node_modules symlink missing in worktree**
- **Found during:** Task 1 RED phase test execution
- **Issue:** The worktree's `apps/web/` had no `node_modules` directory; `vitest.config.ts` comments "The worktree symlinks node_modules -> main project's node_modules" but the symlink was absent.
- **Fix:** Created symlink: `apps/web/node_modules` → `panelito/apps/web/node_modules`
- **Files modified:** symlink only, no source files

## Verification Status

- `widget-registry.test.tsx` passes: 6/6 tests (all key lookups + BentoGrid render smoke test)
- `tsc --noEmit` on web app files: 0 errors in Plan 04's files (pre-existing errors in `apps/api/src` and `app/api/[[...route]]/route.ts` are out of scope)
- `AnimatePresence`, `widgetRegistry.get`, `usePanelStore` present in AnalyticsPanel.tsx
- Human checkpoint (Task 3) pending — visual widget render + morph transition + branch badge

## Known Stubs

None — all widget components are fully implemented with real Recharts renderers. The panel header "Main" branch badge is hardcoded to Main branch; dynamic multi-branch support is Phase 3 scope.

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| None | — | No new network endpoints, auth paths, or file access patterns introduced |

T-02-13 (Recharts crash isolation): fully mitigated — WidgetZone + all widgets remain inside `AnalyticsPanelErrorBoundary`. A render throw shows the LAYOUT-07 fallback card; chat stream below remains operational.

T-02-14 (oversized widget data): mitigated at schema level (PanelWidgetSchema array bounds from Plan 01); widget components render what they receive within those bounds.

---

## Self-Check

Files verified:
- apps/web/components/workspace/widgets/BentoGrid.tsx — FOUND
- apps/web/components/workspace/widgets/RadarWidget.tsx — FOUND
- apps/web/components/workspace/widgets/ScatterWidget.tsx — FOUND
- apps/web/components/workspace/widgets/PieWidget.tsx — FOUND
- apps/web/components/workspace/widgets/widget-registry.ts — FOUND
- apps/web/components/workspace/widgets/widget-registry.test.tsx — FOUND
- apps/web/components/workspace/AnalyticsPanel.tsx — FOUND (contains AnimatePresence, widgetRegistry.get, usePanelStore)

Commits verified:
- 869d094 test(02-04): add failing tests — FOUND
- de4ed43 feat(02-04): add four widget components and registry — FOUND
- ec13db9 feat(02-04): extend AnalyticsPanel with header strip, AnimatePresence widget zone — FOUND

## Self-Check: PASSED

*Phase: 02-ai-analytics*
*Completed: 2026-06-14*
