import { requireUser } from '@/lib/auth'
import { NewSessionForm } from './new-session-form'

/**
 * New Session page — server component shell.
 *
 * Auth-gated via requireUser() (enforced in parent layout but checked here
 * for direct URL access safety). Renders the client-side form component.
 *
 * SESS-02: Creator creates session with title and mode.
 * D-06: No AI response cap field on this form (cap is global in /settings).
 */
export default async function NewSessionPage() {
  await requireUser()

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-6">
      <div className="w-full max-w-[480px]">
        <NewSessionForm />
      </div>
    </main>
  )
}
