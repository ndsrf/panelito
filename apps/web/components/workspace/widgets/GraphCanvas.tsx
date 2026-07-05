'use client'

/**
 * GraphCanvas.tsx — @xyflow/react canvas widget for the Graph Canvas panel.
 *
 * Reads canvasNodes/canvasEdges from sessionStore (committed + ghost rows).
 * Reads blueprint from sessionStore to resolve node/edge Blueprint colors at runtime.
 *
 * Layout:
 * - Filters out status='silent' nodes before passing to ReactFlow
 * - Runs dagre auto-layout (applyDagreLayout) when any node has null position_x/position_y
 * - Keeps local nodes/edges state synced from store via useEffect
 * - onNodesChange allows ReactFlow internal state (selection, etc.) without DB writes
 *
 * Visual:
 * - nodesDraggable={false} — UI-04 deferred to v2.1
 * - colorMode="dark" — inherits Tailwind dark theme via @xyflow/react
 * - Background + Controls overlays per UI-SPEC Interaction Contract
 *
 * Pitfall 2 (09-RESEARCH.md): @xyflow/react CSS MUST be imported inside this module
 * (dynamically loaded via next/dynamic ssr:false). Do NOT import in a server component or
 * the parent static bundle — SSR crash guaranteed.
 *
 * Pitfall 1: nodeTypes/edgeTypes imported from module-level exports in GraphNode/GraphEdge.
 * NOT redefined here — redefinition causes remount storm on every parent render.
 *
 * T-09-09: @xyflow/react requires DOM APIs. next/dynamic ssr:false in widget-registry.ts
 * isolates it from the server bundle. AnalyticsPanelErrorBoundary wraps WidgetZone as fallback.
 */

import '@xyflow/react/dist/style.css'

import { useMemo, useState, useEffect, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
} from '@xyflow/react'
import type { Node, Edge, NodeChange } from '@xyflow/react'
import { useSessionStore } from '@/store/session-store'
import { nodeTypes } from './GraphNode'
import { edgeTypes } from './GraphEdge'
import { applyDagreLayout } from './graphLayout'

/** Fallback color when Blueprint color is unavailable — Indigo 500 (project accent) */
const FALLBACK_COLOR = '#6366f1'

export function GraphCanvas() {
  const canvasNodes = useSessionStore((s) => s.canvasNodes)
  const canvasEdges = useSessionStore((s) => s.canvasEdges)
  const blueprint = useSessionStore((s) => s.blueprint)

  // Build ReactFlow Node[] from CanvasNode[]:
  // - Filter out silent nodes (not rendered per UI-SPEC)
  // - Resolve blueprintColor from Blueprint.node_types[].color at runtime (no hardcoding)
  // - Fall back to FALLBACK_COLOR when Blueprint is unavailable or node_type_id not found
  const rfNodes: Node[] = useMemo(() => {
    const visible = canvasNodes.filter((n) => n.status !== 'silent')
    return visible.map((n) => {
      const blueprintColor =
        blueprint?.node_types.find((t) => t.id === n.node_type_id)?.color ?? FALLBACK_COLOR
      return {
        id: n.id,
        type: 'graphNode',
        position: { x: n.position_x ?? 0, y: n.position_y ?? 0 },
        data: { canvasNode: n, blueprintColor },
      }
    })
  }, [canvasNodes, blueprint])

  // Build ReactFlow Edge[] from CanvasEdge[]:
  // - Filter out silent edges
  // - Resolve blueprintColor from Blueprint.edge_types[].color at runtime
  const rfEdges: Edge[] = useMemo(() => {
    return canvasEdges
      .filter((e) => e.status !== 'silent')
      .map((e) => {
        const blueprintColor =
          blueprint?.edge_types.find((t) => t.id === e.edge_type_id)?.color ?? FALLBACK_COLOR
        return {
          id: e.id,
          source: e.source_node_id,
          target: e.target_node_id,
          type: 'graphEdge',
          data: { blueprintColor },
        }
      })
  }, [canvasEdges, blueprint])

  // Apply dagre when any visible node lacks stored coordinates (AI-added nodes)
  const needsLayout = rfNodes.some((n) => {
    const cn = (n.data as { canvasNode: { position_x: number | null } }).canvasNode
    return cn.position_x === null
  })
  const layoutedNodes = needsLayout ? applyDagreLayout(rfNodes, rfEdges) : rfNodes

  const [nodes, setNodes] = useState<Node[]>(layoutedNodes)
  const [edges, setEdges] = useState<Edge[]>(rfEdges)

  // Sync from store whenever store data changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setNodes(layoutedNodes) }, [rfNodes])
  useEffect(() => { setEdges(rfEdges) }, [rfEdges])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    []
  )

  // Empty state — no visible nodes
  if (rfNodes.length === 0) {
    return (
      <div className="w-full h-full min-h-0 flex flex-col items-center justify-center gap-[8px] bg-card">
        <p className="text-[15px] font-semibold text-foreground leading-[1.2]">
          El grafo está vacío
        </p>
        <p className="text-[13px] text-muted-foreground leading-[1.4] text-center px-4">
          El AI añadirá nodos a medida que avance la conversación.
        </p>
      </div>
    )
  }

  return (
    <div className="w-full h-full min-h-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        nodesDraggable={false}
        nodesConnectable={false}
        colorMode="dark"
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}
