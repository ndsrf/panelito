-- Migration: 0011_ghost_expiry.sql
-- Description: pg_cron job to expire ghost canvas nodes after 60 seconds.
--
-- Phase 9 D-04: Ghost nodes are ephemeral — they are deleted by this job
-- once they are older than 60 seconds. This keeps the canvas_nodes table
-- clean and prevents ghost accumulation across invocations.
--
-- Notes:
--   - pg_cron is already enabled by migration 0004_auto_freeze_pg_cron.sql.
--     No CREATE EXTENSION needed here.
--   - canvas_nodes.status CHECK constraint already includes 'ghost' from
--     migration 0008_nsai_foundation.sql. No ALTER TABLE needed here.
--   - Silent node cleanup (audit trail retention) is deferred to v2.1 per
--     CONTEXT.md. This job only deletes ghost rows.

SELECT cron.schedule(
  'canvas-ghost-expiry',
  '* * * * *',
  $$
    DELETE FROM public.canvas_nodes
    WHERE status = 'ghost'
      AND created_at < now() - interval '60 seconds';
  $$
);
