'use client'

/**
 * LayoutWidget — responsive side-by-side container for 2-3 sub-widgets.
 *
 * Renders BasePanelWidget children in a CSS grid layout.
 * Each child cell uses min-h-0 overflow-hidden so Recharts ResponsiveContainer
 * can measure its height correctly — without min-h-0, grid items won't shrink
 * below content size and height="100%" on ResponsiveContainer produces 0.
 *
 * The widgetRegistry is resolved at render time (not import time), so there
 * is no circular import issue despite LayoutWidget and the registry referencing
 * each other.
 */

import type { BasePanelWidget, PanelWidget } from '@panelito/types'
import { widgetRegistry } from './widget-registry'

interface LayoutWidgetProps {
  data: Extract<PanelWidget, { widget_type: 'layout' }>
}

export function LayoutWidget({ data }: LayoutWidgetProps) {
  const count = data.widgets.length
  const gridClass =
    count === 2
      ? 'grid grid-cols-1 sm:grid-cols-2 gap-2 h-full'
      : 'grid grid-cols-1 sm:grid-cols-3 gap-2 h-full'

  return (
    <div className={gridClass}>
      {data.widgets.map((widget: BasePanelWidget, i: number) => {
        const Component = widgetRegistry.get(widget.widget_type)
        if (!Component) return null
        return (
          <div key={i} className="min-h-0 overflow-hidden">
            <Component data={widget as PanelWidget} />
          </div>
        )
      })}
    </div>
  )
}
