# Phase 1: Live Session Shell - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a fully working multi-user session shell that can be demoed to real users: creator authenticates via OAuth, completes a one-time API key onboarding, creates a session, shares a QR code/link, guests join via a branded landing page and chat in real time on a mobile-resilient 40/60 split-screen layout. No AI responses yet — analytics panel shows a placeholder. Includes full BYOK infrastructure (encrypted key storage, server-side routing, upfront verification, prompt caching architecture).

**Requirements in scope:** LAYOUT-01–07, SESS-01–12, CHAT-01–06, AI-01, AI-02, AI-10, AI-11

**Out of scope for Phase 1:** AI streaming responses, analytics widget rendering, power reactions, personas, conversation branching (all Phase 2+).

</domain>

<decisions>
## Implementation Decisions

### Guest Join Experience
- **D-01:** Guest entry begins at a branded `/join/[code]` landing page showing the session title and creator name. Guest enters a display name and clicks Join.
- **D-02:** After submitting their name, guests are instantly redirected into the workspace — no interstitial screen or confirmation step.
- **D-03:** If a guest opens a join link for a frozen or closed session, they land in the workspace in **read-only mode** — they can see the chat history but cannot send messages.

### API Key Capture Flow
- **D-04:** First-time API key capture happens via a **post-OAuth onboarding gate** — after the creator signs in for the first time, they see a one-time, full-page focused screen (product logo + 1-2 sentence explanation + masked input + "Verify & Save" button) before they can do anything else.
- **D-05:** The key can be updated later via a dedicated `/settings` page (separate route, not a drawer).
- **D-06:** The SESS-12 AI response cap (default: 150) is a **global default in `/settings`** alongside the API key — not per-session. The cap applies to all sessions the creator runs.
- **D-07:** Panel state has **two distinct variants**: (a) no API key set → shows "Connect your API key in Settings" with a `/settings` link; (b) key set but no AI invoked → shows branded empty state with tagline.

### Analytics Panel Placeholder
- **D-08:** The analytics panel (top 40%) shows a **branded empty state with tagline** in Phase 1 — product name/logo + a short message like "The AI will analyze your conversation here." The two distinct states from D-07 use this as the base.
- **D-09:** The Branch Navigator bar renders from Phase 1 with a single **"Main" chip** in the default branch color, establishing the visual structure that Phase 3 will populate. It is NOT hidden or deferred.

### Project Scaffold
- **D-10:** **Turborepo monorepo** with: `apps/web` (Next.js 15), `apps/api` (Hono), `packages/types` (shared TypeScript types/schemas).
- **D-11:** Shared types (message schema, session, branch, etc.) live in `packages/types` — single source of truth imported by both `apps/web` and `apps/api`.
- **D-12:** **Supabase local CLI** for development — `supabase start` spins up local Postgres + Realtime + Auth via Docker. Migrations tracked in `/supabase/migrations/`.

### Claude's Discretion
- Routing structure within Next.js App Router (layout nesting, route groups) — Claude picks the cleanest pattern for the screens above.
- Exact Supabase schema design (table names, column types, RLS policies) — Claude follows the message schema from REQUIREMENTS.md (parent_id, path_id, session_id, author_id, content, canvas_snapshot_state) and designs surrounding tables.
- QR code generation library choice — Claude picks a lightweight browser-native or npm library.
- Color palette for the "Main" branch chip — Claude uses a sensible default that Phase 3 can extend.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & Requirements
- `.planning/PROJECT.md` — Core product definition, constraints, key decisions, tech environment
- `.planning/REQUIREMENTS.md` — Full v1 requirement list with IDs (LAYOUT-01–07, SESS-01–12, CHAT-01–06, AI-01/02/10/11). Read the Phase 1 traceability section.
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria, and requirement mapping. The 5 success criteria are the acceptance bar.

### Technology Stack
- `CLAUDE.md` (project root) — Recommended stack table with exact library choices and versions (Next.js 15, Hono, Supabase, Zustand, shadcn/ui, Tailwind, Framer Motion, etc.). Also lists what NOT to use.

No external ADRs or spec docs yet — requirements fully captured in decisions above and REQUIREMENTS.md.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project. No existing components, hooks, or utilities.

### Established Patterns
- None yet — Phase 1 establishes the patterns that Phases 2 and 3 will follow.

### Integration Points
- All code is new. The monorepo scaffold (D-10) is the first integration point to establish.

</code_context>

<specifics>
## Specific Ideas

- The guest join page URL pattern is `/join/[code]` — a short alphanumeric session code, not a full UUID.
- The onboarding API key screen is a "focused single-purpose" design: no sidebar, no navigation — just the product, the explanation, and the input. Comparable to a payment terminal screen.
- The Branch Navigator "Main" chip should use a chromatic gradient as specified in LAYOUT-05 — establishes the ambient color awareness pattern that branches extend.
- Read-only mode for frozen/closed sessions should clearly communicate the session state (frozen vs. ended) and disable the message input without hiding it.

</specifics>

<deferred>
## Deferred Ideas

- Per-session AI response cap configuration (SESS-12 UI on the Create Session form) — the cap is a global default in /settings instead. If per-session configuration is needed later, the settings-page approach is the starting point.
- Guest-facing introduction tour — mentioned as an option, explicitly deferred. Phase 1 guests go straight into the workspace.

None of the discussed ideas created scope outside Phase 1 boundary.

</deferred>

---

*Phase: 1-Live Session Shell*
*Context gathered: 2026-06-08*
