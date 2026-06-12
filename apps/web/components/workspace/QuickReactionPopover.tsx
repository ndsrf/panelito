'use client'

/**
 * QuickReactionPopover — ephemeral emoji reaction picker (LAYOUT-06)
 *
 * Opened by double-tap on a MessageBubble.
 * Phase 1: scaffolded only. console.log the reaction; posting to DB is Phase 2.
 * Phase 2: replaces console.log with a POST to /api/sessions/:id/reactions.
 *
 * T-05-08: Emoji glyphs are static string constants — NOT user input — so rendering
 * them as text nodes is safe (no XSS risk).
 */

import { type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const REACTION_EMOJIS = ['🧠', '🔥', '📌', '🎯'] as const

interface QuickReactionPopoverProps {
  messageId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * QuickReactionPopover — floating reaction picker anchored to the message bubble.
 */
export function QuickReactionPopover({
  messageId,
  open,
  onOpenChange,
}: QuickReactionPopoverProps): ReactNode {
  const handleReact = (emoji: string) => {
    // Phase 1: scaffold only — log the reaction
    // Phase 2: POST to /api/sessions/:id/reactions
    console.log('reaction', emoji, messageId)
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {/* Invisible trigger — opened programmatically via useLongPress/useDoubleTap */}
      <PopoverTrigger asChild>
        <span className="sr-only" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-2"
        side="top"
        align="start"
        sideOffset={8}
      >
        <div className="flex gap-1" role="group" aria-label="Quick reactions">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="w-11 h-11 flex items-center justify-center text-[20px] rounded-md hover:bg-accent transition-colors"
              aria-label={`React with ${emoji}`}
              onClick={() => handleReact(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
