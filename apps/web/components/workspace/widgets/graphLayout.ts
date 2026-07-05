/**
 * graphLayout.ts — Dagre auto-layout utility for @xyflow/react nodes.
 *
 * Used when canvas nodes have null position_x/position_y (AI-added nodes without
 * explicit coordinates). Computes a top-down (TB) hierarchical layout via dagre.
 *
 * Pure utility — no project imports. Accepts and returns @xyflow/react Node/Edge types.
 *
 * Pattern 2 from 09-RESEARCH.md: official reactflow.dev dagre example pattern.
 */

import dagre from '@dagrejs/dagre'
import type { Node, Edge } from '@xyflow/react'

const NODE_WIDTH = 180
const NODE_HEIGHT = 60

/**
 * applyDagreLayout — compute positions for nodes using dagre top-down layout.
 *
 * @param nodes - @xyflow/react Node array (may have position: { x: 0, y: 0 } for null-position nodes)
 * @param edges - @xyflow/react Edge array (used for dagre edge relationships)
 * @returns New Node array with computed `position` centered relative to dagre output
 */
export function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', ranksep: 60, nodesep: 40 })

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  edges.forEach((e) => g.setEdge(e.source, e.target))

  dagre.layout(g)

  return nodes.map((n) => {
    const pos = g.node(n.id)
    return {
      ...n,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    }
  })
}
