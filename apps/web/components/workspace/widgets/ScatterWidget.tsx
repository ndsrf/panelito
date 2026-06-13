'use client'

/**
 * ScatterWidget — consensus/impact positioning widget (Widget 3 per 02-UI-SPEC.md).
 *
 * Recharts ScatterChart with:
 * - CartesianGrid stroke: --border at 40% opacity, dasharray "3 3"
 * - XAxis label "Consenso", domain [0, 100], tick 11px muted-foreground
 * - YAxis label "Impacto", domain [0, 100], rotated, tick 11px muted-foreground
 * - Scatter fill: Indigo 500 (#6366f1), radius 6
 * - Custom Tooltip typed with TooltipContentProps (Recharts 3.x)
 * - No Legend
 */

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import type { PanelWidget } from '@panelito/types'

function renderTooltip(props: TooltipContentProps) {
  const { active, payload } = props
  if (!active || !payload?.length) return null
  // payload[0].payload contains the full point data including concept
  const point = payload[0]?.payload as { x: number; y: number; concept: string } | undefined
  if (!point) return null
  return (
    <div className="bg-card border border-border rounded-md p-2 text-[15px] text-foreground max-w-[200px]">
      <div className="text-[13px] text-muted-foreground mb-1 truncate">{point.concept}</div>
      <div>
        <span className="text-muted-foreground">Consenso:</span> {point.x}
        {' | '}
        <span className="text-muted-foreground">Impacto:</span> {point.y}
      </div>
    </div>
  )
}

interface ScatterWidgetProps {
  data: Extract<PanelWidget, { widget_type: 'scatter' }>
}

export function ScatterWidget({ data }: ScatterWidgetProps) {
  const chartData = data.points.map((p) => ({
    x: p.consensus,
    y: p.impact,
    concept: p.concept,
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 8, right: 8, bottom: 24, left: 8 }}>
        <CartesianGrid stroke="rgba(63,63,70,0.4)" strokeDasharray="3 3" />
        <XAxis
          dataKey="x"
          type="number"
          domain={[0, 100]}
          name="Consenso"
          label={{
            value: 'Consenso',
            position: 'insideBottom',
            offset: -10,
            fontSize: 11,
            fill: '#a1a1aa',
          }}
          tick={{ fontSize: 11, fill: '#a1a1aa' }}
        />
        <YAxis
          dataKey="y"
          type="number"
          domain={[0, 100]}
          name="Impacto"
          label={{
            value: 'Impacto',
            angle: -90,
            position: 'insideLeft',
            offset: 10,
            fontSize: 11,
            fill: '#a1a1aa',
          }}
          tick={{ fontSize: 11, fill: '#a1a1aa' }}
        />
        <Scatter data={chartData} fill="#6366f1" />
        <Tooltip content={renderTooltip} cursor={{ strokeDasharray: '3 3' }} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}
