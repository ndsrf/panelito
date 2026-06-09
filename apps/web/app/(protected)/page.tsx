import { getUser } from '@/lib/auth'

/**
 * Protected home page — placeholder for authenticated users.
 *
 * Proves the user is authenticated by displaying their email.
 * This page is replaced in Plan 03 (workspace shell).
 *
 * Note: requireUser() is called in the parent layout — getUser() here
 * will always return a valid user (never null) since the layout gate
 * already ensures authentication.
 */
export default async function ProtectedHomePage() {
  const user = await getUser()

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="text-center space-y-3 max-w-sm">
        <h1 className="text-[20px] font-semibold text-foreground">
          Signed in as {user?.email}
        </h1>
        <p className="text-[15px] text-muted-foreground">
          Workspace coming in Plan 03.
        </p>
      </div>
    </main>
  )
}
