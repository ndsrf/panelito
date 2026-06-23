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
import { useSessionStore } from '@/store/session-store'
import type { Message, Reaction, Branch } from '@panelito/types'

export function useSessionChannel(
  sessionId: string,
  onMessage: (msg: Message) => void,
  onReaction?: (reaction: Reaction) => void
): void {
  // Use a ref for the callbacks to avoid re-subscribing on every render
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const onReactionRef = useRef(onReaction)
  onReactionRef.current = onReaction

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
      .on('broadcast', { event: 'new_reaction' }, ({ payload }) => {
        console.log('[useSessionChannel] Received new_reaction broadcast:', payload)
        if (payload && onReactionRef.current) {
          onReactionRef.current(payload as Reaction)
        }
      })
      .on('broadcast', { event: 'new_branch' }, ({ payload }) => {
        console.log('[useSessionChannel] Received new_branch broadcast:', payload)
        if (payload) {
          useSessionStore.getState().addBranch(payload as Branch)
        }
      })
      .on('broadcast', { event: 'branch_update' }, ({ payload }) => {
        console.log('[useSessionChannel] Received branch_update broadcast:', payload)
        if (payload) {
          useSessionStore.getState().updateBranch(payload as Branch)
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel).catch(() => {})
    }
  }, [sessionId])
}
