/**
 * canvas-tool.ts — canvasMutationTool ProviderTool definition (ORCH-03)
 *
 * Follows the renderPanelTool pattern in ai.ts exactly:
 *   - Uses `parameters` key (NOT `input_schema`) — adapters convert at call time
 *   - Exported as a named const of type ProviderTool
 *
 * Tool output shape maps to CanvasOpSchema discriminated union in canvas.ts:
 *   ADD_NODE  → z.object({ op:'ADD_NODE', node_type_id, label, confidence })
 *   ADD_EDGE  → z.object({ op:'ADD_EDGE', source_node_id, target_node_id, edge_type_id, confidence })
 *   NO_ACTION → z.object({ op:'NO_ACTION', reason? })
 *
 * node_type_id must match a Blueprint node_types[].id (BLUE-03).
 * edge_type_id must match a Blueprint edge_types[].id (BLUE-03).
 * Dynamic Blueprint vocabulary validation is enforced at runtime by MutationGateNode (D-07);
 * this static schema accepts any string.
 *
 * Flat properties block (no oneOf at root) — Anthropic API requires a top-level
 * `properties` dictionary in input_schema; oneOf-only schemas at root are non-standard
 * and may be silently rejected. CanvasOpSchema.safeParse() in agentNode handles
 * runtime discriminated-union validation; this schema only guides the model.
 */

import type { ProviderTool } from './ai'

export const canvasMutationTool: ProviderTool = {
  name: 'canvas_mutation',
  description:
    'Emit a structured canvas mutation based on the conversation. ' +
    'Use ADD_NODE when a participant introduces a new concept matching a Blueprint node type. ' +
    'Use ADD_EDGE when a clear directional relationship between two existing nodes is stated. ' +
    'Use NO_ACTION when the message does not produce a clear canvas change. ' +
    'Always include a confidence score (0.0–1.0) representing certainty of the mutation.',
  parameters: {
    type: 'object',
    properties: {
      op: {
        type: 'string',
        enum: ['ADD_NODE', 'ADD_EDGE', 'NO_ACTION'],
        description: 'The canvas operation type.',
      },
      node_type_id: {
        type: 'string',
        description: 'Required for ADD_NODE. Must match a Blueprint node_types[].id.',
      },
      label: {
        type: 'string',
        description: 'Required for ADD_NODE. Short descriptive label (max 120 chars).',
      },
      source_node_id: {
        type: 'string',
        description: 'Required for ADD_EDGE. UUID of the source canvas node.',
      },
      target_node_id: {
        type: 'string',
        description: 'Required for ADD_EDGE. UUID of the target canvas node.',
      },
      edge_type_id: {
        type: 'string',
        description: 'Required for ADD_EDGE. Must match a Blueprint edge_types[].id.',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Required for ADD_NODE/ADD_EDGE. Certainty 0.0–1.0.',
      },
      reason: {
        type: 'string',
        description: 'Optional. For NO_ACTION: why no canvas change was made.',
      },
    },
    required: ['op'],
  },
}
