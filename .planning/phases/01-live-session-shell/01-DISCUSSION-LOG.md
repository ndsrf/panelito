# Phase 1: Live Session Shell - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-08
**Phase:** 1-Live Session Shell
**Areas discussed:** Guest join experience, API key capture flow, Analytics panel placeholder, Project scaffold

---

## Guest Join Experience

| Option | Description | Selected |
|--------|-------------|----------|
| Branded landing page | /join/[code] page showing session title, creator name, and name-entry field | ✓ |
| Direct workspace + modal overlay | Link drops guests straight into workspace; blocking modal for name entry | |
| Simple full-screen name entry | Minimal page with just app logo and name field, no session context | |

**User's choice:** Branded landing page

---

| Option | Description | Selected |
|--------|-------------|----------|
| Session title + creator name | Shows what the session is about and who created it | ✓ |
| Session title only | Minimal — just the topic, creator stays private | |
| Session title + participant count | Social proof / FOMO with join count | |

**User's choice:** Session title + creator name

---

| Option | Description | Selected |
|--------|-------------|----------|
| Instant redirect into workspace | Guest clicks Join → directly in the chat, no confirmation | ✓ |
| Brief 'you're in' screen then workspace | 1-2 second interstitial before workspace | |
| Workspace loads with intro tour | 3-step overlay explaining 40/60 layout | |

**User's choice:** Instant redirect into workspace

---

| Option | Description | Selected |
|--------|-------------|----------|
| Clear status page on landing page | Shows 'frozen' / 'ended' on /join/[code] — no entry permitted | |
| Redirect to app home | Silent redirect with generic 'session unavailable' message | |
| Show workspace in read-only mode | Guest sees chat history but can't send messages | ✓ |

**User's choice:** Show workspace in read-only mode
**Notes:** Guest gets visibility into the session even when it's no longer active.

---

## API Key Capture Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Required at session creation | Key entry on the Create Session form — can't create without one | |
| Post-OAuth onboarding gate | One-time screen after first sign-in, before any other action | ✓ |
| Settings/profile drawer on demand | Key optional at session creation; prompted later | |

**User's choice:** Post-OAuth onboarding gate

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — settings/profile drawer | Key updatable via drawer accessible from workspace | |
| Yes — dedicated /settings page | Separate route for key management | ✓ |
| No — key set once at onboarding | YAGNI for v1, revisit in v2 | |

**User's choice:** Dedicated /settings page

---

| Option | Description | Selected |
|--------|-------------|----------|
| On the Create Session form | Cap is a per-session field with default of 150 | |
| In the settings page alongside the API key | Global default cap applied to all sessions | ✓ |
| Deferred — hardcode 150 | No configuration UI in Phase 1 | |

**User's choice:** Settings page alongside the API key (global default)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Focused single-purpose screen | Full-page centered card with logo, explanation, masked input, Verify & Save | ✓ |
| Multi-step onboarding wizard | Step 1: welcome. Step 2: key. Step 3: you're set | |
| Modal over the dashboard | Blocking modal over empty session dashboard | |

**User's choice:** Focused single-purpose screen

---

## Analytics Panel Placeholder

| Option | Description | Selected |
|--------|-------------|----------|
| Branded empty state with tagline | Product name/logo + 'The AI will analyze your conversation here' | ✓ |
| Static mock widget preview | Blurred/greyed-out skeleton of what widgets look like | |
| Minimal 'AI not connected' indicator | Small centered icon + one line of text | |

**User's choice:** Branded empty state with tagline

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — two distinct states | No key: link to /settings. Key set: branded tagline | ✓ |
| No — same state for both | Same branded state regardless of key status | |
| You decide | Claude picks simplest approach | |

**User's choice:** Two distinct states

---

| Option | Description | Selected |
|--------|-------------|----------|
| Shows a single 'Main' chip | Navigator renders with one chip in default branch color from Phase 1 | ✓ |
| Hidden in Phase 1 | Not rendered until Phase 3 branching ships | |
| Shows branch name + session title | Bar combines branch label and session title | |

**User's choice:** Shows a single 'Main' chip from Phase 1

---

## Project Scaffold

| Option | Description | Selected |
|--------|-------------|----------|
| Monorepo with two packages | apps/web + apps/api + packages/types in one repo | ✓ |
| Two separate repos | frontend/ and backend/ repos deployed independently | |
| Next.js only with API routes for now | Single Next.js app, migrate to Hono in Phase 2 | |

**User's choice:** Monorepo with two packages

---

| Option | Description | Selected |
|--------|-------------|----------|
| Turborepo | Official Vercel tooling, native Next.js support, intelligent caching | ✓ |
| pnpm workspaces only | No build orchestration, manage dev scripts manually | |
| Nx | More powerful but overkill for 2 packages | |

**User's choice:** Turborepo

---

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated /packages/types package | Shared types imported by both web and api | ✓ |
| Defined in api, imported by web | Types in apps/api, creates directional coupling | |
| Duplicated in each package | Fastest to bootstrap, manual sync required | |

**User's choice:** Dedicated /packages/types package

---

| Option | Description | Selected |
|--------|-------------|----------|
| Supabase local CLI | `supabase start` — local Postgres + Realtime + Auth via Docker | ✓ |
| Shared cloud Supabase project | Single cloud project for dev and prod | |
| Separate cloud Supabase projects | Dev + prod cloud projects, no Docker | |

**User's choice:** Supabase local CLI

---

## Claude's Discretion

- Next.js App Router routing structure and layout nesting
- Supabase schema design (table names, column types, RLS policies)
- QR code generation library
- Default color for the "Main" branch chip

## Deferred Ideas

- Per-session AI response cap configuration on Create Session form — made global in /settings instead
- Guest-facing introduction tour — explicitly deferred, guests go straight into workspace
