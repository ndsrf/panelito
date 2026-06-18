'use client'

/**
 * ChatStream — composition wrapper for the message list.
 *
 * Plan 04: Shell only.
 * Plan 05: Wired to MessageList with Supabase Realtime subscription,
 *          message bubbles, auto-scroll (CHAT-03), and typing indicator.
 * Plan 02-05: Phase 2 — passes onTriggerAIStream so power reactions (🔥📌🎯)
 *             can open the AI invoke stream from within MessageList.
 *
 * LAYOUT-03: .chat-stream class provides flex:1 + overflow-y:auto from globals.css.
 */

import type { ReactNode } from 'react'
import { MessageList } from './MessageList'

interface ChatStreamProps {
  sessionId: string
  currentUserId: string
  /** Phase 2: relay AI trigger from power reactions up to workspace */
  onTriggerAIStream?: () => void
}

/**
 * ChatStream — live chat message list with real-time delivery.
 */
export function ChatStream({ sessionId, currentUserId, onTriggerAIStream }: ChatStreamProps): ReactNode {
  return (
    <MessageList
      sessionId={sessionId}
      currentUserId={currentUserId}
      onTriggerAIStream={onTriggerAIStream}
    />
  )
}
