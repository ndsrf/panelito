# Architecture: NSAI Integration into Hono + Supabase + Next.js

**Milestone:** v2.0 NSAI — Neuro-Symbolic Collaborative Engine
**Researched:** 2026-07-01
**Confidence:** HIGH (all integration points verified against official docs and live codebase)

---

## Context: What Already Exists

The existing stack is well-structured for this evolution. The key observation is that the
current `/invoke` route already does exactly what the NSAI engine needs to do — it just does
it imperatively rather than as a graph. The integration path is surgical, not a rewrite.

Existing components that remain unchanged:
- `AIProvider` interface and adapter factory (`createAdapter`)
- Auth middleware (`requireAuth`)
- All Supabase CRUD routes (sessions, messages, branches, reactions)
- `use-ai-stream.ts` on the frontend (SSE consumption logic is reusable)
- `PanelWidgetSchema` validation gate

Existing components that get modified:
- `routes/ai.ts` — the `/invoke` POST handler is replaced with a LangGraph execution path
- `packages/types/src/ai.ts` — new `CanvasNode` and `CanvasEdge` types added
- Supabase schema — three new tables added (see below)

---

## Integration Overview

```
POST /api/sessions/:id/invoke
         │
         ▼
  [MODIFIED: routes/ai.ts]
         │
  ① Load Blueprint from domain_blueprints
  ② Validate Blueprint with Ajv
  ③ Build LangGraph (OrchestratorNode + Agent nodes)
     thread_id = branch_id
  ④ graph.stream(input, { configurable: { thread_id } })
     ├── streamMode: ["messages", "custom"]
     ├── callbacks: [langfuseHandler]
         │
         ▼
  ⑤ Stream loop:
     ├── text_delta → SSE event: text_delta (unchanged, frontend reads this)
     ├── canvas_mutation → write to Supabase canvas_nodes/canvas_edges
     │                   → Supabase Realtime broadcast → all clients
     └── panel_update  → SSE event: panel_update (existing widget path unchanged)
         │
         ▼
  ⑥ After stream: insert AI message row (unchanged pattern)
  ⑦ langfuseHandler.flushAsync()
```

---

## Question 1: Where Does LangGraph Execute in the Hono Route?

### Replacement, Not Addition

The LangGraph graph **replaces** the direct `adapter.stream()` call inside the SSE handler
in `routes/ai.ts`. Everything else in that route stays: auth check, cap check, API key
decryption, persona loading, message history fetch, message insert after stream.

**Current shape (simplified):**
```typescript
return streamSSE(c, async (stream) => {
  for await (const event of adapter.stream(promptArray, [renderPanelTool], opts)) {
    // handle text_delta and tool_use
  }
})
```

**New shape (simplified):**
```typescript
return streamSSE(c, async (stream) => {
  const graph = buildNSAIGraph(adapter, blueprint, { branchId, sessionId })
  const graphConfig = {
    configurable: { thread_id: branchId },
    callbacks: [langfuseHandler],
  }
  for await (const chunk of await graph.stream(input, { ...graphConfig, streamMode: ["messages", "custom"] })) {
    // handle LangGraph stream chunks
  }
  await langfuseHandler.flushAsync()
})
```

The graph construction (`buildNSAIGraph`) is a pure function that takes the adapter, the
loaded Blueprint, and identifiers. It returns a compiled `StateGraph`. This function lives
in a new file: `apps/api/src/lib/nsai/graph.ts`.

### How the Graph Is Wired

LangGraph `StateGraph` with `Annotation.Root`:

```typescript
const NSAIStateAnnotation = Annotation.Root({
  messages:      Annotation<ProviderMessage[]>({ reducer: (a, b) => [...a, ...b] }),
  canvasNodes:   Annotation<CanvasNode[]>({ reducer: (a, b) => mergeNodes(a, b) }),
  canvasEdges:   Annotation<CanvasEdge[]>({ reducer: (a, b) => mergeEdges(a, b) }),
  domainMatch:   Annotation<'DOMAIN_MATCH' | 'DOMAIN_BRIDGE' | 'DOMAIN_DRIFT'>,
  confidence:    Annotation<number>,
  pendingMutations: Annotation<CanvasMutation[]>({ reducer: (a, b) => [...a, ...b] }),
})
```

Nodes:
- `orchestratorNode` — runs flex-soft guardrail classification, sets `domainMatch`, routes to agent
- `agentNode` (one per active domain persona, selected by Blueprint) — calls AIProvider adapter,
  produces `pendingMutations` + text
- `mutationGateNode` — applies confidence threshold: >0.85 direct, 0.5–0.85 ghost, <0.5 silent

Edges:
```typescript
graph
  .addEdge(START, 'orchestrator')
  .addConditionalEdges('orchestrator', routeByDomainMatch, {
    DOMAIN_MATCH: 'agent',
    DOMAIN_BRIDGE: 'agent',
    DOMAIN_DRIFT: END,  // silent — no agent fires
  })
  .addEdge('agent', 'mutationGate')
  .addEdge('mutationGate', END)
```

### What the Stream Loop Handles

LangGraph emits different chunk shapes depending on `streamMode`. Using `["messages", "custom"]`:

- `messages` mode yields `[messageChunk, metadata]` — token-by-token LLM text. These map
  directly to `text_delta` SSE events (same as today).
- `custom` mode yields whatever nodes write via `config.writer?.(payload)`. Agent nodes use
  this to emit `canvas_mutation` payloads without blocking the text stream.

The `mutationGateNode` calls `config.writer?.({ type: 'canvas_mutation', mutation })` for
each approved mutation. The route handler's stream loop catches these and writes them to
Supabase (not to the SSE stream — canvas state goes through Realtime, not SSE).

The existing `panel_update` SSE path survives intact. The agent node can still call the
`render_panel` tool; the route handles `tool_use` events exactly as before via `PanelWidgetSchema`.
The two paths (graph canvas and chart widgets) coexist.

---

## Question 2: How Does the LangGraph Postgres Checkpointer Connect to Supabase?

### Package

Use `@langchain/langgraph-checkpoint-postgres`. This is the official LangGraph JS checkpointer
for Postgres. It creates three tables: `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`,
and a `checkpoint_migrations` tracking table.

### Connection String Requirement

The PostgresSaver uses the `pg` connection pool internally. It requires prepared statements,
which means it **must not** use Supabase's transaction-mode pooler (port 6543). Use the
**session-mode connection** instead.

Supabase provides two connection strings:
- `postgresql://postgres.[ref]:[pass]@aws-[region].pooler.supabase.com:5432/postgres` — session
  mode via Supavisor, supports prepared statements. Use this.
- `postgresql://postgres.[ref]:[pass]@aws-[region].pooler.supabase.com:6543/postgres` — transaction
  mode, does NOT support prepared statements. Do not use for the checkpointer.

Alternatively use the direct connection string (bypasses Supavisor entirely):
`postgresql://postgres:[pass]@db.[ref].supabase.co:5432/postgres` — direct to Postgres.
This works but consumes one persistent connection. Acceptable for a single Vercel function.

### Setup Pattern

```typescript
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'

// Called once at module load (cold start), not on every request
const checkpointer = PostgresSaver.fromConnString(process.env.SUPABASE_DIRECT_URL!)

// Run setup() exactly once — idempotent, safe to call on every cold start
await checkpointer.setup()

// Use in graph compilation
const graph = builder.compile({ checkpointer })
```

**Vercel module-level singleton pattern:** Initialize `checkpointer` outside the request
handler. Vercel reuses warm function instances, so `setup()` runs only on cold start. Inside
the handler, use `graph.stream(input, { configurable: { thread_id: branchId } })`.

### What `thread_id = branch_id` Means

When a user switches branches, the branch UUID passed to `/invoke` changes. LangGraph loads
the checkpoint for that branch, resuming its graph state. Branch isolation is achieved
automatically through `thread_id`. No extra filtering is needed in the graph itself —
`thread_id` is the isolation boundary.

---

## Question 3: New Supabase Tables

### Table: `domain_blueprints`

Stores the JSON schema defining a session's domain ontology. Blueprint is loaded once per
`/invoke` call, validated with Ajv, then used to configure the graph.

```sql
CREATE TABLE public.domain_blueprints (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  domain       text        NOT NULL,             -- e.g. 'debate', 'strategy', 'red_team'
  version      int         NOT NULL DEFAULT 1,
  schema_json  jsonb       NOT NULL,             -- full Blueprint JSON
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX domain_blueprints_session_active_idx
  ON public.domain_blueprints (session_id) WHERE is_active = true;

ALTER TABLE public.domain_blueprints ENABLE ROW LEVEL SECURITY;

-- Only session creator can manage blueprints; participants can read
CREATE POLICY "blueprints_select" ON public.domain_blueprints
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "blueprints_insert" ON public.domain_blueprints
  FOR INSERT WITH CHECK (
    auth.uid() = (SELECT creator_id FROM public.sessions WHERE id = session_id)
  );

CREATE POLICY "blueprints_update" ON public.domain_blueprints
  FOR UPDATE USING (
    auth.uid() = (SELECT creator_id FROM public.sessions WHERE id = session_id)
  );
```

**Blueprint JSON shape (minimum viable for Debate domain):**
```json
{
  "domain": "debate",
  "node_types": [
    { "type": "Hypothesis",      "color": "#6366f1", "icon": "lightbulb" },
    { "type": "Evidence",        "color": "#22c55e", "icon": "check-circle" },
    { "type": "CounterArgument", "color": "#ef4444", "icon": "x-circle" },
    { "type": "Action",          "color": "#f59e0b", "icon": "arrow-right" }
  ],
  "edge_types": ["SUPPORTS", "CONTRADICTS", "BUILDS_ON"],
  "active_personas": ["scientific_analyst", "devils_advocate"],
  "view_mode": "graph"
}
```

### Table: `canvas_nodes`

```sql
CREATE TABLE public.canvas_nodes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  branch_id    uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  node_type    text        NOT NULL,    -- Blueprint-defined: 'Hypothesis', 'Evidence', etc.
  label        text        NOT NULL,
  description  text,
  confidence   numeric     NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  status       text        NOT NULL DEFAULT 'direct'
                           CHECK (status IN ('direct', 'ghost', 'silent')),
  source_message_id uuid   REFERENCES public.messages(id) ON DELETE SET NULL,
  position_x   numeric     NOT NULL DEFAULT 0,
  position_y   numeric     NOT NULL DEFAULT 0,
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX canvas_nodes_branch_idx ON public.canvas_nodes (branch_id);
CREATE INDEX canvas_nodes_session_idx ON public.canvas_nodes (session_id, branch_id);

ALTER TABLE public.canvas_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canvas_nodes_select" ON public.canvas_nodes
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "canvas_nodes_insert" ON public.canvas_nodes
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "canvas_nodes_update" ON public.canvas_nodes
  FOR UPDATE USING (auth.uid() IS NOT NULL);
```

### Table: `canvas_edges`

```sql
CREATE TABLE public.canvas_edges (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  branch_id    uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  source_node_id uuid      NOT NULL REFERENCES public.canvas_nodes(id) ON DELETE CASCADE,
  target_node_id uuid      NOT NULL REFERENCES public.canvas_nodes(id) ON DELETE CASCADE,
  edge_type    text        NOT NULL,    -- Blueprint-defined: 'SUPPORTS', 'CONTRADICTS', etc.
  confidence   numeric     NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  status       text        NOT NULL DEFAULT 'direct'
                           CHECK (status IN ('direct', 'ghost', 'silent')),
  source_message_id uuid   REFERENCES public.messages(id) ON DELETE SET NULL,
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX canvas_edges_branch_idx ON public.canvas_edges (branch_id);
CREATE UNIQUE INDEX canvas_edges_pair_idx ON public.canvas_edges
  (branch_id, source_node_id, target_node_id, edge_type);

ALTER TABLE public.canvas_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canvas_edges_select" ON public.canvas_edges
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "canvas_edges_insert" ON public.canvas_edges
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "canvas_edges_update" ON public.canvas_edges
  FOR UPDATE USING (auth.uid() IS NOT NULL);
```

### Checkpointer Tables (auto-created by `checkpointer.setup()`)

LangGraph creates these automatically in the `public` schema:
- `checkpoints` — one row per graph superstep; keyed on `(thread_id, checkpoint_ns, checkpoint_id)`
- `checkpoint_blobs` — serialized large state values (message lists, canvas arrays)
- `checkpoint_writes` — intermediate write log between supersteps
- `checkpoint_migrations` — schema version tracking

These tables are internal to LangGraph. Do not query them directly. Do not add RLS — they
are only accessed by the service-role checkpointer client.

**Recommendation:** Create a separate `SUPABASE_DIRECT_URL` environment variable pointing
to the direct connection string (not the anon key URL) specifically for the checkpointer.
The existing `@supabase/supabase-js` client in the rest of the API continues to use the
existing credentials.

---

## Question 4: Canvas State Flow — LangGraph → Supabase → Realtime → Frontend

### Full Path

```
LangGraph mutationGateNode
    │  calls config.writer({ type: 'canvas_mutation', mutation })
    ▼
routes/ai.ts stream loop catches 'canvas_mutation' chunk
    │
    ├── if mutation.op === 'upsert_node':
    │     INSERT INTO canvas_nodes ... ON CONFLICT (id) DO UPDATE
    │
    ├── if mutation.op === 'upsert_edge':
    │     INSERT INTO canvas_edges ... ON CONFLICT DO UPDATE
    │
    └── if mutation.op === 'delete_node':
          DELETE FROM canvas_nodes WHERE id = ...
    │
    ▼
After each Supabase write:
supabase.channel(`session:${sessionId}`)
  .httpSend('canvas_mutation', { op, data })
    │
    ▼
Supabase Realtime broadcast → all connected clients on that channel
    │
    ▼
Frontend: useSessionChannel hook
  .on('broadcast', { event: 'canvas_mutation' }, handler)
    │
    ▼
Zustand canvasStore.applyMutation(mutation)
    │
    ▼
GraphCanvas component re-renders
```

### Why Realtime Broadcast Instead of SSE for Canvas

The SSE stream goes only to the invoking client (the one that pressed send). Canvas mutations
must reach all session participants. The existing pattern (`supabase.channel().httpSend()`)
already handles this for `new_message` and `panel_update` events. Canvas mutations follow
the same pattern.

The existing `use-session-channel.ts` hook already subscribes to the `session:${sessionId}`
channel. Extending it to handle `canvas_mutation` events is additive — no structural change.

### Canvas State Hydration on Join/Branch Switch

When a participant joins a session or switches branches, they need the current canvas state.
This comes from a direct Supabase query, not Realtime:

```typescript
// New API endpoint: GET /api/sessions/:id/canvas?branch_id=...
// Returns { nodes: CanvasNode[], edges: CanvasEdge[] }
const { nodes, edges } = await fetch(`/api/sessions/${sessionId}/canvas?branch_id=${branchId}`)
```

This endpoint is new. It queries `canvas_nodes` and `canvas_edges` filtered by `branch_id`.
It is the single source of truth on initial load; Realtime broadcast keeps it current after.

### Ghost Node Rendering

Nodes with `status = 'ghost'` are rendered in the `GraphCanvas` component with reduced
opacity and a dashed border. Ghost nodes are written to Supabase normally (so all clients
see them) but the `status` field drives the visual treatment. Promoting a ghost to `direct`
is an UPDATE to the `status` column — triggering another broadcast.

---

## Question 5: Langfuse in a Hono Serverless Function

### The Flush Problem

Vercel Serverless Functions (Hono bridged via `app/api/[[...route]]/route.ts`) are short-lived.
Langfuse's LangChain callback handler queues events and flushes them in the background. Without
explicit flushing, traces are silently lost when the function exits.

### Solution

```typescript
import { CallbackHandler } from '@langfuse/langchain'

// Inside the SSE handler, per-request:
const langfuseHandler = new CallbackHandler({
  secretKey:  env.LANGFUSE_SECRET_KEY,
  publicKey:  env.LANGFUSE_PUBLIC_KEY,
  baseUrl:    env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
  sessionId:  sessionId,
  userId:     session.creator_id,
  tags:       [providerName, `branch:${branchId ?? 'main'}`],
})

// After the stream loop completes, before the SSE 'done' event:
await langfuseHandler.flushAsync()

await stream.writeSSE({ event: 'done', data: '{}' })
```

**Key facts (verified):**
- `CallbackHandler` is from `langfuse-langchain` (package: `langfuse-langchain`)
- Pass it via `{ callbacks: [langfuseHandler] }` to `graph.stream()` or `graph.invoke()`
- `flushAsync()` blocks until all pending trace events are delivered
- Do not set `LANGCHAIN_CALLBACKS_BACKGROUND=false` globally — it slows all callbacks.
  The explicit `flushAsync()` is more targeted.
- Create a new `CallbackHandler` instance per request, not a module-level singleton.
  Handler instances accumulate trace context; sharing across requests corrupts traces.

### What Langfuse Captures Automatically

When passed as a LangGraph callback, Langfuse traces:
- Each graph node execution (name, input state, output state, duration)
- LLM calls within nodes (model, tokens in/out, cost estimate, latency)
- Tool calls (name, input, output)
- Overall graph run (total cost, total latency, success/error)

No manual span creation needed. The callback handler instruments everything automatically.

### Environment Variables to Add

```
LANGFUSE_SECRET_KEY=...
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_BASE_URL=https://cloud.langfuse.com  # or self-hosted URL
```

---

## Question 6: Build Order

The dependencies form a strict chain. Each layer must be complete before the next can be
tested end-to-end.

### Layer 0: Schema Foundation (no code dependencies, must be first)

**Why first:** Every subsequent piece writes to or reads from these tables. Migration order
matters — `canvas_nodes` references `branches`, which must exist.

Tasks:
1. Migration: `canvas_nodes` table + RLS
2. Migration: `canvas_edges` table + RLS
3. Migration: `domain_blueprints` table + RLS
4. Seed: Debate/Strategy Blueprint row for testing
5. Add `SUPABASE_DIRECT_URL` env var

### Layer 1: Types Package (no runtime dependencies)

**Why second:** The TypeScript types for `CanvasNode`, `CanvasEdge`, `CanvasMutation`, and
`Blueprint` are used by both the API (graph nodes) and the frontend (Zustand store, GraphCanvas).
Defining them first prevents type-chasing later.

Tasks:
1. `packages/types/src/canvas.ts` — `CanvasNode`, `CanvasEdge`, `CanvasMutation` types
2. `packages/types/src/blueprint.ts` — `Blueprint`, `NodeTypeDef`, `EdgeTypeDef` types
3. Export from `packages/types/src/index.ts`

### Layer 2: Blueprint Loading + Ajv Validation (API only, no LangGraph yet)

**Why third:** Proves the Blueprint round-trip (DB → API → Ajv) before adding LangGraph.
Fail fast on schema issues without touching the graph.

Tasks:
1. `apps/api/src/lib/nsai/blueprint-loader.ts` — fetch active blueprint from `domain_blueprints`
2. `apps/api/src/lib/nsai/blueprint-validator.ts` — Ajv schema for Blueprint JSON
3. Hono middleware that validates Blueprint on `/invoke` (returns 422 on invalid Blueprint)
4. `GET /api/sessions/:id/blueprints/active` endpoint (creator UI will need this)

### Layer 3: LangGraph Graph Construction (API, no Supabase canvas writes yet)

**Why fourth:** Build the graph as a unit, testable in isolation before wiring Realtime.
Use `MemorySaver` checkpointer during development, swap to `PostgresSaver` in Layer 4.

Tasks:
1. Install: `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres`
2. `apps/api/src/lib/nsai/graph.ts` — `buildNSAIGraph(adapter, blueprint, opts)` function
3. `apps/api/src/lib/nsai/nodes/orchestrator.ts` — domain guardrail node
4. `apps/api/src/lib/nsai/nodes/agent.ts` — parameterized agent node (takes Blueprint persona)
5. `apps/api/src/lib/nsai/nodes/mutation-gate.ts` — confidence threshold routing
6. Unit tests: graph compilation, state transitions, routing logic

### Layer 4: Postgres Checkpointer (swaps MemorySaver for PostgresSaver)

**Why fifth:** Checkpointer is an infrastructure swap, not a logic change. Separating it
lets Layer 3 unit tests run without a Supabase connection.

Tasks:
1. `apps/api/src/lib/nsai/checkpointer.ts` — singleton `PostgresSaver` with `setup()` guard
2. Run `checkpointer.setup()` once; verify tables created in Supabase
3. Update `buildNSAIGraph` to accept checkpointer as parameter
4. Integration test: same `thread_id` across two `/invoke` calls resumes state

### Layer 5: `/invoke` Route Modification (the critical seam)

**Why sixth:** This is where everything connects. The route modification is the highest-risk
step — it touches the existing streaming path that v1 users depend on.

Tasks:
1. **Modify** `apps/api/src/routes/ai.ts`:
   - Load Blueprint via `blueprint-loader`
   - Build graph via `buildNSAIGraph`
   - Replace `adapter.stream()` loop with `graph.stream()` loop
   - Keep all pre/post stream logic (cap check, message insert, etc.)
2. Stream loop changes:
   - `messages` mode chunks → forward as `text_delta` SSE (same as today)
   - `custom` mode chunks with `type === 'canvas_mutation'` → write to Supabase (NEW)
   - `tool_use` events from agent nodes → existing `render_panel` path (unchanged)
3. Add `langfuseHandler` construction + `flushAsync()` call
4. Smoke test: existing widget rendering still works (panel_update SSE still fires)

### Layer 6: Canvas Supabase Writes + Realtime Broadcast

**Why seventh:** Canvas persistence is a new data path. Prove writes land correctly before
adding the frontend consumer.

Tasks:
1. `apps/api/src/lib/nsai/canvas-writer.ts` — `applyCanvasMutation(supabase, mutation)` function
2. Call `canvasWriter` from route stream loop for `canvas_mutation` chunks
3. After each write: `supabase.channel(`session:${sessionId}`).httpSend('canvas_mutation', mutation)`
4. Verify via Supabase dashboard that rows land in `canvas_nodes` / `canvas_edges`

### Layer 7: Canvas Hydration Endpoint

**Why eighth:** Frontend cannot load initial canvas state without this endpoint.

Tasks:
1. New route: `GET /api/sessions/:id/canvas?branch_id=...`
2. Returns `{ nodes: CanvasNode[], edges: CanvasEdge[] }`
3. Filtered by `branch_id`; respects RLS

### Layer 8: Frontend — Zustand Canvas Store + Realtime Handler

**Why ninth:** State management before UI component.

Tasks:
1. `apps/web/store/canvas-store.ts` — `canvasStore` with `nodes`, `edges` state
   - `applyMutation(mutation: CanvasMutation)` reducer
   - `loadBranch(branchId)` fetches from Layer 7 endpoint
2. **Modify** `apps/web/hooks/use-session-channel.ts`:
   - Add `.on('broadcast', { event: 'canvas_mutation' }, ...)` handler
   - Calls `canvasStore.applyMutation(mutation)`
3. **Modify** `apps/web/hooks/use-ai-stream.ts`: no changes needed (SSE path unchanged)

### Layer 9: GraphCanvas Frontend Component

**Why last:** UI is the final consumer of all preceding layers.

Tasks:
1. Install: `reactflow` (or `@xyflow/react`) — the standard graph canvas library for React
2. `apps/web/components/canvas/GraphCanvas.tsx` — reads from `canvasStore`
3. Renders `CanvasNode` components styled per Blueprint `node_types` color/icon
4. Renders `CanvasEdge` components labeled per Blueprint `edge_types`
5. Ghost nodes rendered with opacity + dashed style based on `status` field
6. Hydrates on mount via `canvasStore.loadBranch(branchId)`
7. Integrate into the analytics panel as View A (alongside existing chart widgets)

---

## Vercel Serverless Constraints

### Time Limits

| Plan | Default | Max | Extended Max |
|------|---------|-----|-------------|
| Hobby | 300s | 300s | — |
| Pro | 300s | 800s | 1800s (beta) |

LangGraph graphs with multi-step reasoning can run long. For a single `/invoke` call with
OrchestratorNode + AgentNode + MutationGateNode, expect 5–30 seconds total (dominated by
LLM API latency). This fits comfortably within the 300s default. No special duration config
needed in v2.0.

### Connection Pooling

The `PostgresSaver` uses a `pg.Pool` internally. In Vercel serverless, each cold start
creates a new pool. Warm instances reuse the pool. The direct Supabase connection string
supports persistent connections. Set `max: 3` on the pool config to avoid exhausting
Supabase's connection limit across concurrent function instances.

### Cold Start

LangGraph + `@anthropic-ai/sdk` adds ~2–4MB to the bundle. Expect 1–2s additional cold
start latency. Acceptable for a conversational application where users tolerate a brief
first-response delay.

---

## Component Boundary Summary

| Component | Location | Status | What Changes |
|-----------|----------|--------|-------------|
| `routes/ai.ts` | `apps/api/src/routes/` | MODIFIED | Replace `adapter.stream()` loop with `graph.stream()` loop; add Blueprint load; add Langfuse flush |
| `lib/nsai/graph.ts` | `apps/api/src/lib/nsai/` | NEW | `buildNSAIGraph()` function |
| `lib/nsai/nodes/*.ts` | `apps/api/src/lib/nsai/nodes/` | NEW | Orchestrator, Agent, MutationGate nodes |
| `lib/nsai/blueprint-loader.ts` | `apps/api/src/lib/nsai/` | NEW | Fetch active Blueprint from Supabase |
| `lib/nsai/blueprint-validator.ts` | `apps/api/src/lib/nsai/` | NEW | Ajv schema validation |
| `lib/nsai/canvas-writer.ts` | `apps/api/src/lib/nsai/` | NEW | Write `CanvasMutation` to Supabase |
| `lib/nsai/checkpointer.ts` | `apps/api/src/lib/nsai/` | NEW | `PostgresSaver` singleton |
| `packages/types/src/canvas.ts` | `packages/types/src/` | NEW | `CanvasNode`, `CanvasEdge`, `CanvasMutation` |
| `packages/types/src/blueprint.ts` | `packages/types/src/` | NEW | `Blueprint`, `NodeTypeDef`, `EdgeTypeDef` |
| `routes/canvas.ts` | `apps/api/src/routes/` | NEW | `GET /api/sessions/:id/canvas` |
| `store/canvas-store.ts` | `apps/web/store/` | NEW | Zustand canvas state |
| `hooks/use-session-channel.ts` | `apps/web/hooks/` | MODIFIED | Add `canvas_mutation` broadcast handler |
| `components/canvas/GraphCanvas.tsx` | `apps/web/components/canvas/` | NEW | React Flow graph renderer |
| Supabase schema | migrations | NEW | `canvas_nodes`, `canvas_edges`, `domain_blueprints` tables |
| LangGraph checkpointer tables | auto-created | NEW | `checkpoints`, `checkpoint_blobs`, `checkpoint_writes` |

---

## What Does NOT Change

The following are explicitly preserved and require no modification:

- `AIProvider` interface and all three adapters (Anthropic, OpenAI, Gemini)
- `adapter-factory.ts` (`createAdapter`)
- `lib/anthropic.ts` (`assemblePromptArray`, `compressHistory`, `verifyApiKey`)
- All non-AI routes (sessions, messages, branches, reactions, keys, settings)
- `use-ai-stream.ts` SSE consumption logic
- `PanelWidgetSchema` and the `panel_update` SSE event path
- Auth middleware
- All existing Supabase tables (no schema changes to existing tables)
- Supabase Realtime channel naming (`session:${sessionId}`) and broadcast pattern

---

## Sources

- LangGraph JS streaming modes: https://langchain-ai.github.io/langgraphjs/how-tos/streaming-content/
- LangGraph JS checkpointer persistence: https://langchain-ai.github.io/langgraphjs/concepts/human_in_the_loop/
- `@langchain/langgraph-checkpoint-postgres` tables: https://blog.lordpatil.com/posts/langgraph-postgres-checkpointer/
- Langfuse LangChain TypeScript callbacks: https://langfuse.com/docs/langchain/typescript
- Vercel function duration limits: https://vercel.com/docs/functions/configuring-functions/duration
- Supabase connection modes (session vs transaction pooler): https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase Realtime broadcast `httpSend`: https://supabase.com/docs/guides/realtime/broadcast
- `@hono/ajv-validator` middleware: https://jsr.io/@hono/ajv-validator
- LangGraph multi-agent routing: https://docs.langchain.com/oss/javascript/langgraph/workflows-agents
