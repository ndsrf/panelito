# Project Multiverse

## What This Is

Project Multiverse is a synchronous, multi-user collaborative workspace where groups debate and explore ideas alongside specialized AI personas. A persistent split-screen interface keeps a live analytics panel (top 40%) synchronized with a real-time group chat (bottom 60%). Participants can fork any message into a parallel conversation branch, creating an explorable "multiverse" of alternative scenarios that the group can later compare and merge into a consensus pathway.

## Core Value

The live analytics panel stays perfectly synchronized with the active conversation branch in real time — transforming passive group chat into structured, visual collective thinking. Without the panel sync, it's just another group chat; without the branching engine, the panel is just a dashboard.

## Requirements

### Validated

(None yet — ship to validate)

### Active

**Workspace & Layout**
- [ ] 40/60 split-screen layout (top: analytics panel, bottom: chat stream) that survives mobile virtual keyboard (IME) without collapsing the panel
- [ ] Layout locks `--app-height` on mount and uses Visual Viewport API to handle keyboard displacement entirely within the chat segment
- [ ] Responsive to mobile single-thumb operation

**Session & Onboarding**
- [ ] Session Creator authenticates via OAuth (social/corporate provider)
- [ ] Creator generates a shareable QR code and session link for guest entry
- [ ] Guests enter by scanning QR code and providing only a temporary display name — no registration, no password
- [ ] Creator can freeze session (disable all input) and formally close session

**Real-Time Multi-User Chat**
- [ ] Live chat stream powered by Supabase Realtime with sub-second message propagation
- [ ] Each message carries `parent_id` and `path_id` for tree traversal
- [ ] Historical messages are immutable — no overwrites, only forks

**Conversation Branching (Multiverse Engine)**
- [ ] Any participant can fork from any message in the history to create a new parallel branch
- [ ] Branching creates a color-coded isolated timeline; other users stay on their current branch
- [ ] Branch context windows are fully isolated — AI never bleeds context across branches
- [ ] Visual branch/timeline selector to navigate between parallel tracks
- [ ] Administrator can merge two branches, synthesizing their conclusions into a new unified timeline

**AI Analytics Panel**
- [ ] AI selects and renders appropriate widget type based on conversation content (bento grid, radar chart, scatter plot)
- [ ] Panel re-renders instantly when user switches to a different branch
- [ ] Each message node stores a `canvas_snapshot_state` for time-travel UI
- [ ] Scroll-spy: scrolling back in chat smoothly updates panel to match that moment in time
- [ ] Anchor jump: each panel widget has an anchor icon that jumps chat to the message that last modified it
- [ ] Panel updates pass schema validation before rendering — corrupted payloads are silently blocked, preserving last stable state

**Multi-Agent AI Personas**
- [ ] Scientific Analyst persona: rigorous, neutral, validates data consistency and flags logical fallacies
- [ ] Devil's Advocate persona: surfaces hidden risks, optimism bias, and market failure points
- [ ] AI response stream separates `text_stream` (chat bubbles) from `ui_mutation_block` (panel updates)

**Power Reactions**
- [ ] 🧠 Insight: marks message as key concept for session summary
- [ ] 🔥 Intensify: commands AI to critically attack the statement and surface risks
- [ ] 📌 Pin to Panel: promotes text content to a permanent visual card on the analytics panel
- [ ] 🎯 Simplify: instructs AI to summarize its last response into concise bullet points

**Claude Integration**
- [ ] Hardwired to Anthropic Claude API for v1 (BYOK deferred to v2)
- [ ] Structured output: dual-channel streaming for text and UI mutations
- [ ] Session Creator provides their own API key via a simple UI flow (masked, not exposed to guests)

**Session Safety**
- [ ] Auto-freeze: if creator is inactive or disconnected for 15+ minutes, session enters `Frozen` state
- [ ] Session finalization generates a basic summary of the active branch's conclusions
- [ ] Guest credentials expire on session close; ephemeral data scrubbed after configurable grace period

### Out of Scope

- BYOK / multi-provider model (v2) — builds on hardwired Claude; add after v1 is validated
- B2B anonymous mode — requires role-based identity layer; defer
- One-click business case generator — complex post-processing; defer to v2
- Recipe / food-chemistry mode — illustrative domain only, not a v1 target market
- Political persona clones (Pedro Sánchez, Pablo Iglesias) — examples of multi-agent extensibility, not built-in v1 presets
- Per-user message quotas and credit top-ups — cost control v2; creator API key absorbs cost in v1
- Drag-and-drop branch merge UI — core merge logic is v1, drag-and-drop polish is v2

## Context

The project targets two markets: B2C social gatherings (dinner debates, roleplays, hobbyist groups) and B2B corporate facilitation (strategy workshops, red team sessions). V1 validates the core workspace interaction pattern with the strategy/debate use case before expanding to vertical-specific modes or enterprise features.

**Technical environment:**
- Frontend: React (TypeScript)
- Backend: Node.js
- Database & Realtime: Supabase (Postgres + Realtime subscriptions)
- AI: Anthropic Claude API (hardwired, creator provides their own key via UI)
- Real-time message tree: adjacency list stored in Supabase; `path_id` traversal client-side
- Widget rendering: AI outputs validated JSON schema before React renders panel updates
- Mobile: Visual Viewport API + CSS custom properties for IME resilience

**Solo developer build** — phases must be self-contained and completable by one person.

## Constraints

- **Solo:** Each phase must be scoped for one developer to complete independently
- **AI coupling:** Claude API is the only AI provider in v1; abstraction layer should be clean to allow v2 swap-in
- **Supabase-first:** Real-time subscriptions, auth, and storage handled by Supabase to minimize backend complexity
- **Mobile-first:** The 40/60 split must hold on iOS/Android with virtual keyboard open — the IME handling is a hard constraint, not polish
- **Budget:** BYOK means zero AI compute cost to the platform; creator's API key is the cost surface

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Multi-user from day one | The collaborative dynamic IS the product — solo testing wouldn't validate the core value | — Pending |
| Hardwire Claude v1 | Simplifies v1 architecture; BYOK adds abstraction overhead before the UX is proven | — Pending |
| All AI widget types in v1 | AI selects widget contextually — restricting to one type would make the panel feel rigid and unmemorable | — Pending |
| Recipe mode deferred | Illustrative domain; not the primary v1 market | — Pending |
| Node.js + Supabase | TypeScript full-stack, Realtime built-in, minimal backend ops for solo dev | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-08 after initialization*
