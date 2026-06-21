import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Snowflake, X, PlayCircle, Users, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
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
import { ShareButton } from '@/app/(protected)/sessions/[id]/share-button'
import type { Session } from '@panelito/types'
import { cn } from '@/lib/utils'

interface CreatorControlsProps {
  session: Session
  shortCode: string
  sessionTitle: string | null
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
export function CreatorControls({ session, shortCode, sessionTitle }: CreatorControlsProps): ReactNode {
  const router = useRouter()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [analystasOpen, setAnalystasOpen] = useState(false)
  const [toggling, setToggling] = useState(false)
  
  const activePersonas = session.active_personas || []
  const isAnalistaActive = activePersonas.includes('analista_cientifico')

  const [localAnalistaActive, setLocalAnalistaActive] = useState<boolean | null>(null)
  const [prevActivePersonas, setPrevActivePersonas] = useState(session.active_personas)

  if (session.active_personas !== prevActivePersonas) {
    setPrevActivePersonas(session.active_personas)
    setLocalAnalistaActive(null)
  }

  const isChecked = localAnalistaActive !== null ? localAnalistaActive : isAnalistaActive

  const handlePersonaToggle = async (checked: boolean) => {
    setLocalAnalistaActive(checked)
    setToggling(true)
    try {
      await apiFetch(`/api/sessions/${session.id}/personas`, {
        method: 'POST',
        body: JSON.stringify({
          personaId: 'analista_cientifico',
          active: checked,
        }),
      })
      router.refresh()
    } catch {
      setLocalAnalistaActive(!checked)
      toast.error('No se pudo cambiar el analista. Inténtalo de nuevo.')
    } finally {
      setToggling(false)
    }
  }

  const personaCard = (
    <div className="flex items-center justify-between p-4 rounded-lg border bg-card gap-3 text-left">
      <div className="flex items-center gap-3">
        <div 
          className={cn(
            "w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 transition-opacity",
            isChecked ? "opacity-100" : "opacity-60"
          )}
          style={{ 
            background: 'rgba(99,102,241,0.15)', 
            border: isChecked ? '1px solid rgba(99,102,241,0.50)' : '1px solid rgba(161,161,170,0.30)' 
          }}
        >
          <FlaskConical size={20} className={isChecked ? "text-indigo-400" : "text-zinc-400"} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium text-foreground">Analista Científico</div>
          <div className="text-[13px] text-muted-foreground mt-0.5 line-clamp-2 leading-tight">
            Analiza datos, detecta falacias y estructura la información cuantitativa.
          </div>
        </div>
      </div>
      <Switch
        checked={isChecked}
        disabled={toggling}
        onCheckedChange={handlePersonaToggle}
        aria-label={isChecked ? 'Desactivar Analista Científico' : 'Activar Analista Científico'}
      />
    </div>
  )

  return (
    <>
      {/* Desktop: float in analytics panel (shown via parent CSS media query) */}
      <div className="hidden md:flex items-center gap-2">
        <ShareButton shortCode={shortCode} sessionTitle={sessionTitle} />
        <Button 
          variant="outline" 
          size="sm" 
          className="h-9 gap-2" 
          onClick={() => setAnalystasOpen(true)}
        >
          <Users className="h-4 w-4" />
          Analistas
        </Button>
        <FreezeButton sessionId={session.id} status={session.status} onAction={() => setSheetOpen(false)} />
        <UnfreezeButton sessionId={session.id} status={session.status} onAction={() => setSheetOpen(false)} />
        <CloseButton sessionId={session.id} status={session.status} onAction={() => setSheetOpen(false)} />
      </div>

      {/* Desktop Analyst drawer Sheet */}
      <Sheet open={analystasOpen} onOpenChange={setAnalystasOpen}>
        <SheetContent side="right" className="w-80" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>Analistas activos</SheetTitle>
          </SheetHeader>
          <div className="pt-6 space-y-4">
            {personaCard}
            <p className="text-[13px] text-muted-foreground">
              Los cambios se aplican de inmediato a los mensajes siguientes.
            </p>
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile: Sheet triggered by ⋯ icon */}
      <div className="md:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Session options">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" aria-describedby={undefined}>
            <SheetHeader>
              <SheetTitle>Opciones de sesion</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-3 pt-4 pb-6">
              <ShareButton shortCode={shortCode} sessionTitle={sessionTitle} />
              <FreezeButton sessionId={session.id} status={session.status} onAction={() => setSheetOpen(false)} />
              <UnfreezeButton sessionId={session.id} status={session.status} onAction={() => setSheetOpen(false)} />
              <CloseButton sessionId={session.id} status={session.status} onAction={() => setSheetOpen(false)} />
              
              <div className="border-t border-border pt-4 mt-2 space-y-3">
                <div className="text-[13px] text-muted-foreground font-medium uppercase tracking-wider text-left">Analistas activos</div>
                {personaCard}
                <p className="text-[13px] text-muted-foreground text-left">
                  Los cambios se aplican de inmediato a los mensajes siguientes.
                </p>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
