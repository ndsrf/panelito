'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useMemo } from 'react'
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button'
import { DevSignInButton } from '@/components/auth/dev-sign-in-button'

const COLORS = ['#818CF8', '#38BDF8', '#F472B6']

function PixelBurst() {
  const pixels = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        left: `${5 + Math.random() * 58}%`,
        top: `${4 + Math.random() * 90}%`,
        size: 3 + Math.floor(Math.random() * 8),
        color: COLORS[i % COLORS.length],
        delay: Math.random() * 0.55,
      })),
    [],
  )

  return (
    <div className="fixed inset-0 z-[56] pointer-events-none" aria-hidden="true">
      {pixels.map((p, i) => (
        <motion.div
          key={i}
          className="absolute rounded-[2px]"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
          }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: [0, 0.9, 0.7, 0], scale: [0, 1, 1, 0] }}
          transition={{
            duration: 1.6,
            delay: p.delay,
            times: [0, 0.15, 0.65, 1],
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  )
}

export function LoginPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <>
      {/* Pixel burst — mounts fresh on each open, self-animates to opacity 0 */}
      {open && <PixelBurst />}

      {/* Backdrop */}
      <AnimatePresence>
        {open ? (
          <motion.div
            key="login-backdrop"
            className="fixed inset-0 z-[55] bg-black/65 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />
        ) : null}
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence>
        {open ? (
          <motion.aside
            key="login-panel"
            className="fixed right-0 top-0 bottom-0 z-[57] w-full sm:w-[400px] bg-slate-950 border-l border-white/[0.07] flex flex-col items-center justify-center gap-8 px-10"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <button
              onClick={onClose}
              className="absolute top-5 right-5 text-slate-600 hover:text-slate-300 transition-colors"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Logo + wordmark */}
            <div className="flex flex-col items-center gap-4 text-center">
              <svg
                width="44"
                height="44"
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
              <div>
                <h2 className="text-2xl font-semibold text-white tracking-tight">
                  Panelito
                </h2>
                <p className="text-sm text-slate-500 mt-1.5">
                  Pensamiento colectivo en tiempo real.
                </p>
              </div>
            </div>

            {/* Auth buttons */}
            <div className="w-full max-w-[300px] flex flex-col gap-3">
              <GoogleSignInButton />
              {process.env.NODE_ENV !== 'production' && <DevSignInButton />}
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </>
  )
}
