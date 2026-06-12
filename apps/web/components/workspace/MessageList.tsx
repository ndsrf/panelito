'use client'

/**
 * MessageList — scrollable chat message list with real-time updates (CHAT-03)
 *
 * CHAT-03: Auto-scrolls to the latest message when the user is within 64px of bottom.
 *          Preserves scroll position when the user has scrolled up to read history.
 * CHAT-01: Initial history loaded from GET /api/sessions/:id/messages on mount.
 *          Live updates delivered via useSessionChannel (broadcast subscription).
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { useSessionStore } from '@/store/session-store'
import { useSessionChannel } from '@/hooks/use-session-channel'
import { apiFetch } from '@/lib/api'
import { MessageBubble } from './MessageBubble'
import type { Message } from '@panelito/types'

interface MessageListProps {
  sessionId: string
  currentUserId: string
}

/**
 * MessageList — renders all messages and manages auto-scroll + initial history.
 */
export function MessageList({ sessionId, currentUserId }: MessageListProps): ReactNode {
  const messages = useSessionStore((s) => s.messages)
  const addMessage = useSessionStore((s) => s.addMessage)
  const setMessages = useSessionStore((s) => s.setMessages)

  const containerRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)

  // Subscribe to live messages via Supabase Realtime broadcast
  useSessionChannel(sessionId, useSessionStore.getState().addMessage)

  // Load initial message history on mount
  useEffect(() => {
    apiFetch<Message[]>(`/api/sessions/${sessionId}/messages`)
      .then((msgs) => setMessages(msgs))
      .catch((err) => console.error('[MessageList] history load failed', err))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // CHAT-03: Snapshot scroll position BEFORE render (on each messages change)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Check if we were at the bottom before this render cycle
    wasAtBottomRef.current =
      container.scrollTop + container.clientHeight >= container.scrollHeight - 64
  })

  // CHAT-03: After render, scroll to bottom if we were at bottom before
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    if (wasAtBottomRef.current) {
      container.scrollTop = container.scrollHeight
    }
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
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isOwn={msg.author_id === currentUserId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
