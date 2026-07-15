-- Migration: 0015_graph_coherence_triggers
--
-- Adds drift_detection_enabled to the debate-strategy-v1 Blueprint definition (D-09),
-- and a moderation_counts table for per-participant/per-branch escalation tracking (D-16).
--
-- Design: drift_detection_enabled follows the exact additive-jsonb-field idiom used
-- by 0014_personalities.sql SECTION 3 (bot_defaults/role_personalities/bot_cooldowns) —
-- an UPDATE ... SET definition = definition || '{...}'::jsonb, not a real column, since
-- Blueprint fields live in domain_blueprints.definition jsonb.
--
-- moderation_counts is a standalone table (branch_id, participant_id, count,
-- updated_at) — narrow and explicit per D-16, so Phase 13's PROFILE-01 full
-- profile model can absorb it later via a simple INSERT...SELECT without touching
-- sessions/branches. participant_id is `text` (not a FK to auth.users) because
-- guests authenticate via anon tokens whose id may not resolve against
-- auth.users(id) — same rationale as messages.author_id (0001_initial_schema.sql).
--
-- Trust boundary (T-12-03, Information Disclosure): moderation escalation data is
-- more sensitive than voice/tone config (personalities) or canvas content — it
-- records a participant's own history of moderation flags. This codebase has no
-- session/branch participant-membership table (sessions_select/canvas_nodes_select
-- both resolve to "any authenticated user who knows the session exists" — see
-- 0001_initial_schema.sql / 0008_nsai_foundation.sql), so the tightest policy this
-- schema can express is row-ownership: a participant may only SELECT their OWN
-- moderation_counts row (auth.uid()::text = participant_id), never another
-- participant's escalation count. This is intentionally NOT "any authenticated
-- user can SELECT" (the personalities/domain_blueprints precedent) — do not copy
-- that pattern here. Writes require service role (moderation-count.ts uses the
-- service-role client) — no INSERT/UPDATE/DELETE policy is granted to
-- `authenticated`, matching the domain_blueprints/personalities write-path pattern.

-- ---------------------------------------------------------------------------
-- SECTION 1: drift_detection_enabled (D-09)
-- Explicit opt-out for domains where an "on-topic scope" doesn't meaningfully
-- apply. Optional in DB; packages/types/src/blueprint.ts's Zod schema supplies
-- the default (true) for any Blueprint that predates this migration.
-- ---------------------------------------------------------------------------
UPDATE public.domain_blueprints
SET definition = definition || '{
  "drift_detection_enabled": true
}'::jsonb
WHERE id = 'debate-strategy-v1';


-- ---------------------------------------------------------------------------
-- SECTION 2: moderation_counts (D-16)
-- Per-participant, per-branch moderation-trigger escalation counter. Read via
-- getModerationCount(), incremented via incrementModerationCount()
-- (apps/api/src/lib/moderation-count.ts) — both fail-closed to count 0 on any
-- Supabase error (T-12-05: a false negative is a gentle nudge, never a
-- wrongful escalation).
-- ---------------------------------------------------------------------------
CREATE TABLE public.moderation_counts (
  branch_id       uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  participant_id  text        NOT NULL,
  count           int         NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, participant_id)
);

COMMENT ON TABLE public.moderation_counts IS
  'Per-participant, per-branch moderation-trigger escalation counter (D-16). '
  'Deliberately narrow/standalone so Phase 13''s full profile model (PROFILE-01) '
  'can fold this in later via INSERT...SELECT without touching sessions/branches. '
  'Fail-closed to count 0 on any read/write error (T-12-05).';

CREATE INDEX moderation_counts_branch_idx ON public.moderation_counts(branch_id);

ALTER TABLE public.moderation_counts ENABLE ROW LEVEL SECURITY;

-- T-12-03: row-ownership only — a participant can read their OWN escalation
-- count, never another participant's. Tighter than the "any authenticated
-- user" pattern used for personalities/canvas_nodes (see header note above).
CREATE POLICY "moderation_counts_select"
  ON public.moderation_counts
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND auth.uid()::text = participant_id
  );

-- No INSERT/UPDATE/DELETE policy for `authenticated` — writes go through
-- moderation-count.ts's service-role client only (bypasses RLS), same posture
-- as domain_blueprints (0008) and personalities (0014).


-- ---------------------------------------------------------------------------
-- SECTION 3: increment_moderation_count — atomic upsert-returning-count
-- Mirrors try_acquire_bot_lock's INSERT ... ON CONFLICT DO UPDATE atomic
-- compare-and-set shape (0012_bot_infrastructure.sql SECTION 5). Two
-- concurrent moderation triggers for the same participant on the same branch
-- must not race and lose an increment — the ON CONFLICT DO UPDATE SET
-- count = moderation_counts.count + 1 is a single atomic round-trip.
-- ---------------------------------------------------------------------------
create or replace function public.increment_moderation_count(
  p_branch_id      uuid,
  p_participant_id text
)
returns table(count int)
language plpgsql
security definer
set search_path = public
as $$
begin
  INSERT INTO public.moderation_counts (branch_id, participant_id, count, updated_at)
  VALUES (p_branch_id, p_participant_id, 1, now())
  ON CONFLICT (branch_id, participant_id) DO UPDATE
    SET count      = moderation_counts.count + 1,
        updated_at = now();

  RETURN QUERY
    SELECT mc.count
    FROM public.moderation_counts mc
    WHERE mc.branch_id = p_branch_id
      AND mc.participant_id = p_participant_id;
end;
$$;

-- WR-02 (see 0012 SECTION 8 precedent): PostgreSQL grants EXECUTE to PUBLIC by
-- default on CREATE FUNCTION. Explicitly grant to service_role and revoke from
-- PUBLIC so authenticated/anon roles cannot call this security-definer RPC
-- directly to inflate another participant's escalation count.
grant execute on function public.increment_moderation_count(uuid, text) to service_role;
revoke execute on function public.increment_moderation_count(uuid, text) from public;
