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

import { useRef, useState, useEffect } from 'react'
import type { BasePanelWidget, PanelWidget } from '@panelito/types'
import { widgetRegistry } from './widget-registry'
import { usePanelStore } from '@/store/panel-store'

interface LayoutWidgetProps {
  data: Extract<PanelWidget, { widget_type: 'layout' }>
  isFullscreen?: boolean
}

interface SubWidgetCellProps {
  widget: BasePanelWidget
  setFullscreenWidget: (widget: PanelWidget | null) => void
}

function SubWidgetCell({ widget, setFullscreenWidget }: SubWidgetCellProps) {
  const Component = widgetRegistry.get(widget.widget_type)
  const lastClickRef = useRef(0)

  if (!Component) return null

  const handleWidgetClick = (e: React.MouseEvent) => {
    const now = Date.now()
    if (now - lastClickRef.current < 300) {
      console.log('[LayoutWidget] Manual double click captured on sub-widget:', widget)
      e.stopPropagation()
      setFullscreenWidget(widget as PanelWidget)
    } else {
      lastClickRef.current = now
    }
  }

  return (
    <div
      className="h-full min-h-0 overflow-hidden cursor-zoom-in hover:brightness-110 active:scale-[0.99] transition-all duration-150 flex flex-col"
      onClickCapture={handleWidgetClick}
      title="Doble clic para pantalla completa"
    >
      <Component data={widget as PanelWidget} />
    </div>
  )
}

export function LayoutWidget({ data }: LayoutWidgetProps) {
  const setFullscreenWidget = usePanelStore((s) => s.setFullscreenWidget)
  const count = data.widgets.length
  const gridClass =
    count === 2
      ? 'grid grid-cols-1 sm:grid-cols-2 gap-2 h-full'
      : 'grid grid-cols-1 sm:grid-cols-3 gap-2 h-full'

  return (
    <div className={gridClass}>
      {data.widgets.map((widget: BasePanelWidget, i: number) => (
        <SubWidgetCell
          key={i}
          widget={widget}
          setFullscreenWidget={setFullscreenWidget}
        />
      ))}
    </div>
  )
}
