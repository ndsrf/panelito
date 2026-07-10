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
