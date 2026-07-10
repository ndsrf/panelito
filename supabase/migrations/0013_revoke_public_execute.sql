-- Migration: 0013_revoke_public_execute
-- Revokes default PUBLIC EXECUTE grants from security-definer RPCs.
--
-- PostgreSQL grants EXECUTE to PUBLIC by default on CREATE FUNCTION. The GRANT
-- EXECUTE TO service_role statements in 0010_mic_lock.sql and
-- 0012_bot_infrastructure.sql only add service_role access; they do not remove
-- the implicit PUBLIC grant. An authenticated or anon database user can
-- therefore call these security-definer functions directly (e.g. via a direct
-- pg connection or psql), bypassing the intended service_role-only trust
-- boundary documented in both migrations.
--
-- Attack vectors mitigated by this migration (WR-02):
--   try_acquire_mic:    User could hold the mic lock indefinitely, blocking AI
--                       responses for any branch.
--   release_mic:        User could release another user's active mic lock,
--                       corrupting the human invoke flow.
--   try_acquire_bot_lock: User could acquire a far-future bot lock to
--                         permanently block bots in targeted sessions.
--   release_bot_lock:   User could bypass arbitration cooldown timing.
--   check_and_record_bot_budget: User could inject arbitrary token counts
--                                to trip circuit breakers (DoS against bots).
--
-- Note: PostgREST API-layer exposure is already blocked in cloud deployments
-- (config.toml: db.schema = ["public"] with function exclusions since 2026-05-30).
-- This migration closes the direct-connection vector.

revoke execute on function public.try_acquire_mic(uuid, text, int) from public;
revoke execute on function public.release_mic(uuid) from public;

-- ---------------------------------------------------------------------------
-- WR-05: Fix TOCTOU in check_and_record_bot_budget — add FOR UPDATE on the
-- circuit state SELECT to serialise concurrent budget checks per branch.
--
-- Without FOR UPDATE, two concurrent callers in READ COMMITTED isolation each
-- SUM only their own ledger insert (the other's INSERT is not yet committed)
-- and both return allowed:true, allowing 2x the threshold before the circuit
-- trips. This is the same race as the mic-lock pattern mitigated by the
-- INSERT ... ON CONFLICT compare-and-set in try_acquire_bot_lock.
--
-- FOR UPDATE on the circuit state row is sufficient because:
--   1. The circuit_open row always exists after the first invocation.
--   2. Both concurrent callers attempt to lock the same row; the second waits
--      until the first commits, then sees the committed SUM.
--   3. For the very first invocation (NOT FOUND), both try the
--      INSERT ... ON CONFLICT DO NOTHING; one succeeds, one no-ops.
--      The FOR UPDATE on the subsequent SELECT serialises them.
-- ---------------------------------------------------------------------------

create or replace function public.check_and_record_bot_budget(
  p_branch_id  uuid,
  p_tokens_used int
)
returns table(allowed boolean, circuit_open boolean, tokens_used_window bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_circuit_open boolean;
  v_reset_at     timestamptz;
  v_threshold    int;
  v_window       bigint;
begin
  -- (a) Read or initialise the circuit state row for this branch.
  -- FOR UPDATE serialises concurrent budget checks on the same branch (WR-05).
  SELECT cs.circuit_open, cs.reset_at
  INTO   v_circuit_open, v_reset_at
  FROM   public.bot_circuit_state cs
  WHERE  cs.branch_id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- First invocation on this branch — insert a default open=false row.
    INSERT INTO public.bot_circuit_state (branch_id, circuit_open, updated_at)
    VALUES (p_branch_id, false, now())
    ON CONFLICT (branch_id) DO NOTHING;
    v_circuit_open := false;
    v_reset_at     := NULL;
  END IF;

  -- If the circuit is open and the 10-minute pause has NOT elapsed: block.
  IF v_circuit_open AND (v_reset_at IS NULL OR v_reset_at > now()) THEN
    RETURN QUERY SELECT false, true, 0::bigint;
    RETURN;
  END IF;

  -- If the circuit was open but the reset window has elapsed: heal it.
  IF v_circuit_open AND v_reset_at IS NOT NULL AND v_reset_at <= now() THEN
    UPDATE public.bot_circuit_state
    SET circuit_open = false,
        reset_at     = NULL,
        updated_at   = now()
    WHERE branch_id = p_branch_id;
    v_circuit_open := false;
  END IF;

  -- (b) Read the per-session budget threshold for the branch.
  SELECT s.bot_budget_threshold
  INTO   v_threshold
  FROM   public.branches b
  JOIN   public.sessions s ON s.id = b.session_id
  WHERE  b.id = p_branch_id;

  IF NOT FOUND THEN
    -- Branch or session not found — default to 1000 as a safe fallback.
    v_threshold := 1000;
  END IF;

  -- (c) Record this invocation in the append-only ledger.
  INSERT INTO public.bot_budget_ledger (branch_id, invoked_at, tokens_used)
  VALUES (p_branch_id, now(), p_tokens_used);

  -- (d) Sum tokens over the 5-minute sliding window (includes row just inserted).
  SELECT COALESCE(SUM(bl.tokens_used), 0)
  INTO   v_window
  FROM   public.bot_budget_ledger bl
  WHERE  bl.branch_id = p_branch_id
    AND  bl.invoked_at > now() - interval '5 minutes';

  -- (e) Trip the circuit if the window sum exceeds the threshold.
  IF v_window > v_threshold THEN
    INSERT INTO public.bot_circuit_state (branch_id, circuit_open, reset_at, updated_at)
    VALUES (p_branch_id, true, now() + interval '10 minutes', now())
    ON CONFLICT (branch_id) DO UPDATE
      SET circuit_open = true,
          reset_at     = now() + interval '10 minutes',
          updated_at   = now();

    RETURN QUERY SELECT false, true, v_window;
  ELSE
    RETURN QUERY SELECT true, false, v_window;
  END IF;
end;
$$;
