-- Migration: 0006_multi_provider_keys
--
-- Multi-provider BYOK storage (D-11, D-13).
--
-- Steps:
--   1. Rename encrypted_api_key → anthropic_api_key (data-preserving).
--      Migration 0002 issued REVOKE SELECT (encrypted_api_key); after the rename
--      that REVOKE no longer covers the column — Step 3 re-issues it under the new name.
--   2. Add openai_api_key, gemini_api_key (text, nullable), and
--      active_provider (text, DEFAULT 'anthropic', CHECK constraint).
--   3. Column-level lockdown (V4 / Pitfall 8):
--      REVOKE SELECT on all three key columns from `authenticated`.
--      GRANT SELECT only on the public-safe columns.

-- Step 1: Rename the existing key column (data preserved)
ALTER TABLE public.creator_settings
  RENAME COLUMN encrypted_api_key TO anthropic_api_key;

-- Step 2: Add new key columns + active_provider
ALTER TABLE public.creator_settings
  ADD COLUMN IF NOT EXISTS openai_api_key text,
  ADD COLUMN IF NOT EXISTS gemini_api_key text,
  ADD COLUMN IF NOT EXISTS active_provider text DEFAULT 'anthropic'
    CHECK (active_provider IN ('anthropic', 'openai', 'gemini'));

-- Step 3: Column-level security lockdown (T-04-07)
-- Revoke SELECT on all encrypted key columns from the PostgREST authenticated role.
-- Only the Hono service-role client (server-side) may read these columns.
REVOKE SELECT (anthropic_api_key, openai_api_key, gemini_api_key)
  ON public.creator_settings FROM authenticated;

-- Re-grant SELECT only on the public-safe columns.
-- Explicitly listing ensures this survives future table-level REVOKE ALL.
GRANT SELECT (user_id, api_response_cap, active_provider, updated_at)
  ON public.creator_settings TO authenticated;
