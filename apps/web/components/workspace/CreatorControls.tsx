'use client'

/**
 * CreatorControls — Freeze, Unfreeze, and Close buttons for the session creator.
 *
 * SESS-05: Freeze button — sets status to 'frozen'.
 * SESS-06: Close button — sets status to 'closed'.
 * SESS-07: Unfreeze button — creator can override an auto-freeze (sets status to 'active').
 * T-04-04: UI gate — only renders if currentUserId === session.creator_id (checked in workspace.tsx).
 *          Server gate (Plan 03/07 Hono routes) re-checks; UI gate alone is NOT the security boundary.
 *
 * Layout:
 *   - Desktop (≥768px): floating button row in the analytics panel top-right corner.
 *   - Mobile (<768px): buttons inside a shadcn Sheet triggered by a ⋯ icon.
 *
 * Both destructive buttons use variant="destructive" with AlertDialog confirmation per UI-SPEC.
 * Unfreeze uses variant="outline" (non-destructive).
 * On success: router.refresh() to sync status without full reload.
 *
 * Plan 07: reads live session from session store for reactive button states.
 */

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Snowflake, X, PlayCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { apiFetch, ApiError } from '@/lib/api'
import type { Session } from '@panelito/types'

interface CreatorControlsProps {
  session: Session
}

interface ActionButtonsProps {
  sessionId: string
  status: Session['status']
  onAction?: () => void
}

function FreezeButton({ sessionId, status, onAction }: ActionButtonsProps): ReactNode {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  if (status !== 'active') return null

  const handleFreeze = async () => {
    setPending(true)
    try {
      await apiFetch<Session>(`/api/sessions/${sessionId}/freeze`, { method: 'POST' })
      router.refresh()
      onAction?.()
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('[CreatorControls] Freeze failed:', err.status)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          className="h-9 gap-2"
        >
          <Snowflake className="h-4 w-4" />
          {pending ? 'Congelando...' : 'Congelar'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Congelar sesion</AlertDialogTitle>
          <AlertDialogDescription>
            Los participantes no podran enviar mensajes. Puedes reanudar la sesion en cualquier momento.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleFreeze}
          >
            Congelar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * UnfreezeButton — only shows when status === 'frozen'.
 * Calls POST /api/sessions/:id/unfreeze to reactivate the session.
 * SESS-07: Creator can override an auto-freeze.
 */
function UnfreezeButton({ sessionId, status, onAction }: ActionButtonsProps): ReactNode {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  if (status !== 'frozen') return null

  const handleUnfreeze = async () => {
    setPending(true)
    try {
      await apiFetch<Session>(`/api/sessions/${sessionId}/unfreeze`, { method: 'POST' })
      router.refresh()
      onAction?.()
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('[CreatorControls] Unfreeze failed:', err.status)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={handleUnfreeze}
      className="h-9 gap-2"
    >
      <PlayCircle className="h-4 w-4" />
      {pending ? 'Reactivando...' : 'Reactivar'}
    </Button>
  )
}

function CloseButton({ sessionId, status, onAction }: ActionButtonsProps): ReactNode {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  if (status === 'closed') return null

  const handleClose = async () => {
    setPending(true)
    try {
      await apiFetch<Session>(`/api/sessions/${sessionId}/close`, { method: 'POST' })
      router.refresh()
      onAction?.()
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('[CreatorControls] Close failed:', err.status)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          className="h-9 gap-2"
        >
          <X className="h-4 w-4" />
          {pending ? 'Cerrando...' : 'Cerrar'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Finalizar sesion</AlertDialogTitle>
          <AlertDialogDescription>
            Esto finaliza la sesion de forma permanente. Los participantes aun podran ver el historial del chat.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleClose}
          >
            Finalizar sesion
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * CreatorControls — renders Freeze / Unfreeze / Close buttons.
 *
 * On desktop: floating button row (rendered by workspace.tsx in analytics panel overlay).
 * On mobile: inside a Sheet triggered by the ⋯ icon.
 *
 * Button visibility rules:
 * - Freeze: only when status === 'active'
 * - Unfreeze / Reactivar: only when status === 'frozen'
 * - Close: always except when already closed
 */
export function CreatorControls({ session }: CreatorControlsProps): ReactNode {
  const [sheetOpen, setSheetOpen] = useState(false)

  const actionButtons = (
    <div className="flex items-center gap-2">
      <FreezeButton sessionId={session.id} status={session.status} onAction={() => setSheetOpen(false)} />
      <UnfreezeButton sessionId={session.id} status={session.status} onAction={() => setSheetOpen(false)} />
      <CloseButton sessionId={session.id} status={session.status} onAction={() => setSheetOpen(false)} />
    </div>
  )

  return (
    <>
      {/* Desktop: float in analytics panel (shown via parent CSS media query) */}
      <div className="hidden md:flex items-center gap-2">
        {actionButtons}
      </div>

      {/* Mobile: Sheet triggered by ⋯ icon */}
      <div className="md:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Session options">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Opciones de sesion</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-3 pt-4 pb-6">
              <FreezeButton sessionId={session.id} status={session.status} onAction={() => setSheetOpen(false)} />
              <UnfreezeButton sessionId={session.id} status={session.status} onAction={() => setSheetOpen(false)} />
              <CloseButton sessionId={session.id} status={session.status} onAction={() => setSheetOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
