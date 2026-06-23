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
  isFullscreen?: boolean
}

export function BentoGrid({ data, isFullscreen }: BentoGridProps) {
  return (
    <div className={`grid gap-3 h-full overflow-y-auto ${isFullscreen ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 p-2' : 'grid-cols-2 md:grid-cols-3'}`}>
      {data.cards.map((card, i) => (
        <Card
          key={i}
          className={`bg-muted border-border rounded-lg flex flex-col gap-2 shadow-none transition-all ${isFullscreen ? 'p-5' : 'p-3'}`}
          style={{ borderRadius: 8 }}
        >
          <span className={`${isFullscreen ? 'text-[14px]' : 'text-[13px]'} text-muted-foreground truncate leading-none`}>
            {card.category}
          </span>
          <span className={`${isFullscreen ? 'text-[22px] font-bold line-clamp-none' : 'text-[20px] font-semibold line-clamp-2'} text-foreground leading-snug break-words`}>
            {card.concept}
          </span>
          {card.relevance_score != null && (
            <span className={`${isFullscreen ? 'text-[14px] px-2 py-0.5' : 'text-[13px] px-1'} text-muted-foreground self-end bg-card rounded leading-none mt-auto`}>
              {card.relevance_score}
            </span>
          )}
        </Card>
      ))}
    </div>
  )
}
