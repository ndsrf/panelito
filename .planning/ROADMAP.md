# Roadmap: Project Multiverse

## Milestones

- ✅ **v1.0 MVP** — Phases 1–4 (shipped 2026-06-18)
- 🚧 **v2.0 NSAI — Neuro-Symbolic Collaborative Engine** — Phases 5–9 (in progress)

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
- [ ] 06-01-PLAN.md — Shared types: canvasMutationTool + drift_reply_probability (Zod + Ajv) (BLUE-03, ORCH-03)
- [ ] 06-02-PLAN.md — Infra: migration 0009 (sessions.current_phase) + @langfuse/otel install + getCheckpointer + setupLangfuseOtel (BLUE-04, ORCH-05, OBS-01, OBS-02)
- [ ] 06-03-PLAN.md — Graph core: state + Orchestrator/Agent/MutationGate/DriftReply nodes + createGraph factory + unit tests (MemorySaver) (BLUE-03, BLUE-04, ORCH-02, ORCH-03, ORCH-04, HUMAN-03)
- [ ] 06-04-PLAN.md — Integration: PostgresSaver resume test + Langfuse OTel server wiring + trace verification (ORCH-05, OBS-01, OBS-02)

### Phase 7: /invoke Route Modification

**Goal**: The /invoke route's direct adapter.stream() call is replaced with a LangGraph graph.astream() call — making this the highest-risk seam in the entire v2.0 build. The graph and PostgresSaver checkpointer are proven in Phase 6 before this phase begins. Success means the existing v1 session experience is fully preserved while graph execution now drives every AI response.
**Depends on**: Phase 6
**Requirements**: ORCH-01
**Success Criteria** (what must be TRUE):
  1. An existing v1 session (no Blueprint, no canvas) continues to work correctly after the route modification — messages stream, the panel receives render_panel payloads, and no regressions are visible to participants
  2. A new session with the Debate Blueprint active drives the /invoke route through the full LangGraph StateGraph execution; the SSE stream delivers text events to the client without hanging or timeout
  3. The abort controller is correctly wired: when a client disconnects mid-stream, the graph execution terminates and no orphaned async work continues on the server
  4. A Langfuse trace is visible for every real /invoke call — not just unit test calls — confirming the CallbackHandler attaches correctly to graph.astream() streaming mode
**Plans**: TBD
**UI hint**: no

### Phase 8: Human Control + Canvas Sync

**Goal**: Human authority over the conversational floor and phase progression is enforced in real time, and canvas mutations from MutationGateNode flow reliably from the server to every participant via Supabase Realtime. This phase completes the back-and-forth of AI cartography: the LLM maps human speech into graph mutations, humans control when and how those mutations land.
**Depends on**: Phase 7
**Requirements**: HUMAN-01, HUMAN-02, CANVAS-02
**Success Criteria** (what must be TRUE):
  1. When a participant sends a message, a mic token broadcast via Supabase Realtime is visible to all other session participants; no second LangGraph execution on the same branch can start until the mic is released; the mic releases automatically after the graph run completes or after a 30-second typing timeout
  2. The LLM can emit a phase_signal in its output; the frontend surfaces an "Advance Phase" affordance that is only clickable by a human; clicking it writes the updated current_phase to Supabase; the LLM has no path to modify current_phase autonomously
  3. After each committed graph run, canvas_nodes and canvas_edges rows are upserted in Supabase and a Realtime broadcast is emitted via httpSend; a second browser tab receives the broadcast and its local state reflects the new node/edge within one second
**Plans**: TBD

### Phase 9: Graph Canvas Frontend

**Goal**: Session participants see and interact with the live Graph Canvas — a shared interactive node/edge visualization powered by @xyflow/react, synchronized in real time across all clients, that correctly represents the committed and ghost state of every canvas mutation. Switching branches re-renders the canvas to that branch's snapshot. The analytics panel coexists with the existing chart widget panel — the active Blueprint's canvas_view_mode determines which renders.
**Depends on**: Phase 8
**Requirements**: CANVAS-03, CANVAS-04, UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. On branch switch or Realtime reconnect, the client fetches canonical canvas state from GET /api/sessions/:id/canvas?branch_id= and the Graph Canvas renders the correct committed node/edge set; ghost nodes that were pending are discarded
  2. The Graph Canvas renders node types and colors from the active Blueprint (Hypothesis, Evidence, etc.); ghost nodes display with dashed borders and ~40% opacity; participants can click to confirm (promote to committed) or dismiss; unacknowledged ghost nodes expire after 60 seconds
  3. A canvas mutation broadcast in Phase 8 triggers a live re-render on all connected clients within one second without a full page reload or manual branch switch
  4. A session using the Debate Blueprint renders the Graph Canvas (View A); a session with canvas_view_mode: chart renders the existing Recharts panel (View B); both rendering paths coexist and neither crashes
**Plans**: TBD
**UI hint**: yes

---

## Progress

**Execution Order:** 5 → 6 → 7 → 8 → 9

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Live Session Shell | v1.0 | 7/7 | Complete | 2026-06-13 |
| 2. AI + Analytics | v1.0 | 6/6 | Complete | 2026-06-21 |
| 3. The Multiverse | v1.0 | 4/4 | Complete | 2026-06-23 |
| 4. Multi-AI Providers | v1.0 | 4/4 | Complete | 2026-06-18 |
| 5. Foundation | v2.0 | 4/4 | Complete   | 2026-07-01 |
| 6. Graph Construction + Checkpointer | v2.0 | 0/? | Not started | - |
| 7. /invoke Route Modification | v2.0 | 0/? | Not started | - |
| 8. Human Control + Canvas Sync | v2.0 | 0/? | Not started | - |
| 9. Graph Canvas Frontend | v2.0 | 0/? | Not started | - |

---

*Roadmap created: 2026-06-08*
*v2.0 phases added: 2026-07-01*
