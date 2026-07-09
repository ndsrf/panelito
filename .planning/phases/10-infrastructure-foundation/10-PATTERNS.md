# Phase 10: Infrastructure Foundation - Pattern Map

**Mapped:** 2026-07-09
**Files analyzed:** 7 (3 new, 4 modified)
**Analogs found:** 7 / 7

## CRITICAL: Migration Numbering Correction

CONTEXT.md says `0009_bot_infrastructure.sql` — that number is already taken.
The latest migration is `0011_ghost_expiry.sql`. The correct filename is:

  `supabase/migrations/0012_bot_infrastructure.sql`

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/0012_bot_infrastructure.sql` | migration | batch | `supabase/migrations/0010_mic_lock.sql` | exact |
| `apps/api/src/lib/bot-arbitrator.ts` | service | request-response | `apps/api/src/lib/cap-guard.ts` | role-match |
| `packages/types/src/bot.ts` (new) | type definition | — | `packages/types/src/canvas.ts` | exact |
| `packages/types/src/index.ts` | config | — | itself | exact (modify) |
| `apps/api/src/graph/state.ts` | model | — | itself | exact (extend) |
| `apps/api/src/routes/ai.ts` line 344 | route | request-response | itself | exact (1-line change) |
| `apps/api/src/lib/langgraph-checkpointer.ts` | service | — | itself | read-only reference |

---

## Pattern Assignments

### `supabase/migrations/0012_bot_infrastructure.sql` (migration, batch)

**Analog:** `supabase/migrations/0010_mic_lock.sql`

**File header pattern** (lines 1–9 of 0010_mic_lock.sql):
```sql
-- Migration: 0010_mic_lock
-- Adds mic lock columns to the branches table and two RPC functions for atomic
-- lock acquisition and release (HUMAN-01 — Mic Check Pattern).
--
-- Design: The lock is enforced at DB level, not application level, because two
-- near-simultaneous /invoke calls on serverless can race. The Postgres
-- UPDATE ... WHERE ... RETURNING pattern in try_acquire_mic provides atomic
-- compare-and-set — if the WHERE clause matches nothing, no UPDATE happens and
-- FOUND is false (same pattern as increment_ai_count in migration 0003).
```

**Table creation pattern** (from `0008_nsai_foundation.sql` lines 33–38):
```sql
CREATE TABLE public.domain_blueprints (
  id          text        PRIMARY KEY,
  name        text        NOT NULL,
  definition  jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

**Section comment divider pattern** (0010_mic_lock.sql lines 14–16):
```sql
-- ---------------------------------------------------------------------------
-- SECTION 1: Add mic lock columns to branches table
-- ---------------------------------------------------------------------------
```

**Atomic compare-and-set RPC pattern** (0010_mic_lock.sql lines 32–62 — the reference for `try_acquire_bot_lock`):
```sql
create or replace function public.try_acquire_mic(
  p_branch_id     uuid,
  p_holder_id     text,
  p_expiry_seconds int DEFAULT 30
)
returns table(acquired boolean, held_since timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  UPDATE public.branches
  SET
    mic_holder_id   = p_holder_id,
    mic_acquired_at = now()
  WHERE id = p_branch_id
    AND (
      mic_holder_id IS NULL
      OR mic_acquired_at < (now() - (p_expiry_seconds || ' seconds')::interval)
    );

  IF FOUND THEN
    RETURN QUERY SELECT true, now();
  ELSE
    RETURN QUERY
      SELECT false, b.mic_acquired_at
      FROM public.branches b
      WHERE b.id = p_branch_id;
  END IF;
end;
$$;
```

**Release/void RPC pattern** (0010_mic_lock.sql lines 68–79 — the reference for circuit state reset):
```sql
create or replace function public.release_mic(p_branch_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  UPDATE public.branches
  SET
    mic_holder_id   = NULL,
    mic_acquired_at = NULL
  WHERE id = p_branch_id;
$$;
```

**Grant pattern** (0010_mic_lock.sql lines 85–86):
```sql
grant execute on function public.try_acquire_mic(uuid, text, int) to service_role;
grant execute on function public.release_mic(uuid) to service_role;
```

**What to build in 0012_bot_infrastructure.sql:**

SECTION 1: `bot_arbitration` table — `(id uuid PK, branch_id uuid FK→branches, locked_until timestamptz, winner_bot_id text, created_at timestamptz)`

SECTION 2: `bot_budget_ledger` table — `(id uuid PK, branch_id uuid FK→branches, invoked_at timestamptz, tokens_used int, created_at timestamptz)`. Append-only.

SECTION 3: `bot_circuit_state` table — `(branch_id uuid PK FK→branches, circuit_open boolean NOT NULL DEFAULT false, reset_at timestamptz, updated_at timestamptz)`. One row per branch, upserted.

SECTION 4: `try_acquire_bot_lock(p_branch_id uuid, p_bot_id text, p_locked_until timestamptz)` RPC — atomic UPDATE WHERE locked_until < NOW() pattern (same structure as try_acquire_mic). Returns `table(acquired boolean)`.

SECTION 5: `release_bot_lock(p_branch_id uuid)` RPC — void, same structure as release_mic.

SECTION 6: `check_and_record_bot_budget(p_branch_id uuid, p_tokens_used int)` RPC — complex plpgsql: check circuit state, sum 5-minute window, insert ledger row, trip circuit if over threshold (read budget threshold from sessions table). Returns `table(allowed boolean, circuit_open boolean, tokens_used_window bigint)`.

SECTION 7: Grant execute on all 3 RPCs to service_role only (no participant reads needed, consistent with mic lock table).

All 3 tables: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` with service_role-only access (no SELECT policy for authenticated users — these are server-side only).

---

### `apps/api/src/lib/bot-arbitrator.ts` (service, request-response)

**Primary analog:** `apps/api/src/lib/cap-guard.ts`
**Secondary analog:** `apps/api/src/lib/langgraph-checkpointer.ts` (singleton Promise pattern)

**File header pattern** (cap-guard.ts lines 1–15):
```typescript
/**
 * cap-guard.ts — AI response cap check + warning thresholds (SESS-12).
 *
 * checkCap: reads sessions.ai_response_count + .ai_response_cap.
 *           Returns { ok: false, reason: 'cap_reached' } when count >= cap.
 *
 * incrementCount: atomic increment via Postgres RPC function `increment_ai_count`.
 *                 Determines threshold:
 *                 - 'warning'  → count just crossed 90% of cap.
 *                 - 'cap'      → count just reached 100% of cap → freeze + system message.
 *                 - null       → normal increment, no threshold crossed.
 *
 * T-07-02: Uses a Postgres function for atomic increment to prevent race conditions
 * in concurrent invocations.
 */
```

**Import pattern** (cap-guard.ts lines 17–18):
```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import { freezeSession, SYSTEM_AUTHOR_ID, SYSTEM_DISPLAY_NAME } from './sessions-helpers'
```

**Result union type pattern** (cap-guard.ts lines 24–26):
```typescript
export type CapCheckResult =
  | { ok: true }
  | { ok: false; reason: 'cap_reached' }
```

**Supabase RPC call pattern** (cap-guard.ts lines 81–82):
```typescript
const { data, error } = await supabase.rpc('increment_ai_count', { s_id: sessionId })

if (error || !data || !Array.isArray(data) || data.length === 0) {
  console.error('[cap-guard] incrementCount rpc error:', error?.message)
  // ... fallback ...
}
```

**Singleton Promise pattern** (langgraph-checkpointer.ts lines 34–76 — for module-level registry state):
```typescript
let _checkpointerPromise: Promise<PostgresSaver> | null = null

export function getCheckpointer(): Promise<PostgresSaver> {
  if (!_checkpointerPromise) {
    _checkpointerPromise = (async () => {
      // ... initialization ...
      return saver
    })()
  }
  return _checkpointerPromise
}
```

**What to build in bot-arbitrator.ts:**

```typescript
/**
 * bot-arbitrator.ts — Central bot arbitration module (BOT-02).
 *
 * Plugin registry: bots self-register via registerBot(botId, scorerFn).
 * runArbitration: scores all registered bots, acquires the arbitration lock for
 * the winner, returns the winner bot ID or null (no bots registered / all fail).
 *
 * In Phase 10, the registry is empty — runArbitration short-circuits to null.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Blueprint } from '@panelito/types'

export interface ArbContext {
  branchId: string
  blueprint: Blueprint
  supabase: SupabaseClient
}

type ScorerFn = (context: ArbContext) => number

/** Module-level plugin registry — populated by bot module imports in Phase 11+. */
const _registry = new Map<string, ScorerFn>()

export function registerBot(botId: string, scorer: ScorerFn): void {
  _registry.set(botId, scorer)
}

export async function runArbitration(
  branchId: string,
  blueprint: Blueprint,
  supabase: SupabaseClient
): Promise<string | null> {
  if (_registry.size === 0) return null   // Phase 10: no bots registered

  const context: ArbContext = { branchId, blueprint, supabase }

  // Score all registered bots, pick highest
  let winnerId: string | null = null
  let highScore = -Infinity
  for (const [botId, scorer] of _registry) {
    const score = scorer(context)
    if (score > highScore) { highScore = score; winnerId = botId }
  }
  if (!winnerId) return null

  // Try to acquire the bot lock for the winner
  const lockedUntil = new Date(Date.now() + /* cooldown from blueprint */ 0)
  const { data, error } = await supabase.rpc('try_acquire_bot_lock', {
    p_branch_id: branchId,
    p_bot_id: winnerId,
    p_locked_until: lockedUntil.toISOString(),
  })
  if (error || !data?.[0]?.acquired) {
    console.warn('[bot-arbitrator] lock not acquired:', error?.message)
    return null
  }
  return winnerId
}
```

Logging prefix: `[bot-arbitrator]` (consistent with `[cap-guard]`, `[langgraph-checkpointer]`, `[auto-freeze]`).

---

### `packages/types/src/bot.ts` (new type file)

**Analog:** `packages/types/src/canvas.ts`

**File structure pattern** (canvas.ts lines 1–87):

```typescript
import { z } from "zod";

// -------------------------------------------------------
// TypeName — description of what this type models
// -------------------------------------------------------

export const TypeNameSchema = z.object({
  field: z.string(),
  // ...
});

export type TypeName = z.infer<typeof TypeNameSchema>;
```

**What to define in bot.ts:**

```typescript
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
// -------------------------------------------------------

export const TriggerMetadataEntrySchema = z.object({
  last_fired_at: z.string().nullable(),
  cooldown_until: z.string().nullable(),
});

export const TriggerMetadataSchema = z.record(z.string(), TriggerMetadataEntrySchema);

export type TriggerMetadataEntry = z.infer<typeof TriggerMetadataEntrySchema>;
export type TriggerMetadata = z.infer<typeof TriggerMetadataSchema>;
```

---

### `packages/types/src/index.ts` (modify — add bot.ts exports)

**Pattern:** Append a new block to the end of the existing export list. Follow the exact comment style of existing blocks (lines 61–67 of index.ts):

```typescript
// Canvas types + schemas (CanvasNode, CanvasEdge, CanvasOp — CANVAS-01, INFRA-03)
export type { CanvasNode, CanvasEdge, CanvasOp, CanvasNodeStatus } from "./canvas";
export { CanvasNodeSchema, CanvasEdgeSchema, CanvasOpSchema, CanvasNodeStatusSchema } from "./canvas";

// Blueprint types + schemas (Blueprint, sub-schemas — BLUE-01, INFRA-03)
export type { Blueprint, NodeTypeConfig, EdgeTypeConfig, PhaseSequence } from "./blueprint";
export { BlueprintSchema, NodeTypeConfigSchema, EdgeTypeConfigSchema, PhaseSequenceSchema } from "./blueprint";
```

**Add after these lines:**

```typescript
// Bot infrastructure types + schemas (ArgNode, ArgEdge, BotBudgetResult, TriggerMetadata — BOT-01, BOT-02, BOT-05)
export type { ArgNode, ArgEdge, BotBudgetResult, TriggerMetadata, TriggerMetadataEntry } from "./bot";
export { ArgNodeSchema, ArgEdgeSchema, BotBudgetResultSchema, TriggerMetadataSchema, TriggerMetadataEntrySchema } from "./bot";
```

---

### `apps/api/src/graph/state.ts` (modify — add argGraph and triggerMetadata fields)

**Analog:** itself — extend the existing `GraphStateAnnotation`.

**Existing overwrite-style field pattern** (state.ts lines 51–55 — the reducer pattern to copy for new fields):
```typescript
guardrailResult: Annotation<'DOMAIN_MATCH' | 'DOMAIN_BRIDGE' | 'DOMAIN_DRIFT' | null>({
  reducer: (_: 'DOMAIN_MATCH' | 'DOMAIN_BRIDGE' | 'DOMAIN_DRIFT' | null, v: 'DOMAIN_MATCH' | 'DOMAIN_BRIDGE' | 'DOMAIN_DRIFT' | null) => v,
  default: () => null,
}),
```

**Existing accumulator-style field pattern** (state.ts lines 30–34 — the reducer pattern for canvasOps, which argGraph nodes/edges will also accumulate):
```typescript
canvasOps: Annotation<CanvasOp[]>({
  reducer: (left: CanvasOp[], right: CanvasOp | CanvasOp[]) =>
    left.concat(Array.isArray(right) ? right : [right]),
  default: () => [],
}),
```

**Import line to extend** (state.ts line 14):
```typescript
import type { ProviderMessage, CanvasOp } from '@panelito/types'
```
Change to:
```typescript
import type { ProviderMessage, CanvasOp, ArgNode, ArgEdge, TriggerMetadata } from '@panelito/types'
```

**New fields to add** (insert after `phase_signal` field, before the closing `}`):
```typescript
// -------------------------------------------------------------------------
// Bot infrastructure fields (Phase 10 — BOT-05)
// -------------------------------------------------------------------------

/** Argument graph accumulated by ArgGraphBuilderNode (Phase 11).
 *  Overwrite-style: each invocation replaces the full graph.
 *  Default: empty graph — safe for human thread invocations that never populate it. */
argGraph: Annotation<{ nodes: ArgNode[]; edges: ArgEdge[] }>({
  reducer: (_: { nodes: ArgNode[]; edges: ArgEdge[] }, v: { nodes: ArgNode[]; edges: ArgEdge[] }) => v,
  default: () => ({ nodes: [], edges: [] }),
}),

/** Trigger metadata map keyed by trigger type (e.g. 'silence_gate').
 *  Overwrite-style: trigger implementations replace specific keys in Phase 11+.
 *  Default: empty record — safe for human thread invocations. */
triggerMetadata: Annotation<TriggerMetadata>({
  reducer: (_: TriggerMetadata, v: TriggerMetadata) => v,
  default: () => ({}),
}),
```

---

### `apps/api/src/routes/ai.ts` line 344 (modify — dual thread_id)

**Pattern:** One-line change. Context surrounding the change (ai.ts lines 341–353):
```typescript
// --- graph.astream config (D-05, D-10, D-14, ORCH-05) ---
const graphConfig = {
  configurable: {
    thread_id: activeBranchId ?? sessionId,  // ORCH-05: thread_id = branch_id (RESEARCH Pitfall 5)
    blueprint,
    providerName,
    plaintextKey,
    activePersonas: activePersonaInstructions,
    streamWriter,
  },
  callbacks: [callbackHandler],
  signal: c.req.raw.signal,
}
```

Change line 344 only:
```typescript
thread_id: `${activeBranchId ?? sessionId}:human`,  // BOT-04: dual thread_id — human thread
```

Update the inline comment on line 344 (ORCH-05 comment) to reference BOT-04.

---

## Shared Patterns

### Supabase RPC call + error guard
**Source:** `apps/api/src/routes/ai.ts` lines 299–311 (mic lock acquire) and `apps/api/src/lib/cap-guard.ts` lines 81–98
**Apply to:** `bot-arbitrator.ts` for all RPC calls

```typescript
const { data: result, error } = await supabase.rpc('rpc_name', { p_param: value })
if (error || !result?.[0]) {
  console.error('[bot-arbitrator] rpc_name error:', error?.message)
  return null  // or appropriate fallback
}
```

### Logging prefix convention
**Source:** All lib files use `[module-name]` prefixes. Examples:
- `[langgraph-checkpointer]` — langgraph-checkpointer.ts
- `[cap-guard]` — cap-guard.ts
- `[auto-freeze]` — auto-freeze.ts
- `[ai]` — routes/ai.ts

**Apply to:** `bot-arbitrator.ts` must use `[bot-arbitrator]` prefix on all console.log/warn/error calls.

### Zod schema + type pattern
**Source:** `packages/types/src/canvas.ts`, `packages/types/src/blueprint.ts`
**Apply to:** All new type definitions in `packages/types/src/bot.ts`

Rule: every exported type has a co-located Zod schema. Export both the schema (`ArgNodeSchema`) and the inferred type (`ArgNode`). Pattern: `export type X = z.infer<typeof XSchema>`.

### security definer + set search_path for all RPCs
**Source:** `supabase/migrations/0010_mic_lock.sql` lines 39–40
```sql
language plpgsql
security definer
set search_path = public
```
**Apply to:** All 3 RPCs in `0012_bot_infrastructure.sql`. This is non-negotiable for Supabase PostgREST security.

### RLS — service_role only (no user access)
**Source:** The mic lock tables are accessed only via RPC (security definer), not directly. Bot tables follow the same pattern: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` with no permissive SELECT policy for authenticated users, meaning only service_role (which bypasses RLS) can access them directly.

---

## No Analog Found

No files are without an analog. All patterns have direct codebase equivalents.

---

## Metadata

**Analog search scope:** `apps/api/src/`, `packages/types/src/`, `supabase/migrations/`
**Files scanned:** 11 (migrations), 48 (api/src), 15 (packages/types/src)
**Pattern extraction date:** 2026-07-09
