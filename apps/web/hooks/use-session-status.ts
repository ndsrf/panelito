'use client'

/**
 * useSessionStatus — subscribes to `session:${id}` broadcast channel for
 * `session_status_change` events and updates the session store (Plan 07).
 *
 * SESS-07: Auto-freeze broadcasts are reflected in < 2s without page reload.
 * SESS-09: Auto-name title updates are reflected live.
 * SESS-11: Anti-flicker — only real status changes reach clients (server-side debounce).
 * SESS-12: Cap warning / cap freeze broadcasts reflected in < 2s.
 *
 * The hook hydrates the store from `initialSession` on mount, then keeps it live.
 * Both this hook and `useSessionChannel` can co-exist on the same `session:${id}`
 * channel — Supabase Realtime allows multiple channel subscriptions.
 */

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSessionStore } from '@/store/session-store'
import type { Session } from '@panelito/types'

interface SessionStatusChangePayload {
  status?: Session['status']
  title?: string | null
  reason?: string
}

/**
 * useSessionStatus — live session state via Supabase broadcast.
 *
 * @param sessionId - The session ID to subscribe to.
 * @param initialSession - Server-fetched session for initial hydration.
 */
export function useSessionStatus(sessionId: string, initialSession: Session): void {
  const setSession = useSessionStore((s) => s.setSession)

  // Re-hydrate the store whenever the server-fetched session changes (e.g. after router.refresh()).
  // Using specific fields avoids re-running on every parent render while still catching
  // status/title updates that router.refresh() brings in after an action.
  useEffect(() => {
    setSession(initialSession)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSession.id, initialSession.status, initialSession.title])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`session-status:${sessionId}`)

    channel
      .on(
        'broadcast',
        { event: 'session_status_change' },
        ({ payload }: { payload: SessionStatusChangePayload }) => {
          const current = useSessionStore.getState().session ?? initialSession
          const updated: Session = {
            ...current,
            ...(payload.status ? { status: payload.status } : {}),
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.reason ? { auto_freeze_reason: payload.reason } : {}),
          } as Session
          setSession(updated)
        }
      )
      // SESS-07/11/12: Fallback for guests via postgres_changes (backed by RLS)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sessions',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const newSession = payload.new as Session
          const current = useSessionStore.getState().session ?? initialSession
          // Merge with current state to preserve any extra fields (like auto_freeze_reason)
          setSession({
            ...current,
            ...newSession,
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])
}
