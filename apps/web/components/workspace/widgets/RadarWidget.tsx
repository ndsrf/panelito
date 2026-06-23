'use client'

/**
 * RadarWidget — multi-axis scoring widget (Widget 2 per 02-UI-SPEC.md).
 *
 * Recharts RadarChart centered in widget zone.
 * - PolarGrid stroke: --border (#3f3f46)
 * - PolarAngleAxis tick: 11px, --muted-foreground (#a1a1aa)
 * - PolarRadiusAxis hidden (no numeric rings)
 * - Radar fill: Indigo 500 at 20% opacity, stroke: Indigo 500, strokeWidth: 2
 * - Custom tooltip typed with TooltipContentProps<number, string> (Recharts 3.x)
 * - No Legend (axis labels sufficient)
 */

import { useState, useEffect } from 'react'
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  Tooltip,
  ResponsiveContainer,
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

interface RadarWidgetProps {
  data: Extract<PanelWidget, { widget_type: 'radar' }>
  isFullscreen?: boolean
}

export function RadarWidget({ data }: RadarWidgetProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => {
      setMounted(true)
    }, 300)
    return () => clearTimeout(timer)
  }, [])

  const chartData = data.axes.map((a) => ({ subject: a.axis, value: a.value }))

  if (!mounted) {
    return <div className="w-full h-full min-h-0" />
  }

  return (
    <div className="w-full h-full min-h-0">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <RadarChart data={chartData}>
          <PolarGrid stroke="#3f3f46" />
          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#a1a1aa' }} />
          {/* PolarRadiusAxis hidden per UI-SPEC — numeric rings too noisy in compact space */}
          <Radar
            dataKey="value"
            stroke="#6366f1"
            fill="#6366f1"
            fillOpacity={0.2}
            strokeWidth={2}
          />
          <Tooltip content={renderTooltip} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
