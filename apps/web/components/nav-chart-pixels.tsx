'use client'

import { motion, AnimatePresence, useScroll, useMotionValueEvent } from 'framer-motion'
import { useState, useEffect, useMemo, useRef } from 'react'

const PX = 3

const CHARTS = [
  {
    // Bar chart — 5 columns of varying height
    pixels: [
      { x: -20, y: 6, color: '#38BDF8' },
      { x: -20, y: 2, color: '#38BDF8' },
      { x: -20, y: -2, color: '#38BDF8' },
      { x: -10, y: 6, color: '#818CF8' },
      { x: -10, y: 2, color: '#818CF8' },
      { x: -10, y: -2, color: '#818CF8' },
      { x: -10, y: -6, color: '#818CF8' },
      { x: -10, y: -10, color: '#818CF8' },
      { x: -10, y: -14, color: '#818CF8' },
      { x: 0, y: 6, color: '#F472B6' },
      { x: 0, y: 2, color: '#F472B6' },
      { x: 0, y: -2, color: '#F472B6' },
      { x: 0, y: -6, color: '#F472B6' },
      { x: 10, y: 6, color: '#38BDF8' },
      { x: 10, y: 2, color: '#38BDF8' },
      { x: 10, y: -2, color: '#38BDF8' },
      { x: 10, y: -6, color: '#38BDF8' },
      { x: 10, y: -10, color: '#38BDF8' },
      { x: 20, y: 6, color: '#818CF8' },
      { x: 20, y: 2, color: '#818CF8' },
    ],
  },
  {
    // Line chart — 9 dots tracing a trend
    pixels: [
      { x: -24, y: 4, color: '#38BDF8' },
      { x: -18, y: -4, color: '#38BDF8' },
      { x: -12, y: 0, color: '#818CF8' },
      { x: -6, y: -12, color: '#818CF8' },
      { x: 0, y: -6, color: '#F472B6' },
      { x: 6, y: -14, color: '#F472B6' },
      { x: 12, y: -8, color: '#38BDF8' },
      { x: 18, y: 2, color: '#38BDF8' },
      { x: 24, y: -4, color: '#818CF8' },
    ],
  },
  {
    // Pie chart — 3 colored sectors
    pixels: [
      { x: 0, y: 0, color: '#818CF8' },
      { x: -4, y: -4, color: '#818CF8' },
      { x: -8, y: -2, color: '#818CF8' },
      { x: -6, y: -8, color: '#818CF8' },
      { x: -2, y: -8, color: '#818CF8' },
      { x: -10, y: -6, color: '#818CF8' },
      { x: 4, y: -4, color: '#38BDF8' },
      { x: 8, y: -2, color: '#38BDF8' },
      { x: 6, y: -8, color: '#38BDF8' },
      { x: 2, y: -8, color: '#38BDF8' },
      { x: 10, y: -6, color: '#38BDF8' },
      { x: -4, y: 4, color: '#F472B6' },
      { x: 0, y: 8, color: '#F472B6' },
      { x: 4, y: 4, color: '#F472B6' },
      { x: -8, y: 4, color: '#F472B6' },
      { x: 8, y: 4, color: '#F472B6' },
      { x: 0, y: 4, color: '#F472B6' },
    ],
  },
  {
    // Scatter plot — irregular cloud of dots
    pixels: [
      { x: -22, y: -10, color: '#38BDF8' },
      { x: -16, y: -2, color: '#818CF8' },
      { x: -10, y: -14, color: '#F472B6' },
      { x: -4, y: -8, color: '#38BDF8' },
      { x: 2, y: 2, color: '#818CF8' },
      { x: 8, y: -12, color: '#F472B6' },
      { x: 14, y: -4, color: '#38BDF8' },
      { x: 20, y: -10, color: '#818CF8' },
      { x: -18, y: 6, color: '#F472B6' },
      { x: -6, y: 4, color: '#38BDF8' },
      { x: 6, y: 8, color: '#818CF8' },
      { x: 16, y: 2, color: '#F472B6' },
    ],
  },
]

const CYCLE_MS = 3800

function NavPixel({
  tx, ty, color, delay, ix, iy,
}: {
  tx: number; ty: number; color: string; delay: number; ix: number; iy: number
}) {
  return (
    <motion.div
      className="absolute rounded-[1px]"
      style={{
        width: PX,
        height: PX,
        backgroundColor: color,
        left: `calc(50% + ${tx}px)`,
        top: `calc(50% + ${ty}px)`,
      }}
      initial={{ x: ix, y: iy, opacity: 0, scale: 0 }}
      animate={{ x: 0, y: 0, opacity: 0.9, scale: 1 }}
      exit={{ opacity: 0, scale: 0, transition: { duration: 0.3 } }}
      transition={{ duration: 0.65, delay, ease: 'easeOut' }}
    />
  )
}

export function NavChartPixels() {
  const { scrollY } = useScroll()
  const [isScrolled, setIsScrolled] = useState(false)
  const [chartKey, setChartKey] = useState(0)
  const [mounted, setMounted] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => { setMounted(true) }, [])

  useMotionValueEvent(scrollY, 'change', (y) => {
    setIsScrolled(y > 80)
  })

  useEffect(() => {
    if (!isScrolled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }
    intervalRef.current = setInterval(() => {
      setChartKey(k => k + 1)
    }, CYCLE_MS)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isScrolled])

  const chart = CHARTS[chartKey % CHARTS.length]!

  // Stable scatter positions per chart cycle — recomputed when chartKey changes
  const scatter = useMemo(
    () =>
      chart.pixels.map(() => ({
        x: (Math.random() - 0.5) * 280,
        y: (Math.random() - 0.5) * 38,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartKey],
  )

  if (!mounted) return null

  return (
    <div
      className="absolute inset-0 pointer-events-none select-none overflow-hidden"
      aria-hidden="true"
    >
      <AnimatePresence>
        {isScrolled &&
          chart.pixels.map((p, i) => (
            <NavPixel
              key={`${chartKey}-${i}`}
              tx={p.x}
              ty={p.y}
              color={p.color}
              delay={i * 0.055}
              ix={scatter[i]?.x ?? 0}
              iy={scatter[i]?.y ?? 0}
            />
          ))}
      </AnimatePresence>
    </div>
  )
}
