'use client'

import Link from 'next/link'
import { motion, useScroll, useTransform, useSpring } from 'framer-motion'
import { ScrollLogo } from './scroll-logo'
import { NavChartPixels } from './nav-chart-pixels'

function ScrollEntrar() {
  const { scrollY } = useScroll()
  const rawScale = useTransform(scrollY, [0, 120], [1.15, 1], { clamp: true })
  const scale = useSpring(rawScale, { stiffness: 120, damping: 22 })

  return (
    <motion.div style={{ scale }} className="origin-right shrink-0">
      <Link
        href="/auth/sign-in"
        className="text-sm bg-white text-black px-4 py-1.5 rounded-md font-medium hover:bg-slate-200 transition-all"
      >
        Entrar →
      </Link>
    </motion.div>
  )
}

export function ScrollHeader() {
  const { scrollY } = useScroll()
  const rawH = useTransform(scrollY, [0, 120], [56, 40], { clamp: true })
  const height = useSpring(rawH, { stiffness: 80, damping: 20 })

  return (
    <motion.header
      style={{ height }}
      className="fixed top-0 inset-x-0 z-50 border-b border-white/[0.04] bg-black/70 backdrop-blur-xl overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between relative">
        <ScrollLogo />
        <NavChartPixels />
        <ScrollEntrar />
      </div>
    </motion.header>
  )
}
