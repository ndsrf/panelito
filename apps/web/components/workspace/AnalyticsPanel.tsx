'use client'

/**
 * AnalyticsPanel — top 40% of the workspace split-screen.
 *
 * LAYOUT-02: height = calc(var(--app-height) * 0.40), flex-shrink: 0
 * LAYOUT-07: wrapped in AnalyticsPanelErrorBoundary — any widget crash
 *            shows the fallback card without breaking the chat below.
 *
 * Two distinct states per D-07:
 *   a) hasApiKey=false → "Connect your API key in Settings" with a link (D-07a)
 *   b) hasApiKey=true  → branded empty state with tagline (D-07b / D-08)
 *
 * Phase 2 will render dynamic widgets inside the boundary; Phase 1 just
 * scaffolds the structural shell and the error safety net.
 */

import { Component, type ReactNode } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { AlertTriangle, KeyRound } from 'lucide-react'

// -----------------------------------------------------------------------
// Error Boundary (LAYOUT-07)
// -----------------------------------------------------------------------

interface BoundaryState {
  hasError: boolean
}

/**
 * AnalyticsPanelErrorBoundary — catches render-time exceptions from analytics
 * widgets and shows the LAYOUT-07 fallback card.
 *
 * The Error Boundary MUST be a class component — React does not support
 * hook-based error boundaries.
 *
 * The boundary is exported so tests can directly instantiate it with a
 * throwing child without going through the full AnalyticsPanel.
 */
export class AnalyticsPanelErrorBoundary extends Component<
  { children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { hasError: false }

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log to console for debugging; Phase 2 may wire this to Sentry/error tracking
    console.error('[AnalyticsPanelErrorBoundary] Widget render error:', error, info)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="analytics-panel flex flex-col items-center justify-center gap-3 bg-card border-b border-border p-6">
          {/* LAYOUT-07 fallback card — exact Spanish copy per UI-SPEC Error States */}
          <AlertTriangle className="text-destructive" size={24} />
          <h2 className="text-[20px] font-semibold text-destructive">
            Error de visualización
          </h2>
          <p className="text-[15px] text-muted-foreground text-center max-w-[280px]">
            El Analista está recalculando. Tu chat no se ve afectado.
          </p>
        </div>
      )
    }

    return this.props.children
  }
}

// -----------------------------------------------------------------------
// Inner panel states
// -----------------------------------------------------------------------

/**
 * D-07a: No API key set — prompt to connect one.
 */
function StateNoKey(): ReactNode {
  return (
    <div className="flex flex-col items-center gap-4 text-center max-w-[280px]">
      <KeyRound className="text-muted-foreground" size={32} />
      <div className="space-y-2">
        <h3 className="text-[20px] font-semibold text-foreground">
          Conecta tu clave API
        </h3>
        <p className="text-[15px] text-muted-foreground">
          Añade tu clave Anthropic en{' '}
          <Link
            href={'/settings' as Route}
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            Configuración
          </Link>{' '}
          para activar el análisis de IA.
        </p>
      </div>
    </div>
  )
}

/**
 * D-07b / D-08: Key set but no AI invoked yet — branded empty state with tagline.
 */
function StateKeySet(): ReactNode {
  return (
    <div className="flex flex-col items-center gap-3 text-center max-w-[280px]">
      {/* Product logo mark — monogram at muted 30% opacity */}
      <div
        className="text-[40px] font-bold select-none"
        style={{ color: 'rgba(161, 161, 170, 0.30)' }}
        aria-hidden="true"
      >
        M
      </div>
      <p className="text-[15px] text-muted-foreground">
        El AI analizará tu conversación aquí.
      </p>
    </div>
  )
}

// -----------------------------------------------------------------------
// Public component
// -----------------------------------------------------------------------

interface AnalyticsPanelProps {
  hasApiKey: boolean
}

/**
 * AnalyticsPanel — the top 40% analytics segment of the workspace.
 *
 * @param hasApiKey - Whether the creator has a verified Anthropic API key.
 *                   Plan 04 hardcodes false; Plan 06 wires the real value.
 */
export function AnalyticsPanel({ hasApiKey }: AnalyticsPanelProps): ReactNode {
  return (
    <AnalyticsPanelErrorBoundary>
      <div className="analytics-panel bg-card flex items-center justify-center border-b border-border">
        {hasApiKey ? <StateKeySet /> : <StateNoKey />}
      </div>
    </AnalyticsPanelErrorBoundary>
  )
}
