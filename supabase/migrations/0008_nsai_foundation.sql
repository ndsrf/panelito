-- =============================================================================
-- Migration: 0008_nsai_foundation
-- Project:   Project Multiverse (Panelito)
-- Created:   2026-07-01
--
-- Creates the full NSAI infrastructure for Phase 5:
--   1. domain_blueprints table (platform-global, service-role write only)
--   2. canvas_nodes table (session-scoped, full CRUD for auth users)
--   3. canvas_edges table (session-scoped, full CRUD for auth users)
--   4. langgraph schema (checkpointer tables created by PostgresSaver.setup() on startup)
--   5. Debate/Strategy Blueprint seed row (must precede blueprint_id FK add)
--   6. sessions TRUNCATE CASCADE + blueprint_id NOT NULL FK
--
-- ORDERING NOTE: Sections 5 and 6 are intentionally ordered so the Blueprint seed
-- is inserted BEFORE the NOT NULL FK constraint is added to sessions. This ensures
-- the domain_blueprints table is populated before the FK constraint validation runs.
--
-- References:
--   REQUIREMENTS.md: INFRA-02, BLUE-05
--   Security: T-05-03 (service-role-only write), T-05-04 (NOT NULL FK ON DELETE RESTRICT)
--             T-05-05 (status CHECK constraint), T-05-06 (RLS WITH CHECK for canvas writes)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- SECTION 1: domain_blueprints
-- Platform-global Blueprint library.
-- D-06: No creator_id FK — blueprints are global, not per-creator.
-- RLS: any authenticated user can SELECT; no INSERT/UPDATE/DELETE policy
--      means writes require service role (bypasses RLS entirely).
-- T-05-03: Tampering mitigation — only service role can write blueprints.
-- ---------------------------------------------------------------------------
CREATE TABLE public.domain_blueprints (
  id          text        PRIMARY KEY,
  name        text        NOT NULL,
  definition  jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.domain_blueprints ENABLE ROW LEVEL SECURITY;

-- SELECT allowed for all authenticated users; no INSERT/UPDATE/DELETE policy.
CREATE POLICY "blueprints_select"
  ON public.domain_blueprints
  FOR SELECT
  USING (auth.uid() IS NOT NULL);


-- ---------------------------------------------------------------------------
-- SECTION 2: canvas_nodes
-- Per-session, per-branch canvas nodes.
-- D-07 schema: session_id + branch_id + blueprint_id + node_type_id + label + status
-- T-05-05: CHECK (status IN ('committed', 'ghost', 'silent')) prevents arbitrary strings.
-- T-05-06: RLS WITH CHECK (auth.uid() IS NOT NULL) — must be authenticated to write.
-- ---------------------------------------------------------------------------
CREATE TABLE public.canvas_nodes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  branch_id     uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  blueprint_id  text        NOT NULL REFERENCES public.domain_blueprints(id) ON DELETE RESTRICT,
  node_type_id  text        NOT NULL,
  label         text        NOT NULL,
  status        text        NOT NULL DEFAULT 'committed'
                            CHECK (status IN ('committed', 'ghost', 'silent')),
  position_x    float8,
  position_y    float8,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX canvas_nodes_session_branch_idx ON public.canvas_nodes(session_id, branch_id);

ALTER TABLE public.canvas_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canvas_nodes_select"
  ON public.canvas_nodes
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_id
    )
  );

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

CREATE POLICY "canvas_nodes_update"
  ON public.canvas_nodes
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_id
        AND s.status = 'active'
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_id
        AND s.status = 'active'
    )
  );


-- ---------------------------------------------------------------------------
-- SECTION 3: canvas_edges
-- Per-session, per-branch canvas edges between canvas_nodes.
-- T-05-05: CHECK (status IN ('committed', 'ghost', 'silent')) — same constraint as nodes.
-- T-05-06: RLS WITH CHECK (auth.uid() IS NOT NULL) for INSERT/UPDATE.
-- ---------------------------------------------------------------------------
CREATE TABLE public.canvas_edges (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  branch_id       uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  blueprint_id    text        NOT NULL REFERENCES public.domain_blueprints(id) ON DELETE RESTRICT,
  source_node_id  uuid        NOT NULL REFERENCES public.canvas_nodes(id) ON DELETE CASCADE,
  target_node_id  uuid        NOT NULL REFERENCES public.canvas_nodes(id) ON DELETE CASCADE,
  edge_type_id    text        NOT NULL,
  status          text        NOT NULL DEFAULT 'committed'
                              CHECK (status IN ('committed', 'ghost', 'silent')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX canvas_edges_session_branch_idx ON public.canvas_edges(session_id, branch_id);

ALTER TABLE public.canvas_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canvas_edges_select"
  ON public.canvas_edges
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_id
    )
  );

CREATE POLICY "canvas_edges_insert"
  ON public.canvas_edges
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_id
        AND s.status = 'active'
    )
  );

CREATE POLICY "canvas_edges_update"
  ON public.canvas_edges
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_id
        AND s.status = 'active'
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_id
        AND s.status = 'active'
    )
  );


-- ---------------------------------------------------------------------------
-- SECTION 4: langgraph schema
-- Creates the schema for LangGraph PostgresSaver checkpointer.
-- D-14: Schema created here so it is visible in the Supabase dashboard.
-- Tables (checkpoints, checkpoint_blobs, checkpoint_writes) are created by
-- PostgresSaver.setup() on first server startup — idempotent after that.
-- Per RESEARCH.md Pitfall 4: pre-creating tables with potentially mismatched
-- column definitions triggers checkpoint_migrations conflicts. Schema only here;
-- let setup() manage the table DDL.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS langgraph;

COMMENT ON SCHEMA langgraph IS
  'LangGraph PostgresSaver checkpointer schema. Tables (checkpoints, checkpoint_blobs, checkpoint_writes) are created by PostgresSaver.setup() on first server startup — idempotent after that. See apps/api/src/lib/langgraph-checkpointer.ts.';


-- ---------------------------------------------------------------------------
-- SECTION 5: Debate/Strategy Blueprint seed
-- Must be inserted BEFORE the blueprint_id NOT NULL FK is added to sessions
-- (Section 6). This ensures domain_blueprints is populated before the FK
-- constraint prevents NULL blueprint_id on sessions.
--
-- D-08: Node types — Hypothesis, Evidence, Counter-Argument, Action
-- D-09: Edge types — SUPPORTS, CONTRADICTS, BUILDS_ON, REFUTES
-- D-10: canvas_view_mode = "graph"
-- D-05: active_persona_ids references PERSONA_LIBRARY id = 'analista_cientifico'
-- ---------------------------------------------------------------------------
INSERT INTO public.domain_blueprints (id, name, definition) VALUES (
  'debate-strategy-v1',
  'Debate / Strategy',
  '{
    "id": "debate-strategy-v1",
    "name": "Debate / Strategy",
    "canvas_view_mode": "graph",
    "node_types": [
      {
        "id": "hypothesis",
        "label": "Hypothesis",
        "color": "#6366f1",
        "description": "A testable claim or proposition being argued. The LLM should emit this when a participant makes a central assertion or thesis statement."
      },
      {
        "id": "evidence",
        "label": "Evidence",
        "color": "#22c55e",
        "description": "Factual data, research, or concrete examples that support or challenge a hypothesis. Emit when a participant cites data, statistics, or real-world examples."
      },
      {
        "id": "counter_argument",
        "label": "Counter-Argument",
        "color": "#ef4444",
        "description": "A direct challenge or rebuttal to an existing hypothesis or evidence node. Emit when a participant argues against a previously stated position."
      },
      {
        "id": "action",
        "label": "Action",
        "color": "#f59e0b",
        "description": "A concrete next step, decision, or recommendation that emerges from the debate. Emit when consensus moves toward a specific course of action."
      }
    ],
    "edge_types": [
      { "id": "SUPPORTS",   "label": "Supports",     "color": "#22c55e" },
      { "id": "CONTRADICTS","label": "Contradicts",   "color": "#ef4444" },
      { "id": "BUILDS_ON",  "label": "Builds On",     "color": "#6366f1" },
      { "id": "REFUTES",    "label": "Refutes",       "color": "#f97316" }
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
  }'::jsonb
);


-- ---------------------------------------------------------------------------
-- SECTION 6: sessions TRUNCATE CASCADE + blueprint_id NOT NULL FK
-- D-07: Beta data is acceptable to wipe. TRUNCATE CASCADE atomically removes
-- all session-dependent rows (messages, branches, reactions, canvas_nodes,
-- canvas_edges) via the existing ON DELETE CASCADE FK chain.
--
-- Must come AFTER:
--   - SECTION 1 (domain_blueprints table must exist for the FK reference)
--   - SECTION 5 (Blueprint seed must exist before NOT NULL constraint is added)
--
-- T-05-04: ON DELETE RESTRICT prevents orphaned sessions if a Blueprint is removed.
-- The NOT NULL constraint ensures every session references a valid Blueprint.
-- ---------------------------------------------------------------------------

-- Wipe all existing session data (beta — acceptable per D-07)
-- CASCADE propagates to: messages, branches, reactions, canvas_nodes, canvas_edges
TRUNCATE TABLE public.sessions CASCADE;

-- Now safe to add the NOT NULL FK (no existing rows to violate the constraint)
ALTER TABLE public.sessions
  ADD COLUMN blueprint_id text NOT NULL
    REFERENCES public.domain_blueprints(id) ON DELETE RESTRICT;
