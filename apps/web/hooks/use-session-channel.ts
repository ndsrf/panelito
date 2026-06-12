'use client'

/**
 * useSessionChannel — Supabase Realtime broadcast subscription for session:${sessionId}
 *
 * CHAT-01: Delivers messages from remote participants via broadcast.
 * Subscribes on mount, unsubscribes on cleanup (StrictMode-safe via useRef).
 */

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Message } from '@panelito/types'

export function useSessionChannel(
  sessionId: string,
  onMessage: (msg: Message) => void
): void {
  // Use a ref for the callback to avoid re-subscribing on every render
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`session:${sessionId}`)
      .on('broadcast', { event: 'new_message' }, ({ payload }) => {
        onMessageRef.current(payload as Message)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel).catch(() => {})
    }
  }, [sessionId])
}
