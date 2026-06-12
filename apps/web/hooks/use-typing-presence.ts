'use client'

/**
 * useTypingPresence — Supabase Presence channel for CHAT-06 typing indicator.
 *
 * Throttles track() calls to at most 1 per second to avoid flooding the Presence
 * channel on every keystroke (Pitfall 6 from Research doc).
 *
 * Usage:
 *   const { typingUsers, setTyping } = useTypingPresence(sessionId, userId, displayName)
 */

import { useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useSessionStore, type TypingUser } from '@/store/session-store'

interface PresenceState {
  [key: string]: Array<{
    typing?: boolean
    displayName?: string
  }>
}

export function useTypingPresence(
  sessionId: string,
  userId: string,
  displayName: string
): { typingUsers: TypingUser[]; setTyping: (isTyping: boolean) => void } {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastTrackRef = useRef<number>(0)
  const setTypingUsers = useSessionStore((s) => s.setTypingUsers)
  const typingUsers = useSessionStore((s) => s.typingUsers)

  const setTyping = useCallback(
    (isTyping: boolean) => {
      const now = Date.now()
      // Throttle: at most 1 track() call per 1000ms (CHAT-06 protection)
      if (isTyping && now - lastTrackRef.current < 1000) return
      lastTrackRef.current = now
      channelRef.current?.track({ typing: isTyping, displayName }).catch(() => {})
    },
    [displayName]
  )

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase.channel(`presence:${sessionId}`, {
      config: { presence: { key: userId } },
    })

    channelRef.current = channel

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as PresenceState

        // Build typing users list: other participants who have typing: true
        const typing = Object.entries(state)
          .filter(([key]) => key !== userId) // filter self
          .flatMap(([, payloads]) => payloads)
          .filter((p) => p.typing === true && p.displayName)
          .map((p) => ({
            userId: '', // Presence key not exposed per-payload; displayName is sufficient
            displayName: p.displayName!,
          }))

        setTypingUsers(typing)
      })
      .subscribe()

    return () => {
      channel.untrack().catch(() => {})
      supabase.removeChannel(channel).catch(() => {})
    }
  }, [sessionId, userId, setTypingUsers])

  return { typingUsers, setTyping }
}
