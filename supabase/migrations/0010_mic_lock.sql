-- Migration: 0010_mic_lock
-- Adds mic lock columns to the branches table and two RPC functions for atomic
-- lock acquisition and release (HUMAN-01 — Mic Check Pattern).
--
-- Design: The lock is enforced at DB level, not application level, because two
-- near-simultaneous /invoke calls on serverless can race. The Postgres
-- UPDATE ... WHERE ... RETURNING pattern in try_acquire_mic provides atomic
-- compare-and-set — if the WHERE clause matches nothing, no UPDATE happens and
-- FOUND is false (same pattern as increment_ai_count in migration 0003).

-- ---------------------------------------------------------------------------
-- SECTION 1: Add mic lock columns to branches table
-- ---------------------------------------------------------------------------

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS mic_holder_id   text        NULL,
  ADD COLUMN IF NOT EXISTS mic_acquired_at timestamptz NULL;

COMMENT ON COLUMN public.branches.mic_holder_id IS
  'Session-scoped mic lock owner (sessionId string). NULL means the mic is free. '
  'Set atomically by try_acquire_mic(); cleared by release_mic(). (HUMAN-01)';

COMMENT ON COLUMN public.branches.mic_acquired_at IS
  'Timestamp when the current mic holder acquired the lock. Used to calculate '
  'expiry: lock is considered expired when now() - mic_acquired_at > p_expiry_seconds. '
  'NULL when mic is free. (HUMAN-01)';

-- ---------------------------------------------------------------------------
-- SECTION 2: try_acquire_mic — atomic compare-and-set mic acquisition
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- SECTION 3: release_mic — unconditionally clear the mic lock for a branch
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- SECTION 4: Grant execute to service_role only
-- ---------------------------------------------------------------------------

grant execute on function public.try_acquire_mic(uuid, text, int) to service_role;
grant execute on function public.release_mic(uuid) to service_role;
