---
phase: 05-foundation
plan: 02
subsystem: database
tags: [supabase, postgres, rls, migrations, langgraph, blueprint, canvas]

# Dependency graph
requires:
  - phase: 05-01
    provides: Package installs (LangGraph, Ajv, @xyflow/react) and vercel.json runtime config

provides:
  - domain_blueprints table with SELECT RLS and Debate/Strategy Blueprint seed
  - canvas_nodes and canvas_edges tables with status CHECK constraints and full CRUD RLS
  - langgraph schema (PostgresSaver checkpointer tables created by setup() at Phase 6 startup)
  - sessions.blueprint_id NOT NULL FK ensuring every session has a Blueprint
  - TRUNCATE CASCADE clearing all beta session data atomically

affects:
  - 05-03 (types package: CanvasNode/CanvasEdge Zod schemas match DB columns created here)
  - 05-04 (Blueprint loader: loads from domain_blueprints.definition jsonb column)
  - 06 (LangGraph graph construction: PostgresSaver.setup() creates tables in langgraph schema)
  - 07 (/invoke route: sessions require blueprint_id on creation)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Migration ordering: seed data inserted before NOT NULL FK constraint add to avoid constraint violations"
    - "langgraph schema only in migration (no tables); tables created by PostgresSaver.setup() at startup"
    - "service-role-only write via absent INSERT/UPDATE/DELETE RLS policy on domain_blueprints"

key-files:
  created:
    - supabase/migrations/0008_nsai_foundation.sql
  modified: []

key-decisions:
  - "D-06 applied: domain_blueprints has SELECT RLS only; no INSERT/UPDATE/DELETE policy means service role is the only writer"
  - "D-07 applied: TRUNCATE TABLE public.sessions CASCADE wipes all beta session data before adding blueprint_id NOT NULL FK"
  - "Pitfall 4 applied: langgraph schema created in migration but checkpointer tables NOT pre-created — PostgresSaver.setup() owns table DDL to avoid checkpoint_migrations version conflicts"
  - "Execution order: domain_blueprints table → canvas_nodes → canvas_edges → langgraph schema → Debate Blueprint seed → TRUNCATE sessions + ADD COLUMN blueprint_id"

patterns-established:
  - "Migration order dependency: Blueprint seed must precede blueprint_id NOT NULL FK add so the referenced row exists before the constraint is validated"
  - "TRUNCATE CASCADE pattern: single statement atomically clears sessions and all FK-dependent tables (messages, branches, reactions, canvas_nodes, canvas_edges)"

requirements-completed:
  - INFRA-02
  - BLUE-05

# Metrics
duration: 12min
completed: 2026-07-01
---

# Phase 5 Plan 02: NSAI Foundation Migration Summary

**Supabase migration 0008 adding domain_blueprints (platform-global Blueprint store), canvas_nodes and canvas_edges (per-session ontology graph), langgraph schema, and Debate/Strategy Blueprint seed — with sessions TRUNCATE CASCADE and blueprint_id NOT NULL FK**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-01T19:00:00Z
- **Completed:** 2026-07-01T19:08:27Z
- **Tasks:** 2
- **Files modified:** 1 created

## Accomplishments

- Migration 0008 applied to local Supabase with no errors; all 5 verification queries passed
- domain_blueprints table with SELECT-only RLS (service-role write); Debate/Strategy Blueprint seed with 4 node types, 4 edge types, 3-phase sequence
- canvas_nodes and canvas_edges tables with status CHECK (committed/ghost/silent), session/branch/blueprint FKs, and CRUD RLS for authenticated users
- langgraph schema exists in Supabase; PostgresSaver.setup() will create checkpointer tables on Phase 6 server startup
- sessions.blueprint_id NOT NULL FK — no session can exist without a valid Blueprint; all beta sessions truncated via CASCADE

## Task Commits

Each task was committed atomically:

1. **Task 1: Write migration 0008_nsai_foundation.sql** - `e65997d` (feat)
2. **Task 2: Push migration to local Supabase and verify** - DB operation (no new file commit; verified via 5 queries)

**Plan metadata:** (committed below with SUMMARY.md)

## Files Created/Modified

- `supabase/migrations/0008_nsai_foundation.sql` - All NSAI DB infrastructure: domain_blueprints, canvas_nodes, canvas_edges, langgraph schema, Debate Blueprint seed, sessions TRUNCATE + blueprint_id FK

## Decisions Made

- Chose NOT to pre-create LangGraph checkpointer tables in migration SQL (RESEARCH.md Pitfall 4): creating tables with potentially mismatched column definitions causes `checkpoint_migrations` version conflicts when `setup()` runs. Schema only in migration; tables owned by `setup()`.
- Migration execution order: domain_blueprints table first, then canvas tables, then langgraph schema, then Blueprint seed, then TRUNCATE + ALTER sessions. This ensures the Blueprint row exists before the NOT NULL FK constraint is enforced.
- Copied migration file to main project `/supabase/migrations/` directory for local Supabase CLI compatibility (the CLI runs from the main project, not the worktree). File is tracked in the worktree branch; after merge it will be in the main repo.

## Deviations from Plan

None — plan executed exactly as written. The only adaptation was applying the migration via `supabase migration up --local` after copying the file to the main project directory (Supabase CLI reads migrations from the main project root, not the worktree).

## Issues Encountered

**Supabase CLI migration discovery from worktree:** The `supabase` CLI only looks for migrations in the main project's `supabase/migrations/` directory. Since this agent runs in a git worktree (`/home/jgm/dev/projects/web-projects/panelito/.claude/worktrees/agent-ab095d7df147627f5/`), the migration file was committed to the worktree but the CLI couldn't find it. Resolution: copied the file to the main project directory before running `supabase migration up --local`. The worktree branch commit is the source of truth; the main project copy was for CLI compatibility only.

**`supabase db query` multi-statement limitation:** `supabase db query --local --file` fails with "cannot insert multiple commands into a prepared statement" for multi-statement SQL files. Resolution: used `supabase migration up --local` instead, which correctly handles multi-statement migration files.

## User Setup Required

None — all changes are to the local Supabase instance. The migration will need to be pushed to production Supabase when deploying (`supabase db push`), but that is a deployment step, not a development setup step.

## Next Phase Readiness

- Phase 5 Plan 03 (types package): `canvas_nodes` and `canvas_edges` column definitions are established in this migration; `CanvasNode`/`CanvasEdge` Zod schemas in Plan 03 should match.
- Phase 5 Plan 04 (Blueprint loader): `domain_blueprints` table with `definition jsonb` column is ready; Ajv validator loads from this column.
- Phase 6 (LangGraph): `langgraph` schema exists; `PostgresSaver.setup()` will create checkpointer tables on first server startup.

---
*Phase: 05-foundation*
*Completed: 2026-07-01*
