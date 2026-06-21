'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Snowflake, X, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch, ApiError } from '@/lib/api'
import type { Session, SessionStatus } from '@panelito/types'

interface SessionActionsProps {
  sessionId: string
  status: SessionStatus
}

/**
 * SessionActions — Freeze and Close buttons for the session creator.
 *
 * SESS-05: Freeze button — sets status to 'frozen'.
 * SESS-06: Close button — sets status to 'closed'.
 *
 * Both use variant="destructive" per UI-SPEC.
 * On success: router.refresh() to update the status badge without full reload.
 * Both buttons show an optimistic pending state (disabled + spinner text) during the request.
 */
export function SessionActions({ sessionId, status }: SessionActionsProps) {
  const router = useRouter()
  const [freezePending, setFreezePending] = useState(false)
  const [unfreezePending, setUnfreezePending] = useState(false)
  const [closePending, setClosePending] = useState(false)

  const handleFreeze = async () => {
    setFreezePending(true)
    try {
      await apiFetch<Session>(`/api/sessions/${sessionId}/freeze`, { method: 'POST' })
      router.refresh()
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('Freeze failed:', err.status)
      }
    } finally {
      setFreezePending(false)
    }
  }

  const handleUnfreeze = async () => {
    setUnfreezePending(true)
    try {
      await apiFetch<Session>(`/api/sessions/${sessionId}/unfreeze`, { method: 'POST' })
      router.refresh()
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('Unfreeze failed:', err.status)
      }
    } finally {
      setUnfreezePending(false)
    }
  }

  const handleClose = async () => {
    setClosePending(true)
    try {
      await apiFetch<Session>(`/api/sessions/${sessionId}/close`, { method: 'POST' })
      router.refresh()
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('Close failed:', err.status)
      }
    } finally {
      setClosePending(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* Freeze button — only when session is active */}
      {status === 'active' && (
        <Button
          variant="destructive"
          size="sm"
          onClick={handleFreeze}
          disabled={freezePending}
          className="h-9 gap-2"
        >
          <Snowflake className="h-4 w-4" />
          {freezePending ? 'Congelando...' : 'Congelar'}
        </Button>
      )}

      {/* Unfreeze button — only when session is frozen */}
      {status === 'frozen' && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleUnfreeze}
          disabled={unfreezePending}
          className="h-9 gap-2"
        >
          <Play className="h-4 w-4" />
          {unfreezePending ? 'Reactivando...' : 'Reactivar'}
        </Button>
      )}

      {/* Close button — when session is not already closed */}
      {status !== 'closed' && (
        <Button
          variant="destructive"
          size="sm"
          onClick={handleClose}
          disabled={closePending}
          className="h-9 gap-2"
        >
          <X className="h-4 w-4" />
          {closePending ? 'Cerrando...' : 'Cerrar'}
        </Button>
      )}
    </div>
  )
}
