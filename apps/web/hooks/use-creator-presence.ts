'use client'

/**
 * useCreatorPresence — publishes creator presence heartbeats (SESS-07, SESS-11).
 *
 * If `isCreator = false` (guest), this hook is a no-op — guests do NOT publish
 * creator presence, only the creator's device does.
 *
 * If `isCreator = true`:
 * - On mount: subscribes to `presence:${sessionId}` and tracks
 *   `{ role: 'creator', last_seen: Date.now() }`.
 * - Every 5000ms: refreshes `last_seen` to keep the presence alive.
 * - On unmount: clears the interval, untracks, removes the channel.
 *
 * The server-side `startAutoFreezeTracker` subscribes to the same
 * `presence:${sessionId}` channel using the SERVICE-ROLE client.
 * It filters for presence entries where `role === 'creator'` to determine
 * if the creator is online.
 *
 * T-07-01: The hook is only mounted when `currentUserId === session.creator_id`
 * (checked in workspace.tsx). Supabase presence binds to `auth.uid()` server-side,
 * so a forged `role: 'creator'` from a guest account cannot fool the tracker.
 */

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * useCreatorPresence — publishes heartbeats on `presence:${sessionId}`.
 *
 * @param sessionId - The session ID whose presence channel to track on.
 * @param isCreator - Whether the current user is the session creator.
 */
export function useCreatorPresence(sessionId: string, isCreator: boolean): void {
  useEffect(() => {
    if (!isCreator) return

    const supabase = createClient()
    const channel = supabase.channel(`presence:${sessionId}`, {
      config: { presence: { key: 'creator' } },
    })

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Initial track on subscribe
        await channel.track({ role: 'creator', last_seen: Date.now() })
      }
    })

    // 5s heartbeat to keep last_seen fresh (SESS-07)
    const interval = setInterval(() => {
      channel
        .track({ role: 'creator', last_seen: Date.now() })
        .catch((err: unknown) =>
          console.error('[useCreatorPresence] track error:', err)
        )
    }, 5000)

    return () => {
      clearInterval(interval)
      channel.untrack().catch(() => {/* ignore cleanup errors */})
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, isCreator])
}
