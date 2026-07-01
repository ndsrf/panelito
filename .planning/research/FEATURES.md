# Feature Landscape: Project Multiverse v2.0 NSAI Engine

**Domain:** Neuro-Symbolic AI collaborative workspace — structured group deliberation with ontology-constrained LLM orchestration
**Research date:** 2026-07-01
**Milestone scope:** SUBSEQUENT MILESTONE — adds NSAI engine to an existing real-time workspace

---

## Existing Features (v1 baseline — already built)

The following are NOT features to plan — they are dependencies to preserve:

- Multi-user real-time chat, sub-second delivery via Supabase Realtime broadcast
- Conversation branching (fork from any message, up to 5 branches, branch-isolated AI context)
- AI analytics panel (Recharts bento/radar/scatter/pie widgets)
- Multi-provider LLM abstraction (Anthropic, OpenAI, Gemini)
- 4 power reactions triggering AI responses
- Analyst persona toggle

---

## Table Stakes (Must Have — NSAI system breaks without these)

These are the minimum viable behaviors for the v2.0 layer. Missing any one of these means the NSAI engine either doesn't function or violates the core human-control thesis.

### 1. LangGraph Orchestration with OrchestratorNode + Agent Nodes

**Why expected:** LangGraph 1.0 (released October 2025) is the production standard for stateful multi-agent orchestration, deployed at Uber, JP Morgan, Klarna. It is the only JS framework that natively supports hierarchical orchestrator-worker patterns with built-in checkpointing and human-in-the-loop interrupts. Direct LLM calls have no state graph, no conditional routing, and no interrupt capability — they cannot model the domain guardrail → confidence check → autonomy decision chain this system requires.

**Expected behavior:**
- OrchestratorNode receives every human message and routes it through the domain guardrail first (before any agent sees it)
- Conditional edges route to the appropriate domain Agent node based on DOMAIN_MATCH / DOMAIN_BRIDGE / DOMAIN_DRIFT classification
- Agent nodes produce a structured `CanvasOp` block (node/edge mutations) alongside a text response
- `thread_id` maps 1:1 to `branch_id` — each branch has a fully isolated graph execution context
- Postgres checkpointer (via Supabase Postgres) persists graph state between turns; graph can resume after reconnect

**Complexity:** HIGH
**Dependencies:** Supabase Postgres schema extension (checkpointer tables), existing branch_id system, AIProvider abstraction

**LangGraph JS streaming pattern (verified):**
```typescript
// Three simultaneous stream modes for real-time UI
for await (const event of graph.stream(input, {
  streamMode: ["updates", "custom", "messages"],
  configurable: { thread_id: branchId }
})) {
  // "messages" → token-by-token to chat bubble
  // "updates" → node completion signals (progress indicator)
  // "custom" → CanvasOp blocks via get_stream_writer()
}
```

**Vercel constraint:** Use Node.js runtime, NOT Edge runtime. Node.js functions support up to 300s (Hobby) / 800s (Pro) duration. Edge runtime requires response within 25s — too tight for multi-node graph execution. Multi-step agents with several LLM calls can easily exceed 25s.

---

### 2. Domain Blueprints (JSON → Ajv → Prompt Injection)

**Why expected:** The "neuro-symbolic" thesis requires that the LLM operates within a runtime-loaded ontology, not a hard-coded prompt. Blueprints are what separate this from a standard chatbot: the canvas vocabulary (node types, edge types, colors) must be injectable per-session without code changes.

**Expected behavior:**
- Blueprint JSON is stored in Supabase and loaded at session start; validated against a meta-schema using Ajv before use
- Blueprint defines: allowed node types, allowed edge types, active personas, canvas view mode, phase sequence
- Blueprint contents are injected into the system prompt at graph compile time (not per-message) — this is the stable prefix that benefits from Anthropic prompt caching
- LLM is constrained to only propose node/edge types that exist in the loaded Blueprint
- Invalid Blueprint (Ajv fails) → session cannot start; user sees error before entering workspace

**Ajv performance note (HIGH confidence):** Compile schemas once at application boot, not per-request. `ajv.compile(schema)` takes 10–100ms; calling it per-request caps throughput at 10–100 req/s. Cache compiled validator functions:
```typescript
const validateBlueprint = ajv.compile(BlueprintMetaSchema); // at boot
// Per-request:
const valid = validateBlueprint(runtimeBlueprint); // < 1ms, 90k+ validations/sec
```

**Prompt caching interaction:** Blueprint JSON + persona definitions + tool schemas form the stable prefix. Mark with `cache_control: { type: "ephemeral" }` on the last content block of the static prefix. On subsequent turns (same thread), Claude serves these tokens from KV cache at 10% of standard input cost and 85% lower latency.

**Complexity:** MEDIUM (JSON schema authoring is the hard part; Ajv integration is low effort)
**Dependencies:** Supabase storage schema, LangGraph state for carrying Blueprint through graph

---

### 3. Universal CanvasNode + CanvasEdge Data Model

**Why expected:** A single schema that domains customize through vocabulary and color, not structure, is the only pattern that keeps graph rendering generic. If each domain had its own schema, the frontend canvas component would need domain-specific rendering logic.

**Expected behavior:**
- Single `CanvasNode` type: `{ id, type, label, confidence, status, position, metadata }`
- Single `CanvasEdge` type: `{ id, source, target, type, label, weight }`
- `type` field maps to Blueprint-defined vocabulary (e.g., "Hypothesis", "Evidence" in Debate domain)
- `status` field carries autonomy state: `"committed"` | `"ghost"` | `"pending_human"`
- `metadata` is a freeform `Record<string, unknown>` for domain-specific data that doesn't affect rendering

**Complexity:** LOW (schema design; no novel engineering)
**Dependencies:** Blueprint definitions must enumerate all valid `type` values

---

### 4. Confidence-Based Autonomy Matrix

**Why expected:** The core claim of the NSAI engine is that AI acts as cartographer, not author. Without a calibrated autonomy threshold, the AI either mutates the canvas without human awareness (violates control thesis) or requires confirmation on every token (unusable friction).

**Expected behavior:**

| Confidence | Action | UX Signal |
|------------|--------|-----------|
| > 0.85 | Direct canvas mutation — node/edge committed immediately | Node appears solid, full opacity |
| 0.5 – 0.85 | Ghost mutation — node/edge rendered as tentative (dashed border, ~40% opacity) | "Click to confirm" affordance visible |
| < 0.5 | No canvas mutation — text-only sidebar suggestion | Grey suggestion text in chat, no canvas change |

**Implementation pattern:**
- LLM outputs confidence as a verbalized field in the structured `CanvasOp` block (not extracted from prose)
- Confidence is produced via tool use / structured output — NOT verbalized uncertainty ("I think...") which is miscalibrated in RLHF models
- Ghost nodes are non-blocking: session can continue while ghost nodes sit unconfirmed
- Bulk ghost promotion: session admin can "confirm all ghosts" at phase transition

**Critical calibration warning (MEDIUM confidence):** Verbalized LLM confidence is systematically miscalibrated — RLHF training decouples verbal confidence from actual epistemic state. The 0.85/0.5 thresholds in the design are design-intent values, not empirically validated accuracy thresholds. In production, monitor ghost promotion rate (what % of ghosts get confirmed vs rejected) and tune thresholds based on observed behavior. High rejection rates → lower the direct-mutation threshold. Zero ghosts ever generated → threshold too high.

**Complexity:** MEDIUM
**Dependencies:** Structured output from LLM (tool use schema enforces confidence field); CanvasNode `status` field; React canvas component rendering for ghost state

---

### 5. Flex-Soft Domain Guardrails (DOMAIN_MATCH / DOMAIN_BRIDGE / DOMAIN_DRIFT)

**Why expected:** Without a routing layer, every user message hits the domain agent regardless of relevance. In a Debate/Strategy Blueprint session, questions like "what should I have for lunch?" would produce graph mutations about lunch, polluting the canvas.

**Expected behavior:**
- Every incoming human message passes through a lightweight classifier node BEFORE reaching any domain Agent
- Classification produces one of three labels:
  - `DOMAIN_MATCH`: message is on-topic for active Blueprint → route to domain Agent
  - `DOMAIN_BRIDGE`: message is adjacent/related → route to domain Agent with context note; LLM decides if canvas mutation is warranted
  - `DOMAIN_DRIFT`: message is off-topic → pass to plain LLM for conversational response; NO canvas mutation produced
- Classification must be synchronous and fast (target < 50ms) — it blocks the main response path
- "Flex-Soft" means: DOMAIN_DRIFT does NOT refuse or block the message; it just routes to a non-mutating path. Human conversation continues; only canvas is protected.

**Implementation options (ordered by latency):**
1. Lightweight classifier model (embedding similarity to Blueprint topic summary) — fastest, ~30ms
2. Small LLM call with few-shot examples — ~200ms, more accurate
3. Full domain agent with early exit — slowest but most nuanced

**Recommended for v1:** Option 2 (small LLM call). Domain classification with brief few-shot prompts is ~200ms, well within perceived response time. Option 1 requires embedding infrastructure not yet in the stack.

**Complexity:** MEDIUM (routing logic is straightforward; the calibration of what counts as BRIDGE vs DRIFT is the ongoing work)
**Dependencies:** LangGraph conditional edges; Blueprint topic metadata (each Blueprint needs a `domain_description` field for classifier context)

---

### 6. Mic Check Pattern (Human Turn Token)

**Why expected:** In a multi-user session, LLM cannot know whose turn it is, whether someone is typing, or whether a human message is still forming. Without a floor control mechanism, LLM may respond to incomplete thoughts, respond mid-typing, or respond to one participant while another has the floor.

**Expected behavior:**
- A `mic_check` field in session/branch state tracks which `user_id` currently holds the floor (or `null` if floor is open)
- LLM generation is gated: if `mic_check !== null` AND the current user is not the `mic_check` holder, message submission is blocked at the UI layer
- When a user begins composing a message, they implicitly claim the floor (`mic_check = user_id`)
- On message send, floor is released (`mic_check = null`) — LLM then fires
- On 30-second typing timeout without send, floor auto-releases
- Implementation uses Supabase Realtime broadcast (not DB write) for `mic_check` state — sub-100ms propagation, no persistence needed

**This is primarily a UX convention, not a technical lock.** The LLM itself does not check the token — the client and Hono endpoint enforce it. This means it can be violated by race conditions in the 100-300ms network window, which is acceptable: rare races produce benign double-responses.

**Complexity:** LOW (Supabase broadcast + Zustand state; no graph changes)
**Dependencies:** Supabase Realtime broadcast channel; Zustand branch state; existing user identity

---

### 7. Human Consensus Pattern (Phase Gating)

**Why expected:** Research on AI-facilitated structured deliberation (GROW coaching, debate stages, consensus building) consistently shows a critical pattern: LLM can signal readiness to advance a phase but cannot unilaterally advance it. Unilateral LLM phase advancement removes meaningful human agency — users feel shepherded rather than facilitated.

**Expected behavior:**
- Each Blueprint defines an ordered `phases` array (e.g., `["Framing", "Evidence", "Debate", "Synthesis"]`)
- `current_phase` is stored in Supabase session state (not LangGraph state — it outlives any single graph execution)
- LLM can emit a `phase_signal: { type: "READY_TO_ADVANCE", reason: string }` in the structured output — this renders as a UI indicator ("AI thinks you're ready to move to Evidence phase")
- Phase advancement requires an explicit human action: admin clicks "Advance Phase" button in the UI
- On phase advance: LangGraph state is updated, new system prompt prefix for the new phase is compiled, graph continues
- LLM cannot call any tool, emit any mutation block, or produce any output that changes `current_phase`

**Complexity:** LOW–MEDIUM (the state machine is simple; the UX for surfacing phase signals clearly is the non-trivial part)
**Dependencies:** Blueprint `phases` definition; Supabase session table `current_phase` field; LangGraph state schema includes `current_phase` as read-only (from DB) context

---

### 8. Langfuse Observability

**Why expected:** LangGraph multi-node execution makes debugging non-trivial without traces. When a message produces no canvas mutation, you need to know whether it was DOMAIN_DRIFT routing, a low-confidence ghost that wasn't rendered, a schema validation failure, or a model error. Langfuse is the de facto open-source standard for LLM observability in 2025-2026.

**Expected behavior:**
- Every graph execution (per user message) produces a Langfuse trace capturing: all node executions, LLM calls within each node, latency per node, token counts, estimated cost, the `thread_id` / `branch_id`
- Integration pattern (TypeScript, HIGH confidence):
  ```typescript
  import { CallbackHandler } from "@langfuse/langchain";
  const langfuseHandler = new CallbackHandler({
    sessionId: branchId,
    userId: creatorUserId,
    tags: [blueprintId, currentPhase],
  });
  await graph.invoke(input, { callbacks: [langfuseHandler] });
  ```
- Langfuse dashboard shows: cost per session, p95 latency per node, DOMAIN_DRIFT rate (tags), confidence distribution
- Does NOT require modifying individual nodes — the callback handler auto-instruments the entire graph

**Complexity:** LOW (single dependency, callback pattern; dashboard is zero-config)
**Dependencies:** `@langfuse/langchain` npm package; Langfuse account (self-hosted or cloud); LangGraph's callback support

---

## Differentiators (What Makes This System Distinct)

### Universal Graph Canvas (View A)

**Why it differentiates:** Most collaborative AI tools produce text. A live, interactive knowledge graph that evolves in real time alongside conversation is the core visual differentiator of the NSAI engine.

**Expected behavior:**
- React Flow (confirmed production-ready for node/edge graph rendering, used in AI pipeline tools like LangGraph Studio itself)
- Nodes are drag-repositionable by humans; LLM proposes positions but humans override freely
- Ghost nodes (`status: "ghost"`) render with dashed border and reduced opacity; click to promote to committed
- Edge labels show relationship type from Blueprint vocabulary
- Canvas is synchronized across all users in the branch via Supabase Realtime broadcast (canvas mutations broadcast as `CanvasOp` events)
- Multi-user conflict: "last write wins" is acceptable for v1 (CRDT/Yjs is v3+ complexity)
- Canvas coexists with existing Recharts widgets — Blueprint `canvas_view_mode` determines which is active (canvas, charts, or split)

**Complexity:** HIGH
**Dependencies:** React Flow library; existing Supabase Realtime infrastructure; CanvasNode/CanvasEdge schema; Blueprint `canvas_view_mode` field

**React Flow note (HIGH confidence):** React Flow is the standard choice for interactive node-edge graphs in React. It is used in production AI tools (LangGraph Studio, Hugging Face pipeline builders). Supports custom node rendering, collaborative examples with Yjs, and virtualization for large graphs. The free tier (MIT license) is sufficient for this use case.

---

### Debate/Strategy Blueprint as Production Domain

**Why it differentiates:** This is the first concrete proof that the Blueprint system is real, not theoretical. Without a shipped domain, the NSAI engine is infrastructure with no product.

**Blueprint definition:**
```json
{
  "id": "debate-strategy-v1",
  "node_types": ["Hypothesis", "Evidence", "Counter-Argument", "Action"],
  "edge_types": ["SUPPORTS", "CONTRADICTS", "BUILDS_ON"],
  "phases": ["Framing", "Evidence", "Debate", "Synthesis"],
  "canvas_view_mode": "canvas",
  "personas": ["analyst", "devil_advocate"],
  "domain_description": "Structured debate and strategic decision-making"
}
```

**Complexity:** LOW (JSON authoring; the infrastructure is table stakes above)
**Dependencies:** Blueprint schema defined and Ajv meta-schema validated

---

### LangGraph thread_id = branch_id (Graph State as Branch Memory)

**Why it differentiates:** Existing v1 branching isolates chat context. v2.0 elevates this: each branch has not just isolated message history but isolated graph execution state — the canvas, the accumulated ontology graph, the confidence history. Switching branches switches the entire NSAI engine state.

**Expected behavior:**
- `thread_id` is set to `branch_id` on every graph invocation — LangGraph checkpointer key
- Branch switch in UI triggers graph state reload from checkpointer (< 200ms for typical session)
- Branch fork creates a new `branch_id` → new LangGraph thread; initial state is a deep copy of parent thread's last checkpoint
- Merge operation synthesizes two threads' canvas states — this is a human-supervised operation (Human Consensus Pattern applies)

**Complexity:** MEDIUM (the branch fork as thread-copy is the novel part; standard LangGraph threading is well-documented)
**Dependencies:** Postgres checkpointer (Supabase); existing branch_id system; branch fork logic

---

### Prompt Caching + LangGraph State Compression

**Why it differentiates:** Multi-user sessions can run for 1–2 hours. Without caching, a 100-message session passes 50K+ tokens as context per LLM call, costing ~$0.75 per response. With prompt caching and state compression, that drops by 60–90%.

**Expected behavior:**
- Anthropic prompt caching: Blueprint JSON + tool schemas + system prompt are the stable prefix. Mark with `cache_control: { type: "ephemeral" }`. Cache TTL is 5 minutes — any gap longer than 5 minutes invalidates the cache.
- LangGraph state compression: after every N messages (configurable, default: 20), summarize older messages in the graph state into a compact summary node rather than carrying full message history. The summary replaces the raw messages in the state.
- State compression is a LangGraph standard pattern (documented); implementation is a summarization node that runs conditionally when `len(messages) > threshold`

**Complexity:** MEDIUM (prompt caching is low-effort; state compression requires a summarization node in the graph with careful prompt design to not lose critical ontology context)
**Dependencies:** Anthropic SDK `cache_control` support; LangGraph state schema

---

## Anti-Features (Explicitly NOT Building)

| Anti-Feature | Why NOT | What to Do Instead |
|---|---|---|
| **Fully autonomous canvas evolution** | Removes human from the loop; violates the Human-Centric Ontology thesis. Users feel surveilled, not facilitated. | Confidence-based autonomy matrix: LLM always checks in via ghost nodes or sidebar text |
| **LLM-controlled phase advancement** | Research shows LLM-paced sessions feel coercive. Users disengage when AI "tells them what to do next." | Human Consensus Pattern: LLM signals readiness, human advances phase |
| **Hard DOMAIN_DRIFT blocking** | Refusing off-topic messages destroys natural conversation flow and frustrates users mid-session | Flex-Soft routing: DOMAIN_DRIFT passes to plain LLM with no canvas impact; conversation continues freely |
| **CRDT/Yjs for canvas sync** | Massive complexity addition (Yjs + React Flow collaborative bindings + conflict resolution) for a problem that "last write wins" via Supabase Realtime solves for v1 session sizes | Supabase Realtime broadcast for canvas ops; revisit CRDT at 10+ concurrent canvas editors |
| **Multiple active canvases per branch** | Visual complexity exceeds a single developer's ability to design coherently; UX becomes incomprehensible | Single canvas per branch; Blueprint `canvas_view_mode` switches between canvas and chart views |
| **Automated Blueprint generation by AI** | AI-generated ontologies introduce circular dependency (LLM constraining itself); validation becomes untestable | Blueprints authored by humans (or future tooling), validated by Ajv at load time |
| **Per-node confidence sliders** | Manual human confidence adjustment adds authoring friction incompatible with fast group conversation pace | Ghost nodes auto-promote via explicit human click; no sliders |
| **LangGraph Cloud / LangGraph Platform** | Vendor lock-in, additional cost layer, complexity for solo dev. Hono + Vercel + Supabase is sufficient. | Self-hosted LangGraph JS graph execution within Hono endpoint |
| **Per-agent message quotas / token caps** | Complexity of billing layer premature for v2 with BYOK model | Creator API key absorbs cost; Langfuse dashboard shows cost per session for visibility |

---

## Feature Complexity Map

| Feature | Complexity | Type | Key Dependency |
|---|---|---|---|
| LangGraph OrchestratorNode + Agent nodes | HIGH | New infrastructure | Supabase Postgres checkpointer, Hono streaming |
| Universal Graph Canvas (React Flow) | HIGH | New frontend component | React Flow, Supabase Realtime broadcast |
| Confidence-based autonomy matrix | MEDIUM | New LLM output schema + frontend rendering | Tool use structured output, CanvasNode `status` field |
| Domain Blueprints + Ajv validation | MEDIUM | New data model | Supabase storage, Ajv (compile at boot) |
| Flex-Soft domain guardrail router | MEDIUM | New LangGraph node | Conditional edges, Blueprint `domain_description` |
| Prompt caching + state compression | MEDIUM | Optimization | Anthropic SDK `cache_control`, LangGraph state schema |
| thread_id = branch_id (graph-per-branch) | MEDIUM | Architecture integration | Postgres checkpointer, existing branch system |
| Human Consensus Pattern (phase gating) | LOW–MEDIUM | State + UX | Supabase session table, Blueprint `phases`, LangGraph read-only context |
| Langfuse observability | LOW | Integration | `@langfuse/langchain`, Langfuse account |
| Mic Check Pattern | LOW | UX convention + Realtime | Supabase Realtime broadcast, Zustand state |
| Debate/Strategy Blueprint definition | LOW | Content authoring | Blueprint schema |
| CanvasNode + CanvasEdge schema | LOW | Data model | Part of Blueprint architecture |

---

## Feature Dependencies (Build Order Constraints)

```
Blueprint schema + Ajv meta-validator
  → Domain Blueprints (Debate/Strategy)
    → CanvasNode + CanvasEdge data model
      → Confidence-based autonomy matrix (needs status field)
      → Universal Graph Canvas (needs node/edge types)

LangGraph orchestration (OrchestratorNode)
  → Supabase Postgres checkpointer
  → thread_id = branch_id mapping
    → Flex-Soft domain guardrail router (runs inside graph)
      → Prompt caching (stable prefix = Blueprint + system prompt)
        → State compression (optimization after basic flow works)

Langfuse integration → LangGraph orchestration (wraps graph invocations)
Mic Check Pattern → Supabase Realtime broadcast (already exists in v1)
Human Consensus Pattern → LangGraph state + Supabase session table

Universal Graph Canvas → React Flow + Supabase Realtime broadcast
  → Ghost node rendering (requires `status` field from autonomy matrix)
```

**Critical path:** Blueprint schema → LangGraph graph with Postgres checkpointer → domain guardrail router → confidence autonomy matrix → Graph Canvas frontend. Everything else (Langfuse, Mic Check, Human Consensus, caching) slots alongside this path.

---

## Phase-Specific Research Flags

| Phase Topic | Expected Pattern | Research Gap / Risk |
|---|---|---|
| LangGraph + Hono streaming on Vercel | Use Node.js runtime, `stream()` with multi-mode | SSE keep-alive behavior under Vercel's Fluid Compute — test empirically |
| Supabase Postgres checkpointer for LangGraph JS | `@skroyc/langgraph-supabase-checkpointer` exists on npm (v2.1) | Community package, not official LangChain. Evaluate stability vs rolling own with `@langchain/langgraph-checkpoint-postgres` |
| Branch fork as LangGraph thread copy | Thread fork = copy last checkpoint to new thread_id | LangGraph JS has no built-in "clone thread" API — implement as: read last checkpoint, write to new thread_id |
| Confidence calibration | Design thresholds (0.85/0.5) are design intent, not measured | Run initial sessions, measure ghost promotion vs rejection rate, tune thresholds in Phase 2 |
| React Flow collaborative multi-user | Supabase Realtime broadcast for canvas ops is sufficient for v1 | Race conditions when 2+ users move nodes simultaneously — "last write wins" is acceptable but test the UX feel |
| Langfuse JS/TS + LangGraph integration | `CallbackHandler` from `@langfuse/langchain`, pass to `graph.invoke()` | Verify callback handler compatibility with `graph.stream()` (not just `.invoke()`) — streaming mode may require different handler attachment |

---

## MVP Recommendation for v2.0

**Ship these first (core NSAI thesis):**
1. Blueprint schema + Ajv validation + Debate Blueprint definition
2. LangGraph OrchestratorNode with Postgres checkpointer (thread_id = branch_id)
3. Flex-Soft domain guardrail router (DOMAIN_MATCH / DOMAIN_BRIDGE / DOMAIN_DRIFT)
4. CanvasNode + CanvasEdge schema + confidence-based autonomy matrix
5. Universal Graph Canvas (React Flow) with ghost node rendering
6. Langfuse observability (low-effort, high operational value from day 1)

**Ship in parallel (lightweight, no blockers):**
- Mic Check Pattern (Supabase Realtime broadcast, Zustand — 1 day of work)
- Human Consensus Pattern (phase state in Supabase, phase signal in LLM output schema — 2 days)

**Defer to v2.1:**
- Prompt caching + state compression (optimize after basic flow is proven)
- Branch fork as LangGraph thread copy (can initially start fork from empty thread)
- Additional Blueprints beyond Debate/Strategy

---

## Sources

- LangGraph JS official docs: https://docs.langchain.com/oss/javascript/langgraph/overview
- LangGraph streaming patterns: https://focused.io/lab/streaming-agent-state-with-langgraph
- LangGraph 1.0 release (October 2025): https://medium.com/@romerorico.hugo/langgraph-1-0-released-no-breaking-changes-all-the-hard-won-lessons-8939d500ca7c
- Vercel Functions limits (updated 2026-06-19): https://vercel.com/docs/functions/limitations
- Langfuse LangGraph integration: https://langfuse.com/integrations/frameworks/langchain
- Langfuse JS/TS cookbook: https://langfuse.com/guides/cookbook/js_integration_langchain
- Ajv performance guide: https://ajv.js.org/guide/why-ajv.html
- Anthropic prompt caching: https://www.anthropic.com/news/prompt-caching
- LLM confidence calibration in production: https://tianpan.co/blog/2026-04-20-llm-calibration-production-overconfidence
- LLM guardrails domain drift: https://medium.com/@_jaydeepkarale/llm-guardrails-explained-preventing-domain-drift-in-production-ai-systems-8ed71bb12345
- Phase-gated LLM facilitation research: https://www.researchgate.net/publication/379476302_An_Automated_Multi-Phase_Facilitation_Agent_Based_on_LLM
- Agent anti-patterns: https://achan2013.medium.com/ai-agent-anti-patterns-part-1-architectural-pitfalls-that-break-enterprise-agents-before-they-32d211dded43
- React Flow production use: https://reactflow.dev/
- Supabase LangGraph checkpointer (npm): https://www.npmjs.com/package/@skroyc/langgraph-supabase-checkpointer
- LangGraph multi-agent orchestration guide: https://latenode.com/blog/ai-frameworks-technical-infrastructure/langgraph-multi-agent-orchestration/langgraph-multi-agent-orchestration-complete-framework-guide-architecture-analysis-2025
