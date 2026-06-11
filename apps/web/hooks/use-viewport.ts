'use client'

/**
 * useViewport — Visual Viewport API hook for IME-resilient layout.
 *
 * LAYOUT-01: Locks --app-height once from window.innerHeight on mount.
 * LAYOUT-04: Updates --keyboard-height live from visualViewport size delta.
 *
 * The inline <script> in app/layout.tsx already sets --app-height before
 * first paint (preventing layout flash on mobile). This hook is the
 * React-side re-affirmation and provides the keyboard-height listener.
 *
 * Critical constraints from RESEARCH.md:
 * - Do NOT recalculate --app-height on visualViewport.resize (would shrink analytics panel)
 * - Do NOT use window.resize (doesn't fire on iOS when keyboard opens)
 * - Do NOT use 100vh / dvh / svh anywhere in the workspace shell
 * - Attach both 'resize' AND 'scroll' — iOS Safari sometimes only fires 'scroll'
 *   when the keyboard opens (the visual viewport "scrolls" relative to layout viewport)
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
 * @see .planning/phases/01-live-session-shell/01-RESEARCH.md Pattern 2
 * @see .planning/phases/01-live-session-shell/01-UI-SPEC.md (Keyboard Resilience)
 */

import { useEffect } from 'react'

export function useViewport(): void {
  useEffect(() => {
    // SSR guard — this hook is client-only
    if (typeof window === 'undefined') return

    // Lock --app-height once from window.innerHeight.
    // This is the React-side re-affirmation of the inline <script> in layout.tsx.
    // Never recalculate --app-height after this point.
    const appHeight = window.innerHeight
    document.documentElement.style.setProperty('--app-height', `${appHeight}px`)

    // No-op if visualViewport is unavailable (old browser / non-standard env)
    if (!window.visualViewport) {
      document.documentElement.style.setProperty('--keyboard-height', '0px')
      return
    }

    const updateKeyboardHeight = (): void => {
      // keyboard height = locked app height − current visual viewport height
      // Math.max(0, ...) ensures we never write a negative value (e.g. if vvp > innerHeight)
      const kh = appHeight - (window.visualViewport?.height ?? appHeight)
      document.documentElement.style.setProperty(
        '--keyboard-height',
        `${Math.max(0, kh)}px`
      )
    }

    // iOS Safari requires BOTH 'resize' and 'scroll' listeners.
    // When the keyboard opens, the visual viewport "scrolls" relative to the
    // layout viewport — this triggers 'scroll' but not always 'resize'.
    window.visualViewport.addEventListener('resize', updateKeyboardHeight)
    window.visualViewport.addEventListener('scroll', updateKeyboardHeight)

    return () => {
      window.visualViewport?.removeEventListener('resize', updateKeyboardHeight)
      window.visualViewport?.removeEventListener('scroll', updateKeyboardHeight)
    }
  }, [])
}
