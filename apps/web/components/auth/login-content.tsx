'use client'

import { GoogleSignInButton } from '@/components/auth/google-sign-in-button'
import { DevSignInButton } from '@/components/auth/dev-sign-in-button'
import { HeroPixels } from '@/components/hero-pixels'

function PanelitoLogo({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
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
  )
}

/**
 * Shared login UI — logo, wordmark, tagline, and auth buttons.
 * asPage=true: h1 heading, HeroPixels animation, page-scale sizing.
 * asPage=false (default): h2 heading, no pixels, panel-scale sizing.
 */
export function LoginContent({ asPage = false }: { asPage?: boolean }) {
  const Heading = asPage ? 'h1' : 'h2'

  const logoBlock = (
    <div className="flex flex-col items-center gap-3">
      <PanelitoLogo size={asPage ? 48 : 44} />
      <Heading
        className={
          asPage
            ? 'text-[28px] font-semibold leading-[1.15] tracking-[0.02em] text-foreground'
            : 'text-2xl font-semibold text-white tracking-tight'
        }
      >
        Panelito
      </Heading>
    </div>
  )

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      {/* Logo + wordmark */}
      <div className="text-center space-y-2">
        {asPage ? (
          /* Sized to contain all HeroPixels (x: ±130, y: −50/+80) */
          <div className="relative w-[260px] h-[180px] flex flex-col items-center justify-center mx-auto">
            <HeroPixels />
            <div className="relative z-10">{logoBlock}</div>
          </div>
        ) : (
          logoBlock
        )}
        <p
          className={
            asPage
              ? 'text-[15px] font-normal text-muted-foreground leading-[1.5]'
              : 'text-sm text-slate-500 mt-1.5'
          }
        >
          Pensamiento colectivo en tiempo real.
        </p>
      </div>

      {/* Auth buttons */}
      <div className="w-full max-w-[300px] flex flex-col gap-3">
        <GoogleSignInButton />
        {process.env.NODE_ENV !== 'production' && <DevSignInButton />}
      </div>
    </div>
  )
}
