'use client'

/**
 * LineWidget — time-series or labeled line chart widget.
 *
 * Recharts LineChart filling the widget zone height.
 * - CartesianGrid horizontal-only (vertical={false}): cleaner look in compact panel
 * - XAxis ticks rotated -30deg so long labels don't overlap
 * - Line: Indigo 500 with monotone curve; dots shown when ≤10 points
 * - Tooltip styled with same bg-card pattern as BarWidget
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import type { PanelWidget } from '@panelito/types'

function renderTooltip(props: TooltipContentProps) {
  const { active, payload, label } = props
  if (!active || !payload?.length) return null
  const entry = payload[0]
  return (
    <div className="bg-card border border-border rounded-md p-2 text-[15px] text-foreground">
      <span className="font-medium">{String(label ?? '')}</span>
      {': '}
      <span>{String(entry?.value ?? '')}</span>
    </div>
  )
}

interface LineWidgetProps {
  data: Extract<PanelWidget, { widget_type: 'line' }>
}

export function LineWidget({ data }: LineWidgetProps) {
  const chartData = data.line_points.map((p) => ({ name: p.x, value: p.y }))
  const showDots = data.line_points.length <= 10

  return (
    <div className="w-full h-full flex flex-col">
      {data.title && (
        <h3 className="text-[13px] font-semibold text-foreground mb-1 px-1 shrink-0">
          {data.title}
        </h3>
      )}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 32, left: 8 }}>
            <CartesianGrid stroke="rgba(63,63,70,0.4)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: '#a1a1aa' }}
              interval={0}
              angle={-30}
              textAnchor="end"
            />
            <YAxis tick={{ fontSize: 11, fill: '#a1a1aa' }} />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#6366f1"
              strokeWidth={2}
              dot={showDots ? { r: 3, fill: '#6366f1' } : false}
              activeDot={{ r: 4, fill: '#6366f1' }}
            />
            <Tooltip content={renderTooltip} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
