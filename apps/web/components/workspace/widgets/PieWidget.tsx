'use client'

/**
 * PieWidget — proportional breakdown donut chart (Widget 4 per 02-UI-SPEC.md).
 *
 * Recharts PieChart with:
 * - Pie innerRadius 40% (donut) outerRadius 70%, paddingAngle 3
 * - Segment fill order: Indigo/Violet/Sky/Emerald/Amber, repeat for >5 segments
 * - Segment stroke: --background (#09090b), width 2 (separates on dark bg)
 * - Legend below chart: 13px muted-foreground, max 6 items
 * - Custom Tooltip typed with TooltipContentProps (Recharts 3.x): "[label]: X%"
 */

import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import type { PanelWidget } from '@panelito/types'

const PALETTE = ['#6366f1', '#a78bfa', '#38bdf8', '#34d399', '#fbbf24'] as const

function renderTooltip(props: TooltipContentProps) {
  const { active, payload } = props
  if (!active || !payload?.length) return null
  const entry = payload[0]
  if (!entry) return null
  const total = (entry.payload as { totalSum?: number }).totalSum ?? 0
  const pct = total > 0 ? ((Number(entry.value) / total) * 100).toFixed(1) : '0'
  return (
    <div className="bg-card border border-border rounded-md p-2 text-[15px] text-foreground">
      {String(entry.name ?? '')}: {pct}%
    </div>
  )
}

interface PieWidgetProps {
  data: Extract<PanelWidget, { widget_type: 'pie' }>
}

export function PieWidget({ data }: PieWidgetProps) {
  const total = data.segments.reduce((acc, s) => acc + s.value, 0)

  // Inject totalSum into each entry so the tooltip can calculate percentage
  const chartData = data.segments
    .slice(0, 6)
    .map((s) => ({ name: s.label, value: s.value, totalSum: total }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          innerRadius="40%"
          outerRadius="70%"
          paddingAngle={3}
          stroke="#09090b"
          strokeWidth={2}
        >
          {chartData.map((_entry, index) => (
            <Cell key={`cell-${index}`} fill={PALETTE[index % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip content={renderTooltip} />
        <Legend
          wrapperStyle={{ fontSize: 13, color: '#a1a1aa', paddingTop: 8 }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
