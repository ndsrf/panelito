-- Migration: 0002_creator_settings_grants
--
-- Column-level lockdown for creator_settings.encrypted_api_key.
--
-- T-06-01: The authenticated PostgREST role (used by Supabase client) must NOT
-- be able to read the encrypted API key column — only the service role (Hono
-- backend) decrypts it. This revoke ensures that even if RLS is misconfigured,
-- the column remains unreadable to browser-side queries.
--
-- Steps:
--   1. REVOKE SELECT on the sensitive column from the authenticated role.
--   2. Re-grant SELECT only on the safe columns we do want the frontend to read.

-- Step 1: Lock down the sensitive column
revoke select (encrypted_api_key) on public.creator_settings from authenticated;

-- Step 2: Ensure the frontend-safe columns are readable
-- (These were granted via the default table grant in 0001; this makes the
-- column-level permission explicit and survives future table-level REVOKE ALL.)
grant select (user_id, api_response_cap, updated_at) on public.creator_settings to authenticated;
