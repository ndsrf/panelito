'use client'

/**
 * useLongPress — detects 500ms long-press on touch + mouse (LAYOUT-06)
 *
 * Returns event handlers that start a timer on pointer-down and call
 * handler() after `ms` milliseconds of continuous hold.
 * Triggers haptic feedback via navigator.vibrate(10) on trigger.
 *
 * Touch-specific behaviour (mobile fix):
 * - Calls e.preventDefault() on touchstart (when cancelable) to suppress the
 *   native iOS/Android text-selection callout and magnifier.
 * - Tolerates up to MOVE_THRESHOLD px of finger jitter before cancelling —
 *   native selection always introduces micro-movement, so the old
 *   unconditional cancel on any touchmove killed the gesture.
 * - On long-press trigger, clears any stray window selection so no
 *   highlight remains.
 *
 * useDoubleTap — detects two taps/clicks within 300ms (LAYOUT-06)
 */

import { useRef, useCallback } from 'react'

/** Maximum finger movement (px) that is still treated as a stationary hold */
const MOVE_THRESHOLD = 10

interface TouchAndMouseProps {
  onTouchStart: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchCancel: (e: React.TouchEvent) => void
  onMouseDown: (e: React.MouseEvent) => void
  onMouseUp: (e: React.MouseEvent) => void
  onMouseLeave: (e: React.MouseEvent) => void
}

export function useLongPress(
  handler: () => void,
  ms = 500
): TouchAndMouseProps {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Starting touch coordinates — used to compute movement delta */
  const startCoordsRef = useRef<{ x: number; y: number } | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    startCoordsRef.current = null
  }, [])

  const start = useCallback(() => {
    timerRef.current = setTimeout(() => {
      navigator.vibrate?.(10)
      // Clear any stray text selection created by the native gesture
      window.getSelection()?.removeAllRanges()
      handler()
      timerRef.current = null
      startCoordsRef.current = null
    }, ms)
  }, [handler, ms])

  return {
    onTouchStart: (e: React.TouchEvent) => {
      // Suppress native text-selection callout / magnifier only when the
      // browser allows it (cancelable guard prevents errors on passive listeners).
      if (e.cancelable) {
        e.preventDefault()
      }
      const touch = e.touches[0]
      if (touch) {
        startCoordsRef.current = { x: touch.clientX, y: touch.clientY }
      }
      start()
    },
    onTouchEnd: () => cancel(),
    onTouchMove: (e: React.TouchEvent) => {
      // Only cancel if the finger has moved beyond the jitter threshold.
      // Native text selection always causes a few px of movement, so a
      // hard zero-tolerance cancel (the old behaviour) killed the gesture.
      const touch = e.touches[0]
      if (touch && startCoordsRef.current) {
        const dx = touch.clientX - startCoordsRef.current.x
        const dy = touch.clientY - startCoordsRef.current.y
        if (Math.sqrt(dx * dx + dy * dy) > MOVE_THRESHOLD) {
          cancel()
        }
      } else {
        cancel()
      }
    },
    onTouchCancel: () => cancel(),
    // Mouse handlers do NOT call preventDefault — that would break desktop
    // click / double-tap / right-click behaviour.
    onMouseDown: () => start(),
    onMouseUp: () => cancel(),
    onMouseLeave: () => cancel(),
  }
}

interface DoubleTapProps {
  onClick: (e: React.MouseEvent) => void
}

export function useDoubleTap(handler: () => void, ms = 300): DoubleTapProps {
  const lastTapRef = useRef<number>(0)

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const now = Date.now()
      if (now - lastTapRef.current < ms) {
        e.preventDefault()
        handler()
        lastTapRef.current = 0 // reset after double-tap to prevent triple-tap triggering again
      } else {
        lastTapRef.current = now
      }
    },
    [handler, ms]
  )

  return { onClick }
}
