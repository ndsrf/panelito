'use client'

/**
 * useTypingPresence — Supabase Presence channel for CHAT-06 typing indicator.
 *
 * Throttles track() calls to at most 1 per second to avoid flooding the Presence
 * channel on every keystroke (Pitfall 6 from Research doc).
 *
 * Phase 2 additions (AI-07 / D-04 / T-02-12):
 * - ai_streaming field added to the presence payload via MERGED track() calls (Pitfall 3).
 *   track() replaces the entire payload for that key — so we always merge typing +
 *   displayName + ai_streaming in one call to prevent clobbering (T-02-12).
 * - setAIStreaming(active) broadcasts the merged payload with ai_streaming set.
 * - isAIStreaming is a React state derived from any presence entry with ai_streaming === true.
 *
 * Usage:
 *   const { typingUsers, setTyping, setAIStreaming, isAIStreaming } =
 *     useTypingPresence(sessionId, userId, displayName)
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useSessionStore, type TypingUser } from '@/store/session-store'

interface PresencePayload {
  typing?: boolean
  displayName?: string
  ai_streaming?: boolean
}

interface PresenceState {
  [key: string]: Array<PresencePayload>
}

export function useTypingPresence(
  sessionId: string,
  userId: string,
  displayName: string
): {
  typingUsers: TypingUser[]
  setTyping: (isTyping: boolean) => void
  /**
   * setAIStreaming — broadcast a merged presence payload that sets ai_streaming.
   * Pitfall 3 / T-02-12: always merges with the current typing state so neither
   * field clobbers the other.
   */
  setAIStreaming: (active: boolean) => void
  /** isAIStreaming — true if any presence entry in the channel has ai_streaming === true */
  isAIStreaming: boolean
} {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastTrackRef = useRef<number>(0)
  // Track current typing state so merged track() calls can preserve it (Pitfall 3)
  const currentTypingRef = useRef<boolean>(false)
  const setTypingUsers = useSessionStore((s) => s.setTypingUsers)
  const typingUsers = useSessionStore((s) => s.typingUsers)
  const [isAIStreaming, setIsAIStreaming] = useState(false)

  const setTyping = useCallback(
    (isTyping: boolean) => {
      const now = Date.now()
      currentTypingRef.current = isTyping
      if (isTyping) {
        // Throttle: at most 1 track() call per 1000ms (CHAT-06 protection)
        if (now - lastTrackRef.current < 1000) return
        lastTrackRef.current = now
        // Merged payload: preserve ai_streaming field (T-02-12 / Pitfall 3)
        channelRef.current
          ?.track({ typing: true, displayName, ai_streaming: false })
          .catch(() => {})
      } else {
        // Untrack immediately so the presence:leave event fires without waiting
        // for the Presence heartbeat cycle (which can take ~10s on local Supabase)
        channelRef.current?.untrack().catch(() => {})
      }
    },
    [displayName]
  )

  const setAIStreaming = useCallback(
    (active: boolean) => {
      // T-02-12 / Pitfall 3: merge ai_streaming with the current typing state
      // so neither field clobbers the other.
      channelRef.current
        ?.track({
          typing: currentTypingRef.current, // preserve current typing state
          displayName,                       // preserve display name
          ai_streaming: active,
        })
        .catch(() => {})
    },
    [displayName]
  )

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase.channel(`presence:${sessionId}`, {
      config: { presence: { key: userId } },
    })

    channelRef.current = channel

    const syncTypingUsers = () => {
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

      // Derive isAIStreaming: any entry (including self) with ai_streaming === true
      const streaming = Object.values(state)
        .flatMap((payloads) => payloads)
        .some((p) => p.ai_streaming === true)

      setIsAIStreaming(streaming)
    }

    channel
      .on('presence', { event: 'sync' }, syncTypingUsers)
      .on('presence', { event: 'leave' }, syncTypingUsers)
      .subscribe()

    return () => {
      channel.untrack().catch(() => {})
      supabase.removeChannel(channel).catch(() => {})
    }
  }, [sessionId, userId, setTypingUsers])

  return { typingUsers, setTyping, setAIStreaming, isAIStreaming }
}
