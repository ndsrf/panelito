'use client'

/**
 * QuickReactionPopover — ephemeral emoji reaction picker (LAYOUT-06)
 *
 * Opened by double-tap on a MessageBubble.
 * Phase 2: POSTs to /api/sessions/:id/reactions with optimistic UI.
 * The postReaction is delegated back to the parent (MessageList) via callbacks
 * so the useReactions hook owns all state — this component only fires the gesture.
 *
 * Props added in Phase 2:
 * - sessionId: used by the parent hook for the POST URL
 * - onOptimisticReaction(emoji): called BEFORE the POST (D-10 optimistic badge)
 * - onRevertReaction(emoji): called on POST failure (Pitfall 6 silent revert)
 * - onPostReaction(emoji): async — fires the real POST; returns triggersAI
 *
 * T-05-08: Emoji glyphs are static string constants — NOT user input — so rendering
 * them as text nodes is safe (no XSS risk).
 */

import { type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const REACTION_EMOJIS = ['🧠', '🔥', '📌', '🎯'] as const

interface QuickReactionPopoverProps {
  messageId: string
  /** Phase 2: session identifier for the reaction POST URL */
  sessionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Phase 2: called immediately when an emoji is tapped (D-10 optimistic) */
  onOptimisticReaction?: (emoji: string) => void
  /** Phase 2: called when the POST fails (Pitfall 6 silent revert) */
  onRevertReaction?: (emoji: string) => void
  /**
   * Phase 2: async callback that performs the actual reaction POST.
   * Returns triggersAI so MessageList can open the SSE stream.
   */
  onPostReaction?: (emoji: string) => Promise<boolean>
  /** Phase 2: called when triggersAI is true — parent opens SSE stream */
  onTriggerAI?: () => void
}

/**
 * QuickReactionPopover — floating reaction picker anchored to the message bubble.
 */
export function QuickReactionPopover({
  messageId,
  sessionId: _sessionId,
  open,
  onOpenChange,
  onOptimisticReaction,
  onRevertReaction,
  onPostReaction,
  onTriggerAI,
}: QuickReactionPopoverProps): ReactNode {
  const handleReact = async (emoji: string) => {
    // Close popover immediately for fast feedback
    onOpenChange(false)

    // D-10: Optimistic UI — badge appears before server confirmation
    onOptimisticReaction?.(emoji)

    if (onPostReaction) {
      // onPostReaction delegates to useReactions.postReaction which POSTs to
      // POST /api/sessions/:id/reactions { messageId, emoji } → 201 { triggersAI }
      // (D-09: /reactions route; hook owns state to dedupe Realtime echo)
      try {
        const triggersAI = await onPostReaction(emoji)
        // D-09: if fire/pin/target reaction confirmed, open the AI invoke stream
        if (triggersAI && onTriggerAI) {
          onTriggerAI()
        }
      } catch {
        // D-10 / Pitfall 6: revert on server error — silent, no toast
        onRevertReaction?.(emoji)
      }
    }
  }

  void messageId // messageId used by parent to route per-message callbacks

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
              onClick={() => void handleReact(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
