'use client'

/**
 * GraphNode.tsx — Custom node renderer for @xyflow/react.
 *
 * Renders committed and ghost nodes per 09-UI-SPEC.md Ghost Node Visual Contract:
 * - Committed: solid 1.5px border at Blueprint color, 15% fill, foreground label
 * - Ghost: 0.6 opacity wrapper, 1.5px dashed border at Blueprint color, 10% fill, muted-foreground label
 * - Silent: returns null (filtered out before passing to ReactFlow, but guard kept for safety)
 *
 * Ghost confirm/dismiss:
 * - Optimistic local state update before PATCH
 * - PATCH /api/canvas_nodes/:id with { status: 'committed' | 'silent' }
 * - Revert to 'ghost' + sonner toast on error (UI-SPEC Copywriting Contract)
 * - Touch targets: min-h-[44px] min-w-[44px] — iOS/WCAG mobile constraint (hard requirement)
 * - Spanish aria-labels: "Confirmar nodo {label}" / "Descartar nodo {label}"
 *
 * T-09-08: node.label rendered as React text children (auto-escaped — no dangerouslySetInnerHTML)
 *
 * Pitfall 1 (09-RESEARCH.md): `nodeTypes` defined at MODULE LEVEL — never inside a component.
 * Defining inside a component causes all nodes to unmount/remount on every render (re-mount storm).
 */

import { useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps, Node } from '@xyflow/react'
import type { CanvasNode } from '@panelito/types'
import { Button } from '@/components/ui/button'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'

type GraphNodeData = {
  canvasNode: CanvasNode
  blueprintColor: string
}

function GraphNode({ data }: NodeProps<Node<GraphNodeData>>) {
  const { canvasNode, blueprintColor } = data
  const [optimisticStatus, setOptimisticStatus] = useState<CanvasNode['status']>(canvasNode.status)

  // Silent nodes: guard — in practice filtered before ReactFlow receives them
  if (optimisticStatus === 'silent') return null

  const isGhost = optimisticStatus === 'ghost'

  // Ghost Node Visual Contract (UI-SPEC §Ghost Node Visual Contract):
  // - opacity: 0.6 on wrapper achieves ~40% visual dimness
  // - dashed border at 60% opacity (hex alpha 99 ≈ 60%)
  // - 10% fill for ghost (blueprintColor + '1A'); 15% fill for committed (blueprintColor + '26')
  const ghostStyle: React.CSSProperties = {
    opacity: 0.6,
    border: `1.5px dashed ${blueprintColor}99`,
    background: `${blueprintColor}1A`,
  }

  const committedStyle: React.CSSProperties = {
    border: `1.5px solid ${blueprintColor}`,
    background: `${blueprintColor}26`,
  }

  const handleConfirm = async () => {
    setOptimisticStatus('committed')
    try {
      await apiFetch(`/api/canvas_nodes/${canvasNode.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'committed' }),
      })
    } catch {
      setOptimisticStatus('ghost')
      toast.error('No se pudo actualizar el nodo. Inténtalo de nuevo.')
    }
  }

  const handleDismiss = async () => {
    setOptimisticStatus('silent')
    try {
      await apiFetch(`/api/canvas_nodes/${canvasNode.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'silent' }),
      })
    } catch {
      setOptimisticStatus('ghost')
      toast.error('No se pudo actualizar el nodo. Inténtalo de nuevo.')
    }
  }

  return (
    <div
      className="rounded-md p-2 min-w-[120px] relative"
      style={isGhost ? ghostStyle : committedStyle}
    >
      {/* Target handle — top of node (receives incoming edges) */}
      <Handle type="target" position={Position.Top} />

      {/* Node label — 12px/400 per UI-SPEC Typography; T-09-08: plain text, no dangerouslySetInnerHTML */}
      <span
        className="text-[12px] font-normal leading-[1.3] block"
        style={{ color: isGhost ? '#a1a1aa' : 'var(--color-foreground, #fafafa)' }}
      >
        {canvasNode.label}
      </span>

      {/* Ghost confirm / dismiss — only shown when ghost (not optimistically committed/silent) */}
      {isGhost && (
        <div className="flex gap-[8px] mt-[8px]">
          {/* Confirm — sets status='committed'; min 44×44px touch target (mobile hard constraint) */}
          <Button
            size="sm"
            className="min-h-[44px] min-w-[44px] p-0 flex items-center justify-center"
            onClick={handleConfirm}
            aria-label={`Confirmar nodo ${canvasNode.label}`}
          >
            <Check size={16} />
          </Button>

          {/* Dismiss — sets status='silent'; destructive variant per UI-SPEC */}
          <Button
            size="sm"
            variant="destructive"
            className="min-h-[44px] min-w-[44px] p-0 flex items-center justify-center"
            onClick={handleDismiss}
            aria-label={`Descartar nodo ${canvasNode.label}`}
          >
            <X size={16} />
          </Button>
        </div>
      )}

      {/* Source handle — bottom of node (emits outgoing edges) */}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

/**
 * nodeTypes — module-level map of custom node type renderers.
 * MUST be defined outside any component (Pitfall 1 — prevents remount storm).
 * Imported by GraphCanvas — do NOT redefine there.
 */
export const nodeTypes = { graphNode: GraphNode }
