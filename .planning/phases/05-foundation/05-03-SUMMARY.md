---
phase: 05-foundation
plan: "03"
subsystem: shared-types
tags: [types, zod, canvas, blueprint, nsai]
dependency_graph:
  requires: [05-01]
  provides: [canvas-types, blueprint-types]
  affects: [packages/types, apps/api, apps/web]
tech_stack:
  added: []
  patterns:
    - "Zod schema + z.infer type co-located in same file (existing @panelito/types convention)"
    - "export type {} for TypeScript types; named export for Zod schemas in index.ts"
    - "CanvasOp discriminated union on 'op' literal (not 'type')"
    - "active_persona_ids as z.array(z.string()) — runtime-checked against PERSONA_LIBRARY, not compile-time enum"
key_files:
  created:
    - packages/types/src/canvas.ts
    - packages/types/src/blueprint.ts
  modified:
    - packages/types/src/index.ts
decisions:
  - "blueprint_id in CanvasNodeSchema and CanvasEdgeSchema is z.string() (not uuid) — Blueprint ids are human-readable text like 'debate-strategy-v1' per D-07"
  - "active_persona_ids is z.array(z.string()) not z.array(z.enum(PERSONA_IDS)) — allows new personas without rebuilding types package per D-05"
  - "node_types/edge_types/phase_sequence all have .min(1) constraint — Blueprints with empty arrays are invalid"
  - "canvas_view_mode enum is exactly ['graph', 'chart'] — 'graph' for @xyflow/react Phase 9, 'chart' for existing Recharts panel (CANVAS-04)"
metrics:
  duration: "1m 52s"
  completed_date: "2026-07-01"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 1
---

# Phase 5 Plan 03: Canvas and Blueprint Shared Types Summary

**One-liner:** Zod-first CanvasNode/CanvasEdge/CanvasOp + Blueprint type system with discriminated union and min-1 arrays, co-located with TypeScript types in @panelito/types.

## What Was Built

Two new files added to `packages/types/src/`:

**canvas.ts** — Universal NSAI graph data types (CANVAS-01, INFRA-03):
- `CanvasNodeStatusSchema`: `z.enum(["committed", "ghost", "silent"])` — three lifecycle states for nodes and edges
- `CanvasNodeSchema`: 11-field Zod object matching `public.canvas_nodes` migration 0008 column names exactly; `blueprint_id` is `z.string()` (text FK, not uuid)
- `CanvasEdgeSchema`: 10-field Zod object matching `public.canvas_edges` migration 0008; reuses `CanvasNodeStatusSchema` for edge status
- `CanvasOpSchema`: discriminated union on `"op"` literal with `ADD_NODE`, `ADD_EDGE`, `NO_ACTION` variants; `confidence` field on ADD_* ops for Phase 6 autonomy routing

**blueprint.ts** — Domain Blueprint type system (BLUE-01, INFRA-03):
- `NodeTypeConfigSchema`: `{ id, label, color, description }` — `description` is required per D-02 (feeds Phase 6 AgentNode system prompt)
- `EdgeTypeConfigSchema`: `{ id, label, color }` — no description per D-03
- `PhaseSequenceSchema`: `{ id, label, llm_instructions, allowed_node_types }` per D-04
- `BlueprintSchema`: top-level schema per D-01 with `canvas_view_mode: z.enum(["graph", "chart"])`, `.min(1)` on all array fields, `active_persona_ids: z.array(z.string())` per D-05

**index.ts** — Appended 8 new re-export lines (4 `export type {}` + 4 named schema exports) without modifying any existing lines.

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm --filter @panelito/types build` | exit 0 |
| `pnpm --filter @panelito/api typecheck` | exit 0 |
| `pnpm --filter @panelito/web typecheck` | exit 0 |
| `grep -c "BlueprintSchema" packages/types/src/index.ts` | 1 |
| `grep -c "CanvasNodeSchema" packages/types/src/index.ts` | 1 |
| `canvas_view_mode` in blueprint.ts | `z.enum(["graph", "chart"])` confirmed |
| `description` in NodeTypeConfigSchema | Required z.string() confirmed |
| EdgeTypeConfigSchema | No description field confirmed |

## Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create canvas.ts | 09f2e4e | packages/types/src/canvas.ts |
| 2 | Create blueprint.ts + update index.ts | 2b5b0a2 | packages/types/src/blueprint.ts, packages/types/src/index.ts |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — these are pure type definitions. No data sources to wire, no UI rendering.

## Threat Flags

None — types package is compile-time only. No new runtime trust boundaries introduced. Blueprint validation against the Ajv meta-schema is implemented in Plan 04 (blueprint-loader.ts).

## Self-Check: PASSED

- packages/types/src/canvas.ts: FOUND
- packages/types/src/blueprint.ts: FOUND
- packages/types/src/index.ts: MODIFIED (canvas + blueprint re-exports appended)
- Commit 09f2e4e: FOUND
- Commit 2b5b0a2: FOUND
