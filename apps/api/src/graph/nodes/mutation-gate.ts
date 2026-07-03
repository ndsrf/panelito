/**
 * mutation-gate.ts — MutationGateNode: confidence threshold routing + Blueprint vocabulary validation
 *
 * ORCH-04: Confidence thresholds
 *   >0.85  → status 'committed' (direct canvas mutation)
 *   0.5–0.85 → status 'ghost' (tentative, pending human confirmation)
 *   <0.5   → silent (no canvas op appended)
 *
 * D-07 (post-validation): vocabulary membership check against blueprint.node_types and edge_types.
 * Invalid node_type_id or edge_type_id → logged + dropped silently (fail-silent, no throw).
 * T-06-07: Canvas mutation outside Blueprint vocabulary is mitigated here.
 *
 * Never imports @anthropic-ai/sdk directly.
 */

import type { Blueprint, CanvasOp } from '@panelito/types'
import type { GraphState } from '../state'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function mutationGateNode(state: GraphState, config?: any): Promise<Partial<GraphState>> {
  // D-08 (Phase 8): phase_signal is NOT in the return value by design.
  // AgentNode sets it in state before MutationGateNode runs.
  // The overwrite reducer preserves it — returning {} here does not reset it.
  const blueprint = config?.configurable?.blueprint as Blueprint | undefined

  const op = state.agentOutput

  // No output or explicit NO_ACTION → nothing to gate
  if (!op || op.op === 'NO_ACTION') {
    return {}
  }

  // ---------------------------------------------------------------------------
  // D-07: Blueprint vocabulary post-validation (T-06-07 mitigation)
  // ---------------------------------------------------------------------------
  if (op.op === 'ADD_NODE') {
    const validNodeType = blueprint
      ? blueprint.node_types.some((n) => n.id === op.node_type_id)
      : true // If no blueprint available, skip (fail-open on missing blueprint)

    if (!validNodeType) {
      console.warn(
        `[mutation-gate] node_type_id "${op.node_type_id}" not in blueprint vocabulary — dropping silently`
      )
      return {}
    }
  }

  if (op.op === 'ADD_EDGE') {
    const validEdgeType = blueprint
      ? blueprint.edge_types.some((e) => e.id === op.edge_type_id)
      : true

    if (!validEdgeType) {
      console.warn(
        `[mutation-gate] edge_type_id "${op.edge_type_id}" not in blueprint vocabulary — dropping silently`
      )
      return {}
    }
  }

  // ---------------------------------------------------------------------------
  // ORCH-04: Confidence threshold routing
  // ---------------------------------------------------------------------------
  const confidence = state.agentConfidence ?? 0

  let status: 'committed' | 'ghost'

  if (confidence > 0.85) {
    status = 'committed'
  } else if (confidence >= 0.5) {
    status = 'ghost'
  } else {
    // Below minimum threshold — silent exit (no canvas op)
    return {}
  }

  // Append the op with its resolved status to canvasOps (reducer accumulates).
  // CanvasOp ADD_NODE/ADD_EDGE branches include optional status (canvas.ts) so
  // the spread satisfies the type without casting.
  const gatedOp: CanvasOp = { ...op, status }

  return {
    canvasOps: [gatedOp],
  }
}
