-- =============================================================================
-- Migration: 0004_reactions_personas
-- Project:   Project Multiverse (Panelito)
-- Created:   2026-06-14
--
-- Creates: reactions table, adds active_personas to sessions, adds role to messages
-- Enables: RLS on reactions table, Realtime publication for reactions
--
-- References:
--   REQUIREMENTS.md: REACT-01, REACT-02, REACT-03, REACT-04, PERSONA-01
--   packages/types/src/reaction.ts, persona.ts
--   Security: T-02-01 (RLS INSERT), T-02-02 (CHECK emoji), T-02-03 (UNIQUE)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Table: public.reactions
-- REACT-01 through REACT-05: emoji reactions on messages
-- T-02-01: RLS INSERT policy WITH CHECK (auth.uid() = author_id)
-- T-02-02: CHECK constraint restricts emoji to 4 power emojis
-- T-02-03: UNIQUE(message_id, author_id, emoji) prevents row inflation
-- ---------------------------------------------------------------------------
create table public.reactions (
  id          uuid        primary key default gen_random_uuid(),
  message_id  uuid        not null references public.messages(id) on delete cascade,
  session_id  uuid        not null references public.sessions(id) on delete cascade,
  author_id   uuid        not null,
  emoji       text        not null check (emoji in ('🧠', '🔥', '📌', '🎯')),
  created_at  timestamptz not null default now(),
  unique (message_id, author_id, emoji)
);

-- Index for fetching reactions by message (REACT-01: count per message)
create index reactions_message_idx on public.reactions (message_id);


-- ---------------------------------------------------------------------------
-- RLS: reactions
-- Mirrors the messages RLS pattern from migration 0001
-- ---------------------------------------------------------------------------
alter table public.reactions enable row level security;

-- Anyone who can see the session can read its reactions
create policy "reactions_select"
  on public.reactions
  for select
  using (
    exists (
      select 1 from public.sessions s
      where s.id = session_id
      and auth.uid() is not null
    )
  );

-- Reactions can only be inserted by the identified author
-- T-02-01: mirrors messages_insert policy — prevents guest impersonation
create policy "reactions_insert"
  on public.reactions
  for insert
  with check (auth.uid() = author_id);

-- DELETE is intentionally denied — no policy created.
-- UPDATE is intentionally denied — reactions are immutable (react/unreact via new row).


-- ---------------------------------------------------------------------------
-- Supabase Realtime: broadcast reaction INSERTs to all participants
-- Open Question 2 recommendation: use Postgres Realtime INSERT subscription
-- consistent with the existing messages broadcast pattern.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.reactions;


-- ---------------------------------------------------------------------------
-- sessions.active_personas — PERSONA-01, PERSONA-02
-- Tracks which AI personas are active for each session.
-- Default: analista_cientifico is active in all new sessions.
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column active_personas text[] not null default '{analista_cientifico}';


-- ---------------------------------------------------------------------------
-- messages.role — AI-06 / AI-08 context assembly
-- Distinguishes AI persona turns ('assistant') from human turns ('user').
-- Required so assemblePromptArray() maps the correct Anthropic role per message.
-- Existing rows default to 'user' — retroactively correct since no AI rows exist yet.
-- ---------------------------------------------------------------------------
alter table public.messages
  add column role text not null default 'user'
  check (role in ('user', 'assistant'));
