'use client'

/**
 * BarWidget — ranked comparison bar chart widget.
 *
 * Recharts BarChart filling the widget zone height.
 * - CartesianGrid horizontal-only (vertical={false}): cleaner look in compact panel
 * - XAxis ticks rotated -30deg so long labels don't overlap
 * - Bars: Indigo 500 base fill with slight descending opacity gradient
 * - Tooltip styled with same bg-card pattern as RadarWidget
 * - No Legend (bar labels on XAxis are sufficient)
 */

import { useState, useEffect } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import type { PanelWidget } from '@panelito/types'

function renderTooltip(props: TooltipContentProps) {
  const { active, payload } = props
  if (!active || !payload?.length) return null
  const entry = payload[0]
  return (
    <div className="bg-card border border-border rounded-md p-2 text-[15px] text-foreground">
      <span className="font-medium">{String(entry?.name ?? entry?.dataKey ?? '')}</span>
      {': '}
      <span>{String(entry?.value ?? '')}</span>
    </div>
  )
}

interface BarWidgetProps {
  data: Extract<PanelWidget, { widget_type: 'bar' }>
  isFullscreen?: boolean
}

export function BarWidget({ data }: BarWidgetProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => {
      setMounted(true)
    }, 300)
    return () => clearTimeout(timer)
  }, [])

  const chartData = data.bars.map((b) => ({ name: b.label, value: b.value }))

  if (!mounted) {
    return <div className="w-full h-full min-h-0" />
  }

  return (
    <div className="w-full h-full min-h-0">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 32, left: 8 }}>
          <CartesianGrid stroke="rgba(63,63,70,0.4)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: '#a1a1aa' }}
            interval={0}
            angle={-30}
            textAnchor="end"
          />
          <YAxis tick={{ fontSize: 11, fill: '#a1a1aa' }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {chartData.map((_, index) => (
              <Cell
                key={index}
                fill="#6366f1"
                fillOpacity={Math.max(0.4, 0.85 - index * 0.04)}
              />
            ))}
          </Bar>
          <Tooltip content={renderTooltip} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
