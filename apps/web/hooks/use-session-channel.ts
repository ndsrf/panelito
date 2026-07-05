'use client'

/**
 * useSessionChannel — Supabase Realtime broadcast subscription for session:${sessionId}
 *
 * CHAT-01: Delivers messages from remote participants via broadcast.
 * Subscribes on mount, unsubscribes on cleanup (StrictMode-safe via useRef).
 *
 * Phase 9 (09-02):
 * - canvas_update handler uses mergeCanvasData (not setCanvasData) — Pitfall 3 fix:
 *   live broadcasts carry only the current invocation's rows; merging preserves earlier nodes.
 * - SUBSCRIBED status callback: on reconnect, fetches committed-only canvas and full-replaces
 *   the store (D-14). Ghost nodes are intentionally dropped on reconnect per D-03.
 */

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePanelStore } from '@/store/panel-store'
import { useSessionStore } from '@/store/session-store'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import type { Message, Reaction, Branch, CanvasNode, CanvasEdge } from '@panelito/types'

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
      .on('broadcast', { event: 'mic_acquired' }, ({ payload }) => {
        // D-04, HUMAN-01: Only apply if this broadcast is for the active branch
        console.log('[useSessionChannel] mic_acquired', payload.branch_id)
        if (payload.branch_id === useSessionStore.getState().activeBranchId) {
          useSessionStore.getState().setMicLocked(true)
        }
      })
      .on('broadcast', { event: 'mic_released' }, ({ payload }) => {
        // D-04, HUMAN-01: Only apply if this broadcast is for the active branch
        console.log('[useSessionChannel] mic_released', payload.branch_id, payload.reason)
        if (payload.branch_id === useSessionStore.getState().activeBranchId) {
          useSessionStore.getState().setMicLocked(false)
        }
      })
      .on('broadcast', { event: 'canvas_update' }, ({ payload }) => {
        // D-16, CANVAS-02: Canvas is session-wide — no branch filter
        // WR-01: guard against missing fields in broadcast payload (schema drift / partial failure)
        const nodes = Array.isArray(payload?.nodes) ? payload.nodes as CanvasNode[] : []
        const edges = Array.isArray(payload?.edges) ? payload.edges as CanvasEdge[] : []
        console.log('[canvas] update received', nodes.length, 'nodes', edges.length, 'edges')
        // Phase 9 Pitfall 3 fix: use mergeCanvasData (upsert by id) instead of setCanvasData
        // (full replace). Live broadcasts carry only current invocation's rows; merging preserves
        // nodes from prior invocations (D-02). Ghost + committed nodes both arrive here (D-02).
        useSessionStore.getState().mergeCanvasData(nodes, edges)
      })
      .on('broadcast', { event: 'phase_advanced' }, ({ payload }) => {
        // D-12, HUMAN-02: Update currentPhase and notify all participants
        console.log('[useSessionChannel] phase_advanced', payload.new_phase_id)
        useSessionStore.getState().setCurrentPhase(payload.new_phase_id as string)
        toast.success('La sesion ha avanzado a la siguiente fase.')
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // D-14, CANVAS-03: On reconnect, overwrite store with committed-only canvas state
          // (full replace, not merge). Ghost nodes are intentionally dropped on reconnect per D-03
          // — they are ephemeral per invocation and expire after 60 seconds via pg_cron.
          const { activeBranchId } = useSessionStore.getState()
          apiFetch<{ nodes: CanvasNode[]; edges: CanvasEdge[] }>(
            `/api/sessions/${sessionId}/canvas?branch_id=${activeBranchId}`
          )
            .then(({ nodes, edges }) => {
              useSessionStore.getState().setCanvasData(nodes, edges)
            })
            .catch(() => {}) // fail-silent — leave existing canvas state unchanged on error
        }
      })

    return () => {
      supabase.removeChannel(channel).catch(() => {})
    }
  }, [sessionId])
}
