'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useMemo } from 'react'
import { LoginContent } from '@/components/auth/login-content'
import { PanelAnimation } from '@/components/panel-animation'

const COLORS = ['#818CF8', '#38BDF8', '#F472B6']

// Viewport-wide pixel burst on panel open — draws the eye to the right
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
      {/* Viewport pixel burst — mounts fresh each open */}
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
            className="fixed right-0 top-0 bottom-0 z-[57] w-full sm:w-[400px] bg-slate-950 border-l border-white/[0.07] flex flex-col items-center justify-center px-10 overflow-hidden"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <button
              onClick={onClose}
              className="absolute top-5 right-5 z-10 text-slate-600 hover:text-slate-300 transition-colors"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>

            {/* In-panel animation: hero pixels → chart pixels */}
            <PanelAnimation active={open} />

            <LoginContent />
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </>
  )
}
