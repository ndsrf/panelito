'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect, useMemo, useRef } from 'react'

// ── Hero pixels — permanent floating background behind the login content ──────
// Anchored at 50% / 50% (panel center, same as the login form).
// y-spread covers the full content height: logo → title → tagline → button.

const HERO_PIXELS = [
  // left cluster
  { x: -95, y: -85,  size: 8, color: '#818CF8', delay: 0    },
  { x: -65, y: -20,  size: 5, color: '#38BDF8', delay: 0.2  },
  { x: -110, y: 45,  size: 7, color: '#F472B6', delay: 0.45 },
  { x: -50, y: -115, size: 4, color: '#818CF8', delay: 0.6  },
  { x: -85, y: 85,   size: 5, color: '#38BDF8', delay: 0.1  },
  { x: -30, y: 115,  size: 6, color: '#F472B6', delay: 0.55 },
  { x: -120, y: -5,  size: 3, color: '#818CF8', delay: 0.85 },
  // right cluster
  { x: 70,  y: -95,  size: 6, color: '#F472B6', delay: 0.3  },
  { x: 55,  y: 20,   size: 8, color: '#818CF8', delay: 0.5  },
  { x: 100, y: -45,  size: 5, color: '#38BDF8', delay: 0.15 },
  { x: 80,  y: 90,   size: 4, color: '#F472B6', delay: 0.7  },
  { x: 30,  y: -120, size: 7, color: '#818CF8', delay: 0.35 },
  { x: 115, y: 50,   size: 3, color: '#38BDF8', delay: 0.8  },
  { x: 40,  y: 115,  size: 5, color: '#F472B6', delay: 0.65 },
]

// ── Chart pixels — form recognisable charts (scaled for panel width) ──────────
// Anchored at 50% / 28% (upper area of panel, above main login content).

const PX = 4

const PANEL_CHARTS = [
  {
    // Bar chart
    pixels: [
      { x: -54, y: 16, color: '#38BDF8' },
      { x: -54, y:  6, color: '#38BDF8' },
      { x: -54, y: -4, color: '#38BDF8' },
      { x: -28, y: 16, color: '#818CF8' },
      { x: -28, y:  6, color: '#818CF8' },
      { x: -28, y: -4, color: '#818CF8' },
      { x: -28, y:-14, color: '#818CF8' },
      { x: -28, y:-24, color: '#818CF8' },
      { x: -28, y:-34, color: '#818CF8' },
      { x:  -2, y: 16, color: '#F472B6' },
      { x:  -2, y:  6, color: '#F472B6' },
      { x:  -2, y: -4, color: '#F472B6' },
      { x:  -2, y:-14, color: '#F472B6' },
      { x:  24, y: 16, color: '#38BDF8' },
      { x:  24, y:  6, color: '#38BDF8' },
      { x:  24, y: -4, color: '#38BDF8' },
      { x:  24, y:-14, color: '#38BDF8' },
      { x:  24, y:-24, color: '#38BDF8' },
      { x:  50, y: 16, color: '#818CF8' },
      { x:  50, y:  6, color: '#818CF8' },
    ],
  },
  {
    // Line chart
    pixels: [
      { x: -60, y: 10,  color: '#38BDF8' },
      { x: -45, y: -10, color: '#38BDF8' },
      { x: -30, y:   0, color: '#818CF8' },
      { x: -15, y: -30, color: '#818CF8' },
      { x:   0, y: -15, color: '#F472B6' },
      { x:  15, y: -36, color: '#F472B6' },
      { x:  30, y: -20, color: '#38BDF8' },
      { x:  45, y:   5, color: '#38BDF8' },
      { x:  60, y: -10, color: '#818CF8' },
    ],
  },
  {
    // Pie chart
    pixels: [
      { x:   0, y:   0, color: '#818CF8' },
      { x: -10, y: -10, color: '#818CF8' },
      { x: -20, y:  -5, color: '#818CF8' },
      { x: -15, y: -20, color: '#818CF8' },
      { x:  -5, y: -20, color: '#818CF8' },
      { x: -25, y: -15, color: '#818CF8' },
      { x:  10, y: -10, color: '#38BDF8' },
      { x:  20, y:  -5, color: '#38BDF8' },
      { x:  15, y: -20, color: '#38BDF8' },
      { x:   5, y: -20, color: '#38BDF8' },
      { x:  25, y: -15, color: '#38BDF8' },
      { x: -10, y:  10, color: '#F472B6' },
      { x:   0, y:  20, color: '#F472B6' },
      { x:  10, y:  10, color: '#F472B6' },
      { x: -20, y:  10, color: '#F472B6' },
      { x:  20, y:  10, color: '#F472B6' },
      { x:   0, y:  10, color: '#F472B6' },
    ],
  },
  {
    // Scatter plot
    pixels: [
      { x: -55, y: -25, color: '#38BDF8' },
      { x: -40, y:  -5, color: '#818CF8' },
      { x: -25, y: -35, color: '#F472B6' },
      { x: -10, y: -20, color: '#38BDF8' },
      { x:   5, y:   5, color: '#818CF8' },
      { x:  20, y: -30, color: '#F472B6' },
      { x:  35, y: -10, color: '#38BDF8' },
      { x:  50, y: -25, color: '#818CF8' },
      { x: -45, y:  15, color: '#F472B6' },
      { x: -15, y:  10, color: '#38BDF8' },
      { x:  15, y:  20, color: '#818CF8' },
      { x:  40, y:   5, color: '#F472B6' },
    ],
  },
]

const CHART_START_DELAY = 1200
const CYCLE_MS = 3800

// ── Sub-components ────────────────────────────────────────────────────────────

function HeroPixel({
  x, y, size, color, delay,
}: { x: number; y: number; size: number; color: string; delay: number }) {
  const floatY = size > 6 ? 8 : 5
  const floatX = size > 6 ? 4 : 3

  return (
    <motion.div
      className="absolute rounded-[2px]"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        left: `${x - size / 2}px`,
        top:  `${y - size / 2}px`,
        opacity: 0,
      }}
      animate={{
        opacity: [0, 0.7, 0.5, 0.8, 0.6],
        y: [0, -floatY, floatY * 0.5, -floatY * 0.3, 0],
        x: [0,  floatX, -floatX * 0.5,  floatX * 0.3, 0],
        scale: [1, 1.15, 0.9, 1.05, 1],
      }}
      exit={{ opacity: 0, scale: 0, transition: { duration: 0.4 } }}
      transition={{
        duration: 4 + size * 0.4,
        delay,
        repeat: Infinity,
        ease: 'easeInOut',
        times: [0, 0.25, 0.5, 0.75, 1],
      }}
    />
  )
}

function ChartPixel({
  tx, ty, color, delay, ix, iy,
}: { tx: number; ty: number; color: string; delay: number; ix: number; iy: number }) {
  return (
    <motion.div
      className="absolute rounded-[1px]"
      style={{
        width: PX,
        height: PX,
        backgroundColor: color,
        left: `${tx - PX / 2}px`,
        top:  `${ty - PX / 2}px`,
      }}
      initial={{ x: ix, y: iy, opacity: 0, scale: 0 }}
      animate={{ x: 0, y: 0, opacity: 0.88, scale: 1 }}
      exit={{ opacity: 0, scale: 0, transition: { duration: 0.3 } }}
      transition={{ duration: 0.65, delay, ease: 'easeOut' }}
    />
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function PanelAnimation({ active }: { active: boolean }) {
  const [chartsActive, setChartsActive] = useState(false)
  const [chartKey, setChartKey] = useState(0)
  const [mounted, setMounted] = useState(false)
  const startTimer = useRef<NodeJS.Timeout | null>(null)
  const cycleInterval = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (startTimer.current) clearTimeout(startTimer.current)
    if (cycleInterval.current) { clearInterval(cycleInterval.current); cycleInterval.current = null }

    if (!active) {
      setChartsActive(false)
      return
    }

    setChartKey(0)
    startTimer.current = setTimeout(() => {
      setChartsActive(true)
      cycleInterval.current = setInterval(() => setChartKey(k => k + 1), CYCLE_MS)
    }, CHART_START_DELAY)

    return () => {
      if (startTimer.current) clearTimeout(startTimer.current)
      if (cycleInterval.current) clearInterval(cycleInterval.current)
    }
  }, [active])

  const chart = chartsActive ? PANEL_CHARTS[chartKey % PANEL_CHARTS.length]! : null

  const scatter = useMemo(
    () =>
      (chart?.pixels ?? []).map(() => ({
        x: (Math.random() - 0.5) * 260,
        y: (Math.random() - 0.5) * 90,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartKey],
  )

  if (!mounted) return null

  return (
    <>
      {/* Layer 1: floating hero pixels — centered on the login form, always on while open */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0 h-0 pointer-events-none select-none"
        aria-hidden="true"
      >
        <AnimatePresence>
          {active &&
            HERO_PIXELS.map((p, i) => (
              <HeroPixel key={`hero-${i}`} {...p} />
            ))}
        </AnimatePresence>
      </div>

      {/* Layer 2: chart-forming pixels — upper area, starts after 1.2 s, cycles */}
      <div
        className="absolute top-[28%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-0 h-0 pointer-events-none select-none"
        aria-hidden="true"
      >
        <AnimatePresence>
          {chartsActive &&
            chart?.pixels.map((p, i) => (
              <ChartPixel
                key={`chart-${chartKey}-${i}`}
                tx={p.x}
                ty={p.y}
                color={p.color}
                delay={i * 0.06}
                ix={scatter[i]?.x ?? 0}
                iy={scatter[i]?.y ?? 0}
              />
            ))}
        </AnimatePresence>
      </div>
    </>
  )
}
