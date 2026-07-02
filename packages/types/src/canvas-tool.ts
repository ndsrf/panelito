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
    oneOf: [
      {
        properties: {
          op: { type: 'string', enum: ['ADD_NODE'] },
          node_type_id: {
            type: 'string',
            description:
              'Must match a Blueprint node_types[].id (e.g. "hypothesis", "evidence"). ' +
              'MutationGateNode post-validates this value against the active Blueprint vocabulary.',
          },
          label: {
            type: 'string',
            description: 'Short descriptive label for the node (max 120 chars)',
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description:
              'Certainty of the mutation (0.0–1.0). ' +
              '>0.85 = direct commit; 0.5–0.85 = ghost/tentative; <0.5 = silent.',
          },
        },
        required: ['op', 'node_type_id', 'label', 'confidence'],
      },
      {
        properties: {
          op: { type: 'string', enum: ['ADD_EDGE'] },
          source_node_id: {
            type: 'string',
            description: 'UUID of the source canvas node',
          },
          target_node_id: {
            type: 'string',
            description: 'UUID of the target canvas node',
          },
          edge_type_id: {
            type: 'string',
            description:
              'Must match a Blueprint edge_types[].id (e.g. "SUPPORTS", "CONTRADICTS"). ' +
              'MutationGateNode post-validates this value against the active Blueprint vocabulary.',
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description:
              'Certainty of the mutation (0.0–1.0). ' +
              '>0.85 = direct commit; 0.5–0.85 = ghost/tentative; <0.5 = silent.',
          },
        },
        required: ['op', 'source_node_id', 'target_node_id', 'edge_type_id', 'confidence'],
      },
      {
        properties: {
          op: { type: 'string', enum: ['NO_ACTION'] },
          reason: {
            type: 'string',
            description:
              'Optional explanation of why no canvas change was made (max 240 chars)',
          },
        },
        required: ['op'],
      },
    ],
    required: ['op'],
  },
}
