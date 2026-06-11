import { Badge } from '@/components/ui/badge'
import { JoinForm } from './join-form'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787'

interface SessionSummary {
  id: string
  title: string | null
  creator_display_name: string | null
  status: 'active' | 'frozen' | 'closed'
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Activa',
  frozen: 'Congelada',
  closed: 'Finalizada',
}

/**
 * Guest join landing page — /join/[code]
 *
 * D-01: Branded landing page showing the session title and creator name.
 * D-02: Guest enters display name; on submit they are instantly redirected
 *       to the workspace with no interstitial.
 * D-03: Frozen/closed sessions show a read-only variant (the form still works;
 *       the workspace itself enforces read-only mode).
 *
 * Renders:
 * - Session not found: centered error card (404 branch)
 * - Valid session: session info card + JoinForm client component
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params

  // Fetch session info (public endpoint — no auth required)
  let session: SessionSummary | null = null
  try {
    const res = await fetch(`${API_URL}/api/sessions/by-code/${code}`, {
      cache: 'no-store',
    })
    if (res.ok) {
      session = await res.json()
    }
  } catch {
    // Network error — treat as session not found
  }

  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="w-full max-w-[400px] rounded-lg border border-border bg-card p-6 text-center space-y-3">
          <h1 className="text-[20px] font-semibold text-foreground">Session not found</h1>
          <p className="text-[15px] text-muted-foreground">
            This link may have expired or the session code is incorrect.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-[400px] space-y-4">
        {/* Session info card */}
        <div className="rounded-lg border border-border bg-card p-6 space-y-2">
          <h1 className="text-[20px] font-semibold text-foreground">
            {session.title ?? 'Untitled Session'}
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            {session.creator_display_name && (
              <span className="text-[13px] text-muted-foreground">
                by {session.creator_display_name}
              </span>
            )}
            <Badge
              variant={session.status === 'active' ? 'default' : 'secondary'}
              className="text-[13px]"
            >
              {STATUS_LABELS[session.status] ?? session.status}
            </Badge>
          </div>
        </div>

        {/* Join form (client component) */}
        <JoinForm
          sessionId={session.id}
          shortCode={code}
          sessionStatus={session.status}
        />
      </div>
    </main>
  )
}
