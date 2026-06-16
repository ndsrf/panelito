import { GoogleSignInButton } from '@/components/auth/google-sign-in-button'
import { DevSignInButton } from '@/components/auth/dev-sign-in-button'
import { HeroPixels } from '@/components/hero-pixels'

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

        {/* Logo + wordmark with floating pixel animation */}
        <div className="text-center space-y-2">
          {/* Container sized to contain all HeroPixels (x: ±130, y: −50/+80) */}
          <div className="relative w-[260px] h-[180px] flex flex-col items-center justify-center mx-auto">
            <HeroPixels />
            <div className="relative z-10 flex flex-col items-center gap-3">
              <svg
                width="48"
                height="48"
                viewBox="0 0 32 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <rect width="32" height="32" rx="6" fill="#0F172A" />
                <path
                  d="M11 22V10H17C18.6569 10 20 11.3431 20 13C20 14.6569 18.6569 16 17 16H11"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="22" cy="22" r="2" fill="#38BDF8" />
                <circle cx="24" cy="12" r="1.5" fill="#818CF8" />
                <circle cx="8" cy="18" r="1.5" fill="#F472B6" />
              </svg>
              <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[0.02em] text-foreground">
                Panelito
              </h1>
            </div>
          </div>
          <p className="text-[15px] font-normal text-muted-foreground leading-[1.5]">
            Pensamiento colectivo en tiempo real.
          </p>
        </div>

        {/* Google OAuth CTA */}
        <GoogleSignInButton />

        {/* Dev-only bypass — skips OAuth for WSL2 local dev */}
        {process.env.NODE_ENV !== 'production' && <DevSignInButton />}
      </div>
    </main>
  )
}
