'use client'

/**
 * TimelineWidget — horizontal scrollable event timeline.
 *
 * Pure CSS/Tailwind implementation — no external library.
 * Layout: scrollable horizontal row of event nodes.
 * Each node: date (top, muted) → indigo dot → vertical stem → label + description (below).
 * Nodes are connected by a horizontal line running through the dot row.
 */

import type { PanelWidget } from '@panelito/types'

interface TimelineWidgetProps {
  data: Extract<PanelWidget, { widget_type: 'timeline' }>
}

export function TimelineWidget({ data }: TimelineWidgetProps) {
  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {data.title && (
        <h3 className="text-[13px] font-semibold text-foreground mb-2 px-1 shrink-0">
          {data.title}
        </h3>
      )}
      {/* Scrollable timeline container */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div className="flex items-start gap-0 min-w-max px-2 pb-2 h-full">
          {data.events.map((event, index) => (
            <div key={index} className="flex items-start">
              {/* Event node */}
              <div className="flex flex-col items-center w-36">
                {/* Date label */}
                <span className="text-[11px] text-zinc-400 mb-1.5 text-center leading-tight">
                  {event.date}
                </span>
                {/* Dot with horizontal line */}
                <div className="relative flex items-center w-full justify-center">
                  {/* Left connector line */}
                  {index > 0 && (
                    <div className="absolute right-1/2 top-1/2 -translate-y-1/2 w-1/2 h-px bg-indigo-500/40" />
                  )}
                  {/* Right connector line */}
                  {index < data.events.length - 1 && (
                    <div className="absolute left-1/2 top-1/2 -translate-y-1/2 w-1/2 h-px bg-indigo-500/40" />
                  )}
                  {/* Dot */}
                  <div className="relative z-10 w-3 h-3 rounded-full bg-indigo-500 border-2 border-indigo-400 shrink-0" />
                </div>
                {/* Vertical stem */}
                <div className="w-px h-3 bg-indigo-500/40" />
                {/* Label and description */}
                <div className="px-1 text-center">
                  <p className="text-[13px] font-medium text-foreground leading-tight">
                    {event.label}
                  </p>
                  {event.description && (
                    <p className="text-[11px] text-zinc-500 mt-0.5 leading-tight">
                      {event.description}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
