---
phase: 05-foundation
reviewed: 2026-07-01T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - apps/api/package.json
  - apps/api/src/lib/blueprint-loader.ts
  - apps/api/src/lib/env.ts
  - apps/api/src/scripts/verify-blueprint-loader.ts
  - apps/web/package.json
  - packages/types/src/blueprint.ts
  - packages/types/src/canvas.ts
  - packages/types/src/index.ts
  - supabase/migrations/0008_nsai_foundation.sql
findings:
  critical: 4
  warning: 5
  info: 2
  total: 11
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-07-01  
**Depth:** standard  
**Files Reviewed:** 9  
**Status:** issues_found

## Summary

This phase introduces the NSAI (Node-Session-AI) foundation: a Supabase migration adding `domain_blueprints`, `canvas_nodes`, and `canvas_edges` tables; a `blueprint-loader.ts` with Ajv + Zod double-validation; a startup env validator; shared TypeScript types for Blueprint and Canvas; and a developer verification script.

The code is well-structured and shows deliberate security thinking (service-role-only blueprint writes, fail-loud env validation, T-05 series references). However, four critical defects are present: an env validation escape hatch that silently provides a zero-value encryption key in production Vercel deployments, Ajv validation that does not enforce the same `min(1)` array constraints as the Zod schema (creating an AJV bypass path), missing `WITH CHECK` on two RLS UPDATE policies, and RLS policies on canvas tables that allow any authenticated user to read or mutate another session's canvas data.

---

## Critical Issues

### CR-01: `KEY_ENCRYPTION_SECRET` silently defaults to `'0'.repeat(64)` on Vercel at runtime

**File:** `apps/api/src/lib/env.ts:48-57`

**Issue:** The Vercel escape hatch (`process.env.VERCEL === '1'`) bypasses env validation not just during the build phase — it bypasses it for **every request served on Vercel**. The `VERCEL` environment variable is set to `'1'` by Vercel on all invocations (build and runtime). As a result, if `KEY_ENCRYPTION_SECRET` is absent from the Vercel project's environment configuration, the API silently uses `'0'.repeat(64)` as the encryption key — a known-value key that makes all encrypted API keys trivially decryptable by anyone who reads the source code. No warning is emitted per-request; only the one-time startup `console.warn` fires.

**Fix:** Restrict the escape hatch strictly to the build phase, not all Vercel invocations. The `NEXT_PHASE` env var is the correct signal for build-time skipping. `VERCEL === '1'` must not be a sufficient condition to skip runtime secret validation. Apply the escape hatch only when both conditions are true, or better, only use `NEXT_PHASE`:

```typescript
// Only skip during the Next.js production build, not general Vercel runtime
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

if (!result.success) {
  if (isBuildPhase) {
    console.warn('[panelito/api] Skipping env validation during build phase');
    return { /* stub values */ } as z.infer<typeof EnvSchema>;
  }
  // Always throw at runtime — including on Vercel
  const issues = result.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `[panelito/api] Missing or invalid environment variables:\n${issues}`
  );
}
```

Note: `apps/api` is a Hono server, not a Next.js app — `NEXT_PHASE` will never be set during its build either. The correct fix is to remove the `VERCEL` bypass entirely and rely only on the `NEXT_PHASE` guard (which will never fire for the Hono app), effectively making env validation unconditional for the API.

---

### CR-02: Ajv schema does not enforce `minItems: 1` on `node_types`, `edge_types`, and `phase_sequence`

**File:** `apps/api/src/lib/blueprint-loader.ts:37-75`

**Issue:** The Zod `BlueprintSchema` in `packages/types/src/blueprint.ts:62` enforces `.min(1)` on `node_types`, `edge_types`, and `phase_sequence`. The Ajv JSON Schema in `blueprint-loader.ts` has no corresponding `minItems` constraint. A Blueprint stored in the database with empty arrays for any of these three fields will pass Ajv validation and then fail Zod validation — throwing an unhandled `ZodError` rather than the documented `"Blueprint <id> failed Ajv validation"` error. More critically, it means the first defense layer (Ajv) is weaker than advertised; any code that relies on Ajv having already validated array non-emptiness (e.g., future Phase 6 code reading `phase_sequence[0]`) would be unsafe after an Ajv-only check.

**Fix:** Add `minItems: 1` to the three array properties in the Ajv schema:

```typescript
node_types: {
  type: "array",
  minItems: 1,   // mirrors BlueprintSchema .min(1)
  items: { ... }
},
edge_types: {
  type: "array",
  minItems: 1,   // mirrors BlueprintSchema .min(1)
  items: { ... }
},
phase_sequence: {
  type: "array",
  minItems: 1,   // mirrors BlueprintSchema .min(1)
  items: { ... }
},
```

---

### CR-03: RLS UPDATE policies on `canvas_nodes` and `canvas_edges` lack `WITH CHECK`

**File:** `supabase/migrations/0008_nsai_foundation.sql:85-89, 125-129`

**Issue:** The UPDATE policies for both canvas tables use only `USING (auth.uid() IS NOT NULL)` with no `WITH CHECK` clause. In PostgreSQL RLS semantics, `USING` on UPDATE controls which existing rows can be targeted; `WITH CHECK` controls what the row values are allowed to be after the update. Without `WITH CHECK`, an authenticated user can update a `canvas_node` to point to a different `session_id` or `branch_id` (one they don't own or aren't participating in), as long as they can initially select the row. This is a horizontal privilege escalation path — a user could move a node into another session's canvas. The comment in the migration references T-05-06 as requiring `WITH CHECK`, but the UPDATE policies do not implement it.

**Fix:**

```sql
CREATE POLICY "canvas_nodes_update"
  ON public.canvas_nodes
  FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "canvas_edges_update"
  ON public.canvas_edges
  FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
```

Note: The minimum fix above matches the existing INSERT pattern. A stronger fix would scope the check to session participation (see CR-04 for context on the broader RLS scope problem).

---

### CR-04: Canvas RLS policies allow any authenticated user to read and write any session's canvas

**File:** `supabase/migrations/0008_nsai_foundation.sql:75-88, 115-128`

**Issue:** All SELECT, INSERT, and UPDATE policies on `canvas_nodes` and `canvas_edges` use `auth.uid() IS NOT NULL` as the sole condition. This means any authenticated user in the system — including guests with anonymous tokens from unrelated sessions — can read every canvas node/edge across all sessions, and insert or update nodes/edges in sessions they are not participants of. Compare this to the `messages_insert` policy in migration 0001 which correctly checks `auth.uid() = author_id` and `status = 'active'` before allowing insert. Canvas data is equally session-scoped and deserves equivalent protection.

**Fix:** Scope canvas policies to session membership. Given the existing sessions table has a `creator_id` column, a minimum safe policy pattern is:

```sql
-- Only users who can access the session can read its canvas
CREATE POLICY "canvas_nodes_select"
  ON public.canvas_nodes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_id
      AND auth.uid() IS NOT NULL
    )
  );

-- Only allow insert into active sessions
CREATE POLICY "canvas_nodes_insert"
  ON public.canvas_nodes
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_id
      AND s.status = 'active'
    )
  );
```

If a session-participant table exists or is planned (Phase 6+), the policy should additionally check participant membership. The `messages_select` policy pattern from 0001 (checking `session_id` exists in `sessions`) is the minimum viable baseline.

---

## Warnings

### WR-01: `getValidator()` cache is per-`blueprintId` but all entries store the same function

**File:** `apps/api/src/lib/blueprint-loader.ts:106-112`

**Issue:** The `validatorCache` is typed as `Map<string, ValidateFunction>` and the comment says it caches "the already-compiled blueprintValidator under each blueprintId key." However, every key maps to the exact same `blueprintValidator` function reference. This is not a correctness bug today, but it is a design misrepresentation that will become a correctness bug if a future developer adds per-blueprint schema customization (e.g., dynamic enum validation based on a blueprint's own `node_type` IDs). The cache creates the appearance of per-blueprint validators but provides none.

**Fix:** Either: (a) rename the variable to `_validatorInitialized: boolean` (simpler, honest) and drop the Map, since there is only ever one validator; or (b) document explicitly at the cache declaration that the cache is a compile-once guard only, not a per-blueprint cache.

```typescript
// Option (a) — simpler and honest:
let blueprintValidatorInitialized = false;
function getValidator(): ValidateFunction {
  // Already compiled at module scope — return directly
  return blueprintValidator;
}
```

---

### WR-02: `additionalProperties: false` applies only at the Blueprint top level, not inside `node_types`/`edge_types`/`phase_sequence` item schemas

**File:** `apps/api/src/lib/blueprint-loader.ts:77`

**Issue:** `additionalProperties: false` is set on the root Blueprint object but not on the nested item schemas for `node_types`, `edge_types`, and `phase_sequence`. This means a blueprint stored with extra fields in those nested objects (e.g., `node_types[].deprecated_field`) will pass Ajv validation. The intent of `additionalProperties: false` (preventing unknown fields) is partially undermined for the nested schemas. This is not a crash bug because Zod's strict-less parse will also accept extra fields, but it contradicts the security comment on line 20 ("additionalProperties: false at top level prevents unknown fields from passing").

**Fix:** Add `additionalProperties: false` to the item schemas:

```typescript
node_types: {
  type: "array",
  items: {
    type: "object",
    required: ["id", "label", "color", "description"],
    properties: { ... },
    additionalProperties: false,   // add this
  },
},
```

---

### WR-03: `canvas_nodes` and `canvas_edges` `updated_at` columns have no auto-update trigger

**File:** `supabase/migrations/0008_nsai_foundation.sql:68, 108`

**Issue:** Both canvas tables declare `updated_at timestamptz NOT NULL DEFAULT now()`, but migration 0008 does not create `BEFORE UPDATE` triggers to call `set_updated_at()`. The function `public.set_updated_at()` was created in migration 0001 and is used by the `sessions` and `creator_settings` tables. Without the trigger, `updated_at` on canvas rows will permanently remain at the insertion timestamp regardless of subsequent updates. Any UI or API code that uses `updated_at` to detect stale canvas data or drive real-time subscription filtering will receive incorrect values.

**Fix:**

```sql
CREATE TRIGGER canvas_nodes_updated_at
  BEFORE UPDATE ON public.canvas_nodes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER canvas_edges_updated_at
  BEFORE UPDATE ON public.canvas_edges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

---

### WR-04: `CanvasOp` `confidence` field has no range constraint (0–1)

**File:** `packages/types/src/canvas.ts:67, 74`

**Issue:** The comments on lines 59, 67, and 74 state that `confidence` is `0.0–1.0`, and the Phase 6 `MutationGateNode` routes on this value to determine committed/ghost/silent status. However, the Zod schema uses plain `z.number()` with no `min(0).max(1)` constraint. An LLM that emits `confidence: 1.5` or `confidence: -0.2` will pass schema validation, and the Phase 6 gate logic will receive out-of-range values. Since the type is described as controlling `status` routing, an out-of-range value could cause unexpected behavior (e.g., always routing to "silent" if the gate uses `confidence < threshold`).

**Fix:**

```typescript
confidence: z.number().min(0).max(1), // 0.0–1.0 as documented
```

Apply to both `ADD_NODE` (line 67) and `ADD_EDGE` (line 74) variants.

---

### WR-05: `env.ts` is in `apps/api` but guards with `NEXT_PHASE` (a Next.js signal)

**File:** `apps/api/src/lib/env.ts:48`

**Issue:** The `apps/api` package is a Hono server (`tsx watch src/server.ts`), not a Next.js app. The `NEXT_PHASE` environment variable is set by the Next.js CLI during its build pipeline and will never be set when building or running the Hono API server. The comment on line 46 ("During Next.js build phase") is therefore wrong for this file's context. The guard `process.env.NEXT_PHASE === 'phase-production-build'` is dead code for the Hono API — it will never evaluate to true — making the `VERCEL === '1'` branch the only active escape path, which is the problematic one identified in CR-01.

**Fix:** Remove both escape-hatch branches entirely from `apps/api/src/lib/env.ts`. The Hono API must always have valid env vars. If the Hono server is built as part of a Vercel serverless function alongside Next.js, the Vercel project environment variables should be set correctly, not worked around:

```typescript
export const env = (() => {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `[panelito/api] Missing or invalid environment variables:\n${issues}\n\nCopy .env.example to apps/api/.env and fill in the values.`
    );
  }
  return result.data;
})();
```

---

## Info

### IN-01: `verify-blueprint-loader.ts` hardcodes exact counts for seed data assertions

**File:** `apps/api/src/scripts/verify-blueprint-loader.ts:29-34`

**Issue:** Test A asserts `node_types.length === 4`, `edge_types.length === 4`, `phase_sequence.length === 3`. These are correct for the current seed, but the assertions are not labeled with what they're testing — they'll produce cryptic failures when the seed blueprint evolves (e.g., a fifth node type is added). This is a maintainability problem for a developer verification script, not a production bug.

**Fix:** Add inline comments naming the expected values, or replace count assertions with membership checks that survive additive changes:

```typescript
// Confirm all 4 required node types are present
const nodeTypeIds = blueprint.node_types.map(n => n.id);
for (const expected of ["hypothesis", "evidence", "counter_argument", "action"]) {
  if (!nodeTypeIds.includes(expected))
    throw new Error(`Expected node type '${expected}' not found`);
}
```

---

### IN-02: `apps/api/package.json` declares `@langfuse/langchain` which is unused in reviewed scope

**File:** `apps/api/package.json:22`

**Issue:** `@langfuse/langchain` (version 5.9.1) appears in dependencies but no file in the reviewed scope imports it. This is a production dependency that increases bundle size and supply-chain attack surface if it is not actually used. This finding is scoped to the reviewed files only; if it is used in non-reviewed files it can be dismissed.

**Fix:** Verify with `grep -r "@langfuse/langchain" apps/api/src/`. If unused, move to devDependencies or remove.

---

_Reviewed: 2026-07-01_  
_Reviewer: Claude (gsd-code-reviewer)_  
_Depth: standard_
