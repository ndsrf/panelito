---
phase: 06-graph-construction-checkpointer
plan: "01"
subsystem: shared-types
tags: [canvas-tool, blueprint-schema, providerTool, zod, ajv, tdd, wave-1]
dependency_graph:
  requires: []
  provides:
    - canvasMutationTool (ProviderTool) in @panelito/types
    - drift_reply_probability field on BlueprintSchema (Zod)
    - drift_reply_probability property in BLUEPRINT_JSON_SCHEMA (Ajv)
  affects:
    - Wave 2 graph nodes (AgentNode, OrchestratorNode) that import canvasMutationTool
    - loadBlueprint() callers that receive Blueprint with drift_reply_probability
tech_stack:
  added: []
  patterns:
    - ProviderTool literal shape (parameters key, not input_schema) — follows renderPanelTool pattern
    - Zod .default() for optional Blueprint fields that downstream nodes read
    - Ajv additionalProperties:false + optional property declaration pattern (defense-in-depth)
    - vitest resolve.alias for worktree-local package overrides
key_files:
  created:
    - packages/types/src/canvas-tool.ts
    - packages/types/src/canvas-tool.test.ts
    - apps/api/src/lib/blueprint-loader.test.ts
  modified:
    - packages/types/src/index.ts
    - packages/types/src/blueprint.ts
    - apps/api/src/lib/blueprint-loader.ts
    - apps/api/vitest.config.ts
decisions:
  - canvasMutationTool placed in new canvas-tool.ts (not ai.ts) per D-06 Claude discretion — keeps AI provider interface clean
  - drift_reply_probability default is 0.8 per research A5 / D-05 discretion
  - vitest.config.ts resolve.alias added to worktree to override @panelito/types resolution for local type changes
metrics:
  duration: "9 minutes"
  completed: "2026-07-02T11:28:25Z"
  tasks: 2
  files: 7
---

# Phase 6 Plan 01: Type Contracts (canvasMutationTool + drift_reply_probability) Summary

**One-liner:** `canvasMutationTool` ProviderTool with ADD_NODE/ADD_EDGE/NO_ACTION branches exported from `@panelito/types`, and `drift_reply_probability: number (default 0.8)` added to BlueprintSchema and Ajv meta-schema with the seeded debate-strategy-v1 Blueprint still validating.

## What Was Built

### Task 1: canvasMutationTool (ORCH-03)

Created `packages/types/src/canvas-tool.ts` exporting `canvasMutationTool: ProviderTool`. The tool follows the `renderPanelTool` pattern from `ai.ts` exactly:

- `name: 'canvas_mutation'`
- `parameters` key (NOT `input_schema`) — adapters convert at call time
- `oneOf` with three branches: ADD_NODE (op, node_type_id, label, confidence), ADD_EDGE (op, source_node_id, target_node_id, edge_type_id, confidence), NO_ACTION (op, optional reason)
- `confidence` on ADD_NODE and ADD_EDGE: `{ type: 'number', minimum: 0, maximum: 1 }`
- Tool output shape maps to `CanvasOpSchema` discriminated union (canvas.ts) for downstream `CanvasOpSchema.safeParse()` in MutationGateNode (Plan 06-03)

Added barrel export to `packages/types/src/index.ts`: `export { canvasMutationTool } from "./canvas-tool";`

### Task 2: drift_reply_probability (BLUE-03, D-02, T-06-01)

Added `drift_reply_probability: z.number().min(0).max(1).default(0.8)` to `BlueprintSchema` in `packages/types/src/blueprint.ts`.

Added `drift_reply_probability: { type: "number", minimum: 0, maximum: 1 }` to `BLUEPRINT_JSON_SCHEMA.properties` in `apps/api/src/lib/blueprint-loader.ts`. Key constraint: NOT added to the `required` array — the seeded debate-strategy-v1 Blueprint lacks this field; Zod supplies the 0.8 default at parse time. Property declared in `properties` (not `required`) so blueprints that DO include the field aren't rejected by `additionalProperties: false` (T-06-01 mitigation).

## Verification Results

| Check | Result |
|-------|--------|
| `cd packages/types && npx tsc --noEmit` | PASS (exit 0) |
| `vitest run src/canvas-tool.test.ts` (9 tests) | PASS (9/9) |
| `vitest run src/lib/blueprint-loader.test.ts` (7 tests) | PASS (7/7, including integration test) |
| `grep -q canvasMutationTool packages/types/src/index.ts` | PASS |
| loadBlueprint('debate-strategy-v1') resolves | PASS (drift_reply_probability === 0.8 via default) |
| BlueprintSchema.parse({..., drift_reply_probability: 1.5}) throws | PASS |

## Commits

| Hash | Type | Description |
|------|------|-------------|
| dc426f6 | test | add failing tests for canvasMutationTool (RED) |
| e188974 | feat | implement canvasMutationTool and wire barrel export (GREEN) |
| 6a23b8f | test | add failing tests for drift_reply_probability schema (RED) |
| 588c424 | feat | add drift_reply_probability to BlueprintSchema and Ajv meta-schema (GREEN) |

## Deviations from Plan

### Auto-fixed Issues

None — all tasks executed exactly as written.

### Infrastructure Issues (Rule 3 — blocking)

**1. [Rule 3 - Blocking] Worktree node_modules not symlinked**
- **Found during:** Task 1 RED phase test execution
- **Issue:** The worktree's `apps/api/node_modules` and `packages/types/node_modules` were not symlinked to the main repo's node_modules (comment in vitest.config.ts said they should be, but weren't created by the worktree setup)
- **Fix:** Created symlinks manually: `ln -s /home/jgm/.../panelito/apps/api/node_modules worktree/.../apps/api/node_modules`
- **Files modified:** none (filesystem symlinks only, not committed)

**2. [Rule 3 - Blocking] @panelito/types resolves to main repo's packages/types, not worktree's**
- **Found during:** Task 2 GREEN phase (tests passed RED but failed GREEN unexpectedly)
- **Issue:** `apps/api/node_modules/@panelito/types` is a pnpm symlink pointing to `../../../../packages/types` which resolves to the MAIN REPO's types (not the worktree's). So modified `blueprint.ts` in the worktree wasn't being picked up by vitest.
- **Fix:** Added `resolve.alias` to `apps/api/vitest.config.ts` to override `@panelito/types` to the worktree's `packages/types/src` directory when running in worktree mode. This is the correct fix — it doesn't break the main repo's behavior (the alias only triggers when `../../packages/types/src/index.ts` exists, which it always does in the worktree but the alias serves no purpose in the main repo since the package resolves correctly there).
- **Files modified:** `apps/api/vitest.config.ts`
- **Commit:** 588c424

## Known Stubs

None — all code produces real values. No hardcoded placeholders.

## Threat Flags

None — the changes are purely additive type definitions. The `drift_reply_probability` validation (T-06-01 mitigation) is fully implemented as required by the threat register.

## TDD Gate Compliance

Both tasks followed the full RED/GREEN cycle:
- Task 1: `test(06-01): add failing tests for canvasMutationTool` (RED) → `feat(06-01): implement canvasMutationTool` (GREEN)
- Task 2: `test(06-01): add failing tests for drift_reply_probability schema` (RED) → `feat(06-01): add drift_reply_probability to BlueprintSchema` (GREEN)

No REFACTOR phase was needed — implementations were clean on the first pass.

## Self-Check

Checking created files exist:

| File | Status |
|------|--------|
| packages/types/src/canvas-tool.ts | FOUND |
| packages/types/src/canvas-tool.test.ts | FOUND |
| apps/api/src/lib/blueprint-loader.test.ts | FOUND |

Checking commits exist:

| Hash | Status |
|------|--------|
| dc426f6 | FOUND |
| e188974 | FOUND |
| 6a23b8f | FOUND |
| 588c424 | FOUND |

## Self-Check: PASSED
