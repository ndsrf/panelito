# Project Multiverse

## Current Milestone: v3.0 — The Bots Must Help the Conversation Flow

**Goal:** Make bots proactive, personality-driven facilitators that autonomously manage conversation flow, build a coherent linked graph, and render contextually useful panel content — without being invoked by humans.

**Target features:**
- Proactive bot engine with 6 trigger types: silence window, Blueprint phase signal, semantic drift, unlinked assertion, fact-check trigger, moderation trigger
- Three distinct bot personalities: Coach (Socratic, empathetic), Devil's Advocate (adversarial, risk-surfacing), Analyst/Fact-Checker (neutral, data-driven)
- Coherent graph model: bots build typed edges between nodes — no more isolated hypotheses; every new node positioned in relation to existing ones
- Task-based model cost routing: heavy model for graph reasoning and fact-check; light model for facilitation moves and classification
- Per-session user profiles: in-memory participant model tracking stated positions, key assertions, engagement pattern
- Natural bot speech: no "[canvas updated]" or system artifacts in chat; all bot output is conversational and persona-consistent
- Contextual panel content: Blueprint + multi-bot logic determines widget selection dynamically

## What This Is

Project Multiverse is a synchronous, multi-user collaborative workspace where groups debate and explore ideas alongside specialized AI personas. A persistent split-screen interface keeps a live analytics panel (top 40%) synchronized with a real-time group chat (bottom 60%). Participants can fork any message into a parallel conversation branch, creating an explorable "multiverse" of alternative scenarios the group can compare. In v2.0, the analytics panel becomes a Neuro-Symbolic engine: the LLM acts as cartographer (mapping human speech into a structured ontology graph) rather than author — every node and edge on the canvas must be anchored to a human-defined Blueprint.

## Core Value

The live analytics panel stays perfectly synchronized with the active conversation branch in real time — transforming passive group chat into structured, visual collective thinking. Without the panel sync, it's just another group chat; without the branching engine, the panel is just a dashboard.

## Requirements

### Validated

<!-- v1.0 — phases 1–4 complete -->
- ✓ 40/60 split-screen layout with Visual Viewport API IME resilience — Phase 1
- ✓ OAuth session creator + QR guest entry (display name only) — Phase 1
- ✓ Live chat via Supabase Realtime with immutable message tree — Phase 1
- ✓ Conversation branching (fork, isolated context, color-coded timeline, branch merge) — Phase 3
- ✓ AI analytics panel (contextual widget selection, schema-validated updates) — Phase 2
- ✓ Scroll-spy + anchor jump between panel and chat — Phase 2
- ✓ Power Reactions (Insight, Intensify, Pin to Panel, Simplify) — Phase 2
- ✓ Multi-AI provider abstraction (Claude hardwired; abstraction layer for v2 swap) — Phase 4
- ✓ Session safety (auto-freeze, finalization summary, guest credential expiry) — Phase 1

<!-- v2.0 — phases 5–9 complete -->
- ✓ LangGraph JS orchestration (OrchestratorNode + domain-scoped Agent nodes) — Phase 5–7
- ✓ Domain Blueprints (JSON, Supabase-stored, Ajv runtime validation) — Phase 5
- ✓ Universal CanvasNode + CanvasEdge data model — Phase 5
- ✓ Universal Graph Canvas (xyflow/react) with committed + ghost nodes — Phase 9
- ✓ Confidence-based autonomy (direct >0.85 / ghost 0.5–0.85 / silent <0.5) — Phase 7
- ✓ Mic Check Pattern (human turn token) + Human Consensus Pattern — Phase 8
- ✓ Flex-Soft domain guardrails (DOMAIN_MATCH / DOMAIN_BRIDGE / DOMAIN_DRIFT) — Phase 7
- ✓ Langfuse observability (graph tracing, costs, latency, prompts) — Phase 6
- ✓ Debate/Strategy Blueprint (Hypothesis, Evidence, Counter-Argument, Action) — Phase 5

### Active

**Proactive Bot Engine (v3.0)**
- [ ] Bots speak autonomously without human invocation, triggered by 6 event types
- [ ] Silence-window trigger: bot intervenes after N seconds of no human message
- [ ] Blueprint phase-signal trigger: bot nudges group when conversation is ready to advance
- [ ] Semantic drift trigger: bot redirects when conversation leaves Blueprint scope
- [ ] Unlinked assertion trigger: bot surfaces connection between new claim and existing graph node
- [ ] Fact-check trigger: bot challenges clearly false or unsupported claims
- [ ] Moderation trigger: bot intervenes on rude or disruptive messages

**Bot Personalities (v3.0)**
- [ ] Coach bot: Socratic, empathetic — asks questions, never gives answers, guides humans to their own conclusions
- [ ] Devil's Advocate bot: adversarial — challenges assumptions, surfaces risks, plays skeptic
- [ ] Analyst/Fact-Checker bot: neutral, data-driven — tracks agreed vs. open, flags logical gaps, challenges false claims
- [ ] Each personality has distinct prompt character, speech patterns, and trigger affinity

**Coherent Graph Model (v3.0)**
- [ ] Every new canvas node linked via typed edges to ≥1 existing node (no isolated hypotheses)
- [ ] Bots derive and create edge relationships (SUPPORTS, CONTRADICTS, BUILDS_ON, QUESTIONS, etc.)
- [ ] Graph reflects actual argument structure, not a flat list of sentences
- [ ] In-memory conversation graph used by bots for facilitation context

**Model Cost Routing (v3.0)**
- [ ] Task-based LLM tier selection: heavy model for graph reasoning + fact-check; light model for facilitation + classification
- [ ] Model assignment configurable per operation type in Blueprint

**Per-Session User Profiles (v3.0)**
- [ ] Bots maintain in-memory profile per participant: stated positions, key assertions, engagement pattern
- [ ] Bots personalize facilitation using participant history ("you said earlier X — does this contradict that?")

**Natural Bot Speech (v3.0)**
- [ ] No "[canvas updated]" or system artifacts in chat bubbles
- [ ] All bot output is conversational, persona-consistent, and natural

**Contextual Panel Content (v3.0)**
- [ ] Blueprint + multi-bot logic determines widget selection dynamically
- [ ] Panel reflects the most useful view for the current conversation moment

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
*Last updated: 2026-07-09 after milestone v3.0 initialization*
