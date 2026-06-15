'use client'

import { motion, useScroll, useTransform, useSpring } from 'framer-motion'

export function ScrollLogo() {
  const { scrollY } = useScroll()

  // Scale peaks at ~80px scroll then eases back to 1 by ~200px
  const rawScale = useTransform(scrollY, [0, 80, 200], [1, 1.55, 1])
  const scale = useSpring(rawScale, { stiffness: 120, damping: 22 })

  return (
    <motion.div style={{ scale }} className="flex items-center gap-2.5 origin-left">
      <svg
        width="22"
        height="22"
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
      <span className="text-sm font-bold tracking-wider text-white">Panelito</span>
    </motion.div>
  )
}
