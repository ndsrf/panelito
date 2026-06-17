'use client'

import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'

const PIXELS = [
  // left cluster
  { x: -80, y: -20, size: 10, color: '#818CF8', delay: 0 },
  { x: -60, y: 30, size: 6, color: '#38BDF8', delay: 0.3 },
  { x: -100, y: 50, size: 8, color: '#F472B6', delay: 0.6 },
  { x: -50, y: -50, size: 5, color: '#818CF8', delay: 0.9 },
  { x: -120, y: 10, size: 4, color: '#38BDF8', delay: 0.2 },
  { x: -90, y: 80, size: 7, color: '#F472B6', delay: 0.7 },
  { x: -130, y: -30, size: 3, color: '#818CF8', delay: 1.1 },
  // right cluster
  { x: 30, y: -40, size: 8, color: '#38BDF8', delay: 0.4 },
  { x: 60, y: 20, size: 6, color: '#818CF8', delay: 0.8 },
  { x: 20, y: 60, size: 10, color: '#F472B6', delay: 0.1 },
  { x: 80, y: -10, size: 4, color: '#38BDF8', delay: 1.0 },
  { x: 50, y: 70, size: 5, color: '#818CF8', delay: 0.5 },
  { x: 100, y: 40, size: 7, color: '#F472B6', delay: 0.3 },
  { x: 110, y: -30, size: 3, color: '#38BDF8', delay: 1.2 },
]

function Pixel({
  x,
  y,
  size,
  color,
  delay,
}: {
  x: number
  y: number
  size: number
  color: string
  delay: number
}) {
  const floatY = size > 7 ? 8 : 5
  const floatX = size > 7 ? 4 : 3

  return (
    <motion.div
      className="absolute rounded-[2px]"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        left: `calc(50% + ${x}px)`,
        top: `calc(50% + ${y}px)`,
        opacity: 0,
      }}
      animate={{
        opacity: [0, 0.7, 0.5, 0.8, 0.6],
        y: [0, -floatY, floatY * 0.5, -floatY * 0.3, 0],
        x: [0, floatX, -floatX * 0.5, floatX * 0.3, 0],
        scale: [1, 1.15, 0.9, 1.05, 1],
      }}
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

export function HeroPixels() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null

  return (
    <div
      className="absolute inset-0 pointer-events-none select-none overflow-hidden [&>div]:lg:scale-[1.4]"
      aria-hidden="true"
    >
      {PIXELS.map((p, i) => (
        <Pixel key={i} {...p} />
      ))}
    </div>
  )
}
