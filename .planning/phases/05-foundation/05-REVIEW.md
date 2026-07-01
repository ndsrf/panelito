---
phase: 05-foundation
reviewed: 2026-07-01T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - apps/api/package.json
  - apps/web/package.json
  - apps/api/src/lib/env.ts
  - supabase/migrations/0008_nsai_foundation.sql
  - packages/types/src/canvas.ts
  - packages/types/src/blueprint.ts
  - packages/types/src/index.ts
  - apps/api/src/lib/blueprint-loader.ts
  - apps/api/src/scripts/verify-blueprint-loader.ts
findings:
  critical: 4
  warning: 5
  info: 3
  total: 12
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-07-01T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This phase delivers the NSAI foundation: the `domain_blueprints` / `canvas_nodes` / `canvas_edges` migration, shared TypeScript types for blueprints and canvas operations, and the `blueprint-loader.ts` module with Ajv + Zod double-validation. The structural design is deliberate and well-commented, but four critical defects require remediation before shipping. The most severe is the `VERCEL=1` env bypass in `env.ts` that silently supplies a zero-value encryption key at Vercel runtime (not just build time). The SQL migration ships canvas RLS policies that any authenticated user can satisfy regardless of session membership, with UPDATE policies also missing `WITH CHECK`. The Ajv schema omits `minItems: 1` on the three array fields that Zod enforces with `.min(1)`, weakening the first validation gate. Five warnings cover the missing `updated_at` triggers, the misleading validator cache design, missing nested `additionalProperties: false`, an unconstrained `confidence` number field, and a dead `NEXT_PHASE` guard in an API-only file.

---

## Critical Issues

### CR-01: `VERCEL=1` env bypass fires at Vercel runtime, not only during build — silently installs zero encryption key

**File:** `apps/api/src/lib/env.ts:48-57`

**Issue:** `process.env.VERCEL` is set to `'1'` by Vercel on **every invocation** — build and runtime alike. When any required env var (including `KEY_ENCRYPTION_SECRET`) is absent from the Vercel project's environment settings, the API silently substitutes `'0'.repeat(64)` as the encryption key and empty strings for Supabase credentials, then proceeds to serve production traffic. Only one `console.warn` fires at module load; subsequent requests show no indication anything is wrong. A deployer who forgets to set `KEY_ENCRYPTION_SECRET` in the Vercel dashboard will run live sessions with a known-value key that makes all encrypted API keys trivially decryptable by anyone who has read this source file.

The `NEXT_PHASE === 'phase-production-build'` check is the correct signal — it is a Next.js-specific variable set only during `next build`. However, `apps/api` is a Hono server, not a Next.js app; `NEXT_PHASE` will never be set for it, so `VERCEL=1` is the **only** active escape path.

**Fix:** Remove the `VERCEL=1` arm entirely from `apps/api/src/lib/env.ts`. The Hono API must always have valid env vars:

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

If a shared `env.ts` is needed for `apps/web` (Next.js), keep the `NEXT_PHASE` guard only in that copy.

---

### CR-02: Canvas RLS policies allow any authenticated user to read and write any session's canvas

**File:** `supabase/migrations/0008_nsai_foundation.sql:75-88, 115-128`

**Issue:** All SELECT, INSERT, and UPDATE policies on `canvas_nodes` and `canvas_edges` use `auth.uid() IS NOT NULL` as the sole predicate. This means any authenticated user — including anonymous guests from completely unrelated sessions — can read every canvas node and edge in the system and insert or update nodes into sessions they are not participants of. Session isolation is fully absent. Compare `messages_insert` from migration 0001, which checks `auth.uid() = author_id` and that the session is active. Canvas data is equally session-scoped and requires the same protection.

**Fix:** Scope policies to session membership. At minimum, restrict writes to sessions that exist and are active:

```sql
-- Drop and replace:
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
```

Apply the same pattern to `canvas_edges`. When a participant/membership table is added in a later phase, add it to the EXISTS subquery.

---

### CR-03: Canvas UPDATE policies missing `WITH CHECK` — FK fields can be mutated to foreign sessions

**File:** `supabase/migrations/0008_nsai_foundation.sql:85-88, 125-128`

**Issue:** The `canvas_nodes_update` and `canvas_edges_update` policies both use `USING (auth.uid() IS NOT NULL)` with no `WITH CHECK` clause. In PostgreSQL RLS, `USING` on UPDATE gates which rows can be targeted; `WITH CHECK` validates the new row values after the update is applied. Without `WITH CHECK`, an authenticated user who can select a node can update its `session_id` or `branch_id` to point to a session they do not own — transplanting canvas state between sessions. The migration comment references T-05-06 as requiring `WITH CHECK` for canvas writes, but UPDATE policies do not implement it.

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

When CR-02 is fixed with session-scoped predicates, the `WITH CHECK` expression should mirror that stronger condition.

---

### CR-04: Ajv schema omits `minItems: 1` on `node_types`, `edge_types`, and `phase_sequence`

**File:** `apps/api/src/lib/blueprint-loader.ts:37-76`

**Issue:** `BlueprintSchema` in `packages/types/src/blueprint.ts:61-63` enforces `.min(1)` on all three array fields. The Ajv JSON Schema in `blueprint-loader.ts` applies no `minItems` constraint to any of them. A blueprint stored with an empty `node_types: []` passes Ajv validation and then throws an uncaught `ZodError` rather than the documented `"Blueprint <id> failed Ajv validation"` error. Any Phase 6 code path that does an Ajv-only check and then reads `phase_sequence[0]` without a length guard would access `undefined` — a silent crash risk once callers start building on this loader's API contract.

**Fix:** Add `minItems: 1` to the three array properties:

```typescript
node_types: {
  type: "array",
  minItems: 1,   // matches BlueprintSchema .min(1)
  items: { ... }
},
edge_types: {
  type: "array",
  minItems: 1,
  items: { ... }
},
phase_sequence: {
  type: "array",
  minItems: 1,
  items: { ... }
},
```

---

## Warnings

### WR-01: `canvas_nodes` and `canvas_edges` `updated_at` columns have no auto-update trigger

**File:** `supabase/migrations/0008_nsai_foundation.sql:68, 108`

**Issue:** Both canvas tables declare `updated_at timestamptz NOT NULL DEFAULT now()`. Migration 0001 defined `public.set_updated_at()` and applied it to `sessions` and `creator_settings` with `BEFORE UPDATE` triggers. Migration 0008 creates neither trigger. After any UPDATE on a canvas row, `updated_at` remains frozen at the row's insertion timestamp. Code that uses `updated_at` for change detection, ordering, or Supabase Realtime subscription filters will silently receive stale data.

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

### WR-02: `validatorCache` maps every blueprint ID to the same `ValidateFunction` — misleading design

**File:** `apps/api/src/lib/blueprint-loader.ts:98-112`

**Issue:** Every entry in `validatorCache` stores the exact same `blueprintValidator` reference. The cache provides no per-blueprint isolation and no compile-time savings (compilation already happens at module load). The structure implies per-blueprint validators but delivers none. If a future developer adds per-blueprint dynamic schema validation (e.g., validating `CanvasOp.node_type_id` against the blueprint's own `node_types[].id` list), they might incorrectly assume the cache already handles that concern.

**Fix:** Remove `validatorCache` and `getValidator()` entirely and call `blueprintValidator` directly:

```typescript
// Remove: const validatorCache and function getValidator()

// In loadBlueprint():
const valid = blueprintValidator(data.definition);
if (!valid) {
  throw new Error(
    `Blueprint ${blueprintId} failed Ajv validation: ${JSON.stringify(blueprintValidator.errors)}`
  );
}
```

---

### WR-03: `additionalProperties: false` is only at the root level — nested item objects accept unknown fields

**File:** `apps/api/src/lib/blueprint-loader.ts:20, 77`

**Issue:** The root Blueprint object has `additionalProperties: false`, but the item schemas for `node_types`, `edge_types`, and `phase_sequence` do not. Extra fields inside nested objects (e.g., `node_types[].deprecated_field`) pass Ajv validation undetected. The comment on line 20 claims `additionalProperties: false` prevents unknown fields, which is only true at the top level.

**Fix:** Add `additionalProperties: false` to each item schema:

```typescript
node_types: {
  type: "array",
  items: {
    type: "object",
    required: ["id", "label", "color", "description"],
    properties: { id: ..., label: ..., color: ..., description: ... },
    additionalProperties: false,
  },
},
// Repeat for edge_types and phase_sequence items
```

---

### WR-04: `CanvasOp` `confidence` field is unconstrained — out-of-range values will pass validation

**File:** `packages/types/src/canvas.ts:67, 74`

**Issue:** The comments on `confidence` explicitly state it is `0.0–1.0` and that Phase 6 `MutationGateNode` routes on it to determine `committed` / `ghost` / `silent` status. The Zod schema uses plain `z.number()` with no `min(0).max(1)`. An LLM emitting `confidence: 1.5` or `confidence: -0.1` passes schema validation. Depending on how Phase 6 gate logic is written (e.g., `if (confidence < 0.5) return 'ghost'`), out-of-range values could produce unexpected status routing without any schema error.

**Fix:**

```typescript
confidence: z.number().min(0).max(1), // 0.0–1.0 as documented in comments
```

Apply to both `ADD_NODE` and `ADD_EDGE` arms of the discriminated union.

---

### WR-05: `loadBlueprint()` masks real database errors as "Blueprint not found"

**File:** `apps/api/src/lib/blueprint-loader.ts:135-136`

**Issue:** `if (error || !data)` throws the same `"Blueprint not found: <id>"` error for every Supabase error — including network timeouts, authentication failures (wrong service role key), and internal PostgREST errors. A real connectivity failure is indistinguishable from a missing row in logs and in caller-facing error messages. This makes diagnosing production incidents significantly harder.

**Fix:** Distinguish the row-not-found case (PostgREST error code `PGRST116`) from real errors:

```typescript
if (error) {
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
```

---

## Info

### IN-01: `@google/genai` and `openai` are production dependencies — contradicts v1 constraint

**File:** `apps/api/package.json:14, 23`

**Issue:** `@google/genai: ^2.8.0` and `openai: ^6.44.0` appear in `dependencies` (not `devDependencies`). CLAUDE.md states Claude API is the only AI provider in v1. Both packages are unused in the reviewed files. They increase bundle size, supply-chain attack surface, and float on caret ranges that may pull breaking changes silently. If these are pre-loaded for Phase 6 multi-provider work, they belong in a feature branch or behind a documented extension point, not in production dependencies.

**Fix:** Remove from `dependencies` until actually needed. If future-proofing is desired, move to `devDependencies` and document the intent.

---

### IN-02: `verify-blueprint-loader.ts` Test C labels a double DB round-trip as a "cache hit"

**File:** `apps/api/src/scripts/verify-blueprint-loader.ts:67-78`

**Issue:** Test C is labeled "Caching — second call must succeed (no crash; cache hit)" and prints "PASS: second loadBlueprint call succeeded (cache hit)." In reality, `loadBlueprint()` makes a full database round-trip on every call — only the Ajv `ValidateFunction` is cached, not the blueprint data. The test verifies that a second DB call returns the same `id`, not that any data is served from cache. This is misleading for future maintainers who may assume blueprint data is memoized.

**Fix:** Rename the test to reflect what it actually tests:

```typescript
// Test C: Idempotency — second call makes a second DB round-trip and returns the same blueprint
```

---

### IN-03: `@anthropic-ai/sdk` in `apps/web` production dependencies

**File:** `apps/web/package.json:17`

**Issue:** The Anthropic SDK is a production dependency in the Next.js frontend. The project architecture routes all AI calls through the Hono API backend; the browser should never hold an Anthropic API key or instantiate an Anthropic client. Shipping the SDK in the frontend bundle adds dead weight and creates a footgun if a future developer assumes they can call the Anthropic API from client components. If the SDK is imported only for type definitions, those types should live in `@panelito/types`.

**Fix:** Audit with `grep -r "@anthropic-ai/sdk" apps/web/src/`. If no browser-executed code uses it, remove it from `apps/web/package.json`. If needed for shared types, move those to `@panelito/types` and use `import type`.

---

_Reviewed: 2026-07-01T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
