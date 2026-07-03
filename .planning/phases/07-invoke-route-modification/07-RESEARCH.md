# Phase 7: /invoke Route Modification - Research

**Researched:** 2026-07-03
**Domain:** Hono SSE streaming + LangGraph graph.astream() integration + Langfuse per-request tracing + abort signal propagation
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** V1 backward compatibility is dropped. Sessions with no `blueprint_id` → `c.json({ error: 'no_blueprint' }, 400)` before any AI call.
- **D-02:** The existing `session.active_personas` 409 gate (`no_active_persona`) is preserved — runs after the `no_blueprint` check.
- **D-03:** Session SELECT must expand to include `blueprint_id` and `current_phase` (in addition to `id, creator_id, active_personas`). These populate initial LangGraph state.
- **D-04:** `loadBlueprint(blueprintId)` called immediately after session fetch and before opening the SSE stream. Full Blueprint object passed via `config.configurable.blueprint`.
- **D-05:** Text tokens reach SSE client via a **streamWriter seam**: `streamWriter?: (text: string) => void` added to `config.configurable`. AgentNode and DriftReplyNode call `config.configurable.streamWriter?.(event.text)` for each `text_delta` event.
- **D-06:** Route creates an async queue backed by streamWriter. Inside `streamSSE(c, ...)`, route runs `Promise.all([graphExecution, ssePiping])`. SSE emits `done` only after both branches resolve.
- **D-07:** No new npm packages for streaming. AIProvider adapter abstraction preserved inside graph nodes.
- **D-08:** AgentNode system prompt bans canvas meta-commentary. Banned phrases: "I added a node", "I mapped this to", "I connected", "I've recorded", and any description of canvas operations.
- **D-09:** AgentNode produces text output **only when the information cannot be fully represented in the canvas mutation**. Prefer silence. Text should be 1-2 sentences of substantive insight.
- **D-10:** `buildAgentSystemPrompt()` updated to accept active persona instructions and append them after Blueprint phase instructions. Route passes `active_personas` via `config.configurable.activePersonas: string[]`.
- **D-11:** On DOMAIN_BRIDGE, route still goes to AgentNode for canvas mutation. Additionally, `blueprint.drift_reply_probability` roll is applied: if roll < probability → AgentNode also produces brief steering text. If roll >= probability → canvas mutation only, no steering text.
- **D-12:** Steering text on DOMAIN_BRIDGE is polite and redirective. Never says "blueprint", "domain", or technical terms.
- **D-13:** `active_personas` session field still works in Blueprint sessions. PERSONA_LIBRARY lookup and `matchedPersonas` filtering unchanged. 409 `no_active_persona` gate unchanged.
- **D-14:** Client disconnect MUST be logged in Langfuse as a trace attribute or event. `c.req.raw.signal` preferred. Must propagate to `graph.astream()` via `config.signal`.
- **D-15:** New env var `LANGFUSE_TRACE_LEVEL: 'graph' | 'full'`. Default `'graph'`. `'full'` wraps entire route handler in Langfuse parent span. Validated in `apps/api/src/lib/env.ts`. Added to `.env.example`.
- **D-16:** Early-exit paths (400, 409, 429) are NOT traced.

### Claude's Discretion

- Exact `Promise.all` / async queue coordination pattern for concurrent graph + SSE piping
- Whether to use `c.req.raw.signal` directly or create a manual AbortController with Hono stream lifecycle events
- The `active_personas` field name in `config.configurable` (suggest `activePersonas: string[]`)
- `buildAgentSystemPrompt()` signature extension to accept persona instructions
- LANGFUSE_TRACE_LEVEL 'full' route-level parent span implementation details

### Deferred Ideas (OUT OF SCOPE)

- Blueprint hot-reload mid-session (BLUE-07, v2.1)
- `phase_signal` emission from LLM (HUMAN-02) — Phase 8
- Canvas snapshot state for Blueprint sessions — Phase 8
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORCH-01 | Each user message runs a LangGraph StateGraph with three nodes — OrchestratorNode → AgentNode → MutationGateNode — replacing the direct LLM adapter call in the /invoke route | graph.astream() integration pattern, streamWriter seam, Promise.all coordination detailed below |
</phase_requirements>

---

## Summary

Phase 7 is a surgical replacement of steps 8-9 in `apps/api/src/routes/ai.ts` — the direct `adapter.stream()` call and SSE loop are replaced with `graph.astream()` + a streamWriter seam. The graph (`createGraph(checkpointer)`) and its PostgresSaver checkpointer are fully proven in Phase 6. Phase 7's principal engineering challenge is coordinating two concurrent async operations inside a single `streamSSE` callback: the graph execution and the SSE stream consumer draining the text queue.

The second major concern is abort propagation. Hono's `streamSSE` exposes `c.req.raw.signal` (a standard Web `AbortSignal`) that fires when the client disconnects. This signal must be wired into `graph.astream()` via `config.signal` so LangGraph terminates the in-flight LLM calls. The Phase 6 nodes (AgentNode, DriftReplyNode, OrchestratorNode) call `adapter.stream()` internally in an `async for` loop — when the signal aborts, the graph's execution context propagates the cancellation to the running node's async generator.

The Langfuse integration built in Phase 6 (per-request `CallbackHandler` on `config.callbacks`) carries forward unchanged. Phase 7 adds two concerns on top: `LANGFUSE_TRACE_LEVEL` env control to optionally wrap the whole route in a parent span, and a `waitUntil`-style flush after the SSE response closes (OBS-02).

**Primary recommendation:** Use a lightweight async-queue pattern (an array of pending text chunks + a Promise-based `notify` mechanism) as the streamWriter implementation. `Promise.all` drives graph + SSE drain concurrently inside `streamSSE`. No new packages needed — standard JS primitives are sufficient.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Blueprint gate (no_blueprint 400) | API / Backend | — | Route-level guard before any AI work; must block at HTTP layer |
| Session data fetching (blueprint_id, current_phase) | API / Backend | Database | Expanded SELECT on `sessions` table; data flows into LangGraph initial state |
| Blueprint loading (loadBlueprint) | API / Backend | — | Existing lib function; called between session fetch and SSE open |
| Graph execution (graph.astream) | API / Backend | — | LangGraph StateGraph runs in Node.js runtime; not edge-compatible |
| Text streaming seam (streamWriter) | API / Backend | — | config.configurable bridge between graph nodes and SSE layer |
| SSE transport (streamSSE) | API / Backend | Browser / Client | Hono streamSSE → EventSource on frontend; same format as Phase 1-4 |
| Abort propagation (c.req.raw.signal) | API / Backend | — | Web standard AbortSignal from Hono → graph.astream config.signal |
| Langfuse tracing (CallbackHandler) | API / Backend | — | Per-request, not module-level; OBS-01 constraint |
| Langfuse flush (forceFlush) | API / Backend | — | OBS-02: waitUntil or post-stream flush before function exit |
| Env validation (LANGFUSE_TRACE_LEVEL) | API / Backend | — | Zod union type in env.ts; startup-time validation |

---

## Standard Stack

No new npm packages are added in Phase 7 (D-07). All functionality uses libraries already installed in `apps/api`.

### Core (already installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@langchain/langgraph` | 1.4.7 | `graph.astream()`, `config.signal` propagation | [VERIFIED: package.json] |
| `hono` | 4.12.24 | `streamSSE`, `c.req.raw.signal` | [VERIFIED: package.json] |
| `@langfuse/langchain` | 5.9.1 | Per-request `CallbackHandler` | [VERIFIED: package.json] |
| `@langfuse/tracing` | 5.9.1 | `getLangfuseTracerProvider().forceFlush()` | [VERIFIED: package.json] |
| `@langchain/langgraph-checkpoint-postgres` | 1.0.4 | `PostgresSaver` via `getCheckpointer()` | [VERIFIED: package.json] |

### Supporting (already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | existing | `LANGFUSE_TRACE_LEVEL` union type validation in `env.ts` | env var schema extension |

**Installation:** None required — no new packages.

## Package Legitimacy Audit

No new packages are installed in Phase 7. All dependencies are already present in `apps/api/package.json` and were audited in prior phases. This section is intentionally minimal.

| Package | Registry | Disposition |
|---------|----------|-------------|
| All Phase 7 deps | Pre-existing in package.json | Approved (audited in prior phases) |

---

## Architecture Patterns

### System Architecture Diagram

```
POST /api/sessions/:id/invoke
       │
       ├─► [Step 1] SELECT id, creator_id, active_personas, blueprint_id, current_phase
       │     └─► no row → 404
       │
       ├─► [Step 1.5] blueprint_id guard
       │     └─► null → 400 { error: 'no_blueprint' }
       │
       ├─► [Step 2] checkCap() → 429 if reached
       │
       ├─► [Step 3] parse body, anyoneTyping gate → 429 typing_hold
       │
       ├─► [Step 4] matchedPersonas from PERSONA_LIBRARY → 409 no_active_persona
       │
       ├─► [Step 5] fetch creator_settings → providerName, decrypt plaintextKey
       │
       ├─► [Step 6] createAdapter(providerName, plaintextKey) — for compression only
       │
       ├─► [Step 7] fetch messages → compressHistory → assemblePromptArray → state.messages
       │
       ├─► [Step 7.5] loadBlueprint(blueprint_id) → blueprint object
       │
       ├─► [Step 8 NEW] getCheckpointer() → PostgresSaver
       │
       └─► streamSSE(c, async (stream) => {
               │
               ├─► create textQueue (array + notify Promise pair)
               ├─► define streamWriter = (text) => { textQueue.push(text); notify() }
               │
               ├─► graphExecution = graph.astream(
               │       initialState,
               │       {
               │         configurable: {
               │           thread_id: activeBranchId ?? sessionId,
               │           blueprint,
               │           providerName, plaintextKey, activePersonas,
               │           streamWriter,
               │         },
               │         callbacks: [new CallbackHandler(...)],
               │         signal: c.req.raw.signal,  ← abort propagation
               │       }
               │   )
               │
               ├─► ssePiping = async () => {
               │       for each text chunk in queue → stream.writeSSE(text_delta)
               │       on abort → log disconnect to Langfuse
               │   }
               │
               ├─► await Promise.all([graphExecution, ssePiping])
               │
               ├─► insert AI message (accumulatedText, canvas_snapshot_state=null for Phase 7)
               ├─► incrementCount()
               ├─► getLangfuseTracerProvider().forceFlush()  [OBS-02]
               └─► stream.writeSSE({ event: 'done' })
           })
```

### Recommended Project Structure

No new directories. All changes are within existing files:

```
apps/api/src/
├── routes/
│   └── ai.ts                    ← PRIMARY: steps 8-9 replaced; blueprint gate added
├── graph/
│   ├── nodes/
│   │   ├── agent.ts             ← streamWriter seam + D-08/D-09 text rules + activePersonas
│   │   └── drift-reply.ts       ← streamWriter seam (one-line addition)
│   └── (orchestrator, mutation-gate, state, graph unchanged)
└── lib/
    └── env.ts                   ← LANGFUSE_TRACE_LEVEL union type added
.env.example                     ← LANGFUSE_TRACE_LEVEL=graph added
```

### Pattern 1: streamWriter Seam + Async Queue

**What:** The graph nodes call `config.configurable.streamWriter?.(text)` for each `text_delta`. The route creates a queue backed by this writer. The SSE consumer drains the queue concurrently with the graph via `Promise.all`.

**When to use:** Any time a LangGraph graph must produce real-time streaming output through Hono's SSE layer.

**Example (async queue with Promise notification):**
```typescript
// Source: Claude's Discretion (D-06) — no external library needed

// Inside streamSSE callback:
const textChunks: string[] = []
let _notify: (() => void) | null = null

function streamWriter(text: string): void {
  textChunks.push(text)
  _notify?.()
}

let graphDone = false

// SSE drain loop (runs concurrently with graph)
async function drainQueue(): Promise<void> {
  while (!graphDone || textChunks.length > 0) {
    while (textChunks.length > 0) {
      const text = textChunks.shift()!
      await stream.writeSSE({ event: 'text_delta', data: JSON.stringify({ text }) })
    }
    if (!graphDone) {
      // Wait for next notification or graph completion
      await new Promise<void>((resolve) => { _notify = resolve })
      _notify = null
    }
  }
}

// Graph execution
async function runGraph(): Promise<void> {
  for await (const _chunk of graph.astream(initialState, config)) {
    // graph.astream yields state snapshots — we don't need them here;
    // text tokens flow via streamWriter in config.configurable
  }
  graphDone = true
  _notify?.()  // Wake drainQueue for final flush
}

await Promise.all([runGraph(), drainQueue()])
```

**Key insight:** `graph.astream()` yields state snapshots (one per node transition), not individual tokens. The token stream flows out-of-band via the `streamWriter` callback injected into `config.configurable`. These are two separate channels that must be coordinated.

### Pattern 2: Abort Signal Wiring

**What:** `c.req.raw.signal` is the Web `AbortSignal` that fires when the HTTP client disconnects. Passing it via `config.signal` causes LangGraph to abort the in-flight `graph.astream()` iteration.

**When to use:** Every `graph.astream()` call in a Hono SSE route.

**Example:**
```typescript
// Source: CONTEXT.md D-14 + Hono Web API compatibility
const abortSignal = c.req.raw.signal

const config = {
  configurable: { /* ... */ },
  callbacks: [callbackHandler],
  signal: abortSignal,
}

// The signal automatically propagates through LangGraph to the running node.
// When the client disconnects, graph.astream() throws AbortError or stops yielding.
// Catch it in the outer try/catch and log disconnect to Langfuse.
try {
  for await (const _chunk of graph.astream(initialState, config)) { /* drain */ }
} catch (err) {
  if ((err as Error).name === 'AbortError') {
    // D-14: log disconnect as Langfuse trace attribute
    console.info('[ai] client disconnected — graph execution aborted')
    // callbackHandler will include this in the trace span attributes
    await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: 'stream_aborted' }) })
    return
  }
  throw err
}
```

### Pattern 3: Per-Request Langfuse CallbackHandler

**What:** A new `CallbackHandler` is instantiated per request (never module-level). It is passed in `config.callbacks` to `graph.astream()`. After the stream completes, `getLangfuseTracerProvider().forceFlush()` ensures traces flush before the Vercel function exits (OBS-02).

**When to use:** Every real (non-early-exit) route invocation.

```typescript
// Source: graph.integration.test.ts (established pattern, Phase 6)
import { CallbackHandler } from '@langfuse/langchain'
import { getLangfuseTracerProvider } from '@langfuse/tracing'

// Inside streamSSE callback, ONLY when LANGFUSE_TRACE_LEVEL is enabled:
const callbackHandler = new CallbackHandler({ 
  tags: [`session:${sessionId}`, `branch:${activeBranchId ?? 'main'}`] 
})

const config = {
  configurable: { /* ... */ },
  callbacks: [callbackHandler],
  signal: c.req.raw.signal,
}

// After Promise.all completes:
await getLangfuseTracerProvider().forceFlush().catch((err) => {
  console.warn('[ai] Langfuse forceFlush error (non-fatal):', (err as Error).message)
})
```

### Pattern 4: LANGFUSE_TRACE_LEVEL env var

**What:** Added to `env.ts` as a Zod union type. Controls whether the route wraps the entire handler in a Langfuse parent span or uses only the graph-level CallbackHandler.

```typescript
// In apps/api/src/lib/env.ts — add to EnvSchema:
LANGFUSE_TRACE_LEVEL: z
  .enum(['graph', 'full'])
  .default('graph'),
```

**`'graph'` (default):** Per-request `CallbackHandler` on `graph.astream()` only. DB query latency and route overhead are not traced.

**`'full'`:** Wrap the entire route handler body in a Langfuse parent span (via `getLangfuseTracerProvider().startActiveObservation(...)` or equivalent OTel span), making DB fetch latency visible alongside graph spans. Implementation is at Claude's discretion.

### Pattern 5: Initial State Construction

**What:** The route builds the initial `GraphState` from route context and passes it to `graph.astream()`.

```typescript
// Initial state for graph.astream()
const initialState = {
  blueprintId: session.blueprint_id,
  currentPhaseId: session.current_phase ?? blueprint.phase_sequence[0].id,
  messages: promptMessages,  // output of assemblePromptArray()
  canvasOps: [],
}
```

Note: `assemblePromptArray()` continues to be called in the route (history compression stays outside the graph per Phase 6 D-09). The output is placed directly into `initialState.messages`.

### Anti-Patterns to Avoid

- **Iterating `graph.astream()` for text tokens:** `graph.astream()` yields state snapshots, not text events. Text comes via `streamWriter` in `config.configurable`. Do not try to extract text from state snapshot diffs.
- **Module-level Langfuse CallbackHandler:** Banned by REQUIREMENTS.md. Creates trace context corruption across concurrent requests. Always instantiate per-request inside the SSE callback.
- **Calling `getCheckpointer()` inside the route handler on every request:** `getCheckpointer()` is a lazy singleton (returns the same Promise on repeat calls). It's safe to call per-request — the first call initializes, subsequent calls return the cached instance. However, the pattern used in the integration test (single `beforeAll`) is preferred at startup if architecturally possible. In the Vercel serverless environment, `getCheckpointer()` is the right pattern because cold starts are unavoidable.
- **Opening the SSE stream before loadBlueprint():** Blueprint loading can throw (Blueprint not found, Ajv validation failure). It must complete before `return streamSSE(...)` so that failures can return proper JSON error responses (not SSE errors).
- **Setting `canvas_snapshot_state` to canvasOps in Phase 7:** Phase 7 sets `canvas_snapshot_state = null` for Blueprint sessions. The v1 `lastPanelUpdate` field is removed from the route — `renderPanelTool` is no longer in the tool list. Canvas DB writes are Phase 8.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Async text queue | Custom EventEmitter subclass | Plain JS array + Promise notify | EventEmitter adds no value here; the pattern is 5 lines of vanilla JS |
| Blueprint loading | Inline Supabase query in route | `loadBlueprint()` from `blueprint-loader.ts` | Includes Ajv double-validation, error formatting, type-safe parse |
| PostgresSaver initialization | Direct `new PostgresSaver(...)` | `getCheckpointer()` from `langgraph-checkpointer.ts` | Lazy singleton, concurrent cold-start safe, schema='langgraph' baked in |
| Abort detection | `stream.onAbort()` or custom timeout | `c.req.raw.signal` passed to `config.signal` | LangGraph natively handles AbortSignal propagation to in-flight nodes |
| Langfuse trace flush | Custom flush logic | `getLangfuseTracerProvider().forceFlush()` | Established in Phase 6; matches OBS-02 requirement exactly |
| History compression | In-graph compression node | `compressHistory()` called before `graph.astream()` | Keeps checkpoint payloads lean; Phase 6 D-09 locks this decision |

**Key insight:** Nearly all infrastructure for Phase 7 was built in Phase 6. Phase 7's role is wiring, not construction.

---

## Common Pitfalls

### Pitfall 1: Opening SSE Before Blueprint Load Completes
**What goes wrong:** `loadBlueprint()` throws after `streamSSE` is entered. The response has already started streaming, so `c.json({ error: 'blueprint_not_found' }, 500)` cannot be returned. The client receives an incomplete SSE stream with no `done` event.
**Why it happens:** Developer moves `loadBlueprint()` inside the SSE callback for perceived latency improvement.
**How to avoid:** `loadBlueprint()` must complete before `return streamSSE(c, ...)`. On throw, return `c.json({ error: 'blueprint_load_failed' }, 500)`.
**Warning signs:** Blueprint-related errors appearing in the SSE `error` event instead of HTTP response codes.

### Pitfall 2: graph.astream() vs graph.invoke() for Streaming
**What goes wrong:** Using `graph.invoke()` instead of `graph.astream()`. `graph.invoke()` awaits full completion before returning — text tokens accumulated in `streamWriter` are not flushed to the client until the entire graph run is done. Perceived as a non-streaming response.
**Why it happens:** `graph.invoke()` was used in all Phase 6 tests (it's simpler for testing). The streaming requirement only manifests in the route.
**How to avoid:** Always use `graph.astream()` in the route. The state snapshot chunks it yields can be ignored; the text flows via `streamWriter` throughout.
**Warning signs:** Client receives all text tokens at once after several seconds, rather than token-by-token.

### Pitfall 3: streamWriter Called After SSE Stream Closes
**What goes wrong:** A graph node calls `streamWriter` after `drainQueue` has returned (e.g., due to abort or early exit). The write to a closed `stream` may throw `stream already closed`.
**Why it happens:** Race condition between graph abort and the last `streamWriter` call in a node.
**How to avoid:** Check `graphDone` in `streamWriter` and no-op if already done. Or wrap `stream.writeSSE` in a try/catch that swallows `stream already closed` errors.

### Pitfall 4: renderPanelTool Removal
**What goes wrong:** Phase 7 removes `renderPanelTool` from the AI call (it was v1 only — the graph no longer uses `render_panel` tool, it uses `canvas_mutation` inside AgentNode). If the import is left in `ai.ts`, `panel_update` SSE events will never be emitted (canvas writes are Phase 8 anyway), but the import itself is now dead code that confuses future readers.
**Why it happens:** Mechanical removal of steps 8-9 without cleaning up the v1 tool list.
**How to avoid:** Remove `renderPanelTool` from the import and any remaining SSE panel_update logic from the route. Phase 8 will re-introduce panel/canvas SSE events from a different path.

### Pitfall 5: thread_id for PostgresSaver
**What goes wrong:** Using `sessionId` as `thread_id` instead of `activeBranchId ?? sessionId`. LangGraph state accumulates per thread. If two branches of the same session share a `thread_id`, their states contaminate each other.
**Why it happens:** `thread_id` is "session-level" thinking rather than "branch-level".
**How to avoid:** `thread_id = activeBranchId ?? sessionId`. This matches ORCH-05 (`thread_id = branch_id`). The `?? sessionId` fallback handles the case where no branch is active (main thread).

### Pitfall 6: Abort Logging to Langfuse
**What goes wrong:** The abort is caught but not logged in Langfuse. The success criterion (SC-4) requires "client disconnect MUST be logged in Langfuse as a trace attribute or event on the graph execution span."
**Why it happens:** Developer catches `AbortError` and returns early without adding a Langfuse span attribute or event.
**How to avoid:** When `AbortError` is caught, add a custom event to the `callbackHandler` before the stream closes, or use `getLangfuseSpanProcessor()` to record the disconnect. The simplest approach: `callbackHandler.handleCustomEvent('client_disconnected', { sessionId, branchId: activeBranchId })` before returning.

### Pitfall 7: Fallback Text for Empty Response
**What goes wrong:** The v1 route has a fallback for empty `accumulatedText` when a panel update was rendered: `accumulatedText = "He actualizado el panel con el gráfico correspondiente."`. In Phase 7, panel updates no longer exist in the route — the canvas mutation is inside the graph. The `accumulatedText` fallback must be reconsidered. For Blueprint sessions, if AgentNode produces NO text (D-09 silence preference) AND produces a canvas mutation, `accumulatedText` will be empty. The `messages_content_check` Postgres constraint (content length >= 1) will block the INSERT.
**Why it happens:** The v1 fallback text assumed a `lastPanelUpdate` context that no longer exists.
**How to avoid:** For Phase 7, if `accumulatedText.trim()` is empty after graph completion: check `finalState.canvasOps.length > 0`. If ops exist, use a minimal fallback like `"[canvas updated]"` (internal, not user-visible — the canvas is the real output). If no ops and no text, skip the INSERT entirely. The `messages_content_check` constraint blocks empty inserts.

### Pitfall 8: DOMAIN_BRIDGE steering text vs canvas mutation text
**What goes wrong:** D-11 specifies that on DOMAIN_BRIDGE, the probability roll controls whether `streamWriter` is called with steering text. But the AgentNode currently only produces text via `streamWriter` — it has no separate "steering text path." The confusion is: the steering text for DOMAIN_BRIDGE is different from the D-09 substantive insight text.
**Why it happens:** D-11 is described at the route level but needs to be implemented at the OrchestratorNode level (the probability roll is done by OrchestratorNode, which then needs to pass a flag to AgentNode).
**How to avoid:** OrchestratorNode adds a field (e.g., `steeringTextEnabled: boolean`) to its state output. AgentNode reads this field from state and, when true, generates a brief steering text in addition to (or instead of) its substantive insight text. This requires a minimal state schema extension.

---

## Code Examples

### streamWriter seam in AgentNode (D-05)
```typescript
// Source: CONTEXT.md D-05 — one-line change to agent.ts
// Inside the adapter.stream() loop in agentNode:
if (event.type === 'text_delta') {
  // Phase 7 streamWriter seam — routes tokens to SSE via route's async queue
  config?.configurable?.streamWriter?.(event.text)
  // Note: text is NOT accumulated here — accumulation happens in the route
}
```

### streamWriter seam in DriftReplyNode (D-05)
```typescript
// Source: CONTEXT.md D-05 — one-line change to drift-reply.ts
// The current loop body is a comment ("Phase 6: events are collected but not streamed")
// Replace with:
if (event.type === 'text_delta') {
  config?.configurable?.streamWriter?.(event.text)
}
```

### Extended buildAgentSystemPrompt signature (D-10)
```typescript
// Source: CONTEXT.md D-10 + D-08 + D-09
export function buildAgentSystemPrompt(
  blueprint: Blueprint,
  currentPhaseId: string,
  activePersonaInstructions?: string,  // NEW in Phase 7
): string {
  // ... existing blueprint + phase section ...
  const rules = [
    '- Call canvas_mutation with op=ADD_NODE ...',
    // ... existing rules ...
    // D-08: ban canvas meta-commentary
    '- NEVER describe your canvas operations in text. Do not say "I added a node", "I mapped this to",',
    '  "I connected", "I\'ve recorded", or describe what you did to the canvas.',
    // D-09: prefer silence
    '- Produce text output ONLY when the information cannot be fully represented in the canvas mutation.',
    '  If the canvas mutation fully captures the insight, produce NO text. Prefer silence.',
    '  When you do produce text, limit it to 1-2 sentences of substantive insight.',
  ]
  // Append persona instructions after Blueprint phase instructions (D-10)
  if (activePersonaInstructions) {
    return base + '\n\n' + rules.join('\n') + '\n\nPersona style:\n' + activePersonaInstructions
  }
  return base + '\n\n' + rules.join('\n')
}
```

### LANGFUSE_TRACE_LEVEL in env.ts
```typescript
// Source: CONTEXT.md D-15
// Add to EnvSchema in apps/api/src/lib/env.ts:
LANGFUSE_TRACE_LEVEL: z
  .enum(['graph', 'full'])
  .default('graph'),
```

### .env.example addition
```
# Langfuse trace detail level: 'graph' traces LangGraph execution only;
# 'full' also traces DB queries and route overhead (debugging tool).
LANGFUSE_TRACE_LEVEL=graph
```

### finalState extraction from graph.astream()
```typescript
// Source: [ASSUMED] — LangGraph JS astream() API pattern
// graph.astream() yields partial state snapshots after each node.
// The final state is available by collecting the last yielded value,
// OR by calling graph.getState() after the loop completes.

let finalState: GraphState | undefined

for await (const chunk of graph.astream(initialState, config)) {
  // chunk is a partial state snapshot { [nodeName]: partialState }
  // We don't need to process chunks here — text flows via streamWriter
  // but we can capture the final state for canvas ops
  Object.assign(finalState ?? {}, chunk)
}

// After the loop: finalState.canvasOps contains all committed + ghost ops
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct `adapter.stream()` in route | `graph.astream()` via createGraph() + PostgresSaver | Phase 7 | Full NSAI pipeline runs per message; checkpointed state across requests |
| `renderPanelTool` in tool list | `canvasMutationTool` inside AgentNode | Phase 7 | Canvas mutations are structured + confidence-gated; panel updates deferred to Phase 8 |
| `BASE_SYSTEM_PROMPT` hardcoded in route | `buildAgentSystemPrompt(blueprint, phaseId, personaInstructions)` | Phase 7 | Dynamic, Blueprint-aware, phase-aware system prompt |
| No abort signal | `c.req.raw.signal` → `config.signal` | Phase 7 | Clean LangGraph termination on disconnect; no orphaned async work |
| No blueprint gate | `no_blueprint` 400 before any AI call | Phase 7 | V1 sessions cannot reach the graph; Blueprint required |

**Deprecated/outdated in Phase 7:**
- `BASE_SYSTEM_PROMPT` constant in `ai.ts`: removed, replaced by `buildAgentSystemPrompt()` output
- `renderPanelTool` usage in the route: removed (still exists in `@panelito/types` for Phase 9 potential re-use, but not used in the route)
- `lastPanelUpdate` accumulator: removed — canvas state is now in `finalState.canvasOps`
- `canvas_snapshot_state = lastPanelUpdate` in message INSERT: replaced by `canvas_snapshot_state = null` (Phase 8 handles real canvas writes)
- `PanelWidgetSchema.safeParse` gate in the route: removed (the gate lives inside MutationGateNode via CanvasOpSchema now)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `graph.astream()` accepts `config.signal` as a standard `AbortSignal` in @langchain/langgraph 1.4.7 | Abort Signal Wiring | If signal is not propagated, graph.astream() runs to completion after disconnect; orphaned work. Need to verify against LangGraph 1.4.7 docs or source. | [ASSUMED] |
| A2 | `callbackHandler.handleCustomEvent()` is available on `@langfuse/langchain` CallbackHandler v5.9.1 for recording abort events | Pitfall 6 | If not available, need alternate approach to log disconnect in Langfuse trace. | [ASSUMED] |
| A3 | The final accumulated state from `graph.astream()` correctly reflects all canvasOps from the full graph run (including MutationGateNode output) | Code Examples — finalState extraction | If canvasOps are empty in the final astream chunk, the route cannot determine what mutations happened. May need `graph.getState()` after the loop instead. | [ASSUMED] |
| A4 | `c.req.raw.signal` is populated for Hono SSE routes in @hono/node-server 2.0.4 | Abort Pattern | If raw.signal is undefined/null, abort wiring silently fails. Need to verify in Hono Node adapter. | [ASSUMED] |

---

## Open Questions

1. **graph.astream() final state capture**
   - What we know: `graph.astream()` yields state snapshots after each node. The last snapshot contains the terminal state.
   - What's unclear: Whether the final chunk is a complete state or only the delta from the last node. If it's a delta, `canvasOps` from earlier nodes may not be present.
   - Recommendation: Verify with `graph.getState({ configurable: { thread_id } })` after the loop if the final chunk approach is unreliable. The PostgresSaver checkpoint always has the complete final state.

2. **OrchestratorNode state field for DOMAIN_BRIDGE steering text (D-11)**
   - What we know: D-11 requires a probability roll in OrchestratorNode to decide if steering text should accompany the canvas mutation.
   - What's unclear: Whether to add a new `steeringTextEnabled: boolean` field to GraphState or to pass this as a configurable flag. Adding to state requires a state schema change.
   - Recommendation: Add `steeringTextEnabled: Annotation<boolean | null>` to `GraphStateAnnotation` in `state.ts`. OrchestratorNode sets it during DOMAIN_BRIDGE routing. AgentNode reads it to decide if steering text is appropriate.

3. **Abort event logging in Langfuse**
   - What we know: D-14 requires logging the disconnect as a trace attribute or event.
   - What's unclear: The exact Langfuse v5 / @langfuse/langchain 5.9.1 API for adding custom events to an existing span.
   - Recommendation: Claude's Discretion to pick the mechanism. Simplest: `console.info('[ai] client_disconnected', { sessionId })` — the CallbackHandler will capture this in the trace context if OTel is wired. Alternatively, the Langfuse parent span approach (LANGFUSE_TRACE_LEVEL='full') makes this straightforward.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| @langchain/langgraph | graph.astream() | ✓ | 1.4.7 | — |
| @langchain/langgraph-checkpoint-postgres | PostgresSaver | ✓ | 1.0.4 | MemorySaver for local dev without DB |
| @langfuse/langchain | CallbackHandler | ✓ | 5.9.1 | LANGFUSE tracing disabled warning (setupLangfuseOtel handles) |
| SUPABASE_DIRECT_URL | PostgresSaver | ✓ (in env) | — | MemorySaver fallback only for tests |
| LANGFUSE_PUBLIC_KEY | Langfuse tracing | Configured (runtime) | — | setupLangfuseOtel() warns and disables |
| LANGFUSE_TRACE_LEVEL | Env control | ✗ (NEW — not in .env.example yet) | — | Zod default('graph') handles missing var |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- `LANGFUSE_TRACE_LEVEL` not in `.env.example` yet — plan must add it.

---

## Validation Architecture

> `nyquist_validation` is set to `false` in `.planning/config.json` — this section is included only for reference.

The Phase 6 graph tests (`graph.test.ts`, `graph.integration.test.ts`) provide the foundation. Phase 7 adds one new test target: the route integration.

**Quick run command:** `cd /home/jgm/dev/projects/web-projects/panelito/apps/api && pnpm test`
**Full suite command:** same (Vitest runs all tests)

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Notes |
|--------|----------|-----------|-------|
| ORCH-01 (SC-1) | v1 session (no Blueprint) returns 400 no_blueprint | Unit (route mock) | New test needed in `routes/ai.test.ts` or new `routes/ai.phase7.test.ts` |
| ORCH-01 (SC-2) | Blueprint session runs full graph; SSE delivers text events without hanging | Integration | Requires MemorySaver + mock adapters + streamWriter injection |
| ORCH-01 (SC-3) | Abort wiring: client disconnect terminates graph; no orphaned work | Integration | Requires programmatic AbortController in test + signal check |
| ORCH-01 (SC-4) | Langfuse trace visible for real /invoke call | Manual verify | human-verify checkpoint; cannot automate dashboard assertion |

**Wave 0 Gaps:**
- `apps/api/src/routes/ai.test.ts` does not exist (no route test exists for `ai.ts` in Phase 6). A new test file covering the Phase 7 route behavior is required. Specifically:
  - Test: `no_blueprint` 400 gate
  - Test: SSE stream delivers `text_delta` + `done` events via mock graph
  - Test: Abort signal propagation (at minimum, verifies the signal is passed to config)

---

## Security Domain

Phase 7 does not introduce new authentication or cryptographic concerns. Existing security controls carry forward:

| ASVS Category | Applies | Control |
|---------------|---------|---------|
| V2 Authentication | Yes (unchanged) | `requireAuth` middleware on route |
| V4 Access Control | Yes (unchanged) | `session.creator_id === user.id` ownership gate |
| V5 Input Validation | Yes | `LANGFUSE_TRACE_LEVEL` union type in Zod env schema; Blueprint validated by `loadBlueprint()` |
| V6 Cryptography | No new | `decryptKey()` unchanged |

**New security note:** `LANGFUSE_TRACE_LEVEL='full'` causes the route to create an outer Langfuse span that may capture DB query timing metadata. No user data is included in span attributes by default. Ensure `plaintextKey` and `SUPABASE_DIRECT_URL` are never included in span attributes (follow existing T-06-04 / T-06-05 patterns).

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 7 |
|-----------|-------------------|
| **Supabase-first** | PostgresSaver uses `SUPABASE_DIRECT_URL`; `loadBlueprint()` queries Supabase — no new DB dependencies |
| **Hono for backend** | `streamSSE` from `hono/streaming` is the SSE mechanism; no migration to another framework |
| **Anthropic TypeScript SDK** | All AI calls go through `createAdapter()` factory → `AIProvider` interface; no direct SDK imports in graph nodes |
| **No Socket.io** | SSE via `hono/streaming` continues to be the only real-time mechanism in the route |
| **No tRPC** | Existing typed Hono endpoints pattern preserved |
| **No Prisma** | Supabase client only for all DB access (`createServiceClient()`) |

---

## Sources

### Primary (HIGH confidence)
- Codebase inspection — `apps/api/src/routes/ai.ts` (current route being modified)
- Codebase inspection — `apps/api/src/graph/graph.ts`, `state.ts`, `nodes/*.ts` (Phase 6 deliverables)
- Codebase inspection — `apps/api/src/graph/graph.test.ts`, `graph.integration.test.ts` (established test patterns)
- Codebase inspection — `apps/api/src/lib/langgraph-checkpointer.ts`, `langfuse-otel.ts`, `blueprint-loader.ts`, `env.ts`, `cap-guard.ts`
- CONTEXT.md D-01 through D-16 (locked user decisions)
- `apps/api/package.json` (dependency versions)

### Secondary (MEDIUM confidence)
- CONTEXT.md canonical_refs section (code_context, established patterns)
- Phase 6 CONTEXT.md (all D-01 through D-12 decisions that carry forward)

### Tertiary (LOW confidence / ASSUMED)
- A1-A4 in Assumptions Log — patterns inferred from LangGraph 1.4.x training knowledge, not verified against live docs in this session

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages from package.json, verified installed
- Architecture: HIGH — all patterns derived from CONTEXT.md locked decisions and existing codebase
- Pitfalls: HIGH — derived from direct code inspection + CONTEXT.md specifics
- Abort signal propagation (A1, A4): LOW — needs verification against LangGraph 1.4.7 source

**Research date:** 2026-07-03
**Valid until:** 2026-08-03 (stable dependencies; LangGraph 1.4.x API unlikely to change)
