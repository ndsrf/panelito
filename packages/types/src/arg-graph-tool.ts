/**
 * arg-graph-tool.ts — argGraphExtractionTool ProviderTool definition (Phase 11 Task 1, GRAPH-01)
 *
 * Follows canvas-tool.ts's exact ProviderTool/raw-JSON-schema shape:
 *   - Uses `parameters` key (NOT `input_schema`) — adapters convert at call time
 *   - Exported as a named const of type ProviderTool
 *   - Flat top-level properties block (no oneOf at root — Anthropic API requirement)
 *
 * Tool output shape maps to ArgGraphSchema (bot.ts) AFTER server-side ID substitution:
 *   ArgGraphBuilderNode (Plan 03) reads the raw tool output, runs crypto.randomUUID()
 *   substitution for id/source_ref→source_id/target_ref→target_id, THEN validates
 *   against the real ArgNodeSchema/ArgEdgeSchema (which keep `.uuid()` constraints).
 *
 * Finding 2 (11-RESEARCH.md): id/message_id/speaker/label/type on nodes and
 * source_ref/target_ref/relation on edges are typed as plain "string" here
 * (NOT uuid-constrained) — the model cannot reliably emit RFC4122 UUIDs. This is
 * a deliberately relaxed raw tool-input schema; the domain Zod schema in bot.ts
 * is NOT relaxed.
 */

import type { ProviderTool } from './ai'

export const argGraphExtractionTool: ProviderTool = {
  name: 'extract_arg_graph',
  description:
    'Extract the argument graph structure implied by the conversation so far. ' +
    'Emit nodes for claims, evidence, counterarguments, and questions raised by participants, ' +
    'and edges expressing the relationship between them (e.g. SUPPORTS, CONTRADICTS, BUILDS_ON, QUESTIONS). ' +
    'Every node must cite the message_id and speaker it was derived from. ' +
    'Use short, stable string refs (not UUIDs) for id/source_ref/target_ref — the server ' +
    'substitutes real UUIDs after extraction.',
  parameters: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        description: 'Argument graph nodes derived from the conversation.',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'A short, stable reference string for this node (e.g. "n1"). NOT a UUID — the server substitutes a real UUID after extraction.',
            },
            type: {
              type: 'string',
              description: "The node type: one of 'claim', 'evidence', 'counterargument', 'question'.",
            },
            label: {
              type: 'string',
              description: 'Short descriptive label / claim text (max 120 chars).',
            },
            message_id: {
              type: 'string',
              description: 'The id of the source message this node was derived from (citation anchor, required for PERSONA-02).',
            },
            speaker: {
              type: 'string',
              description: 'The display name of the participant who made this claim/statement.',
            },
          },
          required: ['id', 'type', 'label', 'message_id', 'speaker'],
        },
      },
      edges: {
        type: 'array',
        description: 'Typed relationships between argument graph nodes (existing or newly emitted in this same response).',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'A short, stable reference string for this edge (e.g. "e1"). NOT a UUID.',
            },
            source_ref: {
              type: 'string',
              description: 'The id/ref of the source node — either a node ref emitted in this same response or an existing node id.',
            },
            target_ref: {
              type: 'string',
              description: 'The id/ref of the target node — either a node ref emitted in this same response or an existing node id.',
            },
            relation: {
              type: 'string',
              description: "The relationship type, e.g. 'SUPPORTS', 'CONTRADICTS', 'BUILDS_ON', 'QUESTIONS'.",
            },
          },
          required: ['id', 'source_ref', 'target_ref', 'relation'],
        },
      },
    },
    required: ['nodes', 'edges'],
  },
}
