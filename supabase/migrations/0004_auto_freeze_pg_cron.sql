-- Migration: 0004_auto_freeze_pg_cron.sql
-- Description: Adds last_creator_activity_at and a pg_cron job to auto-freeze inactive sessions.

-- 1. Enable pg_cron extension (requires superuser, usually available in Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Add last_creator_activity_at column to sessions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_creator_activity_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Create a function to update the activity timestamp
CREATE OR REPLACE FUNCTION update_session_activity(session_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE sessions
  SET last_creator_activity_at = NOW()
  WHERE id = session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create the auto-freeze function
CREATE OR REPLACE FUNCTION auto_freeze_inactive_sessions()
RETURNS VOID AS $$
DECLARE
  system_author_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  -- Update sessions to frozen
  WITH frozen_sessions AS (
    UPDATE sessions
    SET status = 'frozen'
    WHERE status = 'active'
      AND last_creator_activity_at < NOW() - INTERVAL '15 minutes'
    RETURNING id
  )
  -- Insert system messages for frozen sessions
  INSERT INTO messages (
    session_id,
    author_id,
    display_name,
    content,
    path_id
  )
  SELECT 
    id, 
    system_author_id, 
    'system', 
    'Esta sesion se congelo automaticamente por inactividad del creador.',
    'main'
  FROM frozen_sessions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Schedule the job to run every minute
SELECT cron.schedule(
  'auto-freeze-inactive-sessions-job',
  '* * * * *', -- every minute
  'SELECT auto_freeze_inactive_sessions()'
);
