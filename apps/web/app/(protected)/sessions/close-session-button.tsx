'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch, ApiError } from '@/lib/api'
import type { Session } from '@panelito/types'

export function CloseSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const handleClose = async () => {
    setPending(true)
    try {
      await apiFetch<Session>(`/api/sessions/${sessionId}/close`, { method: 'POST' })
      router.refresh()
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('Close failed:', err.status)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClose}
      disabled={pending}
      className="h-7 px-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
      title="Cerrar sesión"
    >
      <X className="h-3.5 w-3.5" />
      <span className="ml-1 text-[12px]">{pending ? 'Cerrando...' : 'Cerrar'}</span>
    </Button>
  )
}
