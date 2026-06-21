/**
 * TDD RED: AnalyticsPanel component tests
 *
 * Tests:
 * 1. Error Boundary catches render errors and shows LAYOUT-07 fallback
 * 2. hasApiKey=false shows D-07a variant (Settings link)
 * 3. hasApiKey=true shows D-08 variant (branded empty state)
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnalyticsPanel, AnalyticsPanelErrorBoundary } from './AnalyticsPanel'

// Thrower component that throws on render — for Error Boundary testing
function Thrower(): never {
  throw new Error('intentional render error for test')
}

describe('AnalyticsPanel', () => {
  it('renders the D-07a variant (no API key) with a Settings link', () => {
    render(<AnalyticsPanel hasApiKey={false} />)
    expect(screen.getByRole('link', { name: /configuración/i })).toBeInTheDocument()
  })

  it('renders the D-08 variant (key set) with branded empty state', () => {
    render(<AnalyticsPanel hasApiKey={true} />)
    expect(screen.getByText(/analizará/i)).toBeInTheDocument()
  })

  it('renders the LAYOUT-07 Error Boundary fallback for a throwing child', () => {
    // Suppress console.error noise from React's error boundary logging in tests
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <AnalyticsPanelErrorBoundary>
        <Thrower />
      </AnalyticsPanelErrorBoundary>
    )

    expect(screen.getByText(/Error de visualización/i)).toBeInTheDocument()
    consoleSpy.mockRestore()
  })
})
