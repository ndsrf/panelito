'use client'

/**
 * useLongPress — detects 500ms long-press on touch + mouse (LAYOUT-06)
 *
 * Returns event handlers that start a timer on pointer-down and call
 * handler() after `ms` milliseconds of continuous hold.
 * Triggers haptic feedback via navigator.vibrate(10) on trigger.
 *
 * useDoubleTap — detects two taps/clicks within 300ms (LAYOUT-06)
 */

import { useRef, useCallback } from 'react'

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

  const start = useCallback(() => {
    timerRef.current = setTimeout(() => {
      navigator.vibrate?.(10)
      handler()
      timerRef.current = null
    }, ms)
  }, [handler, ms])

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  return {
    onTouchStart: () => start(),
    onTouchEnd: () => cancel(),
    onTouchMove: () => cancel(),
    onTouchCancel: () => cancel(),
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
