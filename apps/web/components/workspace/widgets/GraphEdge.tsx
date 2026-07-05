'use client'

/**
 * GraphEdge.tsx — Custom edge renderer for @xyflow/react.
 *
 * Renders Blueprint-colored smooth-step edges using data.blueprintColor.
 * Falls back to Indigo 500 (#6366f1, project accent) when no Blueprint color provided.
 *
 * Pattern 1 / Pitfall 1 from 09-RESEARCH.md:
 * `edgeTypes` is defined at MODULE LEVEL — never inside GraphCanvas or a component.
 * Defining edgeTypes inside a component causes React Flow to unmount/remount all edges
 * on every parent render, producing a jarring flash.
 */

import { BaseEdge, getSmoothStepPath } from '@xyflow/react'
import type { EdgeProps, EdgeTypes } from '@xyflow/react'

type GraphEdgeData = {
  blueprintColor?: string
}

function GraphEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const color = (data as GraphEdgeData | undefined)?.blueprintColor ?? '#6366f1'

  return (
    <BaseEdge
      path={edgePath}
      style={{
        stroke: color,
        strokeWidth: 1.5,
      }}
    />
  )
}

/**
 * edgeTypes — module-level map of custom edge type renderers.
 * MUST be defined outside any component (Pitfall 1 — prevents remount storm).
 */
export const edgeTypes: EdgeTypes = { graphEdge: GraphEdge }
