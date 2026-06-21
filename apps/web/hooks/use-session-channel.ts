'use client'

/**
 * useSessionChannel — Supabase Realtime broadcast subscription for session:${sessionId}
 *
 * CHAT-01: Delivers messages from remote participants via broadcast.
 * Subscribes on mount, unsubscribes on cleanup (StrictMode-safe via useRef).
 */

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePanelStore } from '@/store/panel-store'
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
        const msg = payload as Message
        onMessageRef.current(msg)
        // Automatically sync panel to newest message snapshot if present
        if (msg.role === 'assistant' && msg.canvas_snapshot_state != null) {
          usePanelStore.getState().setWidget(msg.canvas_snapshot_state as any)
        }
      })
      .on('broadcast', { event: 'panel_update' }, ({ payload }) => {
        // Apply live panel updates during assistant tool calls
        if (payload) {
          usePanelStore.getState().setWidget(payload as any)
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel).catch(() => {})
    }
  }, [sessionId])
}
