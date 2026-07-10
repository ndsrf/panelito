-- Migration: 0012_bot_infrastructure
-- Adds three server-side bot tables, a sessions budget-threshold column, and
-- three atomic RPC functions for concurrency/safety constructs (BOT-01 budget
-- guard + circuit breaker, BOT-02 arbitration lock, BOT-03 silence gate).
--
-- Design: All three RPCs MUST be atomic Postgres functions (not application
-- logic) because two near-simultaneous serverless /invoke calls on the same
-- branch will race — exactly the reason the existing mic lock lives in the DB.
-- The INSERT ... ON CONFLICT ... WHERE expired compare-and-set in
-- try_acquire_bot_lock provides the same atomic guarantee as try_acquire_mic
-- (migration 0010). check_and_record_bot_budget collapses circuit-check +
-- ledger-insert + windowed-SUM + circuit-trip into one round-trip (D-07).
--
-- Trust boundary: All three tables are service_role only. RLS is enabled with
-- no permissive policy for authenticated users — participants cannot read or
-- tamper with lock, budget, or circuit state. Access is via security-definer
-- RPCs granted exclusively to service_role (T-10-03).

-- ---------------------------------------------------------------------------
-- SECTION 1: bot_arbitration — one row per branch, upserted on lock attempt
-- ---------------------------------------------------------------------------

CREATE TABLE public.bot_arbitration (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  locked_until  timestamptz,
  winner_bot_id text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Unique index makes branch_id the ON CONFLICT target for the upsert in
-- try_acquire_bot_lock (one arbitration row per branch at all times).
CREATE UNIQUE INDEX bot_arbitration_branch_id_uidx ON public.bot_arbitration(branch_id);

COMMENT ON TABLE public.bot_arbitration IS
  'One row per branch tracking the current bot-lock holder and expiry. '
  'Mutated exclusively by try_acquire_bot_lock / release_bot_lock (BOT-02, T-10-04).';

ALTER TABLE public.bot_arbitration ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- SECTION 2: bot_budget_ledger — append-only invocation log per branch
-- ---------------------------------------------------------------------------

CREATE TABLE public.bot_budget_ledger (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  invoked_at  timestamptz NOT NULL DEFAULT now(),
  tokens_used int         NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Composite index on (branch_id, invoked_at) for the windowed SUM in
-- check_and_record_bot_budget: WHERE branch_id = X AND invoked_at > now() - 5min.
CREATE INDEX bot_budget_ledger_branch_window_idx ON public.bot_budget_ledger(branch_id, invoked_at);

COMMENT ON TABLE public.bot_budget_ledger IS
  'Append-only token-usage log. Each bot invocation inserts one row. '
  'check_and_record_bot_budget aggregates via windowed SUM for BYOK budget guard (BOT-01, T-10-05, T-10-06).';

ALTER TABLE public.bot_budget_ledger ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- SECTION 3: bot_circuit_state — one row per branch, upserted on trip/reset
-- ---------------------------------------------------------------------------

CREATE TABLE public.bot_circuit_state (
  branch_id    uuid        PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  circuit_open boolean     NOT NULL DEFAULT false,
  reset_at     timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bot_circuit_state IS
  'One row per branch. circuit_open=true blocks all bot invocations until '
  'reset_at elapses (10-minute pause). Tripped by check_and_record_bot_budget (BOT-01, T-10-05).';

ALTER TABLE public.bot_circuit_state ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- SECTION 4: sessions.bot_budget_threshold — per-session-overridable ceiling
-- ---------------------------------------------------------------------------

-- 1000 tokens per 5-minute window (= 200 tokens/min). Creator can override
-- per session. check_and_record_bot_budget reads this to determine the trip
-- threshold before inserting the ledger row (D-06).
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS bot_budget_threshold int NOT NULL DEFAULT 1000;

COMMENT ON COLUMN public.sessions.bot_budget_threshold IS
  'Per-session budget ceiling in tokens per 5-minute window (default 1000 = 200 tokens/min). '
  'Creator-overridable. Read by check_and_record_bot_budget to decide whether to trip the circuit (BOT-01, D-06).';

-- ---------------------------------------------------------------------------
-- SECTION 5: try_acquire_bot_lock — atomic compare-and-set bot lock
-- ---------------------------------------------------------------------------

create or replace function public.try_acquire_bot_lock(
  p_branch_id   uuid,
  p_bot_id      text,
  p_locked_until timestamptz
)
returns table(acquired boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Attempt to insert a new arbitration row, or update an existing one only
  -- when the lock is currently unset or has already expired. This is the
  -- same compare-and-set contract as try_acquire_mic (migration 0010):
  -- if the WHERE clause on the DO UPDATE matches nothing, the row is left
  -- untouched and FOUND is false — exactly one caller wins per window.
  INSERT INTO public.bot_arbitration (branch_id, locked_until, winner_bot_id)
  VALUES (p_branch_id, p_locked_until, p_bot_id)
  ON CONFLICT (branch_id) DO UPDATE
    SET locked_until  = excluded.locked_until,
        winner_bot_id = excluded.winner_bot_id
  WHERE bot_arbitration.locked_until IS NULL
     OR bot_arbitration.locked_until < now();

  IF FOUND THEN
    RETURN QUERY SELECT true;
  ELSE
    RETURN QUERY SELECT false;
  END IF;
end;
$$;

-- ---------------------------------------------------------------------------
-- SECTION 6: release_bot_lock — unconditionally clear the bot lock for a branch
-- ---------------------------------------------------------------------------

create or replace function public.release_bot_lock(p_branch_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  -- Mirrors release_mic: NULL-out both lock fields, leaving the arbitration row
  -- in place so the next INSERT ... ON CONFLICT can update it atomically.
  UPDATE public.bot_arbitration
  SET
    locked_until  = NULL,
    winner_bot_id = NULL
  WHERE branch_id = p_branch_id;
$$;

-- ---------------------------------------------------------------------------
-- SECTION 7: check_and_record_bot_budget — circuit-check + insert + SUM in one round-trip
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
  SELECT cs.circuit_open, cs.reset_at
  INTO   v_circuit_open, v_reset_at
  FROM   public.bot_circuit_state cs
  WHERE  cs.branch_id = p_branch_id;

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

-- ---------------------------------------------------------------------------
-- SECTION 8: RLS enforcement + grant execute to service_role only
-- ---------------------------------------------------------------------------

-- All three tables already have RLS enabled above. No SELECT/INSERT/UPDATE/DELETE
-- policy is created for the authenticated role — service_role bypasses RLS
-- entirely and accesses these tables only through the security-definer RPCs
-- granted below. This is consistent with the mic lock pattern (T-10-03).

grant execute on function public.try_acquire_bot_lock(uuid, text, timestamptz) to service_role;
grant execute on function public.release_bot_lock(uuid) to service_role;
grant execute on function public.check_and_record_bot_budget(uuid, int) to service_role;

-- WR-02: PostgreSQL grants EXECUTE to PUBLIC by default on CREATE FUNCTION.
-- The GRANT above only adds service_role; it does NOT remove the PUBLIC grant.
-- Explicitly revoke so that authenticated and anon roles cannot call these
-- security-definer RPCs directly (e.g. via a direct pg connection or psql).
-- Without this, an authenticated user could: inject token counts to trip the
-- circuit breaker (DoS), acquire a far-future bot lock to permanently block
-- bots, or release locks to bypass arbitration timing.
revoke execute on function public.try_acquire_bot_lock(uuid, text, timestamptz) from public;
revoke execute on function public.release_bot_lock(uuid) from public;
revoke execute on function public.check_and_record_bot_budget(uuid, int) from public;
