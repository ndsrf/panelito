import { z } from "zod";

// -------------------------------------------------------
// NodeTypeConfig — D-02: description is REQUIRED
// The description field is injected into the LangGraph AgentNode system prompt
// in Phase 6 to explain each node type's semantic meaning to the LLM.
// -------------------------------------------------------

export const NodeTypeConfigSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string(),
  description: z.string(), // Required — feeds AgentNode system prompt (Phase 6)
});

export type NodeTypeConfig = z.infer<typeof NodeTypeConfigSchema>;

// -------------------------------------------------------
// EdgeTypeConfig — D-03: NO description field
// Edge semantics are implied by the id/label (SUPPORTS, CONTRADICTS, etc.)
// -------------------------------------------------------

export const EdgeTypeConfigSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string(),
});

export type EdgeTypeConfig = z.infer<typeof EdgeTypeConfigSchema>;

// -------------------------------------------------------
// PhaseSequence — D-04
// allowed_node_types restricts which node type ids the LLM can emit per phase.
// llm_instructions is injected into the system prompt when current_phase matches.
// -------------------------------------------------------

export const PhaseSequenceSchema = z.object({
  id: z.string(),
  label: z.string(),
  llm_instructions: z.string(),
  allowed_node_types: z.array(z.string()), // references NodeTypeConfig.id values
});

export type PhaseSequence = z.infer<typeof PhaseSequenceSchema>;

// -------------------------------------------------------
// Blueprint — D-01: top-level domain configuration schema
// Stored as a JSONB definition column in domain_blueprints table.
// canvas_view_mode: "graph" uses @xyflow/react canvas; "chart" uses existing Recharts panel.
// active_persona_ids: string[] — NOT z.array(z.enum(PERSONA_IDS)).
//   Intentional: persona references are text IDs checked at runtime against PERSONA_LIBRARY,
//   not at TypeScript-compile time. Allows new personas without rebuilding types. (D-05)
// node_types + edge_types + phase_sequence: min(1) enforces non-empty arrays.
// -------------------------------------------------------

export const BlueprintSchema = z.object({
  id: z.string(),
  name: z.string(),
  canvas_view_mode: z.enum(["graph", "chart"]), // "graph" = @xyflow/react; "chart" = Recharts
  node_types: z.array(NodeTypeConfigSchema).min(1),
  edge_types: z.array(EdgeTypeConfigSchema).min(1),
  phase_sequence: z.array(PhaseSequenceSchema).min(1),
  active_persona_ids: z.array(z.string()), // references PERSONA_LIBRARY ids at runtime
  // D-02 (Phase 6): probability [0,1] that OrchestratorNode sends a DriftReplyNode response
  // on DOMAIN_DRIFT classification. Default 0.8 per research A5 / D-05 discretion.
  // Optional in DB (seeded debate-strategy-v1 Blueprint lacks this field); Zod supplies default.
  drift_reply_probability: z.number().min(0).max(1).default(0.8),
  // Phase 11 (Finding 5): bot_defaults + role_personalities are REAL Blueprint fields
  // (not the bot_cooldowns TS-only-intersection anti-pattern) — Blueprint is the actual
  // DB source of truth for which bots run by default and which Personality each Role uses.
  // Keyed by Role id ('coach' | 'analyst', text — runtime-resolved, D-10/D-11).
  bot_defaults: z.record(z.string(), z.boolean()).default({}),
  // Role id -> default Personality id (D-05).
  role_personalities: z.record(z.string(), z.string()).default({}),
  // Optional per-Role cooldown config (PERSONA-03): Coach 3/15, Analyst 2/15.
  bot_cooldowns: z
    .record(z.string(), z.object({ max: z.number(), window_minutes: z.number() }))
    .optional(),
});

export type Blueprint = z.infer<typeof BlueprintSchema>;
