-- Migration: 0016_participant_profiles
--
-- Phase 13 (PROFILE-01, TRIGGER-02): builds the durable, cold-start-safe
-- participant_profiles store (D-01 — no InMemoryStore) and folds in Phase 12's
-- narrow moderation_counts table per D-02 (the fold-in Phase 12's own 0015
-- header comment anticipated). Also repoints increment_moderation_count to
-- write participant_profiles.moderation_count, adds a new
-- upsert_participant_profile RPC for positions/assertions/messages_sent/
-- reactions_used, and documents the phase_readiness_gate default posture
-- (TRIGGER-02's Blueprint N/M gate field — Zod-default-supplied, no DB write
-- required for the seeded Blueprint).
--
-- Design precedent: table + index + RLS + SECURITY DEFINER RPC + grant/revoke
-- structure copied verbatim from 0015_graph_coherence_triggers.sql SECTION 2/3.
--
-- Trust boundary (T-13-03/T-13-04): same row-ownership posture as
-- moderation_counts (0015) — no participant-membership table exists anywhere
-- in this schema to scope a broader policy against, so row-ownership
-- (auth.uid() = participant_id) is the tightest expressible SELECT policy.
-- participant_id is `uuid` here (NOT `text` like the old moderation_counts
-- table) — D-04/A2: author_id is always a real auth.uid() value. Writes are
-- service-role-only (ProfileBuilderNode, moderation Skill) — no authenticated
-- INSERT/UPDATE/DELETE policy is granted.

-- ---------------------------------------------------------------------------
-- SECTION 1: participant_profiles table (D-01, D-02, D-04)
-- ---------------------------------------------------------------------------
CREATE TABLE public.participant_profiles (
  branch_id        uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  participant_id   uuid        NOT NULL,   -- author_id (D-04) — always a real auth.uid(),
                                             -- unlike moderation_counts.participant_id (text)
  positions        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  assertions       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  messages_sent    int         NOT NULL DEFAULT 0,
  reactions_used   int         NOT NULL DEFAULT 0,
  moderation_count int         NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, participant_id)
);

COMMENT ON TABLE public.participant_profiles IS
  'Per-participant, per-branch profile rollup (PROFILE-01/02, D-01/D-02/D-04/D-05). '
  'Durable, cold-start-safe store — no JS process memory (D-01). Folds in Phase 12''s '
  'moderation_counts (D-02, see SECTION 3 below). Row-ownership RLS: a participant may '
  'only SELECT their own row; writes are service-role-only (ProfileBuilderNode / '
  'moderation Skill via upsert_participant_profile / increment_moderation_count).';

CREATE INDEX participant_profiles_branch_idx ON public.participant_profiles(branch_id);

ALTER TABLE public.participant_profiles ENABLE ROW LEVEL SECURITY;

-- T-13-03: row-ownership only — a participant can read their OWN profile row,
-- never another participant's. No FOR INSERT/UPDATE/DELETE policy for
-- `authenticated` — writes go through service-role RPCs only (T-13-04).
CREATE POLICY "participant_profiles_select"
  ON public.participant_profiles
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND auth.uid() = participant_id
  );

-- ---------------------------------------------------------------------------
-- SECTION 2: Data fold-in (D-02) — MUST run before the moderation_counts DROP
-- below. participant_id was `text` in the old table (guest-safe design
-- decision at the time) but every real value inserted so far is a valid
-- auth.uid() string — safe to cast to uuid.
-- ---------------------------------------------------------------------------
INSERT INTO public.participant_profiles (branch_id, participant_id, moderation_count, updated_at)
SELECT branch_id, participant_id::uuid, count, updated_at
FROM public.moderation_counts
ON CONFLICT (branch_id, participant_id) DO UPDATE
  SET moderation_count = EXCLUDED.moderation_count;

-- ---------------------------------------------------------------------------
-- SECTION 3: increment_moderation_count — repointed to participant_profiles.
-- Replaces the 0015 version (moderation_counts, p_participant_id text) with
-- one whose p_participant_id is uuid and whose body reads/writes
-- participant_profiles.moderation_count. Same atomic upsert-returning-count
-- shape — two concurrent moderation triggers for the same participant/branch
-- must not race and lose an increment.
-- ---------------------------------------------------------------------------
create or replace function public.increment_moderation_count(
  p_branch_id      uuid,
  p_participant_id uuid
)
returns table(count int)
language plpgsql
security definer
set search_path = public
as $$
begin
  INSERT INTO public.participant_profiles (branch_id, participant_id, moderation_count, updated_at)
  VALUES (p_branch_id, p_participant_id, 1, now())
  ON CONFLICT (branch_id, participant_id) DO UPDATE
    SET moderation_count = public.participant_profiles.moderation_count + 1,
        updated_at       = now();

  RETURN QUERY
    SELECT pp.moderation_count AS count
    FROM public.participant_profiles pp
    WHERE pp.branch_id = p_branch_id
      AND pp.participant_id = p_participant_id;
end;
$$;

-- Explicitly grant to service_role and revoke from PUBLIC so authenticated/anon
-- roles cannot call this security-definer RPC directly to inflate another
-- participant's escalation count (WR-02, mirrors 0015 SECTION 3 precedent).
grant execute on function public.increment_moderation_count(uuid, uuid) to service_role;
revoke execute on function public.increment_moderation_count(uuid, uuid) from public;

-- Drop the old text-typed signature — it is fully replaced by the uuid version
-- above; no caller should ever invoke the old text-param overload again.
drop function if exists public.increment_moderation_count(uuid, text);

-- ---------------------------------------------------------------------------
-- SECTION 4: upsert_participant_profile — NEW SECURITY DEFINER RPC for
-- positions/assertions/messages_sent/reactions_used (ProfileBuilderNode,
-- Plan 03). Must NOT overwrite moderation_count — that column is owned
-- exclusively by increment_moderation_count above.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_participant_profile(
  p_branch_id      uuid,
  p_participant_id uuid,
  p_positions      jsonb,
  p_assertions     jsonb,
  p_messages_sent  int,
  p_reactions_used int
)
returns table(
  branch_id        uuid,
  participant_id   uuid,
  positions        jsonb,
  assertions       jsonb,
  messages_sent    int,
  reactions_used   int,
  moderation_count int,
  updated_at       timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  INSERT INTO public.participant_profiles
    (branch_id, participant_id, positions, assertions, messages_sent, reactions_used, updated_at)
  VALUES
    (p_branch_id, p_participant_id, p_positions, p_assertions, p_messages_sent, p_reactions_used, now())
  ON CONFLICT (branch_id, participant_id) DO UPDATE
    SET positions      = EXCLUDED.positions,
        assertions     = EXCLUDED.assertions,
        messages_sent  = EXCLUDED.messages_sent,
        reactions_used = EXCLUDED.reactions_used,
        updated_at     = now();
        -- moderation_count is intentionally NOT touched here — owned by
        -- increment_moderation_count only.

  RETURN QUERY
    SELECT pp.branch_id, pp.participant_id, pp.positions, pp.assertions,
           pp.messages_sent, pp.reactions_used, pp.moderation_count, pp.updated_at
    FROM public.participant_profiles pp
    WHERE pp.branch_id = p_branch_id
      AND pp.participant_id = p_participant_id;
end;
$$;

grant execute on function public.upsert_participant_profile(uuid, uuid, jsonb, jsonb, int, int) to service_role;
revoke execute on function public.upsert_participant_profile(uuid, uuid, jsonb, jsonb, int, int) from public;

-- ---------------------------------------------------------------------------
-- SECTION 5: old moderation_counts table drop — AFTER the fold-in INSERT
-- (SECTION 2) has run. All reads/writes now go through participant_profiles.
-- ---------------------------------------------------------------------------
DROP TABLE public.moderation_counts;

-- ---------------------------------------------------------------------------
-- SECTION 6: phase_readiness_gate default (D-09, TRIGGER-02) — NO DB write.
-- packages/types/src/blueprint.ts's PhaseSequenceSchema.phase_readiness_gate
-- carries a Zod .default({ min_nodes: 3, min_messages_after: 5 }), so every
-- phase_sequence[] entry of the live debate-strategy-v1 Blueprint (which
-- predates this field) still parses successfully without a jsonb rewrite —
-- same "Zod supplies the default, no migration needed" posture already used
-- for drift_reply_probability (0006) and drift_detection_enabled (0015 is
-- the field itself; the *value* default there IS written via jsonb ||, but
-- phase_readiness_gate is per-phase-sequence-entry and Zod's array-item
-- default already covers every entry without a jsonb array-element rewrite,
-- which would be comparatively fragile). blueprint-loader.ts's Ajv schema
-- (SECTION covered in Task 2) declares phase_readiness_gate as optional
-- under phase_sequence.items.properties so Ajv does not reject entries that
-- omit it, matching this Zod-default posture.
