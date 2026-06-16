import { LoginContent } from '@/components/auth/login-content'

/**
 * Sign-in page — Screen 1 (OAuth Sign-In Page)
 * Uses min-h-[var(--app-height)] — do not use viewport height units (mobile IME constraint).
 */
export default function SignInPage() {
  return (
    <main className="flex min-h-[var(--app-height)] flex-col items-center justify-center px-6">
      <div className="w-full max-w-[360px] flex flex-col items-center gap-6">
        <LoginContent asPage />
      </div>
    </main>
  )
}
