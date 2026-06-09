import { GoogleSignInButton } from '@/components/auth/google-sign-in-button'

/**
 * Sign-in page — Screen 1 (OAuth Sign-In Page)
 *
 * Server component. Centered column max-width 360px.
 * Per UI-SPEC:
 * - Product wordmark: Display 28px Semibold (text-[28px] font-semibold)
 * - Tagline: 15px Regular, Muted Foreground, 8px gap below wordmark
 * - CTA: 48px Secondary surface + Border (NOT accent-colored)
 *
 * Uses min-h-[var(--app-height)] — do not use viewport height units (mobile IME constraint).
 */
export default function SignInPage() {
  return (
    <main className="flex min-h-[var(--app-height)] flex-col items-center justify-center px-6">
      <div className="w-full max-w-[360px] flex flex-col items-center gap-6">
        {/* Product wordmark — Display 28px Semibold */}
        <div className="text-center space-y-2">
          <h1
            className="text-[28px] font-semibold leading-[1.15] tracking-[0.02em] text-foreground"
          >
            Panelito
          </h1>
          {/* Tagline — 8px gap below wordmark, 15px Regular, Muted Foreground */}
          <p className="text-[15px] font-normal text-muted-foreground leading-[1.5]">
            Pensamiento colectivo en tiempo real.
          </p>
        </div>

        {/* Google OAuth CTA */}
        <GoogleSignInButton />
      </div>
    </main>
  )
}
