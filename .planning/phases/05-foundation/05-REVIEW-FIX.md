---
phase: 05-foundation
fixed_at: 2026-07-01T00:00:00Z
review_path: .planning/phases/05-foundation/05-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-07-01T00:00:00Z
**Source review:** .planning/phases/05-foundation/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9
- Fixed: 9
- Skipped: 0

## Fixed Issues

### CR-01: Remove VERCEL=1 env bypass from api env

**Files modified:** `apps/api/src/lib/env.ts`
**Commit:** cc7a50b
**Applied fix:** Removed the entire `VERCEL=1` escape hatch from `env.ts`. The Hono API is not a Next.js app so `NEXT_PHASE` is never set for it; the `VERCEL=1` branch was the only active bypass path, firing on every Vercel runtime invocation and silently substituting `'0'.repeat(64)` as the encryption key. The IIFE now always throws on invalid env vars with no bypass.

---

### CR-02: Scope canvas RLS policies to session membership

**Files modified:** `supabase/migrations/0008_nsai_foundation.sql`
**Commit:** d99414e
**Applied fix:** Replaced bare `auth.uid() IS NOT NULL` predicates on `canvas_nodes` SELECT/INSERT and `canvas_edges` SELECT/INSERT policies with `EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id ...)` subqueries. INSERT policies additionally require `s.status = 'active'`. SELECT policies require the session row to exist. Prevents any authenticated user from accessing canvas data outside their session.

---

### CR-03: Add WITH CHECK to canvas UPDATE policies

**Files modified:** `supabase/migrations/0008_nsai_foundation.sql`
**Commit:** f38cb5b
**Applied fix:** Added `WITH CHECK` clauses to both `canvas_nodes_update` and `canvas_edges_update` policies. Also strengthened the `USING` clause to mirror the session-membership check from CR-02 (active session required). `WITH CHECK` validates the new row values after the update is applied, preventing session_id or branch_id from being transplanted to a foreign session.

---

### CR-04: Add minItems: 1 to Ajv schema array fields

**Files modified:** `apps/api/src/lib/blueprint-loader.ts`
**Commit:** 2237583
**Applied fix:** Added `minItems: 1` to `node_types`, `edge_types`, and `phase_sequence` array definitions in `BLUEPRINT_JSON_SCHEMA`. This aligns the Ajv first-gate validation with the `.min(1)` constraints in `BlueprintSchema`, ensuring empty arrays are caught at the Ajv stage rather than producing an uncaught ZodError.

---

### WR-01: Add BEFORE UPDATE triggers for canvas updated_at

**Files modified:** `supabase/migrations/0008_nsai_foundation.sql`
**Commit:** 8d820e3
**Applied fix:** Added `canvas_nodes_updated_at` and `canvas_edges_updated_at` BEFORE UPDATE triggers that call `public.set_updated_at()`, matching the pattern already applied to `sessions` and `creator_settings` in migration 0001. Both triggers are placed at the end of their respective table sections.

---

### WR-02: Remove misleading validatorCache and getValidator

**Files modified:** `apps/api/src/lib/blueprint-loader.ts`
**Commit:** 38e0602
**Applied fix:** Removed `validatorCache` (a `Map<string, ValidateFunction>`) and the `getValidator()` helper function. Every entry in the Map stored the same `blueprintValidator` reference, providing no per-blueprint isolation. `loadBlueprint()` now calls `blueprintValidator(data.definition)` directly. The module docstring and inline comment were updated to accurately describe the simpler design.

---

### WR-03: Add additionalProperties: false to nested Ajv item schemas

**Files modified:** `apps/api/src/lib/blueprint-loader.ts`
**Commit:** fff4426
**Applied fix:** Added `additionalProperties: false` inside each `items` object for `node_types`, `edge_types`, and `phase_sequence`. The root object already had this constraint, but nested item schemas were open to unknown fields, making the comment on line 20 ("prevents unknown fields") only partially true.

---

### WR-04: Constrain CanvasOp confidence to 0.0-1.0 range

**Files modified:** `packages/types/src/canvas.ts`
**Commit:** 10351c4
**Applied fix:** Changed `confidence: z.number()` to `confidence: z.number().min(0).max(1)` in both the `ADD_NODE` and `ADD_EDGE` arms of the `CanvasOpSchema` discriminated union. An LLM emitting out-of-range values (e.g., `1.5` or `-0.1`) will now be rejected at schema parse time rather than silently corrupting Phase 6 gate routing.

---

### WR-05: Distinguish PGRST116 not-found from real DB errors in loadBlueprint

**Files modified:** `apps/api/src/lib/blueprint-loader.ts`
**Commit:** 4c95600
**Applied fix:** Split the `if (error || !data)` guard into separate branches. When `error.code === 'PGRST116'` (PostgREST's zero-row `.single()` code) a genuine "Blueprint not found" message is thrown. All other errors now surface a distinct `"Blueprint ${blueprintId} database error: ${error.message} (code: ${error.code})"` message, making network, auth, and PostgREST failures distinguishable in production logs.

---

_Fixed: 2026-07-01T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
