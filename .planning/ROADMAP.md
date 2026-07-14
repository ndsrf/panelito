# Roadmap: Project Multiverse

## Milestones

- ✅ **v1.0 MVP** — Phases 1–4 (shipped 2026-06-18)
- ✅ **v2.0 NSAI — Neuro-Symbolic Collaborative Engine** — Phases 5–9 (complete 2026-07-09)
- 🚧 **v3.0 — The Bots Must Help the Conversation Flow** — Phases 10–14 (in progress)

---

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1–4) — SHIPPED 2026-06-18</summary>

### Phase 1: Live Session Shell

**Goal**: A fully working multi-user session — creator can authenticate, create a session, share a QR code, and have guests join and chat in real time on a mobile-resilient 40/60 layout. No AI yet; the analytics panel renders as a placeholder. This phase can be demoed to real users.
**Plans**: 7/7 plans executed ✓

Plans:

- [x] 01-01-PLAN.md — Walking Skeleton scaffold: Turborepo monorepo, Next.js + Hono apps, Supabase local + initial migration
- [x] 01-02-PLAN.md — Vertical slice 1: Creator Google OAuth sign-in + protected layout + Playwright E2E (SESS-01)
- [x] 01-03-PLAN.md — Vertical slice 2: Session CRUD + QR share + branded guest join + SESS-10 persistence (SESS-02..06, SESS-08, SESS-10)
- [x] 01-04-PLAN.md — Vertical slice 3: Mobile-resilient 40/60 workspace shell with Branch Navigator + Error Boundary (LAYOUT-01..05, LAYOUT-07)
- [x] 01-05-PLAN.md — Vertical slice 4: Realtime chat + presence + LAYOUT-06 gesture scaffolds (CHAT-01..06, LAYOUT-06)
- [x] 01-06-PLAN.md — BYOK: onboarding gate, encrypted key storage, upfront verification, prompt caching scaffold, /settings (AI-01, AI-02, AI-10, AI-11)
- [x] 01-07-PLAN.md — Lifecycle hardening: auto-freeze (SESS-07/11), auto-name (SESS-09), AI cap (SESS-12), rate limits

### Phase 2: AI + Analytics

**Goal**: The full split-screen experience — Claude streams into the chat when invoked, the analytics panel renders the appropriate widget type (bento, radar, scatter, or pie), power reactions trigger AI instructions, and the Analyst persona is labeled on each response.
**Plans**: 6/6 plans complete

Plans:

- [x] 02-01-PLAN.md — Foundation: migration + schema + shared Zod types + AIProvider interface + compressHistory
- [x] 02-02-PLAN.md — AI streaming backend: real streamSSE /invoke route + reactions CRUD route
- [x] 02-03-PLAN.md — Frontend AI slice: fetch SSE consumer hook + panelStore + AI bubble variant + @analista trigger
- [x] 02-04-PLAN.md — Widget slice: 4 Recharts widgets + registry + AnalyticsPanel dynamic zone
- [x] 02-05-PLAN.md — Reactions slice: optimistic popover POST + reaction badges + Realtime sync
- [x] 02-06-PLAN.md — Persona slice: personas toggle route + creation-form picker + CreatorControls drawer

### Phase 3: The Multiverse

**Goal**: Conversation branching — any participant can fork from any historical message to create a parallel timeline, navigate between branches, and the AI context is fully isolated per branch.
**Plans**: 4/4 plans complete

Plans:

- [x] 03-01-PLAN.md
- [x] 03-02-PLAN.md
- [x] 03-03-PLAN.md
- [x] 03-04-PLAN.md

### Phase 4: Multi-AI Providers

**Goal**: Extend the AIProvider abstraction so OpenAI and Gemini drive the full split-screen experience at full parity with Anthropic. Creator selects provider in /settings; the rest of the app is provider-unaware.
**Plans**: 4/4 plans complete

Plans:

- [x] 04-01-PLAN.md — Provider-agnostic types + AIProvider interface refactor + AnthropicAdapter extraction
- [x] 04-02-PLAN.md — OpenAI + Gemini adapters + adapter factory + per-provider key verification
- [x] 04-03-PLAN.md — Migration 0006 (multi-provider key columns) + schema push + settings routes
- [x] 04-04-PLAN.md — Wire /invoke to adapter factory + provider-aware compressHistory + three-provider settings UI

</details>

---

<details>
<summary>✅ v2.0 NSAI — Neuro-Symbolic Collaborative Engine (Phases 5–9) — COMPLETE 2026-07-09</summary>

### 🚧 v2.0 NSAI — Neuro-Symbolic Collaborative Engine

**Milestone Goal:** Replace the passive analytics panel with a stateful symbolic graph — orchestrated by LangGraph, disciplined by runtime-loaded Domain Blueprints, and synchronized in real time across all session participants. Every node and edge on the canvas is anchored to a human-defined ontology.

---

## Phase Details

### Phase 5: Foundation

**Goal**: All infrastructure required for the NSAI engine exists and is verified before any LangGraph or agent code is written — packages installed, Supabase tables migrated with RLS, TypeScript types published to the shared package, Blueprint loading from the database working end-to-end, and the Debate/Strategy Blueprint passing Ajv validation.
**Depends on**: Phase 4
**Requirements**: INFRA-01, INFRA-02, INFRA-03, BLUE-01, BLUE-02, BLUE-05, CANVAS-01
**Success Criteria** (what must be TRUE):

  1. `pnpm install` succeeds with all new packages (LangGraph, Langfuse, Ajv, Postgres checkpointer, @xyflow/react); the Hono API routes are declared Node.js runtime (not Edge) in vercel.json with maxDuration configured
  2. Three new Supabase tables (canvas_nodes, canvas_edges, domain_blueprints) are visible in the Supabase dashboard with correct RLS policies; LangGraph checkpointer tables exist in the langgraph schema after checkpointer.setup()
  3. `CanvasNode`, `CanvasEdge`, `Blueprint`, and `CanvasOp` types are importable from `@panelito/types` in both apps/api and apps/web without duplication
  4. The Debate/Strategy Blueprint (Hypothesis, Evidence, Counter-Argument, Action; SUPPORTS, CONTRADICTS, BUILDS_ON, REFUTES) is seeded in domain_blueprints and passes Ajv meta-schema validation; an invalid Blueprint is rejected with a descriptive error
  5. A developer can call the blueprint loader, receive the active Blueprint for a session, and confirm that validators are compiled once at module load — not per request

**Plans**: TBD

### Phase 6: Graph Construction + Checkpointer

**Goal**: The full LangGraph StateGraph (OrchestratorNode → AgentNode → MutationGateNode) is built, unit-tested in isolation with MemorySaver, then swapped to the PostgresSaver checkpointer and verified for cross-request state resumption — all before a single character of the /invoke route is touched. Observability is wired here so every graph run is traced from the moment the graph exists.
**Depends on**: Phase 5
**Requirements**: BLUE-03, BLUE-04, ORCH-02, ORCH-03, ORCH-04, ORCH-05, HUMAN-03, OBS-01, OBS-02
**Success Criteria** (what must be TRUE):

  1. A unit test drives the StateGraph with a sample input and a loaded Debate Blueprint; OrchestratorNode classifies the input as DOMAIN_MATCH, DOMAIN_BRIDGE, or DOMAIN_DRIFT correctly; AgentNode returns structured JSON (ADD_NODE / ADD_EDGE / NO_ACTION) constrained to Blueprint vocabulary only
  2. MutationGateNode applies the three confidence thresholds correctly: confidence >0.85 produces a committed mutation, 0.5–0.85 produces a ghost mutation, <0.5 produces no canvas action — all observable from graph output
  3. A DOMAIN_DRIFT input is routed directly to a plain conversational reply with no canvas mutation, no error, and no refusal visible to the caller
  4. The PostgresSaver checkpointer (prepare:false, SUPABASE_DIRECT_URL) stores graph state and correctly resumes a thread across two separate graph invocations — verified by inspecting checkpoint tables in Supabase
  5. A Langfuse dashboard shows at least one complete trace from a test graph run, with node spans, guardrail classification result, agent confidence score, and token costs; waitUntil flush pattern is confirmed working in Vercel preview

**Plans**: 4 plans

Plans:
**Wave 1**

- [x] 06-01-PLAN.md — Shared types: canvasMutationTool + drift_reply_probability (Zod + Ajv) (BLUE-03, ORCH-03)
- [x] 06-02-PLAN.md — Infra: migration 0009 (sessions.current_phase) + @langfuse/otel install + getCheckpointer + setupLangfuseOtel (BLUE-04, ORCH-05, OBS-01, OBS-02)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-03-PLAN.md — Graph core: state + Orchestrator/Agent/MutationGate/DriftReply nodes + createGraph factory + unit tests (MemorySaver) (BLUE-03, BLUE-04, ORCH-02, ORCH-03, ORCH-04, HUMAN-03)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 06-04-PLAN.md — Integration: PostgresSaver resume test + Langfuse OTel server wiring + trace verification (ORCH-05, OBS-01, OBS-02)

### Phase 7: /invoke Route Modification

**Goal**: The /invoke route's direct adapter.stream() call is replaced with a LangGraph graph.astream() call — making this the highest-risk seam in the entire v2.0 build. The graph and PostgresSaver checkpointer are proven in Phase 6 before this phase begins. Success means graph execution now drives every AI response. Note: v1 backward compatibility is dropped per CONTEXT.md D-01 — sessions without a blueprint_id return 400 no_blueprint; all sessions that reach the graph must have an active Blueprint.
**Depends on**: Phase 6
**Requirements**: ORCH-01
**Success Criteria** (what must be TRUE):

  1. A session without a blueprint_id returns 400 no_blueprint before any AI call (D-01 — v1 compat dropped); a Blueprint session streams AI text and persists the message with no regressions visible to participants
  2. A new session with the Debate Blueprint active drives the /invoke route through the full LangGraph StateGraph execution; the SSE stream delivers text events to the client without hanging or timeout
  3. The abort controller is correctly wired: when a client disconnects mid-stream, the graph execution terminates and no orphaned async work continues on the server
  4. A Langfuse trace is visible for every real /invoke call — not just unit test calls — confirming the CallbackHandler attaches correctly to graph.astream() streaming mode

**Plans**: 3 plans

Plans:
**Wave 1**

- [x] 07-01-PLAN.md — Graph node streaming contract: steeringTextEnabled state field + streamWriter seam (agent + drift-reply) + AgentNode persona/silence/steering prompt rules + LANGFUSE_TRACE_LEVEL env var (ORCH-01)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 07-02-PLAN.md — Route modification: replace adapter.stream() with graph.astream() + no_blueprint gate + loadBlueprint + async-queue streamWriter piping + abort signal + Langfuse tracing + new route tests (ORCH-01)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 07-03-PLAN.md — Human-verify checkpoint: live Langfuse trace (SC-4) + blueprint gate + abort behavior against the running app (ORCH-01)

**UI hint**: no

### Phase 8: Human Control + Canvas Sync

**Goal**: Human authority over the conversational floor and phase progression is enforced in real time, and canvas mutations from MutationGateNode flow reliably from the server to every participant via Supabase Realtime. This phase completes the back-and-forth of AI cartography: the LLM maps human speech into graph mutations, humans control when and how those mutations land.
**Depends on**: Phase 7
**Requirements**: HUMAN-01, HUMAN-02, CANVAS-02
**Success Criteria** (what must be TRUE):

  1. When a participant sends a message, a mic token broadcast via Supabase Realtime is visible to all other session participants; no second LangGraph execution on the same branch can start until the mic is released; the mic releases automatically after the graph run completes or after a 30-second typing timeout
  2. The LLM can emit a phase_signal in its output; the frontend surfaces an "Advance Phase" affordance that is only clickable by a human; clicking it writes the updated current_phase to Supabase; the LLM has no path to modify current_phase autonomously
  3. After each committed graph run, canvas_nodes and canvas_edges rows are upserted in Supabase and a Realtime broadcast is emitted via httpSend; a second browser tab receives the broadcast and its local state reflects the new node/edge within one second

**Plans**: 5 plans

**Wave 1** *(parallel — no dependencies between 08-01 and 08-02)*

- [x] 08-01-PLAN.md — Extend canvasMutationTool + GraphStateAnnotation with phase_signal (HUMAN-01, HUMAN-02, CANVAS-02)
- [x] 08-02-PLAN.md — Migration 0010: mic lock columns + try_acquire_mic / release_mic RPCs (HUMAN-01)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 08-03-PLAN.md — AgentNode: extract phase_signal before safeParse; MutationGateNode: verify no reset (HUMAN-02)
- [x] 08-04-PLAN.md — /invoke route: mic lock + phase_signal SSE + canvas upserts; PATCH /sessions/:id/phase (HUMAN-01, HUMAN-02, CANVAS-02)

**Wave 3** *(blocked on Wave 1 completion — depends on 08-01 types)*

- [x] 08-05-PLAN.md — Frontend: session-store Phase 8 state, useAIStream phase_signal + mic_locked, useSessionChannel 4 broadcasts, CreatorControls Advance Phase button, InputBox micLocked read (HUMAN-01, HUMAN-02, CANVAS-02)

**Cross-cutting constraints:**

- phase_signal must be read from raw event.input BEFORE CanvasOpSchema.safeParse() (all graph node plans)
- All httpSend broadcasts are fire-and-forget (no await, .catch only) — consistent with existing messages.ts pattern
- Canvas upserts must occur AFTER the SSE done event; mic release must be in a finally block (always runs)

### Phase 9: Graph Canvas Frontend

**Goal**: Session participants see and interact with the live Graph Canvas — a shared interactive node/edge visualization powered by @xyflow/react, synchronized in real time across all clients, that correctly represents the committed and ghost state of every canvas mutation. Switching branches re-renders the canvas to that branch's snapshot. The analytics panel coexists with the existing chart widget panel — the active Blueprint's canvas_view_mode determines which renders.
**Depends on**: Phase 8
**Requirements**: CANVAS-03, CANVAS-04, UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):

  1. On branch switch or Realtime reconnect, the client fetches canonical canvas state from GET /api/sessions/:id/canvas?branch_id= and the Graph Canvas renders the correct committed node/edge set; ghost nodes that were pending are discarded
  2. The Graph Canvas renders node types and colors from the active Blueprint (Hypothesis, Evidence, etc.); ghost nodes display with dashed borders and ~40% opacity; participants can click to confirm (promote to committed) or dismiss; unacknowledged ghost nodes expire after 60 seconds
  3. A canvas mutation broadcast in Phase 8 triggers a live re-render on all connected clients within one second without a full page reload or manual branch switch
  4. A session using the Debate Blueprint renders the Graph Canvas (View A); a session with canvas_view_mode: chart renders the existing Recharts panel (View B); both rendering paths coexist and neither crashes

**Plans**: 4 plans

Plans:
**Wave 1** *(parallel — no file overlap between 09-01 and 09-02)*

- [x] 09-01-PLAN.md — Backend + types: 'graph' PanelWidget type, GET /canvas + PATCH /canvas_nodes/:id (with session-membership check), ai.ts ghost persistence + committed/ghost broadcast + panel_update('graph'), migration 0011 pg_cron ghost expiry [BLOCKING push], @dagrejs/dagre install (CANVAS-03, CANVAS-04, UI-02)
- [x] 09-02-PLAN.md — Client wiring: sessionStore mergeCanvasData (upsert-by-id), use-session-channel merge + SUBSCRIBED reconnect fetch, workspace branch-switch canvas fetch, page.tsx server-side canvas_view_mode prop (CANVAS-03, CANVAS-04, UI-03)

**Wave 2** *(blocked on Wave 1 — needs 'graph' type from 09-01)*

- [x] 09-03-PLAN.md — GraphCanvas renderer: graphLayout (dagre), GraphNode (committed/ghost + confirm/dismiss), GraphEdge (Blueprint-colored), GraphCanvas (@xyflow/react store-driven), widget-registry 'graph' registration ssr:false (UI-01, UI-02, UI-03, CANVAS-04)

**Wave 3** *(blocked on Wave 2 — acceptance gate)*

- [ ] 09-04-PLAN.md — Human-verify: view-mode routing + live render (SC-1, SC-4) and real-time multi-client updates + ghost lifecycle (SC-2, SC-3) against the running app (CANVAS-03, CANVAS-04, UI-01, UI-02, UI-03)

**UI hint**: yes

</details>

---

### 🚧 v3.0 — The Bots Must Help the Conversation Flow

**Milestone Goal:** Make bots proactive, personality-driven facilitators that autonomously manage conversation flow, build a coherent linked graph, and render contextually useful panel content — without being invoked by humans. Six trigger types, two production bot personalities (Coach + Analyst/Fact-Checker), a linked argGraph, task-based model cost routing, per-session participant profiles, and natural bot speech — all persisted in PostgresSaver with zero in-process memory.

---

## Phase Details (v3.0)

### Phase 10: Infrastructure Foundation

**Goal**: The safety and concurrency infrastructure that every proactive bot depends on exists and is tested before any trigger or personality code is written — token budget guard with circuit breaker, global bot arbitration lock, two-signal silence gate, dual LangGraph thread_id separation, and state schema extended to hold argGraph and trigger metadata in PostgresSaver. No bot fires without these in place.
**Depends on**: Phase 9
**Requirements**: BOT-01, BOT-02, BOT-03, BOT-04, BOT-05
**Success Criteria** (what must be TRUE):

  1. A developer can trigger the token budget guard by simulating 200+ tokens/minute over a 5-minute window; all proactive bot invocations are suspended for 10 minutes and a notification is delivered to the session creator; the guard resets correctly after the pause window
  2. When two bots score trigger affinity simultaneously on the same branch, the arbitration lock ensures only the higher-scoring bot fires; the losing bot's invocation is suppressed for the cooldown window — observable via server logs or Langfuse trace tags
  3. A silence-based trigger with a participant actively typing (`is_typing: true` in Supabase Presence) is suppressed; the trigger fires only after both the time threshold is met AND no participant is typing
  4. A human invocation (`branch_id:human`) and a proactive invocation (`branch_id:bot`) can run on the same branch without checkpoint write-skew; both threads produce independent checkpoints visible in the LangGraph checkpointer tables
  5. After a Vercel cold start simulation, the LangGraph PostgresSaver thread state for a branch retains its argGraph and trigger metadata — no state is held in JavaScript process memory

**Plans**: 3 plans

Plans:
**Wave 1**

- [x] 10-01-PLAN.md — Bot types (@panelito/types), GraphState argGraph/triggerMetadata, dual human thread_id (BOT-04, BOT-05)
- [x] 10-02-PLAN.md — Migration 0012: 3 bot tables + sessions budget column + 3 atomic RPCs + schema push (BOT-01, BOT-02, BOT-03)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 10-03-PLAN.md — Service modules: BotArbitrator, budget guard, two-signal silence gate (BOT-01, BOT-02, BOT-03)

### Phase 11: Personality + Basic Triggers

**Goal**: Coach and Analyst/Fact-Checker bot personalities are wired as FacilitationAgentNode and AnalyticsAgentNode in the LangGraph graph; the conditional START edge routing between them is isolated and fully tested here before any other trigger is built on top of it. The argGraph structure and ArgGraphBuilderNode are introduced. The silence window trigger is the first live trigger: a Coach fires into the conversation after N seconds of silence with no participant typing.
**Depends on**: Phase 10
**Requirements**: PERSONA-01, PERSONA-02, PERSONA-03, TRIGGER-01, GRAPH-01, GRAPH-02, GRAPH-04
**Success Criteria** (what must be TRUE):

  1. The Coach bot's every chat output ends with a question mark — never a statement or conclusion — verified across 10 consecutive test invocations; the Analyst bot's every output cites a specific prior message by speaker name and paraphrased content
  2. The conditional START edge routes correctly: proactive invocations for facilitation triggers reach FacilitationAgentNode (Coach); analysis triggers reach AnalyticsAgentNode (Analyst); a misconfigured routing condition does not silently default to either — it errors with a clear log
  3. The silence window trigger fires at most once per cooldown window after N seconds of no human message with no participant typing; the Coach sends a facilitation question into chat; the trigger does not re-fire during the active cooldown period
  4. The ArgGraphBuilderNode runs after each LangGraph invocation (human or proactive) and updates the argGraph in PostgresSaver thread state; the argGraph summary (nodes, edges, open assertions) is correctly injected into the Analyst's prompt context before each Analyst invocation
  5. Per-persona cooldown budgets (Coach 3/15min, Analyst 2/15min) are enforced and configurable in Blueprint or session config; a Creator can see the cooldown configuration in session settings

**Plans**: 7 plans

Plans:
**Wave 1**

- [x] 11-01-PLAN.md — Types, schemas & config contracts: argGraph extension + extraction tool, Personality model, Blueprint bot_defaults/role_personalities/cooldowns, facilitation model tier, triggerType state field, argGraph summary helper (PERSONA-01/02/03, GRAPH-01, GRAPH-04)

**Wave 2** *(blocked on Wave 1)*

- [ ] 11-02-PLAN.md — Migration 0014: personalities table + 3 seeds (incl. D-06 voice migration) + blueprint defaults + sessions.bot_overrides + [BLOCKING] schema push (PERSONA-01/02/03)
- [x] 11-03-PLAN.md — ArgGraphBuilderNode: extraction, UUID substitution, merge into argGraph (GRAPH-01, GRAPH-02)
- [x] 11-04-PLAN.md — Coach (FacilitationAgentNode) + Analyst (AnalyticsAgentNode) persona nodes; Role-dominant composition, argGraph injection, fact-check framing (PERSONA-01/02, GRAPH-04)

**Wave 3** *(blocked on Wave 2)*

- [x] 11-05-PLAN.md — Conditional START edge + routeFromStart + router error spike + graph tests (PERSONA-01/02)
- [ ] 11-07-PLAN.md — UI: persona-keyed MessageBubble, CreatorControls toggles + read-only cooldown, creator-only bots toggle route (PERSONA-01/02/03)

**Wave 4** *(blocked on Wave 2 + Wave 3)*

- [ ] 11-06-PLAN.md — Interim silence-scan loop + server registration + Coach/Analyst registerBot + direct-insert Coach delivery (TRIGGER-01, PERSONA-01)

### Phase 12: Graph Coherence + Extended Triggers

**Goal**: The graph becomes coherent — after the first 3 nodes, every new bot-proposed CanvasNode must include at least one edge proposal, with a tentative ghost edge to the most semantically similar node when no strong connection is found. Four additional triggers are wired: semantic drift (local ONNX embedding, no token cost during detection), unlinked assertion (Analyst proposes typed edges for orphan nodes), fact-check (three-tier escalation gate), and moderation (heuristic pre-filter only, no LLM cost). Task-based model routing via TASK_MODELS is validated for all trigger types.
**Depends on**: Phase 11
**Requirements**: GRAPH-03, TRIGGER-03, TRIGGER-04, TRIGGER-05, TRIGGER-06, COST-01, COST-02
**Success Criteria** (what must be TRUE):

  1. After 3 committed canvas nodes exist, a bot-proposed fourth node always includes at least one edge proposal in its CanvasOp output; when no strong connection is found, a ghost edge to the most semantically similar existing node is created — observable in the canvas_edges table
  2. The semantic drift trigger fires when cosine similarity between the last 3 messages and the Blueprint domain centroid drops below 0.6 (ONNX all-MiniLM-L6-v2, sub-30ms, zero LLM token cost during detection); the Coach redirects the conversation; the threshold is Blueprint-configurable
  3. When a new canvas node is committed with no edges after the first 3 nodes, the Analyst detects the orphan within one invocation cycle and proposes one or more typed edge connections in chat
  4. A message containing a verifiable factual claim triggers the three-tier escalation (heuristic pre-filter → light-tier classifier → capable-tier for confirmed positives) before any capable-tier LLM call; a moderation trigger fires from the heuristic pre-filter alone with zero LLM calls
  5. A Langfuse trace shows facilitation moves (Coach silence/moderation) routed to the light model tier and analysis tasks (Analyst, Fact-Checker, ArgGraphBuilder) routed to the capable model tier — model tier assignment is not hardcoded to a specific model name

**Plans**: TBD

### Phase 13: User Profiles + Phase Signal

**Goal**: The ArgGraphBuilderNode maintains a per-participant profile in LangGraph thread state, and the Coach uses those profiles to personalize facilitation moves. The Blueprint phase signal trigger completes: when the Analyst determines the argGraph has sufficient coverage of the current phase's required topics, a phase-readiness signal is emitted and the Coach asks the group if they are ready to advance.
**Depends on**: Phase 12
**Requirements**: PROFILE-01, PROFILE-02, TRIGGER-02
**Success Criteria** (what must be TRUE):

  1. After a participant makes 3 or more assertions in a session, the ArgGraphBuilderNode's thread state contains a profile for that participant with stated positions, key assertions made, and engagement level (messages sent, reactions used) — visible in the LangGraph checkpointer state
  2. The Coach's prompt context includes a summary of each active participant's profile; a Coach invocation references a specific prior assertion by a named participant ("Earlier you mentioned X — does this new point support or challenge that?") — verifiable in the Langfuse trace prompt payload
  3. When the Analyst evaluates the argGraph and message history as having sufficient coverage of the current Blueprint phase's required topics, a phase-readiness signal is emitted; the Coach asks the group if they want to advance; the actual phase advancement still requires a human click (the LLM cannot advance the phase autonomously)

**Plans**: TBD

### Phase 14: Polish + TriggerEngine Wiring

**Goal**: All proactive trigger components built in Phases 10–13 are connected to a persistent TriggerEngine — a `setInterval` scan loop running on the standalone Node.js server (`server.ts`) that evaluates all 6 trigger conditions per active branch and dispatches to ProactiveInvoker when a trigger fires. Persona consistency is hardened with a periodic re-anchor mechanism. All bot speech is audited for system artifacts. Langfuse cost attribution by trigger type is confirmed in the dashboard.
**Depends on**: Phase 13
**Requirements**: PERSONA-04, TRIGGER-07, COST-03, SPEECH-01, SPEECH-02, SPEECH-03
**Success Criteria** (what must be TRUE):

  1. The TriggerEngine's `setInterval` scan loop runs on the standalone Node.js server and survives the full session lifetime without stopping; all 6 trigger types are evaluated per scan cycle per active branch; a trigger firing is dispatched to ProactiveInvoker and results in a bot message in chat — end-to-end observable in a live session
  2. A 100-turn synthetic session produces no Coach output without a trailing question mark and no Analyst output without a citation of a specific prior message; the periodic persona re-anchor fires every 15 bot invocations and is confirmed in Langfuse traces
  3. No bot chat message contains "[canvas updated]", "[graph modified]", "[node added]", or any system artifact string — verified across all 6 trigger types in the synthetic session; canvas updates are communicated exclusively through the canvas UI animations and node count badge, never through chat text
  4. A message that matches system artifact patterns is silently dropped (replaced with empty string) at the frontend rendering layer as defense-in-depth — verifiable by injecting a test message with a blocked pattern
  5. The Langfuse dashboard shows cost attribution by trigger type for each LLM call; a developer can identify which trigger type is most expensive from the dashboard without querying the database

**Plans**: TBD
**UI hint**: yes

---

## Progress

**Execution Order:** 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Live Session Shell | v1.0 | 7/7 | Complete | 2026-06-13 |
| 2. AI + Analytics | v1.0 | 6/6 | Complete | 2026-06-21 |
| 3. The Multiverse | v1.0 | 4/4 | Complete | 2026-06-23 |
| 4. Multi-AI Providers | v1.0 | 4/4 | Complete | 2026-06-18 |
| 5. Foundation | v2.0 | 4/4 | Complete   | 2026-07-01 |
| 6. Graph Construction + Checkpointer | v2.0 | 4/4 | Complete    | 2026-07-02 |
| 7. /invoke Route Modification | v2.0 | 3/3 | Complete    | 2026-07-03 |
| 8. Human Control + Canvas Sync | v2.0 | 5/5 | Complete | 2026-07-03 |
| 9. Graph Canvas Frontend | v2.0 | 3/4 | In Progress|  |
| 10. Infrastructure Foundation | v3.0 | 3/3 | Complete    | 2026-07-10 |
| 11. Personality + Basic Triggers | v3.0 | 4/7 | In Progress|  |
| 12. Graph Coherence + Extended Triggers | v3.0 | 0/? | Not started | - |
| 13. User Profiles + Phase Signal | v3.0 | 0/? | Not started | - |
| 14. Polish + TriggerEngine Wiring | v3.0 | 0/? | Not started | - |

---

*Roadmap created: 2026-06-08*
*v2.0 phases added: 2026-07-01*
*v3.0 phases added: 2026-07-09*
