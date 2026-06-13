'use client'

/**
 * MessageBubble — renders a single message with avatar + immutability (CHAT-02, CHAT-05)
 *
 * CHAT-02: Avatar color determined by getAvatarColor(author_id) — 6-color palette
 * CHAT-05: No edit/delete affordances exist — this component renders text only
 * LAYOUT-06: Double-tap => QuickReactionPopover; Long-press 500ms => MessageActionMenu
 */

import { useState, type ReactNode } from 'react'
import { getAvatarColor, cn } from '@/lib/utils'
import { useLongPress, useDoubleTap } from '@/hooks/use-long-press'
import { QuickReactionPopover } from './QuickReactionPopover'
import { MessageActionMenu } from './MessageActionMenu'
import type { Message } from '@panelito/types'

interface MessageBubbleProps {
  message: Message
  isOwn: boolean
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

/**
 * MessageBubble — one chat message with avatar, author, time, and content.
 *
 * CHAT-05 immutability — no edit or delete affordances exist here.
 * The component intentionally exposes ONLY reaction (Phase 2) and fork/pin (Phase 3) gestures.
 */
export function MessageBubble({ message, isOwn }: MessageBubbleProps): ReactNode {
  const [reactionOpen, setReactionOpen] = useState(false)
  const [actionOpen, setActionOpen] = useState(false)

  const avatarColor = getAvatarColor(message.author_id)
  const initials = message.display_name.charAt(0).toUpperCase()

  const longPressHandlers = useLongPress(() => setActionOpen(true), 500)
  const doubleTapHandlers = useDoubleTap(() => setReactionOpen(true))

  return (
    <div
      className={cn(
        'message-bubble flex items-start gap-3 px-4 py-2',
        isOwn && 'flex-row-reverse'
      )}
      data-message-id={message.id}
    >
      {/* Avatar — 32px circle with author color and initial (CHAT-02) */}
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold text-white select-none"
        style={{
          backgroundColor: avatarColor,
          border: `2px solid ${avatarColor}`,
        }}
        aria-hidden="true"
      >
        {initials}
      </div>

      {/* Content column */}
      <div className={cn('flex-1 min-w-0 flex flex-col', isOwn ? 'items-end' : 'items-start')}>
        {/* Author + timestamp */}
        <div className={cn('flex items-baseline gap-2 mb-0.5', isOwn && 'flex-row-reverse')}>
          <span className="text-[15px] font-medium text-foreground truncate">
            {message.display_name}
          </span>
          <span className="text-[13px] text-muted-foreground flex-shrink-0">
            {formatTime(message.created_at)}
          </span>
        </div>

        {/* Message bubble — LAYOUT-06 gesture handlers */}
        <div
          className="relative w-full flex"
          style={{ minHeight: 44, justifyContent: isOwn ? 'flex-end' : 'flex-start' }} /* iOS 44px touch target minimum */
        >
          <div
            className={cn(
              'rounded-lg p-3 text-[15px] text-foreground leading-relaxed max-w-[80%] break-words cursor-pointer select-text',
              isOwn ? 'bg-muted rounded-tr-none' : 'bg-card border border-border rounded-tl-none'
            )}
            {...longPressHandlers}
            {...doubleTapHandlers}
            role="article"
            aria-label={`Message from ${message.display_name}`}
          >
            {message.content}
          </div>
        </div>
      </div>

      {/* LAYOUT-06: Quick reaction popover (double-tap) — Phase 2 wires posting */}
      <QuickReactionPopover
        messageId={message.id}
        open={reactionOpen}
        onOpenChange={setReactionOpen}
      />

      {/* LAYOUT-06: Contextual action menu (long-press) — Fork + Pin disabled in Phase 1 */}
      <MessageActionMenu
        open={actionOpen}
        onOpenChange={setActionOpen}
      />
    </div>
  )
}
