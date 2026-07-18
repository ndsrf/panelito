-- =============================================================================
-- Migration: 0017_system_message_role
-- Project:   Project Multiverse (Panelito)
--
-- Quick task 260718-t3h: Fix Langfuse capturing session freeze/reactivation
-- control notices as user messages.
--
-- Root cause: messages.role was `not null default 'user' check (role in
-- ('user','assistant'))` (0005_reactions_personas.sql). freezeSession /
-- unfreezeSession / closeSession (apps/api/src/lib/sessions-helpers.ts) insert
-- control-plane notices with author_id = SYSTEM_AUTHOR_ID but never set
-- `role`, so every notice silently defaulted to role='user' — polluting both
-- the LLM generation context (ai.ts, trigger-engine.ts) and Langfuse traces,
-- and corrupting `lastHumanMessage` participantId resolution.
--
-- This migration (a) widens the role check-constraint to allow 'system', and
-- (b) backfills existing control-plane rows (identified by the SYSTEM_AUTHOR_ID
-- sentinel, which ONLY freeze/unfreeze/close notices ever use) to role='system'.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Widen the role check-constraint to include 'system'.
-- The 0005 migration added the constraint inline/unnamed, so Postgres
-- auto-named it `messages_role_check` — drop defensively before re-adding.
-- ---------------------------------------------------------------------------
alter table public.messages
  drop constraint if exists messages_role_check;

alter table public.messages
  add constraint messages_role_check
  check (role in ('user', 'assistant', 'system'));

-- ---------------------------------------------------------------------------
-- Backfill existing control-plane rows. Scoped to the SYSTEM_AUTHOR_ID
-- sentinel ('00000000-0000-0000-0000-000000000000') — the all-zeros UUID
-- exclusively used by freezeSession/unfreezeSession/closeSession, so this
-- backfill cannot accidentally reclassify a real participant's message.
-- ---------------------------------------------------------------------------
update public.messages
  set role = 'system'
  where author_id = '00000000-0000-0000-0000-000000000000';
