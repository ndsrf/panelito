# Requirements: Project Multiverse

**Defined:** 2026-07-01 (v2.0) | **v3.0 added:** 2026-07-09
**Core Value:** The live analytics panel stays perfectly synchronized with the active conversation branch in real time — transforming passive group chat into structured, visual collective thinking. Bots are proactive facilitators, not passive responders.

---

## v2.0 Requirements

### Infrastructure & Stack (INFRA)

- [ ] **INFRA-01**: Developer can install and run the complete NSAI stack — apps/api adds LangGraph JS, Langfuse, Ajv, Postgres checkpointer; apps/web adds @xyflow/react; Hono API routes are declared as Node.js runtime (not Edge) with maxDuration configured in vercel.json
- [ ] **INFRA-02**: Three new Supabase tables (canvas_nodes, canvas_edges, domain_blueprints) exist with RLS; LangGraph checkpointer tables (checkpoints, checkpoint_blobs, checkpoint_writes) are created via checkpointer.setup() on first deploy
- [ ] **INFRA-03**: Shared TypeScript types CanvasNode, CanvasEdge, Blueprint, and CanvasOp are defined in @panelito/types and consumed by both apps/api and apps/web without duplication

### Blueprint System (BLUE)

- [ ] **BLUE-01**: Creator can select a Domain Blueprint for their session; Blueprint defines node vocabulary, edge vocabulary, active personas, phase sequence, and canvas_view_mode
- [ ] **BLUE-02**: Each Blueprint is validated against an Ajv meta-schema at API load time; compiled validators are cached per blueprintId — never recompiled per request; invalid Blueprints are rejected with a descriptive error before the session starts
- [x] **BLUE-03**: Blueprint ontology (allowed node types, edge types, LLM instructions) is injected into LangGraph State before any agent node executes; the LLM cannot output a node or edge type outside the active Blueprint vocabulary
- [x] **BLUE-04**: The LLM system prompt mutates dynamically based on the Blueprint's current_phase field in Supabase; each phase carries distinct instructions and constraints
- [ ] **BLUE-05**: Debate/Strategy Blueprint ships as the first production domain (node types: Hypothesis, Evidence, Counter-Argument, Action; edge types: SUPPORTS, CONTRADICTS, BUILDS_ON, REFUTES; canvas_view_mode: graph)

### Orchestration & Agent Graph (ORCH)

- [x] **ORCH-01**: Each user message runs a LangGraph StateGraph with three nodes — OrchestratorNode (guardrail classifier) → AgentNode (domain LLM call) → MutationGateNode (confidence evaluator) — replacing the direct LLM adapter call in the /invoke route
- [x] **ORCH-02**: OrchestratorNode classifies input as DOMAIN_MATCH, DOMAIN_BRIDGE, or DOMAIN_DRIFT; DOMAIN_DRIFT bypasses AgentNode and generates a conversational reply with no canvas mutation
- [x] **ORCH-03**: AgentNode outputs structured JSON (ADD_NODE / ADD_EDGE / NO_ACTION) with a confidence score (0.0–1.0), constrained strictly to the active Blueprint's ontology vocabulary
- [x] **ORCH-04**: MutationGateNode applies confidence thresholds: >0.85 → direct canvas commit; 0.5–0.85 → ghost node (dashed border, ~40% opacity); <0.5 → sidebar text only, canvas untouched
- [x] **ORCH-05**: LangGraph thread_id equals the existing branch_id; graph state persists across serverless invocations via a PostgresSaver checkpointer (prepare:false, SUPABASE_DIRECT_URL)

### Human Control Patterns (HUMAN)

- [ ] **HUMAN-01**: Mic Check Pattern — the message sender holds the mic token, broadcast via Supabase Realtime; concurrent LangGraph executions on the same branch are impossible by construction; mic is released automatically after the graph run completes or after a 30-second typing timeout
- [ ] **HUMAN-02**: Human Consensus Pattern — the LLM may emit a phase_signal in its output to indicate readiness to advance to the next session phase; the UI surfaces an "Advance Phase" affordance; only an explicit human click writes the updated current_phase to Supabase; the LLM has no tool or action capable of advancing current_phase autonomously
- [x] **HUMAN-03**: DOMAIN_DRIFT responses generate a natural conversational reply in the chat stream; the canvas is completely untouched; no rejection, error, or refusal message is shown to participants

### Canvas Data Model & Sync (CANVAS)

- [ ] **CANVAS-01**: All domains use a single universal CanvasNode + CanvasEdge schema; the status field (committed / ghost / silent) controls rendering; domains customize vocabulary and colors via Blueprint, not schema
- [ ] **CANVAS-02**: Committed canvas mutations from each LangGraph run are upserted to canvas_nodes / canvas_edges in Supabase and broadcast to all session participants via Supabase Realtime httpSend
- [ ] **CANVAS-03**: On branch switch or Realtime reconnect, the client fetches canonical canvas state from GET /api/sessions/:id/canvas?branch_id= and reconciles with local Zustand store; ghost nodes that were pending are discarded on reconnect (ephemeral)
- [ ] **CANVAS-04**: The active Blueprint's canvas_view_mode determines whether a session renders Graph Canvas (View A: nodes/edges) or the existing chart widget panel (View B); both rendering paths coexist in the codebase

### Graph Canvas Frontend (UI)

- [ ] **UI-01**: Session participants see a shared interactive Graph Canvas (View A) built with @xyflow/react (loaded via next/dynamic ssr:false); node types and colors are defined by the active Blueprint
- [ ] **UI-02**: Ghost nodes render with dashed borders and ~40% opacity; participants can click to confirm (promote to committed) or dismiss (remove); unacknowledged ghost nodes expire after 60 seconds
- [ ] **UI-03**: The Graph Canvas updates in real time for all participants via Supabase Realtime; switching branches re-renders the canvas to that branch's committed snapshot

### Observability (OBS)

- [x] **OBS-01**: Langfuse receives a per-request CallbackHandler that traces every LangGraph execution: node spans, guardrail classification result, agent confidence score, token costs, and per-node latency
- [x] **OBS-02**: Traces flush reliably in Vercel serverless via waitUntil(langfuse.flushAsync()) called after the SSE response completes; no traces are silently lost on function exit

---

## v2.1 Requirements (Deferred)

### Blueprint Expansion

- **BLUE-06**: Additional Domain Blueprints — Coaching GROW model (Goal → Reality → Options → Way Forward) and Finance/Investment domain
- **BLUE-07**: Blueprint hot-reload mid-session without restarting — requires Ajv compiled validator cache-busting via Blueprint version field and LangGraph graph recompilation trigger

### Optimization

- **ORCH-06**: Prompt caching + LangGraph state compression — static system prompt prefix with cache_control, state summarization node when message count exceeds threshold
- **CANVAS-05**: Branch fork creates a new LangGraph thread initialized from the parent branch's checkpoint; canvas state carries over to the forked branch

### Canvas Editing

- **UI-04**: Human participants can manually add, edit, or delete canvas nodes and edges directly in the Graph Canvas (not only via AI suggestions)

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Autonomous LLM phase advancement | Invariant rule: humans advance phases, LLM signals readiness only |
| Multiple simultaneous Blueprints per session | Single active domain per session; switching Blueprints requires session restart in v2.0 |
| LangGraph interrupt() for Mic Check | Pitfall P16: interrupt() is incompatible with short-lived Vercel serverless functions; two-request pattern used instead |
| CRDT / Yjs canvas conflict resolution | Last-write-wins sufficient for v2.0 session sizes; complexity deferred |
| Per-domain database schemas | Universal CanvasNode/CanvasEdge model is a non-negotiable architectural constraint |
| Module-level Langfuse singleton | Per-request CallbackHandler is required to prevent trace context corruption across concurrent requests |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 5 | Pending |
| INFRA-02 | Phase 5 | Pending |
| INFRA-03 | Phase 5 | Pending |
| BLUE-01 | Phase 5 | Pending |
| BLUE-02 | Phase 5 | Pending |
| BLUE-05 | Phase 5 | Pending |
| CANVAS-01 | Phase 5 | Pending |
| BLUE-03 | Phase 6 | Complete |
| BLUE-04 | Phase 6 | Complete |
| ORCH-02 | Phase 6 | Complete |
| ORCH-03 | Phase 6 | Complete |
| ORCH-04 | Phase 6 | Complete |
| ORCH-05 | Phase 6 | Complete |
| HUMAN-03 | Phase 6 | Complete |
| OBS-01 | Phase 6 | Complete |
| OBS-02 | Phase 6 | Complete |
| ORCH-01 | Phase 7 | Complete |
| HUMAN-01 | Phase 8 | Pending |
| HUMAN-02 | Phase 8 | Pending |
| CANVAS-02 | Phase 8 | Pending |
| CANVAS-03 | Phase 9 | Pending |
| CANVAS-04 | Phase 9 | Pending |
| UI-01 | Phase 9 | Pending |
| UI-02 | Phase 9 | Pending |
| UI-03 | Phase 9 | Pending |

**Coverage:**
- v2.0 requirements: 25 total (3 INFRA + 5 BLUE + 5 ORCH + 3 HUMAN + 4 CANVAS + 3 UI + 2 OBS)
- Mapped to phases: 25
- Unmapped: 0 ✓

---

*Requirements defined: 2026-07-01*
*Last updated: 2026-07-01 — traceability finalized after v2.0 roadmap creation*

---

## v3.0 Requirements

### Proactive Bot Infrastructure (BOT)

- [ ] **BOT-01**: A session token budget guard with circuit breaker exists per branch; hard ceiling (configurable, default 200 tokens/minute averaged over 5-minute window) prevents cost explosion on creator's BYOK key; when circuit trips, all proactive bot invocations are paused for 10 minutes and the session creator is notified
- [ ] **BOT-02**: A global bot arbitration lock prevents multiple bots from firing simultaneously on the same branch; each bot scores its trigger affinity (0–9) and the highest scorer wins; other bots stand down for that N-second window
- [ ] **BOT-03**: A two-signal silence gate checks both elapsed time since last human message AND Supabase Presence `is_typing` state before any silence-based trigger fires; if any participant is typing, the trigger is suppressed
- [ ] **BOT-04**: LangGraph thread state uses dual thread_id separation: `branch_id:human` (existing path) and `branch_id:bot` (new proactive path); concurrent write-skew between human and proactive invocations is prevented by construction
- [ ] **BOT-05**: All bot state (argGraph, user profiles, trigger metadata) persists in LangGraph PostgresSaver thread state — no JavaScript process memory; survives Vercel cold starts and serverless function recycling

### Bot Personalities (PERSONA)

- [ ] **PERSONA-01**: Coach bot is wired into the LangGraph graph as a new FacilitationAgentNode; its prompt enforces Socratic discipline — every output ends with a question, never a statement or answer; it never gives conclusions, only surfaces them
- [ ] **PERSONA-02**: Analyst/Fact-Checker bot is wired as a new AnalyticsAgentNode; its output always cites the specific prior message (speaker name + paraphrased content) it is responding to; when operating as Fact-Checker it uses uncertainty framing exclusively ("I can't verify that — what's the source?") and never makes confident counter-assertions
- [ ] **PERSONA-03**: Each personality has configurable per-session cooldown budgets (default: Coach 3/15min, Analyst 2/15min, Fact-check 1/30min) stored in the Blueprint or session config; Creator can adjust in session settings
- [ ] **PERSONA-04**: Persona consistency is maintained across long sessions via a periodic re-anchor mechanism that refreshes the persona context window every 15 bot invocations; tested against a 100-turn synthetic session before release

### Trigger Types (TRIGGER)

- [ ] **TRIGGER-01**: Silence window trigger — Coach fires when no human message arrives within N seconds (default 45s, Blueprint-configurable) AND no participant has `is_typing: true`; fires at most once per cooldown window
- [ ] **TRIGGER-02**: Blueprint phase signal trigger — when the in-context argGraph and message history contain sufficient coverage of the current phase's required topics (evaluated by the Analyst bot), a phase-readiness signal is emitted; the Coach asks the group if they are ready to advance
- [ ] **TRIGGER-03**: Semantic drift trigger — when the cosine similarity between the last 3 messages (embedded locally via all-MiniLM-L6-v2 ONNX) and the Blueprint's domain centroid drops below threshold (default 0.6), the Coach gently redirects the conversation; threshold is Blueprint-configurable
- [ ] **TRIGGER-04**: Unlinked assertion trigger — when a new canvas node has been committed with no edges to existing nodes after the first 3 nodes in the session, the Analyst detects the orphan and proposes one or more typed edge connections
- [ ] **TRIGGER-05**: Fact-check trigger — when the classifier detects a message containing a verifiable factual claim with low self-consistency (heuristic pre-filter → Haiku → Sonnet three-tier escalation), the Analyst/Fact-Checker responds with uncertainty framing; never operates without the pre-filter
- [ ] **TRIGGER-06**: Moderation trigger — when a message is classified as rude, disruptive, or off-topic by the heuristic pre-filter (no LLM cost), the Coach intervenes with a neutral, non-accusatory facilitation move
- [ ] **TRIGGER-07**: A TriggerEngine module runs on the standalone Node.js server (`server.ts`) as a persistent `setInterval` scan loop (not Vercel serverless); it evaluates all 6 trigger conditions per active branch and dispatches to a ProactiveInvoker when a trigger fires

### Coherent Graph Model (GRAPH)

- [ ] **GRAPH-01**: The in-memory conversation graph (argGraph) is stored as a custom reducer field in LangGraph thread state; it persists across all invocations on a branch (human and proactive) via PostgresSaver; each branch has its own isolated argGraph
- [ ] **GRAPH-02**: An ArgGraphBuilderNode updates the argGraph after each LangGraph run (human or proactive); it classifies the new content against existing nodes and proposes typed edges using the Blueprint's edge vocabulary
- [ ] **GRAPH-03**: After the first 3 nodes in a session, every new CanvasNode proposed by a bot must include at least one edge proposal in its CanvasOp output; if no strong connection is found, a tentative ghost edge is created to the most semantically similar existing node
- [ ] **GRAPH-04**: The argGraph drives the Analyst's facilitation context — before any Analyst invocation, the argGraph summary (nodes, edges, open assertions) is injected into the prompt so the Analyst can reference specific prior content by name

### Per-Session User Profiles (PROFILE)

- [ ] **PROFILE-01**: The ArgGraphBuilderNode maintains an in-memory profile per session participant (stored in LangGraph thread state via InMemoryStore namespaced by `[sessionId, participantId, 'profile']`) tracking: stated positions, key assertions made, engagement level (messages sent, reactions used)
- [ ] **PROFILE-02**: The Coach bot receives a summary of each participant's profile as part of its prompt context, enabling personalized facilitation ("Earlier you mentioned X — does this new point support or challenge that?")

### Model Cost Routing (COST)

- [ ] **COST-01**: All proactive bot invocations use task-based model routing via the existing TASK_MODELS registry; facilitation moves (Coach silence/phase triggers, moderation) route to the provider's **fast/light tier** (Claude Haiku, GPT-4o-mini, or equivalent); analysis and graph reasoning (Analyst, Fact-Checker, ArgGraphBuilder) route to the provider's **capable tier** (Claude Sonnet, GPT-4o, or equivalent); tier-to-model mapping is resolved per provider at runtime, never hardcoded
- [ ] **COST-02**: Trigger classification uses a three-tier escalation gate (heuristic regex/rule → light-tier classifier → capable-tier for confirmed positives) to minimize LLM calls during the detection phase; raw trigger evaluation never calls the capable-tier model directly
- [ ] **COST-03**: Langfuse traces tag each LLM call with its trigger type and model tier; cost attribution by trigger type is visible in the Langfuse dashboard

### Natural Bot Speech (SPEECH)

- [ ] **SPEECH-01**: No bot message in the chat stream contains system artifact strings ("[canvas updated]", "[graph modified]", "[node added]", or similar); all bot output is conversational, persona-consistent, and natural
- [ ] **SPEECH-02**: The message rendering layer blocks any message content matching system artifact patterns at the frontend layer as defense-in-depth; blocked strings are replaced with an empty string (silent drop)
- [ ] **SPEECH-03**: Canvas update confirmations are communicated exclusively through the canvas UI (ghost → committed animation, node count badge) — never through chat text

## v3.0 Future Requirements

### Devil's Advocate (v3.1)

- **DA-01**: Devil's Advocate bot available as a Power Reaction trigger ("🔥 Challenge this") — human must explicitly invoke it; it never fires proactively
- **DA-02**: Devil's Advocate always acknowledges the prior point before challenging ("That's an interesting position — have you considered...")
- **DA-03**: Devil's Advocate cooldown enforced: max 1 invocation per participant per 10 minutes to prevent adversarial exhaustion

### Persistent User Memory (v4.0)

- **MEM-01**: For registered users, session profile data is stored in Supabase after session close and indexed via pgvector for future retrieval
- **MEM-02**: Returning user profiles are retrieved at session start to provide continuity across sessions

## v3.0 Out of Scope

| Feature | Reason |
|---------|--------|
| Devil's Advocate proactive trigger | CHI 2025 research: unsolicited adversarial challenges destroy group dynamics; requires human Power Reaction invocation — v3.1 |
| Persistent user memory (vector DB) | Infrastructure scope; no pgvector indexing in v3.0 — v4.0 |
| Standalone server deployment automation | Out of scope for solo dev v3.0; documented as manual step |
| Semantic drift threshold auto-tuning | Requires real session data; calibrate manually from Langfuse after 5-10 sessions |
| Multi-session user profile continuity | Requires persistent memory — v4.0 |

## v3.0 Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BOT-01 | Phase 10 | Pending |
| BOT-02 | Phase 10 | Pending |
| BOT-03 | Phase 10 | Pending |
| BOT-04 | Phase 10 | Pending |
| BOT-05 | Phase 10 | Pending |
| PERSONA-01 | Phase 11 | Pending |
| PERSONA-02 | Phase 11 | Pending |
| PERSONA-03 | Phase 11 | Pending |
| PERSONA-04 | Phase 14 | Pending |
| TRIGGER-01 | Phase 11 | Pending |
| TRIGGER-02 | Phase 13 | Pending |
| TRIGGER-03 | Phase 12 | Pending |
| TRIGGER-04 | Phase 12 | Pending |
| TRIGGER-05 | Phase 12 | Pending |
| TRIGGER-06 | Phase 12 | Pending |
| TRIGGER-07 | Phase 14 | Pending |
| GRAPH-01 | Phase 11 | Pending |
| GRAPH-02 | Phase 11 | Pending |
| GRAPH-03 | Phase 12 | Pending |
| GRAPH-04 | Phase 11 | Pending |
| PROFILE-01 | Phase 13 | Pending |
| PROFILE-02 | Phase 13 | Pending |
| COST-01 | Phase 12 | Pending |
| COST-02 | Phase 12 | Pending |
| COST-03 | Phase 14 | Pending |
| SPEECH-01 | Phase 14 | Pending |
| SPEECH-02 | Phase 14 | Pending |
| SPEECH-03 | Phase 14 | Pending |

**v3.0 Coverage:**
- v3.0 requirements: 28 total (5 BOT + 4 PERSONA + 7 TRIGGER + 4 GRAPH + 2 PROFILE + 3 COST + 3 SPEECH)
- Mapped to phases: 28
- Unmapped: 0 ✓

---

*v3.0 requirements defined: 2026-07-09*
*Last updated: 2026-07-09 — initial v3.0 requirements*
