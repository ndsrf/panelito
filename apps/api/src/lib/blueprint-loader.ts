/**
 * blueprint-loader.ts — Module-level Ajv singleton with compiled validator.
 *
 * BLUE-02 enforcement: the Ajv ValidateFunction is compiled ONCE at module load,
 * not per call to loadBlueprint(). loadBlueprint() calls the already-compiled
 * blueprintValidator directly — no per-blueprint cache needed since all blueprints
 * share the same JSON Schema.
 *
 * Public API: only loadBlueprint() is exported. Ajv internals are not re-exported.
 */

import Ajv, { ValidateFunction } from "ajv";
import { Blueprint, BlueprintSchema } from "@panelito/types";
import { createServiceClient } from "./supabase";

// ---------------------------------------------------------------------------
// JSON Schema for Blueprint meta-schema validation (Ajv)
// Covers all required fields from D-01 through D-05.
// additionalProperties: false at top level prevents unknown fields from passing.
// ---------------------------------------------------------------------------
const BLUEPRINT_JSON_SCHEMA = {
  type: "object",
  required: [
    "id",
    "name",
    "canvas_view_mode",
    "node_types",
    "edge_types",
    "phase_sequence",
    "active_persona_ids",
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    canvas_view_mode: { type: "string", enum: ["graph", "chart"] },
    node_types: {
      type: "array",
      minItems: 1, // matches BlueprintSchema .min(1)
      items: {
        type: "object",
        required: ["id", "label", "color", "description"], // D-02: description required
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          color: { type: "string" },
          description: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    edge_types: {
      type: "array",
      minItems: 1, // matches BlueprintSchema .min(1)
      items: {
        type: "object",
        required: ["id", "label", "color"], // D-03: NO description in required
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          color: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    phase_sequence: {
      type: "array",
      minItems: 1, // matches BlueprintSchema .min(1)
      items: {
        type: "object",
        required: ["id", "label", "llm_instructions", "allowed_node_types"], // D-04
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          llm_instructions: { type: "string" },
          allowed_node_types: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    },
    active_persona_ids: { type: "array", items: { type: "string" } }, // D-05
    // D-02 (Phase 6): drift reply probability [0,1] — optional field.
    // NOT in the `required` array: the seeded debate-strategy-v1 Blueprint lacks this field
    // and must still validate. Zod default(0.8) supplies the value at parse time.
    // MUST be declared in `properties` (even though optional) because `additionalProperties: false`
    // would reject any blueprint that does include the field without this declaration (T-06-01).
    drift_reply_probability: { type: "number", minimum: 0, maximum: 1 },
    // Phase 11 (Plan 01/02): bot_defaults + role_personalities + bot_cooldowns.
    // Optional in the schema (Zod supplies .default({})/.optional()) but MUST be
    // declared here — additionalProperties: false at top level rejects any
    // blueprint carrying these fields without this declaration (same pattern as
    // drift_reply_probability above).
    bot_defaults: {
      type: "object",
      additionalProperties: { type: "boolean" },
    },
    role_personalities: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    bot_cooldowns: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["max", "window_minutes"],
        properties: {
          max: { type: "number" },
          window_minutes: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

// ---------------------------------------------------------------------------
// Module-level Ajv singleton — single instance for the entire process
// allErrors: true — report all validation errors, not just the first
// ---------------------------------------------------------------------------
const ajv = new Ajv({ allErrors: true });

// ---------------------------------------------------------------------------
// Module-level compiled validator — compiled ONCE at module load (BLUE-02)
// This is the critical constraint: NOT compiled inside loadBlueprint().
// Compiled here, at module scope; called directly in loadBlueprint().
// ---------------------------------------------------------------------------
const blueprintValidator: ValidateFunction = ajv.compile(BLUEPRINT_JSON_SCHEMA);

// ---------------------------------------------------------------------------
// loadBlueprint — the only public export
//
// Queries domain_blueprints via service role (bypasses RLS), validates the
// JSON definition against the Ajv meta-schema, then parses with BlueprintSchema
// to produce a fully typed Blueprint object.
//
// Throws:
//   "Blueprint not found: <id>" — if blueprintId does not exist in the DB
//   "Blueprint <id> failed Ajv validation: <errors>" — if JSON structure invalid
//   ZodError — if Ajv passes but Zod detects a type mismatch (defense-in-depth)
// ---------------------------------------------------------------------------
export async function loadBlueprint(blueprintId: string): Promise<Blueprint> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("domain_blueprints")
    .select("definition")
    .eq("id", blueprintId)
    .single();

  if (error) {
    // PGRST116: "The result contains 0 rows" — genuine not-found case
    if (error.code === 'PGRST116') {
      throw new Error(`Blueprint not found: ${blueprintId}`);
    }
    throw new Error(
      `Blueprint ${blueprintId} database error: ${error.message} (code: ${error.code})`
    );
  }
  if (!data) {
    throw new Error(`Blueprint not found: ${blueprintId}`);
  }

  const valid = blueprintValidator(data.definition);

  if (!valid) {
    throw new Error(
      `Blueprint ${blueprintId} failed Ajv validation: ${JSON.stringify(blueprintValidator.errors)}`
    );
  }

  // Double-validation (defense-in-depth per T-05-09):
  // Ajv validates structural shape; BlueprintSchema.parse() produces the typed value.
  return BlueprintSchema.parse(data.definition);
}
