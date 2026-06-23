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
 */

import type { ComponentType } from 'react'
import type { PanelWidget } from '@panelito/types'
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
export type WidgetComponent = ComponentType<{ data: PanelWidget }>

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
])
