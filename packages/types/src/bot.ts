import { z } from "zod";

// -------------------------------------------------------
// ArgNode — argument graph node (BOT-05, D-14)
// Parallel to CanvasNode but for the argument graph structure.
// Populated by ArgGraphBuilderNode in Phase 11.
//
// message_id + speaker (PERSONA-02, Phase 11 Task 1): required citation anchor —
// the Analyst persona must always cite a specific prior message. `type` is kept
// z.string() (runtime-resolved, not a compile-time enum, matching blueprint.ts
// active_persona_ids precedent) but the canonical node-type set is now
// 'claim' | 'evidence' | 'counterargument' | 'question'.
// .uuid() constraints on id/source_id/target_id are intentional — the raw
// tool-output ID substitution step (ArgGraphBuilderNode, Plan 03) runs
// crypto.randomUUID() substitution before this schema is applied (Finding 2).
// -------------------------------------------------------

export const ArgNodeSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),          // e.g. 'claim', 'evidence', 'counterargument', 'question'
  label: z.string(),
  branch_id: z.string().uuid(),
  message_id: z.string().uuid(), // citation anchor — required for PERSONA-02
  speaker: z.string(),           // participant display name for citations
});

export type ArgNode = z.infer<typeof ArgNodeSchema>;

// -------------------------------------------------------
// ArgEdge — argument graph edge (BOT-05, D-14)
// -------------------------------------------------------

export const ArgEdgeSchema = z.object({
  id: z.string().uuid(),
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  relation: z.string(),      // e.g. 'SUPPORTS', 'CONTRADICTS'
});

export type ArgEdge = z.infer<typeof ArgEdgeSchema>;

// -------------------------------------------------------
// ArgGraph — full argument graph shape (nodes + edges) (Phase 11 Task 1)
// Matches the shape GraphStateAnnotation.argGraph is typed against (state.ts).
// -------------------------------------------------------

export const ArgGraphSchema = z.object({
  nodes: z.array(ArgNodeSchema),
  edges: z.array(ArgEdgeSchema),
});

export type ArgGraph = z.infer<typeof ArgGraphSchema>;

// -------------------------------------------------------
// BotBudgetResult — return type from check_and_record_bot_budget RPC (BOT-01, D-07)
// -------------------------------------------------------

export const BotBudgetResultSchema = z.object({
  allowed: z.boolean(),
  circuit_open: z.boolean(),
  tokens_used_window: z.number(),
});

export type BotBudgetResult = z.infer<typeof BotBudgetResultSchema>;

// -------------------------------------------------------
// TriggerMetadata — keyed by trigger type (BOT-05, D-15)
// TriggerMetadataEntry: per-trigger firing state.
// last_fired_at / cooldown_until are ISO strings or null.
// -------------------------------------------------------

export const TriggerMetadataEntrySchema = z.object({
  last_fired_at: z.string().nullable(),
  cooldown_until: z.string().nullable(),
});

export type TriggerMetadataEntry = z.infer<typeof TriggerMetadataEntrySchema>;

export const TriggerMetadataSchema = z.record(z.string(), TriggerMetadataEntrySchema);

export type TriggerMetadata = z.infer<typeof TriggerMetadataSchema>;
