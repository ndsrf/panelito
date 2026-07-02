-- =============================================================================
-- Migration: 0009_sessions_current_phase
-- Project:   Project Multiverse (Panelito)
-- Created:   2026-07-02
--
-- Adds `current_phase` column to the sessions table for BLUE-04 support.
--
-- BLUE-04: LLM system prompt mutates based on Blueprint's current_phase field in
-- Supabase. The OrchestratorNode reads `sessions.current_phase` at invocation
-- time and injects the matching phase's `llm_instructions` into the agent
-- system prompt.
--
-- NULL default is intentional: handles the one existing dev session safely.
-- The graph treats NULL as "use blueprint.phase_sequence[0].id as fallback."
-- Phase 7 updates sessions.ts to initialize current_phase on session create.
--
-- References:
--   REQUIREMENTS.md: BLUE-04
--   Security: No new trust boundaries — column is read-only by the graph (server
--             side); only updated by explicit human action (HUMAN-02) in a later
--             phase via authenticated route.
-- =============================================================================

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS current_phase TEXT NULL DEFAULT NULL;

COMMENT ON COLUMN public.sessions.current_phase IS
  'Active Blueprint phase id (references blueprint.phase_sequence[].id). NULL means use blueprint.phase_sequence[0].id as fallback. Updated only by explicit human action (HUMAN-02).';
