import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import { apiFetch } from '@/lib/api'
import type { Session } from '@panelito/types'
import { Badge } from '@/components/ui/badge'
import { ShareButton } from './share-button'
import { SessionActions } from './session-actions'

/**
 * Workspace shell placeholder — Plan 03.
 *
 * Fetches the session server-side and renders a placeholder shell with:
 * - Session title, mode badge, status badge
 * - Share button (opens QR modal)
 * - Freeze/Close buttons (creator-only, conditional on status)
 *
 * Plan 04 replaces the workspace-placeholder div with the real 40/60 layout.
 *
 * SESS-02: Session title and mode displayed.
 * SESS-05/06: Freeze and Close CTAs visible to creator.
 */
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireUser()

  // Get the current user's access token for the API call
  const supabase = await createServerClient()
  const { data: { session: authSession } } = await supabase.auth.getSession()
  const accessToken = authSession?.access_token

  let session: Session | null = null
  try {
    session = await apiFetch<Session>(`/api/sessions/${id}`, {}, accessToken)
  } catch {
    notFound()
  }

  if (!session) {
    notFound()
  }

  const user = await (await import('@/lib/auth')).getUser()
  const isCreator = user?.id === session.creator_id

  const modeLabels: Record<string, string> = {
    strategy: 'Strategy',
    debate: 'Debate',
    red_team: 'Red Team',
  }

  const statusLabels: Record<string, string> = {
    active: 'Active',
    frozen: 'Frozen',
    closed: 'Closed',
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-6">
      {/* Workspace shell placeholder — Plan 04 replaces this */}
      <div id="workspace-placeholder" className="w-full max-w-2xl space-y-6">
        {/* Session header */}
        <div className="space-y-3">
          <h1 className="text-[20px] font-semibold text-foreground">
            {session.title ?? 'Untitled Session'}
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            {session.mode && (
              <Badge variant="secondary" className="text-[13px]">
                {modeLabels[session.mode] ?? session.mode}
              </Badge>
            )}
            <Badge
              variant={session.status === 'active' ? 'default' : 'secondary'}
              className="text-[13px]"
            >
              {statusLabels[session.status] ?? session.status}
            </Badge>
          </div>
        </div>

        {/* Session actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <ShareButton shortCode={session.short_code} sessionTitle={session.title} />

          {isCreator && (
            <SessionActions
              sessionId={session.id}
              status={session.status}
            />
          )}
        </div>

        {/* Plan 04 workspace layout will replace this placeholder */}
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-[15px] text-muted-foreground">
            Real-time workspace coming in Plan 04.
          </p>
          <p className="text-[13px] text-muted-foreground mt-1">
            Session ID: {session.id}
          </p>
        </div>
      </div>
    </main>
  )
}
