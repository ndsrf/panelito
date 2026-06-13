'use client'

/**
 * BentoGrid — key concept cards widget (Widget 1 per 02-UI-SPEC.md).
 *
 * Layout: CSS grid, grid-cols-2 mobile / grid-cols-3 desktop (>=768px). Gap 8px.
 * Each card: shadcn Card (bg-muted, border, rounded-8px, p-3) with:
 *   - Category label (13px muted)
 *   - Concept name (20px semibold, line-clamp-2)
 *   - Optional relevance_score pill (right-aligned, bg-card)
 */

import type { PanelWidget } from '@panelito/types'
import { Card } from '@/components/ui/card'

interface BentoGridProps {
  data: Extract<PanelWidget, { widget_type: 'bento' }>
}

export function BentoGrid({ data }: BentoGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 h-full overflow-y-auto">
      {data.cards.map((card, i) => (
        <Card
          key={i}
          className="bg-muted border-border rounded-lg p-3 flex flex-col gap-1 shadow-none"
          style={{ borderRadius: 8 }}
        >
          <span className="text-[13px] text-muted-foreground truncate leading-none">
            {card.category}
          </span>
          <span className="text-[20px] font-semibold text-foreground line-clamp-2 leading-snug">
            {card.concept}
          </span>
          {card.relevance_score != null && (
            <span className="text-[13px] text-muted-foreground self-end bg-card rounded px-1 leading-none mt-auto">
              {card.relevance_score}
            </span>
          )}
        </Card>
      ))}
    </div>
  )
}
