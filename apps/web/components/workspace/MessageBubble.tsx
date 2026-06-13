'use client'

/**
 * MessageBubble — renders a single message with avatar + immutability (CHAT-02, CHAT-05)
 *
 * CHAT-02: Avatar color determined by getAvatarColor(author_id) — 6-color palette
 * CHAT-05: No edit/delete affordances exist — this component renders text only
 * LAYOUT-06: Double-tap => QuickReactionPopover; Long-press 500ms => MessageActionMenu
 *
 * Phase 2 additions (PERSONA-03):
 * - isAI?: renders AI variant with Bot avatar, persona badge, Indigo accent border
 * - isStreaming?: shows streaming dots or blinking cursor while AI is typing
 * - streamingText?: the ephemeral token buffer to render mid-stream
 */

import { useState, type ReactNode } from 'react'
import { Bot, FlaskConical } from 'lucide-react'
import { getAvatarColor, cn } from '@/lib/utils'
import { useLongPress, useDoubleTap } from '@/hooks/use-long-press'
import { Badge } from '@/components/ui/badge'
import { QuickReactionPopover } from './QuickReactionPopover'
import { MessageActionMenu } from './MessageActionMenu'
import type { Message } from '@panelito/types'

interface MessageBubbleProps {
  message: Message
  isOwn: boolean
  /** Phase 2: render the AI persona variant (Bot avatar + Indigo accent + persona badge) */
  isAI?: boolean
  /** Phase 2: true while the AI stream is in flight (shows streaming indicator / cursor) */
  isStreaming?: boolean
  /** Phase 2: accumulated token text during streaming */
  streamingText?: string
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
export function MessageBubble({
  message,
  isOwn,
  isAI = false,
  isStreaming = false,
  streamingText,
}: MessageBubbleProps): ReactNode {
  const [reactionOpen, setReactionOpen] = useState(false)
  const [actionOpen, setActionOpen] = useState(false)

  // Human avatar — only used when isAI is false
  const avatarColor = getAvatarColor(message.author_id)
  const initials = message.display_name.charAt(0).toUpperCase()

  const longPressHandlers = useLongPress(() => setActionOpen(true), 500)
  const doubleTapHandlers = useDoubleTap(() => setReactionOpen(true))

  return (
    <div
      className={cn(
        'message-bubble flex items-start gap-3 px-4 py-2',
        isOwn && !isAI && 'flex-row-reverse'
      )}
      data-message-id={message.id}
    >
      {/* Avatar — 32px circle */}
      {isAI ? (
        /* AI avatar: Indigo tinted circle with Bot icon (PERSONA-03 / UI-SPEC Surface 2) */
        <div
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
          style={{
            background: 'rgba(99, 102, 241, 0.20)',
            border: '1px solid #6366f1',
          }}
          aria-hidden="true"
        >
          <Bot size={16} style={{ color: '#818cf8' }} />
        </div>
      ) : (
        /* Human avatar: author color + initials (CHAT-02) */
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
      )}

      {/* Content column */}
      <div className={cn('flex-1 min-w-0 flex flex-col', isOwn && !isAI ? 'items-end' : 'items-start')}>
        {/* Author + timestamp (+ persona badge for AI) */}
        <div className={cn('flex items-baseline gap-2 mb-0.5', isOwn && !isAI && 'flex-row-reverse')}>
          <span className="text-[15px] font-medium text-foreground truncate">
            {isAI ? 'Analista Científico' : message.display_name}
          </span>

          {/* Persona badge — shown next to author name when isAI (PERSONA-03 / UI-SPEC Surface 2) */}
          {isAI && (
            <Badge
              className="h-5 text-[13px] gap-1 px-1.5 flex items-center"
              style={{
                background: 'rgba(99, 102, 241, 0.12)',
                border: '1px solid rgba(99, 102, 241, 0.30)',
                color: '#a5b4fc',
              }}
              aria-label="Analista Científico — AI persona"
            >
              <FlaskConical size={10} style={{ color: '#a5b4fc' }} />
              Analista
            </Badge>
          )}

          <span className="text-[13px] text-muted-foreground flex-shrink-0">
            {formatTime(message.created_at)}
          </span>
        </div>

        {/* Message bubble — LAYOUT-06 gesture handlers */}
        <div
          className="relative w-full flex"
          style={{ minHeight: 44, justifyContent: isOwn && !isAI ? 'flex-end' : 'flex-start' }}
        >
          {isAI ? (
            /* AI bubble content: card background + 2px Indigo left border + wider max-width (UI-SPEC Surface 2) */
            <div
              className="rounded-lg rounded-tl-none p-3 pr-3 text-[15px] text-foreground leading-relaxed max-w-[90%] break-words cursor-pointer select-text bg-card pl-4"
              style={{ borderLeft: '2px solid #818cf8' }}
              {...longPressHandlers}
              {...doubleTapHandlers}
              role="article"
              aria-label="Message from Analista Científico"
            >
              {/* Pre-first-token streaming indicator: three bounce dots */}
              {isStreaming && !streamingText && (
                <span
                  role="status"
                  aria-label="Analista está escribiendo..."
                  className="flex gap-1 items-center"
                >
                  {([0, 150, 300] as const).map((delay) => (
                    <span
                      key={delay}
                      className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </span>
              )}

              {/* Streaming text with blinking cursor */}
              {isStreaming && streamingText && (
                <>
                  {streamingText}
                  <span className="text-primary animate-pulse ml-0.5">▋</span>
                </>
              )}

              {/* Final completed content (not streaming) */}
              {!isStreaming && message.content}
            </div>
          ) : (
            /* Human bubble content */
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
          )}
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
