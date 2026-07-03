# Requirements: Project Multiverse

**Defined:** 2026-07-01
**Core Value:** The live analytics panel stays perfectly synchronized with the active conversation branch in real time — transforming passive group chat into structured, visual collective thinking. In v2.0, the panel becomes a Neuro-Symbolic engine: the LLM acts as cartographer, mapping human speech into a structured ontology graph anchored to a human-defined Blueprint.

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
