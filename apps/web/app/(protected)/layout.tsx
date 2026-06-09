import { requireUser } from '@/lib/auth'

/**
 * Protected layout — enforces authentication for all routes in this group.
 *
 * requireUser() is called server-side at the top of every render.
 * If the user is not authenticated, requireUser() calls Next.js redirect()
 * which throws internally and redirects to /auth/sign-in.
 *
 * This is the canonical server-side auth gate for all protected routes.
 * Every subsequent plan (BYOK onboarding, session creation, workspace) uses
 * this layout as the outer shell.
 */
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireUser()

  return (
    <div style={{ height: 'var(--app-height)' }} className="flex flex-col">
      {children}
    </div>
  )
}
