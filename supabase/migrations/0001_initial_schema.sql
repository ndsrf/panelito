-- =============================================================================
-- Migration: 0001_initial_schema
-- Project:   Project Multiverse (Panelito)
-- Created:   2026-06-09
--
-- Creates: sessions, messages, creator_settings tables
-- Enables: Row Level Security on all three tables
-- Policies:
--   sessions      → creator can INSERT/UPDATE; everyone authenticated can SELECT
--   messages      → INSERT-only for session participants (CHAT-05 immutability)
--   creator_settings → owner SELECT/INSERT/UPDATE only
--
-- References:
--   REQUIREMENTS.md: CHAT-04, CHAT-05, SESS-02, SESS-05, SESS-12
--   packages/types/src/session.ts, message.ts, api-key.ts
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Extensions
-- gen_random_uuid() is built into Postgres 13+ (pg_uuidv4/core)
-- gen_random_bytes() requires pgcrypto
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;


-- ---------------------------------------------------------------------------
-- Helper: updated_at trigger function
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- Table: public.sessions
-- ---------------------------------------------------------------------------
create table public.sessions (
  id                uuid        primary key default gen_random_uuid(),
  creator_id        uuid        not null references auth.users(id) on delete cascade,
  -- 6-char Crockford base32: no ambiguous chars (0, O, I, 1)
  short_code        text        not null unique
                               check (short_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  title             text,
  mode              text        check (mode in ('strategy', 'debate', 'red_team')),
  status            text        not null default 'active'
                               check (status in ('active', 'frozen', 'closed')),
  ai_response_count int         not null default 0,
  -- D-06 / SESS-12: global default is 150; creator can adjust in /settings
  ai_response_cap   int         not null default 150,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Bump updated_at on every update
create trigger sessions_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- Table: public.messages
-- CHAT-04: parent_id, path_id, session_id, author_id, content, canvas_snapshot_state
-- CHAT-05: immutable — no UPDATE/DELETE policies (enforced by absence)
-- ---------------------------------------------------------------------------
create table public.messages (
  id                    uuid        primary key default gen_random_uuid(),
  session_id            uuid        not null references public.sessions(id) on delete cascade,
  -- author_id has no FK to auth.users because guests use anon tokens with a
  -- distinct UUID that may differ from the auth.users(id) type expectations.
  -- The RLS policy enforces auth.uid() = author_id on INSERT.
  author_id             uuid        not null,
  display_name          text        not null,
  -- NULL for root messages; references messages(id) for replies/branches
  parent_id             uuid        references public.messages(id) on delete set null,
  -- Materialized path: "main" in Phase 1; branch paths added in Phase 3
  path_id               text        not null default 'main',
  -- Content capped at 4000 chars (T-01-07 DoS mitigation)
  content               text        not null check (length(content) between 1 and 4000),
  -- NULL in Phase 1; full canvas schema added in Phase 2
  canvas_snapshot_state jsonb,
  created_at            timestamptz not null default now()
);

-- Indexes for chat history fetch (CHAT-01: < 200ms perceived latency)
-- Index 1: session history ordered by time
create index messages_session_created_idx on public.messages (session_id, created_at);
-- Index 2: Phase 3 branch reads — filter by path_id within a session
create index messages_session_path_created_idx on public.messages (session_id, path_id, created_at);


-- ---------------------------------------------------------------------------
-- Table: public.creator_settings
-- AI-01 / T-01-01: encrypted_api_key is NEVER returned to the browser.
--   The Hono service-role client is the only reader.
--   Plan 06 will add column-level REVOKE from `authenticated` role.
-- ---------------------------------------------------------------------------
create table public.creator_settings (
  user_id           uuid        primary key references auth.users(id) on delete cascade,
  -- AES-256-GCM encrypted Anthropic API key; NULL until BYOK onboarding
  encrypted_api_key text,
  -- SESS-12 / D-06: global default AI response cap (applies to all sessions)
  api_response_cap  int         not null default 150
                               check (api_response_cap > 0 and api_response_cap <= 10000),
  updated_at        timestamptz not null default now()
);

-- Bump updated_at on every update
create trigger creator_settings_updated_at
  before update on public.creator_settings
  for each row execute function public.set_updated_at();


-- ===========================================================================
-- Row Level Security
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- RLS: sessions
-- ---------------------------------------------------------------------------
alter table public.sessions enable row level security;

-- Anyone authenticated (including anon guests) can read any session
-- D-03: read-only access for frozen/closed sessions is enforced in the app layer
create policy "sessions_select"
  on public.sessions
  for select
  using (auth.uid() is not null);

-- Only the creator can insert their own sessions
create policy "sessions_insert"
  on public.sessions
  for insert
  with check (auth.uid() = creator_id);

-- Only the creator can update their own sessions (freeze, close, rename)
create policy "sessions_update"
  on public.sessions
  for update
  using (auth.uid() = creator_id);

-- DELETE is intentionally denied — no policy created.


-- ---------------------------------------------------------------------------
-- RLS: messages
-- CHAT-05: immutable — only INSERT and SELECT policies exist.
-- ---------------------------------------------------------------------------
alter table public.messages enable row level security;

-- Anyone who can see the session can read its messages
create policy "messages_select"
  on public.messages
  for select
  using (
    exists (
      select 1 from public.sessions s
      where s.id = session_id
      and auth.uid() is not null
    )
  );

-- Messages can only be inserted into ACTIVE sessions by the identified author
-- T-01-05: auth.uid() = author_id prevents guest impersonation
create policy "messages_insert"
  on public.messages
  for insert
  with check (
    auth.uid() = author_id
    and (
      select status from public.sessions where id = session_id
    ) = 'active'
  );

-- UPDATE is intentionally denied — no policy created (CHAT-05).
-- DELETE is intentionally denied — no policy created (CHAT-05).


-- ---------------------------------------------------------------------------
-- RLS: creator_settings
-- T-01-01: Only the owner can read/write their own settings.
-- ---------------------------------------------------------------------------
alter table public.creator_settings enable row level security;

-- Owner can read their own settings row
create policy "creator_settings_select"
  on public.creator_settings
  for select
  using (auth.uid() = user_id);

-- Owner can create their own settings row (created during BYOK onboarding)
create policy "creator_settings_insert"
  on public.creator_settings
  for insert
  with check (auth.uid() = user_id);

-- Owner can update their own settings (API key, cap changes)
create policy "creator_settings_update"
  on public.creator_settings
  for update
  using (auth.uid() = user_id);

-- DELETE is intentionally denied — no policy created.


-- ===========================================================================
-- Short Code Generator
-- Produces a 6-char Crockford base32 string for sessions.short_code.
-- Called in Plan 04's session insert; defined here to keep schema self-contained.
-- Crockford alphabet: A-H, J-N, P-Z, 2-9 (excludes I, O, 0, 1 look-alikes)
-- Note: The regex ^[A-HJ-NP-Z2-9]{6}$ is the canonical spec from session.ts
-- ===========================================================================
create or replace function public.generate_short_code()
returns text
language plpgsql
security definer
as $$
declare
  -- A-H, J-N, P-Z (includes U), 2-9 → matches regex ^[A-HJ-NP-Z2-9]{6}$ (32 chars)
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
  rand_bytes bytea;
  byte_val int;
begin
  rand_bytes := gen_random_bytes(6);
  for i in 0..5 loop
    byte_val := get_byte(rand_bytes, i);
    result := result || substr(alphabet, (byte_val % 32) + 1, 1);
  end loop;
  return result;
end;
$$;
