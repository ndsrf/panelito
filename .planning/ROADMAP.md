# Roadmap: Project Multiverse

**Total phases:** 4
**Requirements covered:** 54 / 54 ✓
**Structure:** Vertical MVP — each phase delivers a demoable user capability

---

## Phase Overview

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|-----------------|
| 1 | Live Session Shell | ✓ Complete | 7/7 |
| 2 | AI + Analytics | 6/6 | Complete   | 2026-06-21 |
| 3 | The Multiverse | Conversation branching — fork, navigate, isolate, switch timelines | BRANCH-01–06, AI-09 | 5 criteria |
| 4 | Multi-AI Providers | 4/4 | Complete    | 2026-06-18 |

---

### Phase 1: Live Session Shell

**Goal:** A fully working multi-user session — creator can authenticate, create a session, share a QR code, and have guests join and chat in real time on a mobile-resilient 40/60 layout. No AI yet; the analytics panel renders as a placeholder. This phase can be demoed to real users.

**Mode:** mvp

**Requirements:**

- LAYOUT-01, LAYOUT-02, LAYOUT-03, LAYOUT-04, LAYOUT-05, LAYOUT-06, LAYOUT-07
- SESS-01, SESS-02, SESS-03, SESS-04, SESS-05, SESS-06, SESS-07, SESS-08, SESS-09, SESS-10, SESS-11, SESS-12
- CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06
- AI-01, AI-02 (key storage + server routing), AI-10 (upfront key verification), AI-11 (prompt caching architecture)

**Success Criteria:**

1. A session creator can sign in via OAuth, create a session, and view a live QR code that guests can scan to enter with only a display name
2. 3+ guests can send and receive messages simultaneously with < 200ms perceived delivery; typing indicators appear correctly
3. The 40/60 layout holds its proportions when the virtual keyboard opens on iOS Safari and Android Chrome — the analytics panel does not compress
4. The Branch Navigator sticky bar renders between panel and chat with the correct structural position; creator can freeze and manually close a session
5. Auto-freeze triggers after 15 min sustained absence (30s de-bounce prevents flicker on brief disconnects); submitting an invalid API key shows an immediate error before saving; a guest who reloads their browser re-enters the session without the identity-claim screen; blank-titled sessions auto-name after 3 messages; prompt array structure achieves > 80% cache hit rate under concurrent multi-user load

**Plans:** 7/7 plans executed ✓

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Walking Skeleton scaffold: Turborepo monorepo, Next.js + Hono apps, Supabase local + initial migration

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Vertical slice 1: Creator Google OAuth sign-in + protected layout + Playwright E2E (SESS-01)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Vertical slice 2: Session CRUD + QR share + branded guest join + SESS-10 persistence (SESS-02..06, SESS-08, SESS-10)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-04-PLAN.md — Vertical slice 3: Mobile-resilient 40/60 workspace shell with Branch Navigator + Error Boundary (LAYOUT-01..05, LAYOUT-07)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-05-PLAN.md — Vertical slice 4: Realtime chat + presence + LAYOUT-06 gesture scaffolds (CHAT-01..06, LAYOUT-06)
- [x] 01-06-PLAN.md — BYOK: onboarding gate, encrypted key storage, upfront verification, prompt caching scaffold, /settings (AI-01, AI-02, AI-10, AI-11)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 01-07-PLAN.md — Lifecycle hardening: auto-freeze (SESS-07/11), auto-name (SESS-09), AI cap (SESS-12), rate limits

---

### Phase 2: AI + Analytics

**Goal:** The full split-screen experience — Claude streams into the chat when invoked, the analytics panel renders the appropriate widget type (bento, radar, scatter, or pie), power reactions trigger AI instructions, and the Analyst persona is labeled on each response. The product now feels like "Project Multiverse."

**Mode:** mvp

**Requirements:**

- AI-03, AI-04, AI-05, AI-06, AI-07, AI-08
- PANEL-01, PANEL-02, PANEL-03, PANEL-04
- REACT-01, REACT-02, REACT-03, REACT-04, REACT-05
- PERSONA-01, PERSONA-02, PERSONA-03

**Success Criteria:**

1. The AI streams a response only when a participant uses `@analista` or applies 🔥📌🎯 reactions — it does not auto-respond to every message; response is withheld if a human is currently typing
2. The AI selects and renders the correct widget type for the conversation content (e.g. multi-axis topic → radar chart; key points → bento grid); widget is visible and well-formatted
3. A deliberately malformed AI panel payload is silently blocked and the last stable panel state is preserved without crashing the UI or breaking the chat stream
4. All 4 power reactions (🧠🔥📌🎯) produce the correct AI behavior; reactions apply optimistically on the local client
5. Each AI message is clearly labeled with "Analista Científico" persona badge; creator can toggle the persona off mid-session and the AI stops responding

**Plans:** 6/6 plans complete

Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Foundation: migration (reactions table, active_personas, messages.role) + schema push + shared Zod types (panel/reaction/persona) + AIProvider interface + compressHistory (AI-04/05/08, PANEL-01/04, REACT-01..04, PERSONA-01)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — AI streaming backend: real streamSSE /invoke route (branch context, bot-activation, snapshot persist) + reactions CRUD route (AI-03/04/06/07/08, PANEL-04, REACT-01..04)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-03-PLAN.md — Frontend AI slice: fetch SSE consumer hook + panelStore + AI bubble variant + presence soft-lock + @analista trigger (AI-03/04/05/07, PANEL-04, PERSONA-03)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-04-PLAN.md — Widget slice: 4 Recharts widgets + registry + AnalyticsPanel dynamic zone + AnimatePresence morph + branch badge (PANEL-01/02/03/04)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 02-05-PLAN.md — Reactions slice: optimistic popover POST + reaction badges + Realtime sync + reaction-triggered AI (REACT-01..05)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 02-06-PLAN.md — Persona slice: personas toggle route + creation-form picker + CreatorControls drawer with live Switch + OFF stops AI (PERSONA-01/02/03)

---

### Phase 3: The Multiverse

**Goal:** Conversation branching — any participant can fork from any historical message to create a parallel timeline, navigate between branches via the Branch Navigator, and the AI context is fully isolated per branch. Switching branches instantly re-renders the analytics panel. The product's core differentiator is now complete.

**Mode:** mvp

**Requirements:**

- BRANCH-01, BRANCH-02, BRANCH-03, BRANCH-04, BRANCH-05, BRANCH-06
- AI-09 (Branch Auto-Labeling — flash model names each new branch automatically)

**Success Criteria:**

1. A participant can long-press any historical message and fork from it; within 200ms a flash model call returns a 2–3 word semantic label that automatically names the branch — no user input required for naming
2. Two parallel branches can each accumulate independent AI conversations; a Claude call in Branch B never contains any content from Branch A (verified by inspecting server-side context assembly)
3. Switching between branches in the Navigator instantly re-renders the analytics panel to the latest snapshot of the selected branch and updates the bar's gradient to the new branch color
4. Creating a 6th branch displays a clear, non-crashing error message; the 5-branch limit is enforced server-side, not just client-side
5. A full end-to-end multiverse session works: 2 branches created, AI invoked in each, panels diverge correctly, switching back and forth shows correct isolated states

---

### Phase 4: Multi-AI Providers

**Goal:** Extend the `AIProvider` abstraction so OpenAI (via `openai` SDK) and Gemini (via `@google/genai` v2 SDK) drive the full split-screen experience — streaming chat and `render_panel` tool calls — at full parity with the existing Anthropic adapter. The creator selects their preferred provider in `/settings`; the rest of the app is provider-unaware. Switching providers is invisible to participants.

**Mode:** standard

**Requirements:**

- Extends AI-01, AI-02, AI-03, AI-04, AI-05, AI-08, AI-10 (no new functional requirement IDs)
- Implements CONTEXT decisions D-01 through D-17

**Success Criteria:**

1. The `AIProvider` interface and `renderPanelTool` are provider-agnostic (own types in `@panelito/types`, no Anthropic SDK imports); each adapter converts internally (D-01)
2. All three providers (Anthropic, OpenAI, Gemini) produce valid `render_panel` tool calls during streaming — gated by `PanelWidgetSchema.safeParse()` before reaching the panel (D-14, AI-05)
3. The creator manages three separate provider keys in `/settings` with upfront per-provider verification; clicking a provider icon activates it; keys for inactive providers persist silently (D-09, D-10, D-12)
4. The active provider is persisted in `creator_settings.active_provider`; the `/invoke` route reads it and instantiates the correct adapter via a factory; all AI tasks (analysis + compression) use the active provider's task-to-model mapping (D-03, D-04, D-05, D-13)
5. New key columns (`openai_api_key`, `gemini_api_key`) are column-level locked to the service role; switching active provider changes which provider streams every session with no other change required (V4 access control, D-05)

**Plans:** 4/4 plans complete

Plans:
**Wave 1**

- [x] 04-01-PLAN.md — Provider-agnostic types + AIProvider interface refactor + AnthropicAdapter extraction + SDK install (D-01, D-02)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02-PLAN.md — OpenAI + Gemini adapters + adapter factory + TASK_MODELS config + per-provider key verification (D-03, D-04, D-14, D-15, D-16)
- [x] 04-03-PLAN.md — Migration 0006 (multi-provider key columns + active_provider + REVOKE/GRANT) + schema push + multi-provider keys/settings routes (D-09..13)

**Wave 3** *(blocked on Waves 2 completion)*

- [x] 04-04-PLAN.md — Wire /invoke to the adapter factory + provider-aware compressHistory + PanelWidgetSchema gate + three-provider /settings UI (D-03, D-05, D-07, D-09, D-14, D-17)

---

## Milestone: v1 Complete

All 44 v1 requirements delivered. The product can be used in a real group session: multi-user chat, live AI analytics panel, conversation branching, power reactions, and mobile-resilient layout.

**Next milestone:** v2 — Time-travel UI, Devil's Advocate persona, branch merge synthesis, session export.

---
*Roadmap created: 2026-06-08*
