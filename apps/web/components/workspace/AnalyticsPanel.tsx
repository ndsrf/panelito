'use client'

/**
 * AnalyticsPanel — top 40% of the workspace split-screen.
 *
 * LAYOUT-02: height = calc(var(--app-height) * 0.40), flex-shrink: 0
 * LAYOUT-07: wrapped in AnalyticsPanelErrorBoundary — any widget crash
 *            shows the fallback card without breaking the chat below.
 *
 * Phase 2 Plan 04 additions:
 *   - 36px panel header strip (PANEL-03): "Main" branch badge + "Analizando..." pulse
 *   - Dynamic widget zone reading from usePanelStore, resolved via widgetRegistry
 *   - AnimatePresence mode="wait" keyed on `${widgetType}-${branchId}` for D-08 morph
 *
 * Two distinct empty states per D-07:
 *   a) hasApiKey=false → "Connect your API key in Settings" with a link (D-07a)
 *   b) hasApiKey=true  → branded empty state with tagline (D-07b / D-08)
 */

import { Component, type ReactNode } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { AlertTriangle, KeyRound } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Badge } from '@/components/ui/badge'
import { usePanelStore } from '@/store/panel-store'
import { widgetRegistry } from './widgets/widget-registry'

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
// Widget Zone (inner client component — reads panelStore hooks)
// -----------------------------------------------------------------------

/**
 * WidgetZone — the dynamic inner zone that reads panelStore and renders
 * the active widget with AnimatePresence morph transitions (D-08).
 *
 * Separated as a client component function so the error boundary (class component)
 * can wrap it without needing to call hooks itself.
 */
function WidgetZone({ hasApiKey, isStreaming }: { hasApiKey: boolean; isStreaming: boolean }) {
  const { widgetType, widgetData, branchId } = usePanelStore()
  const WidgetComponent = widgetType ? widgetRegistry.get(widgetType) : null

  return (
    <div className="analytics-panel bg-card flex flex-col border-b border-border">
      {/* Panel header strip — 36px height (PANEL-03) */}
      <div
        className="flex items-center justify-between px-4 border-b border-border flex-shrink-0"
        style={{ height: 36 }}
      >
        {/* Branch badge — "Main" with Indigo 500 treatment */}
        <Badge
          className="text-[13px] gap-1.5 py-0.5"
          style={{
            background: 'rgba(99,102,241,0.2)',
            border: '1px solid #6366f1',
            color: '#a5b4fc',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: '#6366f1' }}
          />
          Main
        </Badge>

        {/* "Analizando..." pulse — only while AI is streaming */}
        {isStreaming && (
          <span className="text-[13px] text-muted-foreground flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            Analizando...
          </span>
        )}
      </div>

      {/* Widget zone — calc(100% - 36px) height, AnimatePresence morph (D-08) */}
      <div className="flex-1 overflow-hidden p-4">
        <AnimatePresence mode="wait">
          {WidgetComponent && widgetData ? (
            <motion.div
              key={`${widgetType}-${branchId}`}
              initial={{ opacity: 0, scale: 0.97, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 1.02, filter: 'blur(4px)' }}
              transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="h-full"
            >
              <WidgetComponent data={widgetData} />
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="h-full flex items-center justify-center"
            >
              {hasApiKey ? <StateKeySet /> : <StateNoKey />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Accessibility: sr-only status for streaming state */}
      {isStreaming && (
        <span className="sr-only" role="status" aria-live="polite">
          El analista está analizando...
        </span>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------
// Public component
// -----------------------------------------------------------------------

interface AnalyticsPanelProps {
  hasApiKey: boolean
  /**
   * Phase 2: isStreaming — passed from workspace while AI is generating a response.
   * When true, the panel header shows "Analizando..." with a pulsing dot (PANEL-03).
   */
  isStreaming?: boolean
}

/**
 * AnalyticsPanel — the top 40% analytics segment of the workspace.
 *
 * @param hasApiKey - Whether the creator has a verified Anthropic API key.
 * @param isStreaming - Phase 2: true while AI is generating a response (for "Analizando..." label).
 */
export function AnalyticsPanel({ hasApiKey, isStreaming = false }: AnalyticsPanelProps): ReactNode {
  return (
    <AnalyticsPanelErrorBoundary>
      <WidgetZone hasApiKey={hasApiKey} isStreaming={isStreaming} />
    </AnalyticsPanelErrorBoundary>
  )
}
