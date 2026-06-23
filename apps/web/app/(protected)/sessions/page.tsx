/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus, Users, MessageSquare, Clock, LogOut } from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CloseSessionButton } from './close-session-button'
import { signOut } from './actions'

type LastMessage = { content: string; display_name: string; created_at: string }

type SessionListItem = {
  id: string
  title: string | null
  mode: 'strategy' | 'debate' | 'red_team' | null
  status: 'active' | 'frozen' | 'closed'
  short_code: string
  created_at: string
  last_message: LastMessage | null
  participant_count: number
}

type SessionsListResponse = {
  sessions: SessionListItem[]
  total: number
  page: number
  total_pages: number
}

const MODE_LABELS: Record<string, string> = {
  strategy: 'Estrategia',
  debate: 'Debate',
  red_team: 'Equipo Rojo',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Activa',
  frozen: 'Congelada',
  closed: 'Cerrada',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const user = await requireUser()
  if (user.is_anonymous) redirect('/')

  const { page: pageParam } = await searchParams
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1)

  const supabase = await createServerClient()
  const { data: { session: authSession } } = await supabase.auth.getSession()
  const accessToken = authSession?.access_token

  let data: SessionsListResponse = { sessions: [], total: 0, page: 1, total_pages: 0 }
  try {
    data = await apiFetch<SessionsListResponse>(`/api/sessions?page=${page}`, {}, accessToken)
  } catch {
    // Show empty state on API error
  }

  const { sessions, total_pages } = data

  return (
    <main className="flex flex-1 flex-col bg-background">
      <div className="max-w-3xl w-full mx-auto px-4 py-8 flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-foreground">Mis sesiones</h1>
          <div className="flex items-center gap-2">
            <Button asChild size="sm">
              <Link href="/sessions/new">
                <Plus className="h-4 w-4 mr-1.5" />
                Nueva sesión
              </Link>
            </Button>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>

        {/* Empty state */}
        {sessions.length === 0 && (
          <div className="text-center py-20 flex flex-col items-center gap-4">
            <p className="text-muted-foreground">Aún no tienes sesiones.</p>
            <Button asChild>
              <Link href="/sessions/new">Crear primera sesión</Link>
            </Button>
          </div>
        )}

        {/* Session list */}
        {sessions.length > 0 && (
          <div className="flex flex-col gap-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3 hover:border-zinc-600 transition-colors"
              >
                {/* Card header row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <Link
                      href={`/sessions/${session.id}`}
                      className="text-[15px] font-medium text-foreground hover:text-primary transition-colors truncate"
                    >
                      {session.title ?? 'Sin título'}
                    </Link>
                    <div className="flex items-center gap-2 flex-wrap">
                      {session.mode && (
                        <span className="text-[11px] font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                          {MODE_LABELS[session.mode]}
                        </span>
                      )}
                      <span
                        className={cn(
                          'text-[11px] font-medium rounded px-1.5 py-0.5',
                          session.status === 'active' && 'text-emerald-400 bg-emerald-400/10',
                          session.status === 'frozen' && 'text-sky-400 bg-sky-400/10',
                          session.status === 'closed' && 'text-muted-foreground bg-muted',
                        )}
                      >
                        {STATUS_LABELS[session.status]}
                      </span>
                    </div>
                  </div>

                  {/* Close button — only shown while session is not already closed */}
                  {session.status !== 'closed' && (
                    <CloseSessionButton sessionId={session.id} />
                  )}
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-4 text-[13px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 shrink-0" />
                    {session.participant_count === 1
                      ? '1 participante'
                      : `${session.participant_count} participantes`}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    {formatDate(session.created_at)}
                  </span>
                </div>

                {/* Last message preview */}
                {session.last_message && (
                  <div className="flex items-start gap-2 text-[13px] border-t border-border pt-3 min-w-0">
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-muted-foreground line-clamp-1 min-w-0">
                      <span className="font-medium">{session.last_message.display_name}:</span>{' '}
                      {session.last_message.content}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {total_pages > 1 && (
          <div className="flex items-center justify-between pt-2">
            {page > 1 ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/sessions?page=${page - 1}` as any}>Anterior</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>Anterior</Button>
            )}
            <span className="text-[13px] text-muted-foreground">
              Página {page} de {total_pages}
            </span>
            {page < total_pages ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/sessions?page=${page + 1}` as any}>Siguiente</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>Siguiente</Button>
            )}
          </div>
        )}

      </div>
    </main>
  )
}
