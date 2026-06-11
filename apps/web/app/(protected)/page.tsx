import Link from 'next/link'
import { getUser } from '@/lib/auth'
import { Button } from '@/components/ui/button'

/**
 * Protected home page — authenticated creator hub.
 *
 * Shows a welcome message and a CTA to create a new session.
 * The requireUser() gate is enforced in the parent (protected)/layout.tsx.
 */
export default async function ProtectedHomePage() {
  const user = await getUser()

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? 'there'

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="text-center space-y-3 max-w-sm">
        <h1 className="text-[20px] font-semibold text-foreground">
          Welcome, {displayName}
        </h1>
        <p className="text-[15px] text-muted-foreground">
          Create a session to start a collaborative thinking room.
        </p>
      </div>
      <Link href="/sessions/new">
        <Button className="h-12 px-8 text-[15px]">
          Create Session
        </Button>
      </Link>
    </main>
  )
}
