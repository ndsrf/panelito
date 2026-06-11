/**
 * TDD RED: AnalyticsPanel component tests
 *
 * Tests:
 * 1. Error Boundary catches render errors and shows LAYOUT-07 fallback
 * 2. hasApiKey=false shows D-07a variant (Settings link)
 * 3. hasApiKey=true shows D-08 variant (branded empty state)
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnalyticsPanel } from './AnalyticsPanel'

// Thrower component that throws on render — for Error Boundary testing
function Thrower(): never {
  throw new Error('intentional render error for test')
}

describe('AnalyticsPanel', () => {
  it('renders the D-07a variant (no API key) with a Settings link', () => {
    render(<AnalyticsPanel hasApiKey={false} />)
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument()
  })

  it('renders the D-08 variant (key set) with branded empty state', () => {
    render(<AnalyticsPanel hasApiKey={true} />)
    expect(screen.getByText(/analizará/i)).toBeInTheDocument()
  })

  it('renders the LAYOUT-07 Error Boundary fallback for a throwing child', () => {
    // Suppress console.error noise from React's error boundary logging in tests
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // We need to make the inner content throw — we do this by making a custom
    // version that includes a Thrower inside the boundary.
    // Since AnalyticsPanel wraps its inner content in a boundary, we can test
    // by temporarily making the inner throw via a test-specific wrapper.
    // The simplest approach: render a component that wraps AnalyticsPanel with
    // a context that causes an error inside the boundary.

    // Actually, we test the boundary directly by importing it and rendering
    // a child that throws.
    const { AnalyticsPanelErrorBoundary } = require('./AnalyticsPanel')

    render(
      <AnalyticsPanelErrorBoundary>
        <Thrower />
      </AnalyticsPanelErrorBoundary>
    )

    expect(screen.getByText(/Error de visualización/i)).toBeInTheDocument()
    consoleSpy.mockRestore()
  })
})
