# Phase 5: Foundation - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 delivers the infrastructure terrain for the NSAI engine before any LangGraph or agent code is written. Specifically:
- All NSAI npm packages installed (LangGraph JS, Langfuse, Ajv, Postgres checkpointer, @xyflow/react)
- `vercel.json` created declaring all `/api/*` routes as Node.js runtime with `maxDuration: 60`
- Three new Supabase tables (`canvas_nodes`, `canvas_edges`, `domain_blueprints`) created in migration 0008 with RLS
- LangGraph checkpointer tables created in migration 0008 (`langgraph` schema: `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`)
- `sessions.blueprint_id` NOT NULL FK added to `domain_blueprints`; all existing beta sessions truncated
- Shared TypeScript types (`CanvasNode`, `CanvasEdge`, `Blueprint`, `CanvasOp`) added to `@panelito/types`
- Blueprint loader service implemented with Ajv compiled validators (cached per blueprintId, never per request)
- Debate/Strategy Blueprint seeded and passing Ajv meta-schema validation

Phase 5 ends when all 7 requirements pass their success criteria and the Debate Blueprint is queryable from the DB. No graph execution in this phase.

</domain>

<decisions>
## Implementation Decisions

### Blueprint JSON Schema

- **D-01:** Blueprint top-level shape: `{ id, name, canvas_view_mode, node_types[], edge_types[], phase_sequence[], active_persona_ids[] }`. Vocabulary inline; personas by ID referencing the existing `PERSONA_LIBRARY` in `@panelito/types`.
- **D-02:** Each `node_types[]` entry: `{ id: string, label: string, color: string, description: string }`. The `description` field feeds into the LangGraph AgentNode system prompt injection in Phase 6 — it explains what each node type means to the LLM.
- **D-03:** Each `edge_types[]` entry: `{ id: string, label: string, color: string }`. No description field — edge semantics are implied by the id/label (SUPPORTS, CONTRADICTS, etc.).
- **D-04:** Each `phase_sequence[]` entry: `{ id: string, label: string, llm_instructions: string, allowed_node_types: string[] }`. The `allowed_node_types` field restricts which node type ids the LLM can emit per conversation phase. The LLM system prompt mutates based on the `current_phase` field in Supabase.
- **D-05:** `active_persona_ids[]` is a `string[]` referencing persona ids from `PERSONA_LIBRARY`. No persona config is embedded in the Blueprint — `PERSONA_LIBRARY` in `@panelito/types` remains the source of truth for persona configs.
- **D-06:** Blueprints are platform-global only — no `creator_id` FK. RLS policy: readable by all authenticated users, writable only by service role. Creators select from the platform library; they cannot define private Blueprints in v2.0.
- **D-07:** `sessions.blueprint_id` is a **NOT NULL FK** to `domain_blueprints`. Every session must have a Blueprint — no legacy v1 fallback. Migration 0008 truncates the `sessions` table (with cascade to messages, branches, reactions, etc.) before adding the NOT NULL constraint. This is acceptable because the app is in beta.

### Debate/Strategy Blueprint Seed

- **D-08:** Debate Blueprint node types: `Hypothesis`, `Evidence`, `Counter-Argument`, `Action` (with distinct colors and descriptions for each).
- **D-09:** Debate Blueprint edge types: `SUPPORTS`, `CONTRADICTS`, `BUILDS_ON`, `REFUTES`.
- **D-10:** `canvas_view_mode: "graph"` for the Debate Blueprint.

### vercel.json Runtime Config

- **D-11:** All `/api/*` routes are declared as Node.js runtime (not Edge) in `vercel.json`. No granular per-route exceptions — consistency over micro-optimization.
- **D-12:** `maxDuration: 60` — Vercel Hobby tier. This is the hard ceiling for streaming SSE + LangGraph execution.
- **D-13:** Single unified Vercel project for the entire Turborepo. One `vercel.json` at the monorepo root covers both `apps/web` and `apps/api`.

### LangGraph Checkpointer Tables

- **D-14:** Migration 0008 creates the `langgraph` schema AND all checkpointer tables (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`) with explicit SQL. The tables are versioned alongside app tables and visible in the Supabase dashboard.
- **D-15:** `checkpointer.setup()` is still called at runtime (in a bootstrap script or server startup) but becomes a no-op when tables already exist (`prepare: false` config). No state is lost.
- **D-16:** `SUPABASE_DIRECT_URL` is a new env var added to `apps/api/.env` (and Vercel environment variables). The researcher will determine the exact Supabase Postgres direct connection string format. It is distinct from `SUPABASE_URL` (the REST API URL).

### Claude's Discretion

- Exact Debate Blueprint `phase_sequence` definition (which phases, what `llm_instructions` per phase, which `allowed_node_types` per phase) — Claude designs this based on the Debate/Strategy domain.
- Exact `vercel.json` structure for the Turborepo monorepo (framework detection, build commands, functions config) — Claude researches the correct Hono + Next.js + Vercel Node.js runtime pattern.
- Whether to put checkpointer table SQL in migration 0008 or a separate 0009 migration — Claude decides based on what else goes into 0008.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and Roadmap
- `.planning/REQUIREMENTS.md` — Full v2.0 requirements; Phase 5 maps to INFRA-01, INFRA-02, INFRA-03, BLUE-01, BLUE-02, BLUE-05, CANVAS-01 (with traceability table at bottom)
- `.planning/ROADMAP.md` §Phase 5 — Success criteria (5 acceptance criteria that must be TRUE)

### Existing Code Patterns
- `packages/types/src/index.ts` — How `@panelito/types` re-exports types; new NSAI types follow the same per-file pattern with co-located Zod schemas
- `apps/api/package.json` — Current API dependencies; LangGraph, Langfuse, Ajv, Postgres checkpointer are NOT yet installed
- `apps/web/package.json` — Current web dependencies; @xyflow/react is NOT yet installed

### Supabase Migrations
- `supabase/migrations/` — Migration 0001–0007 exist; 0008 is next; follow the existing numbered SQL pattern

### Out-of-Scope Constraints
- `.planning/REQUIREMENTS.md` §Out of Scope — Autonomous LLM phase advancement, per-domain DB schemas, module-level Langfuse singleton, LangGraph interrupt() are all explicitly banned

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/types/src/index.ts` — Established pattern: create `packages/types/src/canvas.ts` (CanvasNode, CanvasEdge, CanvasOp), `packages/types/src/blueprint.ts` (Blueprint type + Zod schema), and re-export from `index.ts`
- `apps/api/src/lib/` — Existing service modules (supabase, crypto, env, cap-guard); Blueprint loader should follow same pattern as a new `lib/blueprint-loader.ts`
- `supabase/migrations/0005_reactions_personas.sql` — Good reference for how multi-table migrations with RLS are structured

### Established Patterns
- Types package: type + co-located Zod schema in the same file, `export type` + `export { Schema }` in `index.ts`
- Supabase migrations: plain SQL, no ORM, RLS enabled per table with `CREATE POLICY` statements
- Env vars: `apps/api/src/lib/env.ts` validates env at startup — `SUPABASE_DIRECT_URL` must be added here
- Blueprint validator caching: Ajv validators are compiled at module load (not per-request) — use a module-level `Map<string, ValidateFunction>` keyed by `blueprintId`

### Integration Points
- `apps/api/src/routes/ai.ts` — Phase 7 will modify the `/invoke` route; Phase 5 must not touch this route (infrastructure only)
- `sessions` table — Migration 0008 truncates it and adds `blueprint_id NOT NULL FK`; all downstream tables (messages, branches, reactions) must cascade-delete cleanly
- `PERSONA_LIBRARY` in `packages/types/src/persona.ts` — Blueprint's `active_persona_ids[]` references ids from this library; researcher should verify the exact id field name

</code_context>

<specifics>
## Specific Ideas

- **sessions.blueprint_id as NOT NULL**: The user explicitly requested wiping all existing sessions (beta data) and making the relationship mandatory. There is no "no Blueprint" mode in v2.0. Planners must cascade-truncate all session-dependent tables in migration 0008.
- **Ajv compiled validators cached per blueprintId at module load**: The validator cache must be a module-level singleton (not per-request, not per-instance). This is an explicit REQUIREMENTS.md constraint (BLUE-02).
- **Debate Blueprint as seed data**: The Debate Blueprint is the first production domain. It must be seeded in migration 0008 (or a companion seed file) so it's available for Phase 6 unit tests without manual DB intervention.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 5-Foundation*
*Context gathered: 2026-07-01*
