/**
 * blueprint-loader.ts — Module-level Ajv singleton with cached validators.
 *
 * BLUE-02 enforcement: the Ajv ValidateFunction is compiled ONCE at module load,
 * not per call to loadBlueprint() and not per call to getValidator(). The
 * validatorCache caches the already-compiled function keyed by blueprintId so
 * that getValidator() returns immediately from cache without ever calling
 * ajv.compile() again after the initial module-load compile.
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
      },
    },
    active_persona_ids: { type: "array", items: { type: "string" } }, // D-05
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
// This is the critical constraint: NOT compiled inside loadBlueprint(),
// NOT compiled inside getValidator(). Compiled here, at module scope.
// ---------------------------------------------------------------------------
const blueprintValidator: ValidateFunction = ajv.compile(BLUEPRINT_JSON_SCHEMA);

// ---------------------------------------------------------------------------
// Module-level validator cache — Map<blueprintId, ValidateFunction>
// Caches the already-compiled blueprintValidator under each blueprintId key.
// getValidator() never calls ajv.compile() — compile happened above.
// ---------------------------------------------------------------------------
const validatorCache = new Map<string, ValidateFunction>();

// ---------------------------------------------------------------------------
// getValidator — internal helper
// Stores the module-level blueprintValidator in the cache under blueprintId
// on first access. Subsequent calls return immediately from cache.
// No re-compilation ever occurs — BLUE-02 compliant.
// ---------------------------------------------------------------------------
function getValidator(blueprintId: string): ValidateFunction {
  if (!validatorCache.has(blueprintId)) {
    // Store the already-compiled validator — NOT a new compile call
    validatorCache.set(blueprintId, blueprintValidator);
  }
  return validatorCache.get(blueprintId)!;
}

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

  if (error || !data) {
    throw new Error(`Blueprint not found: ${blueprintId}`);
  }

  const validate = getValidator(blueprintId);
  const valid = validate(data.definition);

  if (!valid) {
    throw new Error(
      `Blueprint ${blueprintId} failed Ajv validation: ${JSON.stringify(validate.errors)}`
    );
  }

  // Double-validation (defense-in-depth per T-05-09):
  // Ajv validates structural shape; BlueprintSchema.parse() produces the typed value.
  return BlueprintSchema.parse(data.definition);
}
