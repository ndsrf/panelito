# Walking Skeleton — Project Multiverse

**Phase:** 1
**Generated:** 2026-06-09

## Capability Proven End-to-End

A session creator can sign in via Google OAuth, create a session, share a QR code, and exchange real-time chat messages with a guest on a mobile-resilient 40/60 split-screen layout. The analytics panel renders a branded placeholder. No AI yet — the AI integration (Phase 2) plugs into a server route that already has BYOK key storage, server-side routing, upfront verification, and prompt caching scaffolding wired in Phase 1.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Repo topology | Turborepo monorepo, pnpm workspaces | D-10. `apps/web` (Next.js), `apps/api` (Hono), `packages/types` (shared TS). Single install, shared types are the contract between client and server. |
| Frontend framework | Next.js 15.5.x App Router (`next@15.5.19`) | CLAUDE.md stack table. SSR for OAuth callback + middleware token refresh, client components for the live workspace, RSC for static pages. |
| UI primitives | shadcn/ui (New York style, Zinc base), Tailwind v4 | UI-SPEC.md. Copy-owned components, Radix accessibility, Tailwind `@theme` CSS variables. |
| State / store | Zustand 5.x | CLAUDE.md. Minimal boilerplate; chat stream + presence state lives in a single store. |
| Backend framework | Hono 4.12.x on `@hono/node-server` | CLAUDE.md. Edge-compatible, streaming-native for the Phase 2 SSE endpoint, excellent TypeScript types. |
| Realtime | Supabase Realtime (broadcast + presence) | CLAUDE.md. Postgres-backed pub/sub eliminates a custom WebSocket server. Channels: `session:${id}` (broadcast), `presence:${id}` (presence). |
| Database | Supabase Postgres, RLS enabled | CLAUDE.md. `pgvector` reserved for future v2 features. |
| Auth | Supabase Auth (`@supabase/ssr`) — Google OAuth for creators, anonymous tokens for guests | SESS-01, SESS-04. No custom JWT logic. |
| AI key storage (BYOK) | `creator_settings.encrypted_api_key`, AES-256-GCM at rest, decrypted only inside Hono routes | AI-01, AI-02, AI-10. Never in `auth.users.user_metadata` (JWT-visible). `KEY_ENCRYPTION_SECRET` lives in API env. |
| Prompt caching scaffold | Hono `apps/api/src/routes/ai.ts` — static prefix block (system + persona + historical summary) with `cache_control: { type: 'ephemeral' }`, dynamic tail (last 8 messages + new user input) after the breakpoint | AI-11. Architecture in place in Phase 1; first live invocation in Phase 2. |
| Mobile layout | `--app-height` set once from `window.innerHeight` (inline script in `<head>`), `--keyboard-height` updated live from Visual Viewport API. Forbidden: `100vh`, `dvh`, `svh` in the workspace shell. | LAYOUT-01..04. Mobile IME resilience is a hard constraint per CLAUDE.md. |
| Local dev | Supabase CLI (`supabase start`) — local Postgres + Realtime + Auth in Docker. Migrations tracked in `/supabase/migrations/`. | D-12. No reliance on a remote project for everyday development. |
| Directory layout | `apps/web/app/{auth,onboarding,settings,sessions,join}/...`, `apps/web/{components,hooks,lib,store}/...`, `apps/api/src/{routes,lib,middleware}/...`, `packages/types/src/{session,message,branch,index}.ts`, `supabase/{config.toml,migrations/}` | Convention-over-configuration; phases 2-3 add components to the same folders. |
| Deployment target | Local full-stack run via `pnpm dev` (Turborepo orchestrates `next dev` + `tsx watch` + `supabase start`). Vercel + Railway are documented production targets but not deployed in Phase 1. | MVP first; deploy when there is something stable to demo at a public URL. |

## Stack Touched in Phase 1

- [x] Project scaffold — Turborepo + pnpm workspaces, Next.js 15.5.x web app, Hono API app, shared `@panelito/types`, Tailwind v4, shadcn init, lint + typecheck + test runner.
- [x] Routing — `/auth/sign-in`, `/auth/callback`, `/onboarding/api-key`, `/settings`, `/sessions/new`, `/sessions/[id]`, `/join/[code]`.
- [x] Database — `sessions`, `messages`, `creator_settings` tables with RLS. Real read (load history on session entry), real write (insert message → broadcast).
- [x] UI wired to API — Chat input posts to a Hono message route → Supabase Realtime broadcast → all clients render in < 200ms. QR modal renders a working join URL.
- [x] Local full-stack run command — `pnpm dev` brings up `supabase start`, `next dev` (port 3000), and `tsx watch apps/api/src/index.ts` (port 8787). Documented in `README.md`.

## Out of Scope (Deferred to Later Slices)

- AI streaming responses (`AI-03`, `AI-04`, `AI-05`, `AI-07`, `AI-08`) — Phase 2. The `apps/api/src/routes/ai.ts` route returns `501 Not Implemented` in Phase 1; only the prompt-caching scaffold and key-decryption helper are wired.
- Analytics widget rendering — bento / radar / scatter / pie (`PANEL-01`..`04`) — Phase 2. The analytics panel renders the branded empty state from D-08.
- Power reactions 🧠🔥📌🎯 (`REACT-01`..`05`) — Phase 2.
- Personas (`PERSONA-01`..`03`) — Phase 2.
- Conversation branching (`BRANCH-01`..`06`, `AI-09`) — Phase 3. Branch Navigator renders a single static "Main" chip in Phase 1 (D-09) so the structural position is established; fork/switch/limit logic is Phase 3.
- Per-session AI response cap configuration on the create-session form — deferred (CONTEXT.md). Cap is a global default in `/settings` instead (D-06).
- Guest onboarding tour — deferred (CONTEXT.md).
- Production deployment (Vercel + Railway) — documented in this skeleton, deployed when Phase 1 is demo-ready.
- Custom domain, paid Supabase project, monitoring/error tracking — post-MVP.

## Subsequent Slice Plan

Each later phase adds vertical slices on top of this skeleton without altering the architectural decisions above:

- **Phase 2 (AI + Analytics):** Wire `apps/api/src/routes/ai.ts` to stream Claude responses via SSE; render widgets in the analytics panel (`apps/web/components/workspace/AnalyticsPanel.tsx`); add power reactions and the Scientific Analyst persona toggle. The BYOK pipeline and prompt-caching scaffold from Phase 1 are consumed directly.
- **Phase 3 (The Multiverse):** Add `branches` table + fork action on long-press; extend the Branch Navigator chip list from "Main only" to N chips with per-branch color and live switching; route AI context through `path_id` filtering server-side; enforce the 5-branch limit.
