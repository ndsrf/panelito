/**
 * TDD RED: use-viewport hook structural tests
 *
 * Verifies the hook:
 * 1. Exports useViewport
 * 2. Sets --app-height from window.innerHeight on mount
 * 3. Sets --keyboard-height on visualViewport resize + scroll events
 * 4. Is SSR-safe (no throws in server context)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useViewport } from './use-viewport'

describe('useViewport', () => {
  let originalInnerHeight: number
  let originalVisualViewport: VisualViewport | null
  let mockVisualViewport: {
    height: number
    addEventListener: ReturnType<typeof vi.fn>
    removeEventListener: ReturnType<typeof vi.fn>
    dispatchEvent: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    originalInnerHeight = window.innerHeight
    originalVisualViewport = window.visualViewport

    mockVisualViewport = {
      height: 800,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }

    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      writable: true,
      configurable: true,
    })

    Object.defineProperty(window, 'visualViewport', {
      value: mockVisualViewport,
      writable: true,
      configurable: true,
    })

    // Reset CSS variables
    document.documentElement.style.removeProperty('--app-height')
    document.documentElement.style.removeProperty('--keyboard-height')
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', {
      value: originalInnerHeight,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(window, 'visualViewport', {
      value: originalVisualViewport,
      writable: true,
      configurable: true,
    })
  })

  it('sets --app-height from window.innerHeight on mount', () => {
    renderHook(() => useViewport())
    expect(
      document.documentElement.style.getPropertyValue('--app-height')
    ).toBe('800px')
  })

  it('attaches resize and scroll listeners to visualViewport', () => {
    renderHook(() => useViewport())
    expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith(
      'resize',
      expect.any(Function)
    )
    expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function)
    )
  })

  it('removes listeners on unmount', () => {
    const { unmount } = renderHook(() => useViewport())
    unmount()
    expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith(
      'resize',
      expect.any(Function)
    )
    expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function)
    )
  })

  it('computes --keyboard-height correctly when keyboard opens', () => {
    renderHook(() => useViewport())

    // Simulate keyboard opening: visualViewport shrinks by 300px
    mockVisualViewport.height = 500
    const resizeHandler = mockVisualViewport.addEventListener.mock.calls.find(
      (call) => call[0] === 'resize'
    )?.[1] as (() => void) | undefined

    expect(resizeHandler).toBeDefined()
    resizeHandler?.()

    expect(
      document.documentElement.style.getPropertyValue('--keyboard-height')
    ).toBe('300px')
  })

  it('clamps --keyboard-height to 0 (never negative)', () => {
    renderHook(() => useViewport())

    // Simulate visualViewport larger than innerHeight (shouldn't happen but defend)
    mockVisualViewport.height = 900
    const resizeHandler = mockVisualViewport.addEventListener.mock.calls.find(
      (call) => call[0] === 'resize'
    )?.[1] as (() => void) | undefined

    resizeHandler?.()

    expect(
      document.documentElement.style.getPropertyValue('--keyboard-height')
    ).toBe('0px')
  })

  it('handles missing visualViewport gracefully (old browser)', () => {
    Object.defineProperty(window, 'visualViewport', {
      value: null,
      writable: true,
      configurable: true,
    })

    expect(() => renderHook(() => useViewport())).not.toThrow()
  })
})
