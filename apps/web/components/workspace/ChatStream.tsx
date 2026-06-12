'use client'

/**
 * ChatStream — composition wrapper for the message list.
 *
 * Plan 04: Shell only.
 * Plan 05: Wired to MessageList with Supabase Realtime subscription,
 *          message bubbles, auto-scroll (CHAT-03), and typing indicator.
 *
 * LAYOUT-03: .chat-stream class provides flex:1 + overflow-y:auto from globals.css.
 */

import type { ReactNode } from 'react'
import { MessageList } from './MessageList'

interface ChatStreamProps {
  sessionId: string
  currentUserId: string
}

/**
 * ChatStream — live chat message list with real-time delivery.
 */
export function ChatStream({ sessionId, currentUserId }: ChatStreamProps): ReactNode {
  return <MessageList sessionId={sessionId} currentUserId={currentUserId} />
}
