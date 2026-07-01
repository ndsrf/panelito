import { z } from "zod";

// -------------------------------------------------------
// CanvasNodeStatus — lifecycle state for nodes and edges
// committed: accepted by group, rendered normally
// ghost:     tentative/AI-proposed, rendered dimly pending human confirmation
// silent:    present but hidden from canvas view (archived, soft-deleted)
// -------------------------------------------------------

export const CanvasNodeStatusSchema = z.enum(["committed", "ghost", "silent"]);
export type CanvasNodeStatus = z.infer<typeof CanvasNodeStatusSchema>;

// -------------------------------------------------------
// CanvasNode — matches public.canvas_nodes table (migration 0008)
// blueprint_id is text (not uuid) — Blueprint ids are human-readable strings
// like 'debate-strategy-v1'; node_type_id references Blueprint.node_types[].id
// -------------------------------------------------------

export const CanvasNodeSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  blueprint_id: z.string(), // text FK to domain_blueprints.id (not a uuid)
  node_type_id: z.string(), // references Blueprint.node_types[].id (e.g. 'hypothesis')
  label: z.string(),
  status: CanvasNodeStatusSchema,
  position_x: z.number().nullable(), // float8 — null if node not yet positioned
  position_y: z.number().nullable(), // float8 — null if node not yet positioned
  created_at: z.string(), // timestamptz returned as ISO string from Supabase
  updated_at: z.string(),
});

export type CanvasNode = z.infer<typeof CanvasNodeSchema>;

// -------------------------------------------------------
// CanvasEdge — matches public.canvas_edges table (migration 0008)
// edge_type_id references Blueprint.edge_types[].id (e.g. 'SUPPORTS')
// -------------------------------------------------------

export const CanvasEdgeSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  blueprint_id: z.string(), // text FK to domain_blueprints.id
  source_node_id: z.string().uuid(),
  target_node_id: z.string().uuid(),
  edge_type_id: z.string(), // references Blueprint.edge_types[].id (e.g. 'CONTRADICTS')
  status: CanvasNodeStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>;

// -------------------------------------------------------
// CanvasOp — mutation command emitted by LangGraph AgentNode (Phase 6+)
// Defined here in Phase 5 as the shared type contract; not yet consumed.
// Discriminated union key is "op" (not "type").
// confidence: 0–1 float; controls committed/ghost/silent routing in Phase 6.
// -------------------------------------------------------

export const CanvasOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("ADD_NODE"),
    node_type_id: z.string(), // must match a Blueprint.node_types[].id
    label: z.string(),
    confidence: z.number().min(0).max(1), // 0.0–1.0; Phase 6 MutationGateNode routes to status
  }),
  z.object({
    op: z.literal("ADD_EDGE"),
    source_node_id: z.string().uuid(),
    target_node_id: z.string().uuid(),
    edge_type_id: z.string(), // must match a Blueprint.edge_types[].id
    confidence: z.number().min(0).max(1), // 0.0–1.0
  }),
  z.object({
    op: z.literal("NO_ACTION"),
    reason: z.string().optional(), // optional explanation when LLM decides not to mutate
  }),
]);

export type CanvasOp = z.infer<typeof CanvasOpSchema>;
