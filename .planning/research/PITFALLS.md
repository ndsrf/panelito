# Pitfalls Research: Project Multiverse

**Domain:** Real-time collaborative AI workspace with conversation branching
**Research date:** 2026-06-08 (v1) / 2026-07-01 (v2.0 NSAI addendum)

---

## Critical Pitfalls

### P1 — Mobile Layout Collapse on Keyboard Open
**Warning signs:** Panel shrinks when keyboard opens; layout breaks on iOS Safari  
**What happens:** Using `100vh` or `height: 100%` on the outer container causes the entire layout to recompress when the iOS/Android virtual keyboard appears. The analytics panel gets crushed.  
**Prevention:**
- Lock `--app-height` from `window.innerHeight` on mount (before keyboard ever appears)
- Bind `window.visualViewport.onresize` to update `--keyboard-height`
- Set `position: fixed; inset: 0` on app shell
- Never use `100dvh` as a replacement — it changes dynamically and causes repaints  
**Phase:** Phase 1 (layout foundation)

---

### P2 — Branch Context Bleeding in AI Calls
**Warning signs:** AI in Branch B references content from Branch A; merged synthesis includes wrong context  
**What happens:** If you naively pass all session messages to Claude, it sees content from sibling branches. The "multiverse" collapses into one timeline.  
**Prevention:**
- Always traverse the path tree client-side before building the AI context window
- Pass only messages where `path_id` is a prefix of or equal to the active branch path
- Never pass raw `session_id`-scoped messages to AI
- Enforce this in the backend streaming endpoint — client should NOT control what context gets sent  
**Phase:** Phase 2 (branching engine)

---

### P3 — Canvas Snapshot State Explosion
**Warning signs:** DB row sizes growing to MB; queries slowing down; Supabase row limit warnings  
**What happens:** Storing full widget state JSON in every message row bloats the database fast when sessions have hundreds of messages.  
**Prevention:**
- Store only a delta/diff snapshot, not full state, when the canvas doesn't change between messages
- Use a `NULL` snapshot to mean "same as previous message in this branch"
- Rebuild full state by forward-traversal only when needed  
**Phase:** Phase 2 (time-travel UI)

---

### P4 — Supabase Realtime Fan-out Latency Under Load
**Warning signs:** Message delivery feels laggy with 10+ concurrent users; some users miss messages  
**What happens:** Supabase Realtime uses Postgres logical replication. Under write-heavy workloads with many concurrent sessions, replication lag can cause perceived latency.  
**Prevention:**
- Use `broadcast` channel type (not `postgres_changes`) for chat messages — bypasses replication lag
- Use `postgres_changes` only for session metadata updates (status, branch list)
- Keep chat messages lightweight in the real-time payload; full content fetched from DB on demand  
**Phase:** Phase 1 (real-time foundation)

---

### P5 — Claude Tool Use Schema Validation Mismatches
**Warning signs:** Panel randomly goes blank; React hydration errors; JSON parse errors in logs  
**What happens:** Claude occasionally emits tool calls that don't match your expected schema. If you pass this directly to React state, the component crashes.  
**Prevention:**
- Validate every `ui_mutation_block` against Zod schema before touching React state
- On validation failure: log to console, preserve last known panel state, continue streaming text
- Test with intentionally malformed Claude responses in unit tests
- Use TypeScript discriminated unions for widget types so TypeScript catches mismatches at build time  
**Phase:** Phase 1 (AI integration)

---

### P6 — Intersection Observer Scroll-Spy Firing on Initial Load
**Warning signs:** Panel flickers to wrong state on page load; initial panel state is wrong  
**What happens:** When the chat component mounts, IntersectionObserver fires for every visible message simultaneously before the user has scrolled anywhere.  
**Prevention:**
- Initialize the panel from the latest message's snapshot, not from Intersection Observer
- Only activate the scroll-spy observer after the initial scroll position is set to bottom
- Add a 100ms debounce on observer callbacks during initial mount  
**Phase:** Phase 3 (time-travel UI)

---

### P7 — "Fork All the Things" UX Problem
**Warning signs:** Sessions end up with 15+ branches; users can't find their branch; panel feels chaotic  
**What happens:** Unlimited branching without visual hierarchy becomes overwhelming. The "multiverse" becomes incomprehensible.  
**Prevention:**
- Limit active open branches to a configurable max (default: 5 per session)
- Color coding is essential — pre-define a distinct palette of 5-6 branch colors
- The branch navigator must show a visual tree, not just a flat list
- Consider "archive" functionality for dormant branches rather than hard deletion  
**Phase:** Phase 2 (branching UX)

---

### P8 — Session Creator API Key Leaking to Guests
**Warning signs:** Network tab shows API key in request headers; guests can intercept key  
**What happens:** If the Claude API call is made client-side or the key is passed through to the browser, any guest can steal the creator's API key.  
**Prevention:**
- ALL Claude API calls must be made server-side (Hono backend only)
- Creator stores API key in Supabase user metadata (encrypted at rest)
- Backend fetches key from Supabase on behalf of the creator; never sends key to frontend
- Never log full API keys — log only first 6 characters for debugging  
**Phase:** Phase 1 (auth + AI integration)

---

---

## v2.0 NSAI Integration Pitfalls

These pitfalls are specific to adding LangGraph JS, Langfuse, Ajv, and the graph canvas to the existing Hono/Vercel/Supabase stack. Each has been verified against official documentation, GitHub issues, and production reports.

---

### P9 — LangGraph `graph.stream()` Does Not Compose Transparently with Hono `streamSSE`

**Warning signs:** SSE connection opens but browser receives no events; token streaming appears to work in local Node.js but silently fails behind Vercel's edge proxy; the `streamSSE` callback returns before the graph finishes; client sees a single `data:` flush at end instead of incremental tokens.

**What happens:** `graph.stream()` returns a synchronous iterable (`for await...of` compatible) — not a ReadableStream or an async generator in all modes. Hono's `streamSSE()` expects you to drive it imperatively inside its callback. If you try to wrap the LangGraph iterator and pipe it into Hono's stream without an explicit `for await` loop, the runtime may either buffer the entire response before flushing (losing SSE semantics) or close the write handle prematurely.

A separate issue: when the LangGraph graph throws mid-stream (LLM call failure, Zod parse error, node exception), the error propagates into the Hono `streamSSE` callback but Hono does not automatically close the SSE connection with an error event — the client hangs with an open connection until the Vercel function timeout.

A third issue: `graph.astream()` (the async variant required inside an async Hono handler) must be used; `graph.stream()` blocks the event loop inside an async context and will cause issues under concurrent load.

**Prevention:**
```typescript
// Correct pattern in Hono SSE handler
app.get('/stream/:branchId', streamSSE(async (stream) => {
  const abortController = new AbortController();
  stream.onAbort(() => abortController.abort());

  try {
    const graphStream = await graph.astream(input, {
      configurable: { thread_id: branchId },
      signal: abortController.signal,
    });
    for await (const chunk of graphStream) {
      if (stream.aborted) break;
      await stream.writeSSE({ data: JSON.stringify(chunk), event: chunk.type });
    }
  } catch (err) {
    await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: err.message }) });
  } finally {
    await stream.close();
  }
}));
```
- Always use `graph.astream()`, never `graph.stream()` inside an async Hono route
- Always wire `stream.onAbort()` → `abortController.abort()` to cancel the LangGraph run when the client disconnects
- Emit a typed `error` SSE event on exceptions and then explicitly close the stream; do not let the Hono callback exit silently
- Set `export const maxDuration = 300` (or higher on Pro) in `vercel.json` for the streaming route — the default Hobby limit of 300s is often fine, but without explicit config the function may default to a lower project-level setting

**Phase:** v2.0 Phase 1 (LangGraph integration foundation — must get this right before building any agent nodes)

**Confidence:** HIGH — verified against Hono streaming docs, LangGraph JS streaming docs, and Vercel function duration docs.

---

### P10 — Langfuse Drops Traces in Serverless: Missing `waitUntil` / `flushAsync`

**Warning signs:** Traces appear inconsistently in Langfuse dashboard; some graph runs are invisible; traces stop appearing under load; traces appear after a delay of minutes then cluster; cost/latency data is absent for runs that completed successfully.

**What happens:** Langfuse sends trace data via a background HTTP queue. In Vercel serverless functions, the Node.js process exits as soon as the handler returns a response. The background queue is killed mid-flight. Any traces not yet flushed to Langfuse's API are lost — silently, with no error in your logs.

This is reproducible on Vercel with the standard `langfuse.flushAsync()` at end-of-handler pattern too, because `flushAsync` is not awaited before Vercel freezes the instance. The correct Vercel pattern uses `waitUntil`.

**Prevention:**
```typescript
import { after } from 'next/server'; // Next.js 15 App Router
// OR for Hono on Vercel:
import { waitUntil } from '@vercel/functions';

// At end of handler, after streaming response is returned:
waitUntil(langfuse.flushAsync());
```
- Initialize the Langfuse client **outside** the handler (module level) so it persists across warm invocations and doesn't reset the queue on every request
- Call `waitUntil(langfuse.flushAsync())` not `await langfuse.flushAsync()` — the former lets Vercel keep the instance alive for the flush without blocking the response
- Set `flushAt: 1` during development so you get immediate trace visibility; revert to default (15) in production for batching efficiency
- For the Hono adapter on Vercel, import `waitUntil` from `@vercel/functions` (available as of 2025); it works at the function handler level regardless of framework

**Phase:** v2.0 Phase 1 (set up before writing any LangGraph nodes — you need observability from day one)

**Confidence:** HIGH — verified against Langfuse's official serverless FAQ and Vercel functions documentation.

---

### P11 — Ajv Runtime Compilation Fails in Vercel Edge Runtime (`eval` / `new Function` Blocked)

**Warning signs:** `EvalError: Code generation from strings disallowed` in Vercel function logs; schema validation works locally but throws in deployment; Blueprint validation crashes the entire request handler when a Domain Blueprint is first loaded.

**What happens:** Ajv's default schema compilation path uses `new Function()` to generate optimized validators at runtime. Vercel's Edge Runtime (and any route using `export const runtime = 'edge'`) blocks dynamic code generation by policy. This is a hard constraint of the V8 isolate sandbox.

However, this stack uses Hono on Vercel's **Node.js runtime** (not Edge). The trap is that if any Next.js middleware or API route inadvertently inherits edge runtime (e.g., by being co-located with a `middleware.ts` that sets `runtime: 'edge'`), Ajv will fail there too.

A second trap: Domain Blueprints are stored in Supabase and loaded at runtime — they are **not** known at build time. This makes Ajv's standalone AOT compilation (which pre-compiles schemas at build time into static JS files) unusable for Blueprint validation. You need runtime `ajv.compile()`, which requires Node.js runtime.

**Prevention:**
- Confirm all Blueprint validation routes use Node.js runtime, never edge. Add to `vercel.json`:
  ```json
  { "functions": { "api/graph/**": { "runtime": "nodejs22.x" } } }
  ```
- Do NOT use Ajv in `middleware.ts` — middleware runs on edge by default
- Keep a module-level `ajv` instance and a compiled-validator cache (`Map<blueprintId, ValidateFunction>`) so `ajv.compile()` is called once per Blueprint, not once per request
- For static schemas (CanvasNode, CanvasEdge shapes), use Ajv standalone AOT at build time and import the generated validators — these are known at build time and benefit from the optimization
- Zod is a viable alternative for static schemas (it has no `eval` dependency at all); reserve Ajv for the dynamic Blueprint schemas where its JSON Schema compatibility is needed

**Phase:** v2.0 Phase 1 (Blueprint loading infrastructure — validate your runtime before wiring up any domain logic)

**Confidence:** HIGH — Vercel GitHub discussion #47063 explicitly confirms Ajv is blocked in Edge Runtime; Ajv standalone docs confirm dynamic schemas cannot be AOT-compiled.

---

### P12 — LangGraph Postgres Checkpointer + Supabase Pooler: Prepared Statement Conflicts and Connection Exhaustion

**Warning signs:** `prepared statement "s0" already exists` errors in Supabase logs; `too many connections` errors under concurrent graph runs; graph execution hangs at checkpoint write after 10+ concurrent sessions; Supabase dashboard shows connection count pegged near the pool limit.

**What happens:** `@langchain/langgraph-checkpoint-postgres` uses the `postgres` npm package under the hood. By default, `postgres` uses prepared statements (`prepare_threshold: 5`). Supabase's Supavisor pooler (used in transaction mode, port 6543) does not support prepared statements across connection multiplexing — the prepared statement is tied to a specific backend Postgres connection, not to the pooler session. When Supavisor routes the next query to a different backend connection, it sees an unknown prepared statement and throws.

Separately, LangGraph checkpoints involve transactions that can span multiple round-trips (read checkpoint → execute node → write checkpoint). In transaction pooling mode, a connection is held only for the duration of a single statement, not a transaction. LangGraph's transactional checkpoint writes will fail or produce partial writes under transaction-mode pooling.

**Prevention:**
- Connect `@langchain/langgraph-checkpoint-postgres` using the **session-mode pooler** (Supabase port 5432 with `?pgbouncer=true`) or Supabase's direct connection (port 5432 without pooler, but this consumes a dedicated connection slot)
- OR connect via the **transaction-mode pooler** (port 6543) but explicitly disable prepared statements:
  ```typescript
  import postgres from 'postgres';
  const sql = postgres(process.env.SUPABASE_DB_URL!, {
    prepare: false,          // disable prepared statements for pooler compatibility
    max: 5,                  // keep pool small — Vercel has multiple function instances
  });
  ```
- Set `autocommit: true` on the connection to prevent open transactions during LLM calls (LLM latency can hold a Postgres lock for seconds)
- On Vercel (serverless), each function instance opens its own pool. With 5 concurrent function instances × 5 connections = 25 connections. Supabase free tier allows ~20 direct connections. Use the transaction pooler port (6543) with `prepare: false` for serverless, session mode port (5432) only for long-lived server processes
- Run the LangGraph checkpoint migration SQL manually via Supabase Dashboard (not via `supabase db push`) for the first setup — the migration is idempotent and tracks versions via `checkpoint_migrations` table; re-running it is safe
- Set a custom `schema` in the checkpointer config to avoid namespace collisions with Supabase's Realtime schema or your own tables:
  ```typescript
  PostgresSaver.fromConnString(url, { schema: 'langgraph' })
  ```

**Phase:** v2.0 Phase 1 (database foundation — verify connection configuration with a single-node graph before wiring multi-agent topology)

**Confidence:** HIGH — verified against Supabase pooler documentation, LangGraph postgres checkpointer npm package notes, and community reports of `prepared statement already exists` errors.

---

### P13 — Concurrent Users Triggering LangGraph on the Same Branch: Thread Contamination and Double Execution

**Warning signs:** One user's message content appears in another user's canvas update; two canvas mutations arrive for the same message; graph executes twice for a single user message; `AsyncLocalStorageProviderSingleton` appears in stack traces.

**What happens:** Two issues can occur simultaneously:

**Issue A — AsyncLocalStorage cross-thread contamination:** LangGraph JS uses a module-level `AsyncLocalStorageProviderSingleton`. When two concurrent `graph.astream()` calls run in the same Node.js process (same warm Vercel function instance with Fluid Compute), async context from one invocation can leak into another if LangGraph's version is affected by the issue documented in langchain-ai/langgraphjs#2040 (fixed in a later version, but the fix may regress). Result: Customer A's graph state appears in Customer B's LangGraph run, even with different `thread_id` values.

**Issue B — Concurrent writes to the same thread_id:** In Panelito, `thread_id = branch_id`. If two users are on the same branch and both trigger a graph run simultaneously (e.g., both react to the same message), LangGraph has no built-in mutex for concurrent writes to the same thread. The second run will read the checkpoint written by the first run's start state, not its end state, producing a diverged checkpoint tree.

**Prevention:**
- **For Issue A:** Pin `@langchain/langgraph` to a version ≥ the fix for #2040. Verify by running two concurrent `graph.invoke()` calls in a unit test with different `thread_id` values and asserting state isolation. If contamination is detected, instantiate the graph compiler inside a per-request factory instead of at module level (adds ~5ms overhead, acceptable).
- **For Issue B:** Implement a lightweight distributed mutex per `thread_id` using a Supabase row-level advisory lock or a simple `pg_advisory_xact_lock(branch_id_hash)` call before invoking the graph. Alternatively, enforce the invariant at the application layer: only the Mic Check token holder can trigger a graph run — this is the correct design anyway for Panelito's Mic Check Pattern. If only one human holds the mic at a time, concurrent graph runs on the same branch are impossible by design.
- Do NOT rely on LangGraph's `interruptBefore`/`interruptAfter` as a mutex — these are for human-in-the-loop pauses, not concurrency control.

**Phase:** v2.0 Phase 2 (Mic Check Pattern implementation — the Mic Check lock solves Issue B; Issue A must be tested before Phase 2 work begins)

**Confidence:** HIGH for Issue A (documented GitHub issue with reproduction); MEDIUM for Issue B (inferred from LangGraph's documented lack of concurrent write protection, cross-referenced with Supabase advisory lock patterns).

---

### P14 — Zustand Store Shared Across Requests in Next.js App Router (SSR Data Leak)

**Warning signs:** Canvas state from one user's session appears briefly in another user's initial page load; hydration mismatch errors in production but not locally; store state is non-empty on first server render.

**What happens:** JavaScript modules are singletons in Node.js. A Zustand store created with `create(...)` at module level is shared across all concurrent SSR requests handled by the same Next.js server instance. User A's canvas state is in the store when User B's page is server-rendered. This is a data leak between users.

This does not affect client-side-only stores, but the canvas store needs to be initialized from Supabase on first render for correct hydration — which means it must be touched during SSR.

**Prevention:**
- Follow Zustand's official Next.js App Router guide: create a store **factory function**, not a global store instance, and provide it via React context in the root layout:
  ```typescript
  // Wrong: module-level singleton
  export const useCanvasStore = create<CanvasState>()(...);

  // Correct: factory + context provider
  const createCanvasStore = () => create<CanvasState>()(...);
  const CanvasStoreContext = createContext<ReturnType<typeof createCanvasStore> | null>(null);
  ```
- Initialize canvas state from Supabase in a server component and pass it as the initial value to the store provider — do not fetch in the store itself
- The Supabase Realtime subscription for canvas updates must be set up inside a `useEffect` in a **client** component, never in a server component or at module level

**Phase:** v2.0 Phase 3 (Graph Canvas UI — address before wiring Realtime subscription to canvas store)

**Confidence:** HIGH — Zustand official Next.js guide explicitly warns about this; React Server Components architecture documentation confirms the singleton risk.

---

### P15 — Stale Closures in Zustand + Supabase Realtime Canvas Subscription

**Warning signs:** Canvas mutations arrive via Realtime but the canvas doesn't update; React DevTools shows the store updating but the component doesn't re-render; canvas shows stale node positions after switching branches; memory appears to grow after navigating between branches.

**What happens:** Three related closure traps:

**Trap A — Realtime subscription captures stale `branchId`:** If the Supabase channel subscription is created in a `useEffect` with an empty dependency array `[]`, it captures the `branchId` from the first render. When the user switches branches, the subscription is still listening to the old branch's channel.

**Trap B — Zustand selector returns new array reference on every call:** Using `useCanvasStore(s => s.nodes)` returns a new array reference even when node contents are unchanged (because `nodes` is reconstructed from the selector). React Flow compares by reference — every Realtime event triggers a full re-render of all nodes.

**Trap C — React Flow node callbacks capture stale Zustand state:** Event handlers like `onNodeClick`, `onNodesChange` defined inline in React Flow capture the store state at definition time. If the store updates (new node added via Realtime), the callbacks still reference the snapshot from when they were created.

**Prevention:**
- **For Trap A:** Include `branchId` in the `useEffect` dependency array and return a cleanup function that unsubscribes the old channel:
  ```typescript
  useEffect(() => {
    const channel = supabase.channel(`canvas:${branchId}`)
      .on('broadcast', { event: 'canvas_mutation' }, handler)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [branchId]); // re-subscribe on branch change
  ```
- **For Trap B:** Use `useShallow` from Zustand when selecting arrays or objects:
  ```typescript
  import { useShallow } from 'zustand/react/shallow';
  const nodes = useCanvasStore(useShallow(s => s.nodes));
  ```
- **For Trap C:** Define node callbacks inside the Zustand store as actions (not as React component callbacks), so they always access current state via the store's `get()` closure, not a captured snapshot.

**Phase:** v2.0 Phase 3 (Graph Canvas UI — test with a mock Realtime stream before wiring live LangGraph events)

**Confidence:** HIGH — Trap A and B confirmed by React Flow performance docs and Zustand selector docs; Trap C inferred from React closure mechanics, consistent with multiple community reports on state management with React Flow.

---

### P16 — LangGraph `interrupt()` + Mic Check Pattern Incompatible with Short-Lived Vercel Functions

**Warning signs:** Graph execution pauses at `interrupt()` but the SSE connection drops after 300s (Hobby plan limit) or earlier; resumed graph runs start from the beginning of the node instead of from the interrupted state; `Command({ resume: ... })` invocation causes the graph to re-execute node prologue code with side effects.

**What happens:** LangGraph's `interrupt()` mechanism saves graph state to the Postgres checkpointer and waits indefinitely for a `Command({ resume: value })` to be sent in a new invocation. In Panelito's Mic Check Pattern, the graph pauses waiting for a human to release the floor — this could be minutes or hours.

**Issue A:** The original SSE stream that triggered the graph is now dead (the Vercel function has long since completed). The client has no live connection to receive the resumed graph's output.

**Issue B:** When resumed, LangGraph restarts the node that contained `interrupt()` from its beginning. Any side effects in that node before the `interrupt()` call (e.g., writing a ghost node to Supabase, sending a Realtime broadcast) execute again on resume.

**Issue C:** The `Command({ resume })` must be sent in a brand new HTTP request. This means the frontend needs to know the `thread_id` (= `branch_id`) and must open a new SSE connection for the resumed graph's output stream.

**Prevention:**
- Design the Mic Check as a **two-request pattern**, not a long-lived connection:
  1. First request: start graph → receives SSE stream → graph pauses at `interrupt()` → SSE stream closes normally (not an error)
  2. Frontend listens on Supabase Realtime for a `mic_released` presence event from the human
  3. Second request: POST `/graph/resume` with `{ thread_id, resume_value }` → opens new SSE connection → graph continues from checkpoint
- Never put side effects before `interrupt()` in a node. Put all pre-interrupt work in a preceding node, and let the interrupt node contain only the `interrupt()` call:
  ```typescript
  // Wrong: side effect before interrupt
  async function micCheckNode(state) {
    await writeGhostNode(state); // runs again on resume
    const approval = interrupt('Waiting for mic');
    ...
  }
  // Correct: split into two nodes
  graph.addNode('prepareGhost', writeGhostNode);
  graph.addNode('micCheck', async (state) => {
    const approval = interrupt('Waiting for mic');
    return { micApproved: approval };
  });
  graph.addEdge('prepareGhost', 'micCheck');
  ```
- Set `maxDuration` explicitly for the streaming route in `vercel.json` — do not rely on defaults; for typical LLM node execution (non-interrupt), 300s is sufficient on Pro

**Phase:** v2.0 Phase 2 (Mic Check Pattern — design the two-request pattern before implementing any node that uses `interrupt()`)

**Confidence:** HIGH — LangGraph interrupt docs confirm node restarts on resume; Vercel duration docs confirm 300s Pro default; two-request pattern is consistent with documented LangGraph HITL production patterns.

---

### P17 — LangGraph Module-Level Graph Compilation: Cold Starts vs. Memory Leaks

**Warning signs:** Each LangGraph invocation grows heap by 2-4 MB and never returns to baseline; Vercel function memory limit hit after sustained load; alternatively, Vercel cold starts take 3-5s because graph compilation runs on each cold boot.

**What happens:** There are two opposing failure modes:

**Failure Mode A — Graph compiled per-request:** Calling `new StateGraph(...)` and `.compile()` inside the request handler (to avoid module-level globals) creates new function references, validation pipelines, and tracing callbacks on every invocation. These are not garbage collected because LangGraph's tracing infrastructure (LangSmith callbacks, Langfuse callbacks) holds references to compiled graph nodes. Result: ~3.5 MB compiled code + ~2.3 MB string data accumulates per two requests (documented in langchain-ai/langgraphjs#1746).

**Failure Mode B — Graph compiled at module level:** The compiled graph is a module singleton, so it survives warm function instances correctly. However, on cold start, importing `@langchain/langgraph` + compiling the graph + establishing the Postgres checkpointer connection adds 2-4s of cold start latency on Vercel.

**Prevention:**
- Compile the graph **at module level** (singleton) — this is the correct pattern. The graph instance itself is stateless and thread-safe across concurrent invocations (confirmed by LangGraph maintainers).
- Cache prompt templates and tool definitions at module level too — do not recreate them per request.
- The Postgres connection pool should also be at module level so it's reused across warm invocations.
- Mitigate cold start latency with:
  - Vercel Pro's "Fluid Compute" warm instance pooling (reduces cold starts significantly)
  - Lazy import: only import LangGraph in the route file that needs it, not in shared middleware
  - Keep the graph definition file minimal — avoid importing large dependencies (langchain vectorstores, etc.) unless needed
- Monitor memory with Vercel's function metrics. If memory grows despite module-level compilation, the source is likely Langfuse's callback handler holding references — test by running 50 requests without Langfuse enabled and comparing heap.

**Phase:** v2.0 Phase 1 (graph bootstrapping) — decision must be made before any agent node work begins

**Confidence:** MEDIUM for memory leak root cause (documented issue but root cause was not definitively confirmed in the GitHub thread); HIGH for module-level graph as correct pattern (LangGraph maintainer confirmation in discussion #1211).

---

### P18 — LangGraph Checkpoint Data Grows Unbounded in Supabase

**Warning signs:** Supabase storage usage grows continuously even for closed sessions; `checkpoints` and `checkpoint_blobs` tables grow at ~100 rows per graph run; DB query latency degrades after weeks of use.

**What happens:** LangGraph's Postgres checkpointer stores a full copy of the graph state at every superstep (every node execution). For a 5-node graph running 3 times per session with 50 messages, that is ~1,500 checkpoint rows per session. There is no built-in cleanup — LangGraph has no TTL, no auto-purge, no compaction. This is a documented open issue (langchain-ai/langgraphjs#1138).

**Prevention:**
- Write a Supabase `pg_cron` job to delete checkpoints for closed sessions on a schedule:
  ```sql
  -- Run nightly: delete checkpoints for sessions closed > 7 days ago
  DELETE FROM langgraph.checkpoints
  WHERE thread_id IN (
    SELECT id::text FROM sessions
    WHERE status = 'closed' AND closed_at < NOW() - INTERVAL '7 days'
  );
  ```
- Store large state blobs (full canvas snapshots) in Supabase Storage and keep only a reference ID in the LangGraph state — this limits checkpoint row size to metadata + reference IDs
- Consider using a separate Postgres schema (`langgraph`) and monitor its size independently from your application tables
- For the Debate/Strategy Blueprint, the LangGraph state should contain only node/edge IDs and confidence scores, not the full CanvasNode objects — fetch full objects from Supabase on demand

**Phase:** v2.0 Phase 1 (Supabase schema design) — design the state shape to be minimal before writing any nodes

**Confidence:** MEDIUM — unbounded growth is documented; the `pg_cron` mitigation is a standard Supabase pattern but the specific LangGraph table structure must be verified against the actual migration SQL.

---

### P19 — Supabase Realtime Canvas Ordering: At-Most-Once Delivery, Not At-Least-Once

**Warning signs:** Occasionally a canvas node appears on one user's screen but not another's; reconnecting clients miss mutations that occurred during disconnection; canvas diverges across participants after network blip.

**What happens:** Supabase Realtime `broadcast` (used for canvas mutations) guarantees **in-order delivery** but NOT delivery. If a client is momentarily disconnected or behind on processing, a broadcast event is not buffered and retried — it is lost. This is fundamentally different from Postgres changes (which replay from WAL on reconnect).

For confidence-based canvas mutations (the >0.85 direct mutation path), a missed broadcast means User B's canvas is missing a node that User A can see. There is no reconciliation unless explicitly built.

**Prevention:**
- After every LangGraph graph run completes, write the final canvas state to the `canvas_snapshots` table in Supabase (a single authoritative row per branch)
- On client reconnect (Supabase Realtime `CLOSED` → `SUBSCRIBED` transition), fetch the current canvas snapshot from DB and reconcile with local state — broadcast events are only for live deltas, DB is the source of truth
- Use a monotonically increasing `sequence_number` on canvas mutations; on reconnect, compare client's last seen sequence number against DB and replay missing mutations
- The ghost/tentative path (0.5–0.85 confidence) can use broadcast-only without DB write since these are ephemeral — they should disappear on reconnect rather than be replayed

**Phase:** v2.0 Phase 3 (Canvas sync) — must be designed before multi-user testing begins

**Confidence:** HIGH — Supabase Realtime docs explicitly state broadcast is not guaranteed delivery; confirmed in community discussions.

---

## Quick Reference

| Pitfall | Severity | Phase to Address |
|---------|----------|-----------------|
| Mobile layout collapse | Critical | Phase 1 |
| Branch context bleeding | Critical | Phase 2 |
| API key exposure | Critical | Phase 1 |
| Canvas snapshot bloat | High | Phase 2 |
| Realtime fan-out latency | High | Phase 1 |
| Claude schema mismatches | High | Phase 1 |
| Scroll-spy initial fire | Medium | Phase 3 |
| Fork explosion UX | Medium | Phase 2 |
| **v2.0: LangGraph stream + Hono SSE composition** | **Critical** | **v2 Phase 1** |
| **v2.0: Langfuse trace drops (no waitUntil)** | **Critical** | **v2 Phase 1** |
| **v2.0: Ajv eval blocked in edge runtime** | **Critical** | **v2 Phase 1** |
| **v2.0: Postgres checkpointer + Supavisor pooler** | **Critical** | **v2 Phase 1** |
| **v2.0: Concurrent users same branch (thread contamination)** | **High** | **v2 Phase 2** |
| **v2.0: Zustand SSR singleton data leak** | **High** | **v2 Phase 3** |
| **v2.0: Stale closures (Zustand + Realtime canvas)** | **High** | **v2 Phase 3** |
| **v2.0: interrupt() incompatible with short-lived functions** | **High** | **v2 Phase 2** |
| **v2.0: Graph module-level vs. per-request compilation** | **Medium** | **v2 Phase 1** |
| **v2.0: Checkpoint unbounded growth** | **Medium** | **v2 Phase 1** |
| **v2.0: Realtime canvas at-most-once delivery** | **Medium** | **v2 Phase 3** |
