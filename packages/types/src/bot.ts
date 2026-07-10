import { z } from "zod";

// -------------------------------------------------------
// ArgNode — argument graph node (BOT-05, D-14)
// Parallel to CanvasNode but for the argument graph structure.
// Populated by ArgGraphBuilderNode in Phase 11.
// -------------------------------------------------------

export const ArgNodeSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),          // e.g. 'claim', 'evidence', 'rebuttal'
  label: z.string(),
  branch_id: z.string().uuid(),
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
