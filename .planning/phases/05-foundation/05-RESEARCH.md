# Phase 5: Foundation - Research

**Researched:** 2026-07-01
**Domain:** LangGraph JS infrastructure, Ajv schema validation, Supabase migrations, Vercel monorepo config
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Blueprint JSON Schema**
- D-01: Blueprint shape: `{ id, name, canvas_view_mode, node_types[], edge_types[], phase_sequence[], active_persona_ids[] }`
- D-02: `node_types[]` entry: `{ id, label, color, description }` — description feeds LangGraph AgentNode system prompt
- D-03: `edge_types[]` entry: `{ id, label, color }` — no description field
- D-04: `phase_sequence[]` entry: `{ id, label, llm_instructions, allowed_node_types[] }`
- D-05: `active_persona_ids[]` is `string[]` referencing persona ids from `PERSONA_LIBRARY`; no persona config embedded in Blueprint
- D-06: Blueprints are platform-global; no `creator_id` FK; readable by all authenticated users, writable only by service role
- D-07: `sessions.blueprint_id` is NOT NULL FK to `domain_blueprints`; migration 0008 truncates `sessions` (cascade) before adding constraint

**Debate/Strategy Blueprint Seed**
- D-08: Node types: `Hypothesis`, `Evidence`, `Counter-Argument`, `Action` (distinct colors/descriptions)
- D-09: Edge types: `SUPPORTS`, `CONTRADICTS`, `BUILDS_ON`, `REFUTES`
- D-10: `canvas_view_mode: "graph"`

**vercel.json Runtime Config**
- D-11: All `/api/*` routes declared as Node.js runtime (not Edge) in `vercel.json`
- D-12: `maxDuration: 60` — configured in vercel.json (see research note on actual Hobby tier limits)
- D-13: Single unified Vercel project for the entire Turborepo; one `vercel.json` at monorepo root

**LangGraph Checkpointer Tables**
- D-14: Migration 0008 creates `langgraph` schema AND checkpointer tables with explicit SQL
- D-15: `checkpointer.setup()` called at runtime (bootstrap/server startup), no-op when tables exist
- D-16: `SUPABASE_DIRECT_URL` is a new env var; researcher determines exact format

### Claude's Discretion

- Exact Debate Blueprint `phase_sequence` definition (phases, llm_instructions, allowed_node_types)
- Exact `vercel.json` structure for the Turborepo monorepo
- Whether checkpointer table SQL goes in migration 0008 or a separate 0009

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | Install LangGraph JS, Langfuse, Ajv, Postgres checkpointer (apps/api), @xyflow/react (apps/web); declare Hono routes as Node.js runtime in vercel.json with maxDuration | Package names and versions verified; vercel.json pattern documented |
| INFRA-02 | Three new Supabase tables (canvas_nodes, canvas_edges, domain_blueprints) + LangGraph checkpointer tables with RLS | Migration SQL patterns; checkpointer schema documented |
| INFRA-03 | CanvasNode, CanvasEdge, Blueprint, CanvasOp types in @panelito/types | Existing type/Zod pattern documented; Blueprint shape fully decided |
| BLUE-01 | Creator can select Blueprint for session; Blueprint defines node/edge vocab, personas, phase sequence, canvas_view_mode | Blueprint type shape locked in D-01 through D-06 |
| BLUE-02 | Blueprint validated against Ajv meta-schema at API load; compiled validators cached per blueprintId — never per request | Ajv module-level Map<string, ValidateFunction> pattern documented |
| BLUE-05 | Debate/Strategy Blueprint seeded as first production domain | D-08, D-09, D-10 fully specify the seed; SQL seed pattern documented |
| CANVAS-01 | Universal CanvasNode + CanvasEdge schema; status field (committed/ghost/silent) controls rendering | Type shape designed per REQUIREMENTS.md |

</phase_requirements>

---

## Summary

Phase 5 is a pure infrastructure phase — no LangGraph execution, no agent code. It installs six new packages, creates a Supabase migration for five new tables plus the LangGraph schema, publishes four TypeScript types to `@panelito/types`, seeds the first production Blueprint, and wires vercel.json for Node.js maxDuration.

The most critical finding from research is a **package naming correction**: the Langfuse integration package for LangGraph is `@langfuse/langchain` (version 5.9.1, from the `langfuse/langfuse-js` monorepo), NOT `langfuse-langchain`. The `langfuse-langchain` package requires `langchain@0.3.x` which forces `@langchain/core@^0.3.x`, directly conflicting with `@langchain/langgraph@1.4.7` which requires `@langchain/core@^1.1.48`. Using `@langfuse/langchain` avoids this conflict because its peer dep is `@langchain/core>=0.3.8`, satisfied by `@langchain/core@1.2.1`.

The second key finding is about vercel.json: the project **already has** a Hono → Next.js bridge at `apps/web/app/api/[[...route]]/route.ts` with `export const runtime = "nodejs"`. The Node.js runtime is already declared per-route. What is missing from vercel.json is only the `maxDuration` configuration and a `buildCommand` for the Turborepo.

**Primary recommendation:** Install packages in the correct workspaces, write migration 0008 as a single SQL file covering all five tables plus the `langgraph` schema, and implement the Blueprint loader as a module-level Ajv singleton keyed by blueprintId.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Blueprint storage | Database (Supabase) | — | domain_blueprints table with service-role-only write; global platform data |
| Blueprint validation | API / Backend | — | Ajv compiled at module load in `apps/api/src/lib/blueprint-loader.ts` |
| Blueprint loading per request | API / Backend | — | Loader reads from Supabase, validates, returns typed Blueprint object |
| CanvasNode / CanvasEdge types | Shared (@panelito/types) | — | Consumed by both API (mutation writes) and web (rendering); must not duplicate |
| LangGraph checkpointer tables | Database (Supabase) | — | Postgres schema `langgraph`; tables created via migration SQL + setup() no-op at runtime |
| vercel.json runtime config | Infrastructure | — | Next.js bridge route already declares `runtime = "nodejs"`; vercel.json adds maxDuration |
| @xyflow/react dependency | Frontend (apps/web) | — | Canvas rendering is client-only; installed only in apps/web |

---

## Standard Stack

### Core — New Packages for Phase 5

| Library | Version | Purpose | Why Standard | Install Target |
|---------|---------|---------|--------------|----------------|
| `@langchain/langgraph` | 1.4.7 | LangGraph StateGraph, nodes, channels | Official LangGraph JS package from langchain-ai | `apps/api` |
| `@langchain/langgraph-checkpoint-postgres` | 1.0.4 | PostgresSaver for cross-request state persistence | Official LangGraph checkpointer from langchain-ai | `apps/api` |
| `@langfuse/langchain` | 5.9.1 | Per-request CallbackHandler for LangGraph traces | Official Langfuse LangChain integration; avoids langchain@0.3 conflict | `apps/api` |
| `ajv` | 8.20.0 | JSON Schema validation; meta-schema Blueprint validation | De-facto standard JSON Schema validator; 9+ years on npm | `apps/api` |
| `@xyflow/react` | 12.11.1 | Graph canvas (nodes + edges); replaces legacy `reactflow` | Official xyflow/xyflow React package; `reactflow` is legacy name | `apps/web` |

[VERIFIED: npm registry — all versions confirmed via `npm view <pkg> version` on 2026-07-01]

### Package Name Critical Notes

- `@langfuse/langchain` is the CORRECT package for LangGraph integration — NOT `langfuse-langchain` [VERIFIED: langfuse.com/docs + npm registry]
- `@xyflow/react` is the CURRENT package name — NOT `reactflow` (still exists but is old) [VERIFIED: npm registry]
- `@langchain/langgraph-checkpoint-postgres` is the CORRECT checkpointer package (not `@langchain/langgraph-postgres` or similar) [VERIFIED: npm registry]

### Version Compatibility

| Constraint | Value | Status |
|------------|-------|--------|
| `@langchain/langgraph` peer dep: `@langchain/core` | `^1.1.48` | Required — pulled in automatically |
| `@langchain/langgraph-checkpoint-postgres` peer dep: `@langchain/core` | `^1.1.44` | Satisfied by same `@langchain/core@1.2.1` |
| `@langfuse/langchain` peer dep: `@langchain/core` | `>=0.3.8` | Satisfied by `@langchain/core@1.2.1` ✓ |
| `@langchain/langgraph` peer dep: `zod` | `^3.25.32 \|\| ^4.2.0` | Project uses `zod@4.4.3` — satisfies `^4.2.0` ✓ |

[VERIFIED: npm view peerDependencies for all packages]

### Installation Commands

```bash
# apps/api — LangGraph, checkpointer, Langfuse, Ajv
pnpm --filter @panelito/api add @langchain/langgraph@1.4.7 @langchain/langgraph-checkpoint-postgres@1.0.4 @langfuse/langchain@5.9.1 ajv@8.20.0

# apps/web — @xyflow/react
pnpm --filter @panelito/web add @xyflow/react@12.11.1
```

---

## Package Legitimacy Audit

All packages verified via slopcheck 0.6.1 on 2026-07-01. The initial slopcheck run included `langfuse-langchain` (old conflicting package) — all 6 scanned packages returned `[OK]`. The correct replacement `@langfuse/langchain` was subsequently slopcheck-verified.

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `@langchain/langgraph` | npm | Jan 2024 (2+ yr) | github.com/langchain-ai/langgraphjs | [OK] | Approved |
| `@langchain/langgraph-checkpoint-postgres` | npm | Oct 2024 | github.com/langchain-ai/langgraphjs | [OK] | Approved |
| `@langfuse/langchain` | npm | Aug 2025 | github.com/langfuse/langfuse-js | [OK] | Approved |
| `ajv` | npm | May 2015 (11 yr) | github.com/ajv-validator/ajv | [OK] | Approved |
| `@xyflow/react` | npm | Jan 2024 (2+ yr) | github.com/xyflow/xyflow | [OK] | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**`langfuse-langchain` REMOVED from recommendations:** This package exists on npm and passes slopcheck, but creates an irreconcilable peer dependency conflict with LangGraph 1.x. Use `@langfuse/langchain` instead.

**No postinstall scripts detected** for any recommended package.

---

## Architecture Patterns

### System Architecture Diagram

```
pnpm install (monorepo root)
    ↓
apps/api ← @langchain/langgraph, @langchain/langgraph-checkpoint-postgres
         ← @langfuse/langchain, ajv
         ← @langchain/core (peer, auto-resolved)

apps/web ← @xyflow/react

packages/types ← CanvasNode, CanvasEdge, Blueprint, CanvasOp types added

Supabase migration 0008:
  public.canvas_nodes    (with RLS)
  public.canvas_edges    (with RLS)
  public.domain_blueprints (with RLS, service-role write)
  langgraph.checkpoints
  langgraph.checkpoint_blobs
  langgraph.checkpoint_writes
  TRUNCATE sessions CASCADE → ALTER TABLE sessions ADD COLUMN blueprint_id
  INSERT INTO domain_blueprints ← Debate Blueprint seed

vercel.json (monorepo root):
  buildCommand: "turbo run build"
  functions: { "app/api/[[...route]]/route.ts": { maxDuration: 60 } }

apps/api/src/lib/blueprint-loader.ts:
  Ajv instance (module-level singleton)
  Map<string, ValidateFunction> (module-level cache)
  loadBlueprint(blueprintId) → validates → returns Blueprint
```

### Recommended Project Structure Changes

```
packages/types/src/
├── canvas.ts          # CanvasNode, CanvasEdge, CanvasOp + Zod schemas (NEW)
├── blueprint.ts       # Blueprint type + Zod schema (NEW)
└── index.ts           # Re-export canvas + blueprint types (UPDATED)

apps/api/src/lib/
└── blueprint-loader.ts  # Ajv singleton, Map<string, ValidateFunction>, loadBlueprint() (NEW)

apps/api/src/lib/env.ts  # Add SUPABASE_DIRECT_URL to EnvSchema (UPDATED)

supabase/migrations/
└── 0008_nsai_foundation.sql  # All five tables + langgraph schema + seed (NEW)

vercel.json  # New file at monorepo root (NEW)
```

### Pattern 1: Type + Zod Schema Co-location (existing project convention)

Each type file exports both the Zod schema and the TypeScript type. `index.ts` re-exports with `export type {}` for types and named export for schemas.

```typescript
// packages/types/src/canvas.ts
import { z } from "zod";

export const CanvasNodeStatusSchema = z.enum(["committed", "ghost", "silent"]);
export type CanvasNodeStatus = z.infer<typeof CanvasNodeStatusSchema>;

export const CanvasNodeSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  blueprint_id: z.string(),
  node_type_id: z.string(), // references Blueprint.node_types[].id
  label: z.string(),
  status: CanvasNodeStatusSchema,
  position_x: z.number().nullable(),
  position_y: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;

export const CanvasEdgeSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  blueprint_id: z.string(),
  source_node_id: z.string().uuid(),
  target_node_id: z.string().uuid(),
  edge_type_id: z.string(), // references Blueprint.edge_types[].id
  status: CanvasNodeStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>;

// CanvasOp — the mutation command the LLM emits (Phase 6+)
export const CanvasOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("ADD_NODE"), node_type_id: z.string(), label: z.string(), confidence: z.number() }),
  z.object({ op: z.literal("ADD_EDGE"), source_node_id: z.string().uuid(), target_node_id: z.string().uuid(), edge_type_id: z.string(), confidence: z.number() }),
  z.object({ op: z.literal("NO_ACTION"), reason: z.string().optional() }),
]);
export type CanvasOp = z.infer<typeof CanvasOpSchema>;
```

[ASSUMED — CanvasNode/CanvasEdge field names are Claude's design; not in official docs]

### Pattern 2: Blueprint Type + Zod Schema

```typescript
// packages/types/src/blueprint.ts
import { z } from "zod";

export const NodeTypeSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string(),
  description: z.string(), // Injected into AgentNode system prompt (Phase 6)
});

export const EdgeTypeSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string(),
});

export const PhaseSequenceSchema = z.object({
  id: z.string(),
  label: z.string(),
  llm_instructions: z.string(),
  allowed_node_types: z.array(z.string()), // References NodeType.id values
});

export const BlueprintSchema = z.object({
  id: z.string(),
  name: z.string(),
  canvas_view_mode: z.enum(["graph", "chart"]),
  node_types: z.array(NodeTypeSchema),
  edge_types: z.array(EdgeTypeSchema),
  phase_sequence: z.array(PhaseSequenceSchema),
  active_persona_ids: z.array(z.string()), // References PERSONA_IDS from persona.ts
});

export type Blueprint = z.infer<typeof BlueprintSchema>;
```

[ASSUMED — field names follow D-01 through D-05 decisions exactly]

### Pattern 3: Ajv Blueprint Loader (module-level singleton)

```typescript
// apps/api/src/lib/blueprint-loader.ts
import Ajv, { ValidateFunction } from "ajv";
import { createServiceClient } from "./supabase";
import { Blueprint, BlueprintSchema } from "@panelito/types";

// Module-level singleton — compiled once, never per request (BLUE-02)
const ajv = new Ajv({ allErrors: true });
const validatorCache = new Map<string, ValidateFunction>();

// JSON Schema equivalent of BlueprintSchema — defines the meta-schema
const BLUEPRINT_JSON_SCHEMA = {
  type: "object",
  required: ["id", "name", "canvas_view_mode", "node_types", "edge_types", "phase_sequence", "active_persona_ids"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    canvas_view_mode: { type: "string", enum: ["graph", "chart"] },
    node_types: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "color", "description"],
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
      items: {
        type: "object",
        required: ["id", "label", "color"],
        properties: { id: { type: "string" }, label: { type: "string" }, color: { type: "string" } },
      },
    },
    phase_sequence: { type: "array", items: { type: "object" } },
    active_persona_ids: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

function getValidator(blueprintId: string): ValidateFunction {
  if (!validatorCache.has(blueprintId)) {
    // Compile once per blueprintId; cache forever for the process lifetime
    validatorCache.set(blueprintId, ajv.compile(BLUEPRINT_JSON_SCHEMA));
  }
  return validatorCache.get(blueprintId)!;
}

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
      `Blueprint ${blueprintId} failed validation: ${JSON.stringify(validate.errors)}`
    );
  }

  return BlueprintSchema.parse(data.definition);
}
```

[ASSUMED — `domain_blueprints.definition` column name; schema structure is Claude's design]
[CITED: ajv.js.org/guide/managing-schemas.html — module-level compile-once pattern]

### Pattern 4: PostgresSaver Init (decision D-15)

```typescript
// apps/api/src/lib/langgraph-checkpointer.ts (Phase 6, but schema set up in Phase 5)
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { env } from "./env";

// Singleton checkpointer — one instance per process
let _checkpointer: PostgresSaver | null = null;

export async function getCheckpointer(): Promise<PostgresSaver> {
  if (!_checkpointer) {
    _checkpointer = PostgresSaver.fromConnString(env.SUPABASE_DIRECT_URL, {
      schema: "langgraph",
    });
    // setup() is idempotent — runs migrations if tables don't exist,
    // becomes a near-no-op if they do (migration version check only).
    // Because migration 0008 pre-creates the tables, this will be a no-op at runtime.
    await _checkpointer.setup();
  }
  return _checkpointer;
}
```

[CITED: reference.langchain.com/javascript/classes/_langchain_langgraph-checkpoint-postgres — fromConnString + setup()]

### Pattern 5: vercel.json for Turborepo + Hono bridge

**Key discovery:** The project already uses `hono/vercel` bridge at `apps/web/app/api/[[...route]]/route.ts` with `export const runtime = "nodejs"`. The Node.js runtime declaration is already in place per-route. The vercel.json only needs to add `maxDuration` and ensure Turborepo builds correctly.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "turbo run build",
  "functions": {
    "apps/web/app/api/[[...route]]/route.ts": {
      "maxDuration": 60
    }
  }
}
```

**Alternative glob pattern if route file detection differs:**
```json
{
  "functions": {
    "app/api/[[...route]]/route.ts": {
      "maxDuration": 60
    }
  }
}
```

**Important note on maxDuration D-12:** Decision D-12 specifies `maxDuration: 60`. Vercel Hobby tier actual limit (as of 2026-06-17 docs) is 300 seconds. Setting 60 is valid and conservative — any value ≤ 300 is accepted on Hobby. The decision is intentionally conservative to avoid runaway streaming costs. [CITED: vercel.com/docs/functions/configuring-functions/duration]

### Pattern 6: Supabase Migration 0008 — Session Truncation + NOT NULL FK

```sql
-- Truncate all session-dependent tables (cascade)
-- D-07: Beta data is acceptable to wipe; blueprint_id will be mandatory
TRUNCATE TABLE public.sessions CASCADE;

-- Now safe to add NOT NULL FK
ALTER TABLE public.sessions
  ADD COLUMN blueprint_id text NOT NULL
    REFERENCES public.domain_blueprints(id) ON DELETE RESTRICT;
```

**Why `TRUNCATE...CASCADE`?** Sessions references messages, branches, reactions, etc. via FK ON DELETE CASCADE. `TRUNCATE CASCADE` propagates the truncation through all dependent tables in a single atomic operation, bypassing FK constraint checks. [ASSUMED — exact dependent table list verified from migration history: messages (0001), reactions (0005), branches (0007)]

### Pattern 7: LangGraph Checkpointer Tables (migration 0008 or 0009)

The PostgresSaver `setup()` method creates these tables automatically in the specified schema. **The CONTEXT.md decision D-14 requires them to be created via explicit SQL in migration 0008** (visible in Supabase dashboard). Here is the recommended approach:

Option A (single migration 0008): Include the `langgraph` schema and tables in the same migration as canvas/blueprint tables. Simpler to manage.

Option B (split migration 0008 + 0009): Separate the app tables (0008) from infrastructure tables (0009). Cleaner separation of concerns.

**Claude's recommendation:** Use Option A (single migration 0008) — the tables are part of the same "phase infrastructure" deploy and logically belong together. The `langgraph` schema lives in Supabase Postgres but is logically separate from `public.*` app tables.

```sql
-- langgraph schema for PostgresSaver
CREATE SCHEMA IF NOT EXISTS langgraph;

-- LangGraph checkpointer tables
-- These mirror what setup() would create; explicit SQL per D-14
CREATE TABLE IF NOT EXISTS langgraph.checkpoints (
  thread_id     text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  checkpoint_id text NOT NULL,
  parent_id     text,
  type          text,
  checkpoint    jsonb NOT NULL DEFAULT '{}',
  metadata      jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS langgraph.checkpoint_blobs (
  thread_id     text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  channel       text NOT NULL,
  version       text NOT NULL,
  type          text NOT NULL,
  blob          bytea,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE TABLE IF NOT EXISTS langgraph.checkpoint_writes (
  thread_id     text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  checkpoint_id text NOT NULL,
  task_id       text NOT NULL,
  idx           integer NOT NULL,
  channel       text NOT NULL,
  type          text,
  blob          bytea NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
```

[ASSUMED — exact column definitions may differ from what `setup()` generates; verify against PostgresSaver source or run `setup()` against a local Supabase instance and dump the schema]

### Anti-Patterns to Avoid

- **Using `langfuse-langchain` instead of `@langfuse/langchain`:** Creates `langchain@0.3.x` peer dep conflict with `@langchain/langgraph@1.x`. The install will fail with ERESOLVE.
- **Calling `ajv.compile()` per request:** Violates BLUE-02. Always use the module-level `Map<string, ValidateFunction>` cache.
- **Using a module-level Langfuse singleton:** Explicitly banned in REQUIREMENTS.md Out of Scope. `new CallbackHandler({})` must be instantiated per request.
- **Using `reactflow` instead of `@xyflow/react`:** `reactflow` is the legacy package name; `@xyflow/react` is current.
- **Using the pgBouncer/transaction pooler URL for PostgresSaver:** LangGraph's node-postgres library requires a direct connection or session pooler (port 5432). Transaction pooler (port 6543) does not support prepared statements and will cause errors.
- **Adding `blueprint_id NOT NULL` to sessions without truncating first:** Existing rows have no blueprint — migration will fail with NOT NULL constraint violation.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON Schema validation | Custom type guards | `ajv@8.20.0` | Edge cases in deep nested objects, `additionalProperties`, union types; Ajv compiles to optimized functions |
| LangGraph state persistence | Custom checkpoint table + serialization | `@langchain/langgraph-checkpoint-postgres` | Handles thread_id, checkpointed state, partial writes, migration versioning |
| Observability trace context | Manual Supabase logs | `@langfuse/langchain CallbackHandler` | Captures node spans, token costs, latency automatically from LangGraph callbacks |
| Graph canvas rendering | D3 or raw SVG | `@xyflow/react` | Edge routing, node drag, zoom, pan, React reconciliation — 10k+ lines of battle-tested code |
| Postgres connection management | Custom pg.Pool | `PostgresSaver.fromConnString()` | Connection lifecycle, prepared statements, retry logic already handled |

---

## Common Pitfalls

### Pitfall 1: `langfuse-langchain` peer conflict with LangGraph 1.x

**What goes wrong:** `pnpm install` fails with ERESOLVE — `langfuse-langchain@3.38.20` requires `langchain@0.3.x` which requires `@langchain/core@^0.3.x`, conflicting with `@langchain/langgraph@1.4.7`'s requirement of `@langchain/core@^1.1.48`.

**Why it happens:** `langfuse-langchain` is a legacy integration package predating LangGraph 1.0. The correct scoped package `@langfuse/langchain` has a compatible peer dep (`@langchain/core>=0.3.8`).

**How to avoid:** Install `@langfuse/langchain` (with `@langfuse/core` as its implied dependency), not `langfuse-langchain`.

**Warning signs:** `npm error ERESOLVE unable to resolve dependency tree` mentioning `langchain@0.3.x` when installing.

### Pitfall 2: TRUNCATE CASCADE ordering in migration 0008

**What goes wrong:** Adding `blueprint_id NOT NULL` before truncating fails on existing rows. Truncating sessions without CASCADE fails because FK constraints on messages/branches/reactions block it.

**Why it happens:** Postgres FK constraints prevent modifications to referenced rows. `TRUNCATE TABLE sessions` alone does not cascade.

**How to avoid:** `TRUNCATE TABLE public.sessions CASCADE;` before any ALTER TABLE. CASCADE propagates to all FK-dependent tables in one statement.

**Warning signs:** Migration fails with `ERROR: insert or update on table "messages" violates foreign key constraint` or similar.

### Pitfall 3: PostgresSaver connection string vs Supabase URL

**What goes wrong:** `SUPABASE_URL` (the REST API URL like `https://xyz.supabase.co`) is NOT a valid Postgres connection string. Passing it to `PostgresSaver.fromConnString()` will throw a connection error.

**Why it happens:** Supabase exposes two different connection surfaces: the REST API (used by `@supabase/supabase-js`) and the direct Postgres wire protocol.

**How to avoid:** Add `SUPABASE_DIRECT_URL` as a separate env var with the direct connection string format.

**Warning signs:** `Error: PostgresSaver.fromConnString() received invalid connection string` or `Error connecting to Postgres: ECONNREFUSED`.

### Pitfall 4: LangGraph schema tables vs `checkpointer.setup()` idempotency

**What goes wrong:** If migration 0008 creates the tables with slightly different column definitions than what `setup()` generates internally, `setup()` may try to apply migrations and fail or silently create extra tables/columns.

**Why it happens:** The `setup()` method checks a `checkpoint_migrations` table to track which migrations it has applied. If the tables exist but `checkpoint_migrations` doesn't (or shows version 0), it will attempt to re-apply migrations.

**How to avoid:** Create the `langgraph.checkpoint_migrations` table alongside the other tables in migration 0008, or — simpler — let `setup()` create all tables by NOT including them in the migration SQL, and instead call `setup()` during server startup or a one-time bootstrap script. D-15 allows this: `setup()` is called at runtime.

**Recommendation:** Hybrid approach: create the `langgraph` schema in migration 0008 (so it's visible in Supabase dashboard), but let `setup()` create all table/migration tracking artifacts at startup.

**Warning signs:** `ERROR: relation "langgraph.checkpoints" already exists` during `setup()`, or repeated table creation attempts on every deploy.

### Pitfall 5: Zod v4 compatibility with zod@4.x schema syntax

**What goes wrong:** LangGraph internally uses Zod. If Zod v4 changed APIs that LangGraph relies on (like `.nullable()` → `.nullish()` behavior changes), LangGraph might throw runtime type errors.

**Why it happens:** The project uses `zod@4.4.3` (zod v4). LangGraph 1.4.7 declares `"zod": "^3.25.32 || ^4.2.0"` as a peer dep — v4 is explicitly supported.

**How to avoid:** None needed — the peer dep explicitly allows zod v4. The project's existing usage of `zod@4.4.3` is compatible.

**Warning signs:** None expected, but watch for TypeScript errors in any Zod schema that LangGraph exposes in its types.

### Pitfall 6: `@langchain/core` dual-install if other langchain packages are present

**What goes wrong:** If `langchain` or `@langchain/anthropic` (from Langfuse transitive deps) is already a dev dependency, pnpm may resolve `@langchain/core@0.3.x` and `@langchain/core@1.2.x` simultaneously, causing type conflicts.

**Why it happens:** The project does NOT currently have LangChain packages installed (confirmed from `apps/api/package.json`). `@langfuse/langchain` brings `@langchain/core@1.x` as a peer — resolved once.

**How to avoid:** Verify `pnpm install` resolves to a single `@langchain/core` version. Run `pnpm list @langchain/core` after install.

**Warning signs:** Two `@langchain/core` entries in the lockfile.

---

## SUPABASE_DIRECT_URL — Format and Distinction

### What it is

`SUPABASE_DIRECT_URL` is a standard PostgreSQL TCP connection string. It connects directly to the Supabase-managed Postgres instance on port 5432, bypassing the Supabase REST/PostgREST API.

### Format

```
postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
```

Example:
```
postgresql://postgres:MySecretPassword@db.abcdefghijklmnopqrst.supabase.co:5432/postgres
```

### Where to find it

Supabase Dashboard → project → Connect button → Direct Connection tab.

### How it differs from `SUPABASE_URL`

| Variable | Format | Used By | Port |
|----------|--------|---------|------|
| `SUPABASE_URL` | `https://xyz.supabase.co` | `@supabase/supabase-js` REST client | 443 |
| `SUPABASE_DIRECT_URL` | `postgresql://postgres:PW@db.xyz.supabase.co:5432/postgres` | `PostgresSaver.fromConnString()` | 5432 |

### For Vercel serverless

The **transaction pooler** (port 6543, pgBouncer) is NOT compatible with node-postgres prepared statements used by PostgresSaver. Use the direct connection string (port 5432) or the session pooler (port 5432 via the shared pooler URL).

For production Vercel (many concurrent connections), the **session pooler** URL may be preferable:
```
postgres://postgres.[PROJECT_REF]:[PASSWORD]@aws-[REGION].pooler.supabase.com:5432/postgres
```

[CITED: supabase.com/docs/guides/database/connecting-to-postgres]

---

## Code Examples

### Ajv ValidateFunction import

```typescript
// Source: ajv.js.org/api.html + npm registry type exports
import Ajv, { ValidateFunction } from "ajv";

const ajv = new Ajv({ allErrors: true });
const validatorCache = new Map<string, ValidateFunction>();
```

### @langfuse/langchain per-request CallbackHandler

```typescript
// Source: langfuse.com/docs/integrations/langchain/tracing
import { CallbackHandler } from "@langfuse/langchain";

// Inside request handler — new instance per request, NOT a module-level singleton
const langfuseHandler = new CallbackHandler({
  sessionId: branchId,           // LangGraph thread_id = branch_id
  userId: userId,
  tags: ["panelito", "debate"],
});

// Pass to graph invocation
const result = await graph.invoke(input, {
  callbacks: [langfuseHandler],
  configurable: { thread_id: branchId },
});

// After SSE response complete — flush via waitUntil (OBS-02, Phase 6)
await langfuseHandler.flushAsync();
```

### PostgresSaver from connection string with langgraph schema

```typescript
// Source: reference.langchain.com/javascript/classes/_langchain_langgraph-checkpoint-postgres
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const checkpointer = PostgresSaver.fromConnString(
  process.env.SUPABASE_DIRECT_URL!,
  { schema: "langgraph" }  // Uses langgraph schema per D-14
);

// Call setup() once — idempotent, no-op if tables exist
await checkpointer.setup();
```

### env.ts addition for SUPABASE_DIRECT_URL

```typescript
// apps/api/src/lib/env.ts — add to EnvSchema
SUPABASE_DIRECT_URL: z
  .string()
  .url("SUPABASE_DIRECT_URL must be a valid postgres:// or postgresql:// URL")
  .refine(
    (v) => v.startsWith("postgres://") || v.startsWith("postgresql://"),
    "SUPABASE_DIRECT_URL must be a postgresql:// connection string, not a REST API URL"
  ),
```

### vercel.json — full recommended config

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "turbo run build",
  "functions": {
    "apps/web/app/api/[[...route]]/route.ts": {
      "maxDuration": 60
    }
  }
}
```

Note: The glob path must match the actual file path relative to the Vercel project root (the monorepo root per D-13). The `hono/vercel` bridge `export const runtime = "nodejs"` already in `route.ts` handles the Node.js runtime declaration — `vercel.json` only adds `maxDuration`.

[CITED: vercel.com/docs/project-configuration/vercel-json#functions]

---

## Debate Blueprint Seed Design

Claude's discretion per CONTEXT.md. Designed based on D-08, D-09, D-10.

### Blueprint Structure

```json
{
  "id": "debate-strategy-v1",
  "name": "Debate / Strategy",
  "canvas_view_mode": "graph",
  "node_types": [
    { "id": "hypothesis", "label": "Hypothesis", "color": "#6366f1", "description": "A testable claim or proposition being argued. The LLM should emit this when a participant makes a central assertion or thesis statement." },
    { "id": "evidence", "label": "Evidence", "color": "#22c55e", "description": "Factual data, research, or concrete examples that support or challenge a hypothesis. Emit when a participant cites data, statistics, or real-world examples." },
    { "id": "counter_argument", "label": "Counter-Argument", "color": "#ef4444", "description": "A direct challenge or rebuttal to an existing hypothesis or evidence node. Emit when a participant argues against a previously stated position." },
    { "id": "action", "label": "Action", "color": "#f59e0b", "description": "A concrete next step, decision, or recommendation that emerges from the debate. Emit when consensus moves toward a specific course of action." }
  ],
  "edge_types": [
    { "id": "SUPPORTS", "label": "Supports", "color": "#22c55e" },
    { "id": "CONTRADICTS", "label": "Contradicts", "color": "#ef4444" },
    { "id": "BUILDS_ON", "label": "Builds On", "color": "#6366f1" },
    { "id": "REFUTES", "label": "Refutes", "color": "#f97316" }
  ],
  "phase_sequence": [
    {
      "id": "opening",
      "label": "Opening Statements",
      "llm_instructions": "Participants are making initial claims. Focus on identifying Hypothesis nodes. Do not add Action nodes yet — the debate has not converged. Evidence that supports an opening claim should be linked with SUPPORTS.",
      "allowed_node_types": ["hypothesis", "evidence"]
    },
    {
      "id": "debate",
      "label": "Active Debate",
      "llm_instructions": "Participants are challenging and defending positions. All node types are active. Prioritize Counter-Argument nodes when participants directly rebut a prior statement. Use CONTRADICTS and REFUTES edges to show conflict; use BUILDS_ON when an argument extends a prior claim.",
      "allowed_node_types": ["hypothesis", "evidence", "counter_argument", "action"]
    },
    {
      "id": "synthesis",
      "label": "Synthesis",
      "llm_instructions": "The group is moving toward consensus. Focus on Action nodes that emerge from the debate. Link Actions to the Hypotheses and Evidence they are grounded in using BUILDS_ON. Avoid adding new Counter-Arguments unless a participant explicitly raises new objections.",
      "allowed_node_types": ["hypothesis", "evidence", "action"]
    }
  ],
  "active_persona_ids": ["analista_cientifico"]
}
```

[ASSUMED — phase names, labels, and llm_instructions text are Claude's design per Claude's Discretion grant]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `reactflow` package | `@xyflow/react` | Jan 2024 | Same API, renamed; `reactflow` still works but receives only critical fixes |
| `langfuse-langchain` wrapper | `@langfuse/langchain` scoped package | ~Aug 2025 | New package avoids `langchain@0.3` peer dep |
| LangGraph MemorySaver (in-process) | `PostgresSaver` + direct Postgres URL | LangGraph 1.0 (Jan 2024) | Cross-request state persistence in serverless functions |
| Edge runtime for all Next.js API routes | Node.js runtime with `export const runtime = "nodejs"` | Next.js 13.4 | Required for node-postgres, streaming SSE, and LangGraph which use Node.js-only APIs |

**Deprecated/outdated:**
- `reactflow`: Still on npm but receives only security patches. New projects use `@xyflow/react`.
- `langfuse-langchain`: Conflicts with LangGraph 1.x. Use `@langfuse/langchain`.
- `langfuse-node`: Also exists on npm at same version as `langfuse` — is an alias. Not needed.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `CanvasNode` table has columns: `id`, `session_id`, `branch_id`, `blueprint_id`, `node_type_id`, `label`, `status`, `position_x`, `position_y`, `created_at`, `updated_at` | Architecture Patterns, Pattern 1 | Phase 6 migration would need to add missing columns; Zod schema needs updating |
| A2 | `CanvasEdge` table has columns: `id`, `session_id`, `branch_id`, `blueprint_id`, `source_node_id`, `target_node_id`, `edge_type_id`, `status`, `created_at`, `updated_at` | Architecture Patterns, Pattern 1 | Same as A1 |
| A3 | `domain_blueprints` table stores JSON definition in a `definition` column (JSONB) | Pattern 3 (blueprint-loader.ts) | Blueprint loader `.select("definition")` would need different column name |
| A4 | LangGraph checkpointer table SQL (column definitions) matches what `setup()` generates | Pattern 7 | If schema mismatch, `setup()` could fail or create duplicate tables |
| A5 | Debate Blueprint `phase_sequence` names and `llm_instructions` content | Blueprint Seed Design | Instructions may not produce correct LLM behavior in Phase 6 — adjustable before Phase 6 |
| A6 | vercel.json `functions` glob path for Turborepo monorepo is `apps/web/app/api/[[...route]]/route.ts` relative to repo root | Pattern 5 | maxDuration may not apply if Vercel resolves the root dir differently; needs testing after deploy |
| A7 | `CanvasOp` discriminated union covers `ADD_NODE`, `ADD_EDGE`, `NO_ACTION` | Pattern 1 | Phase 6 may need additional operations; additive change safe |

---

## Open Questions

1. **LangGraph checkpointer table schema exact DDL**
   - What we know: `setup()` creates `checkpoints`, `checkpoint_blobs`, `checkpoint_writes` in the specified schema
   - What's unclear: Exact column names and types — documentation shows the high-level description, not DDL
   - Recommendation: Run `checkpointer.setup()` against local Supabase, then `pg_dump --schema-only --schema=langgraph` to extract the exact DDL. Include in migration 0008. This verifies A4.

2. **vercel.json glob resolution for Turborepo**
   - What we know: vercel.json goes at monorepo root (D-13); Next.js App Router handles runtime declaration; `functions` key takes file globs
   - What's unclear: Whether Vercel resolves the glob relative to monorepo root or the Next.js app root (`apps/web`)
   - Recommendation: Test on Vercel Preview after initial deploy; fallback is to set maxDuration via Vercel dashboard if glob path is wrong.

3. **`domain_blueprints.definition` column type**
   - What we know: Blueprints are JSON; Supabase supports `jsonb` for indexed JSON
   - What's unclear: Whether to store the full Blueprint as a single `definition jsonb` column or normalize fields (name, canvas_view_mode as top-level columns with a `config jsonb` for node/edge types)
   - Recommendation: Single `definition jsonb` column with a `name` text column for display. Simpler to evolve; Ajv validates the full structure; Supabase json operators cover any needed querying.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | package install, migration | ✓ | v22.17.1 | — |
| pnpm | workspace install | ✓ | 10.18.3 | — |
| supabase CLI | migration push | ✓ | 2.105.0 | — |
| psql | DDL extraction for checkpointer schema | ✗ | — | Use supabase dashboard or `supabase db dump` |

**Missing dependencies with no fallback:** none that block execution.
**Missing dependencies with fallback:** `psql` absent — use `supabase db dump --schema langgraph` via the CLI instead.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | Supabase RLS on canvas_nodes, canvas_edges; service-role-only write on domain_blueprints |
| V5 Input Validation | yes | Ajv meta-schema validates Blueprint before use; Zod schemas on all types |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Blueprint injection (malicious blueprint_id in session create) | Tampering | RLS: domain_blueprints readable by all auth users; FK constraint on sessions.blueprint_id ensures referenced blueprint exists |
| Canvas node type forgery (LLM emits unknown node_type_id) | Tampering | Blueprint loader validates `allowed_node_types` per phase; Phase 6 MutationGateNode enforces at runtime |
| Service role key exposure | Information Disclosure | Existing pattern: `SUPABASE_SERVICE_ROLE_KEY` read once in `env.ts`, never logged (T-01-08) |
| Direct Postgres URL leak | Information Disclosure | `SUPABASE_DIRECT_URL` follows same pattern as service role key — env var, never returned in response |

---

## Sources

### Primary (HIGH confidence)
- [npm registry — @langchain/langgraph] `npm view @langchain/langgraph version` → 1.4.7 (2026-07-01)
- [npm registry — @langchain/langgraph-checkpoint-postgres] `npm view` → 1.0.4 (2026-07-01)
- [npm registry — @langfuse/langchain] `npm view` → 5.9.1 (2026-07-01)
- [npm registry — ajv] `npm view` → 8.20.0 (2026-07-01)
- [npm registry — @xyflow/react] `npm view` → 12.11.1 (2026-07-01)
- [vercel.com/docs/project-configuration/vercel-json#functions] — functions config, maxDuration syntax
- [vercel.com/docs/functions/configuring-functions/duration] — Hobby tier maxDuration limits (300s max)
- [supabase.com/docs/guides/database/connecting-to-postgres] — Direct URL format
- [reference.langchain.com/javascript/classes/_langchain_langgraph-checkpoint-postgres] — PostgresSaver API
- [ajv.js.org/guide/managing-schemas.html] — module-level compile-once pattern

### Secondary (MEDIUM confidence)
- [langfuse.com/docs/integrations/langchain/tracing] — `@langfuse/langchain` package name + CallbackHandler import
- [slopcheck v0.6.1] — all 6 packages returned [OK] on 2026-07-01

### Tertiary (LOW confidence)
- LangGraph checkpointer DDL column definitions — inferred from source code WebFetch; exact DDL not confirmed from authoritative doc
- vercel.json glob path for Turborepo monorepo Hono bridge — ASSUMED; requires testing on Vercel preview

---

## Metadata

**Confidence breakdown:**
- Standard stack (package names/versions): HIGH — verified via `npm view` on 2026-07-01
- Package conflict detection: HIGH — ERESOLVE error observed and root-caused
- Architecture patterns: MEDIUM — based on official docs + existing codebase patterns
- LangGraph checkpointer DDL: LOW — inferred from source, not official DDL reference
- vercel.json functions glob: MEDIUM — official docs confirmed syntax; Turborepo glob path is ASSUMED

**Research date:** 2026-07-01
**Valid until:** 2026-07-31 (LangGraph 1.x active development; Vercel pricing/limits stable)
