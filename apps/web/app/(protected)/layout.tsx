import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { requireUser } from '@/lib/auth'
import { getCreatorSettings } from '@/lib/creator-settings'

/**
 * Protected layout — enforces authentication AND BYOK onboarding gate.
 *
 * Auth gate: requireUser() redirects to /auth/sign-in if unauthenticated.
 *
 * BYOK gate (D-04):
 * - If the creator has no API key set, redirect to /onboarding/api-key.
 * - Exception: the /settings route itself is NOT gated — the creator must be
 *   able to set, update, or reconnect their key from /settings even if the
 *   key is currently missing. Gating /settings would create a redirect loop.
 * - Exception: /onboarding/api-key is outside this layout group (uses
 *   (onboarding) group), so it is never caught here.
 *
 * Implementation note (D-04 vs D-05 tension):
 * When the creator disconnects their key via /settings DELETE, the next
 * protected-route hit (e.g. /sessions/...) will redirect them back to
 * /onboarding/api-key. The /settings route stays accessible so they can
 * re-enter the key without being locked out entirely.
 *
 * The x-pathname header is set by middleware.ts on every request, allowing
 * this server component to read the current route without the overhead of
 * a separate server action.
 */
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()

  // Read current pathname to implement the /settings exception
  const headersList = await headers()
  const pathname = headersList.get('x-pathname') ?? ''

  // /settings is exempt from the BYOK gate (D-05 — key update route)
  // /onboarding/* is outside this layout group — never matches here
  const isSettingsRoute = pathname.startsWith('/settings')

  // BYOK gate (D-04): Only creators (non-anonymous users) are gated.
  // Guests (anonymous users) do not need to provide their own API keys.
  if (!isSettingsRoute && !user.is_anonymous) {
    // Check if the creator has an API key (D-04 gate)
    const settings = await getCreatorSettings()
    if (!settings.has_api_key) {
      redirect('/onboarding/api-key')
    }
  }

  return (
    <div style={{ height: 'var(--app-height)' }} className="flex flex-col">
      {children}
    </div>
  )
}
