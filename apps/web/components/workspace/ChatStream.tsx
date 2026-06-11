/**
 * ChatStream — scrollable message list shell.
 *
 * Plan 04: Structural shell only — renders an empty state.
 *          No messages, no real-time subscription yet.
 * Plan 05: Wires Supabase Realtime, message bubbles, auto-scroll,
 *          and typing indicator.
 *
 * Accept sessionId as a prop so Plan 05 can swap in the real
 * subscription without changing the component interface.
 *
 * LAYOUT-03: .chat-stream class provides flex:1 + overflow-y:auto
 *            + padding-bottom:52px (input height) from globals.css.
 */

import type { ReactNode } from 'react'

interface ChatStreamProps {
  sessionId: string
}

/**
 * ChatStream — message list shell.
 *
 * Plan 04 renders the empty state placeholder.
 * Plan 05 replaces this with the live message list.
 */
export function ChatStream({ sessionId: _sessionId }: ChatStreamProps): ReactNode {
  return (
    <div className="chat-stream flex items-center justify-center">
      <p className="text-[15px] text-muted-foreground text-center px-6">
        No messages yet. Be the first to write.
      </p>
    </div>
  )
}
