'use client'

/**
 * MessageList — scrollable chat message list with real-time updates (CHAT-03)
 *
 * CHAT-03: Auto-scrolls to the latest message when the user is within 64px of bottom.
 *          Preserves scroll position when the user has scrolled up to read history.
 * CHAT-01: Initial history loaded from GET /api/sessions/:id/messages on mount.
 *          Live updates delivered via useSessionChannel (broadcast subscription).
 *
 * Plan 07: Renders system messages (display_name === 'system') with distinct styling.
 *          System messages: no avatar, italic text, muted-foreground color, centered.
 *          Used for cap warnings (SESS-12), auto-freeze notices (SESS-07), auto-name (SESS-09).
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { useSessionStore } from '@/store/session-store'
import { useSessionChannel } from '@/hooks/use-session-channel'
import { apiFetch } from '@/lib/api'
import { MessageBubble } from './MessageBubble'
import type { Message } from '@panelito/types'

/** Sentinel display_name used for system messages (set in API by sessions-helpers.ts). */
const SYSTEM_DISPLAY_NAME = 'system'

/** All-zeros UUID — system author sentinel (matches SYSTEM_AUTHOR_ID in API). */
const SYSTEM_AUTHOR_ID = '00000000-0000-0000-0000-000000000000'

interface MessageListProps {
  sessionId: string
  currentUserId: string
}

/**
 * SystemMessageBubble — renders a system notification (cap warning, freeze notice, etc.)
 * with no avatar, italic text, and muted foreground color.
 */
function SystemMessageBubble({ message }: { message: Message }): ReactNode {
  return (
    <div className="flex justify-center px-4 py-1">
      <div
        className="text-[13px] italic text-muted-foreground text-center max-w-[80%] px-3 py-1.5 rounded-md bg-muted/40"
        role="status"
        aria-live="polite"
      >
        {message.content}
      </div>
    </div>
  )
}

/**
 * MessageList — renders all messages and manages auto-scroll + initial history.
 */
export function MessageList({ sessionId, currentUserId }: MessageListProps): ReactNode {
  const messages = useSessionStore((s) => s.messages)
  const addMessage = useSessionStore((s) => s.addMessage)
  const setMessages = useSessionStore((s) => s.setMessages)

  const containerRef = useRef<HTMLDivElement>(null)
  const lastScrollHeightRef = useRef(0)

  // Subscribe to live messages via Supabase Realtime broadcast
  useSessionChannel(sessionId, useSessionStore.getState().addMessage)

  // Load initial message history on mount
  useEffect(() => {
    apiFetch<Message[]>(`/api/sessions/${sessionId}/messages`)
      .then((msgs) => setMessages(msgs))
      .catch((err) => console.error('[MessageList] history load failed', err))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Polling fallback: merges new messages every 2s when Supabase Realtime
  // is unavailable (e.g. Docker port not forwarded in WSL2 dev environment).
  // Only adds messages not already in the store; does NOT replace existing ones.
  useEffect(() => {
    const poll = async () => {
      try {
        const msgs = await apiFetch<Message[]>(`/api/sessions/${sessionId}/messages`)
        const knownIds = new Set(useSessionStore.getState().messages.map((m) => m.id))
        msgs.filter((m) => !knownIds.has(m.id)).forEach(useSessionStore.getState().addMessage)
      } catch {
        // ignore — network errors during polling are non-fatal
      }
    }
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // CHAT-03: Auto-scroll to bottom if we were already at the bottom.
  // We use useLayoutEffect so the scroll happens before the browser paints the new messages.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Check if we were at the bottom before this update.
    // scrollTop + clientHeight is the current visible bottom.
    // lastScrollHeightRef.current is the height BEFORE the new messages were added.
    const wasAtBottom =
      container.scrollTop + container.clientHeight >= lastScrollHeightRef.current - 64

    if (wasAtBottom) {
      container.scrollTop = container.scrollHeight
    }

    // Update the height for the next render
    lastScrollHeightRef.current = container.scrollHeight
  }, [messages])

  // Prevent re-adding addMessage to session channel subscription deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  void addMessage

  return (
    <div
      ref={containerRef}
      className="chat-stream flex-1 overflow-y-auto"
      style={{ overscrollBehavior: 'contain' }}
    >
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-muted-foreground text-[15px] px-8 text-center">
          No hay mensajes todavia. Se el primero en escribir.
        </div>
      ) : (
        <div className="py-2">
          {messages.map((msg) => {
            const isSystemMessage =
              msg.display_name === SYSTEM_DISPLAY_NAME ||
              msg.author_id === SYSTEM_AUTHOR_ID
            return isSystemMessage ? (
              <SystemMessageBubble key={msg.id} message={msg} />
            ) : (
              <MessageBubble
                key={msg.id}
                message={msg}
                isOwn={msg.author_id === currentUserId}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
