'use client'

/**
 * widget-registry.ts — Extensible widget registry (D-06).
 *
 * Maps each PanelWidget widget_type to its React component.
 * To add a new widget type: add an entry here only — AnalyticsPanel does not change.
 *
 * Note: Recharts components are client-only. If SSR crashes occur with
 * RadarWidget/ScatterWidget/PieWidget, wrap them with:
 *   dynamic(() => import('./RadarWidget'), { ssr: false })
 * (Pitfall 2 from 02-RESEARCH.md)
 *
 * GraphCanvas is loaded via next/dynamic with ssr:false (Pattern 4, 09-RESEARCH.md):
 * @xyflow/react requires DOM APIs (window, document, ResizeObserver) — server-side render
 * will crash without the dynamic ssr:false gate. The loading skeleton matches the bg-card
 * color so the panel appears stable while the canvas module hydrates.
 */

import type { ComponentType } from 'react'
import type { PanelWidget } from '@panelito/types'
import dynamic from 'next/dynamic'
import { BentoGrid } from './BentoGrid'
import { RadarWidget } from './RadarWidget'
import { ScatterWidget } from './ScatterWidget'
import { PieWidget } from './PieWidget'
import { BarWidget } from './BarWidget'
import { LayoutWidget } from './LayoutWidget'
import { LineWidget } from './LineWidget'
import { TimelineWidget } from './TimelineWidget'
import { MapWidget } from './MapWidget'

/**
 * WidgetComponent — the common props interface for all widget renderers.
 * Each concrete component accepts a narrowed PanelWidget variant but is cast
 * to this type for uniform registry access.
 */
export type WidgetComponent = ComponentType<{ data: PanelWidget; isFullscreen?: boolean }>

/**
 * GraphCanvasDynamic — @xyflow/react canvas loaded client-only (Pattern 4 / Pitfall 2).
 *
 * ssr:false is MANDATORY — @xyflow/react uses window/document/ResizeObserver.
 * T-09-09: SSR crash is isolated behind this gate + AnalyticsPanelErrorBoundary.
 * GraphCanvas ignores `data` (reads sessionStore directly per D-06); `as WidgetComponent`
 * satisfies the registry signature without a runtime prop mismatch.
 */
const GraphCanvasDynamic = dynamic(
  () => import('./GraphCanvas').then((m) => ({ default: m.GraphCanvas })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-card animate-pulse rounded" />
    ),
  }
) as WidgetComponent

/**
 * widgetRegistry — Map from widget_type to its renderer component.
 *
 * D-06: new widget types are registered here only; AnalyticsPanel.tsx
 * resolves them via registry.get(widgetType) without any switch/case.
 */
export const widgetRegistry = new Map<PanelWidget['widget_type'], WidgetComponent>([
  ['bento', BentoGrid as WidgetComponent],
  ['radar', RadarWidget as WidgetComponent],
  ['scatter', ScatterWidget as WidgetComponent],
  ['pie', PieWidget as WidgetComponent],
  ['bar', BarWidget as WidgetComponent],
  ['layout', LayoutWidget as WidgetComponent],
  ['line', LineWidget as WidgetComponent],
  ['timeline', TimelineWidget as WidgetComponent],
  ['map', MapWidget as WidgetComponent],
  ['graph', GraphCanvasDynamic],
])
