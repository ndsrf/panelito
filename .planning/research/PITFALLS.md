# Pitfalls Research: Project Multiverse

**Domain:** Real-time collaborative AI workspace with conversation branching
**Research date:** 2026-06-08 (v1) / 2026-07-01 (v2.0 NSAI addendum) / 2026-07-09 (v3.0 proactive bots addendum)

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

---

## v3.0 Proactive Bot Integration Pitfalls

These pitfalls are specific to adding proactive (autonomously triggered) bots to the existing reactive system. The reactive foundation (Mic Check Pattern, LangGraph thread-per-branch, SSE streaming) is already in place. The new risk surface is bots that fire without human invocation. Each pitfall has been verified against LangGraph JS documentation, Supabase Realtime production reports, Anthropic API documentation, and community postmortems.

---

### P20 — Bot Fires While Human Is Actively Typing: The "Interruption Storm"

**Problem:** A silence-window trigger fires after N seconds of no *sent* messages, but the human is mid-sentence in the input box. The bot's message arrives in the chat while the human is still composing, which destroys conversation flow and makes the bot feel hostile. With three bot personalities all monitoring silence independently, all three can fire simultaneously on the same silence event, flooding the chat with three bot messages in rapid succession.

**Warning signs:**
- Bot messages appear in chat while Supabase Presence shows a participant with `is_typing: true`
- Multiple bot messages arrive within 2 seconds of each other on the same branch
- Users report bots "interrupting" or chat feeling chaotic after periods of inactivity
- Langfuse shows 3 simultaneous LangGraph invocations starting within the same 100ms window

**Prevention strategy:**
- Implement a two-signal silence gate: silence is only confirmed if (a) no message has been sent for N seconds AND (b) no participant's Supabase Presence shows `is_typing: true`. The typing indicator check must happen at the moment the timer fires, not when it is scheduled.
- Use Supabase Presence to broadcast typing state from the frontend input component: emit `{ is_typing: true }` on `keydown` (debounced 500ms) and `{ is_typing: false }` on blur or 3s of no keystrokes. Check this before any proactive trigger evaluates.
- Implement a global bot arbitration lock per branch: only one bot may fire proactively per N-second window. Use a Supabase Postgres advisory lock (`SELECT pg_try_advisory_lock(branch_id_hash)`) or a Redis key with TTL. The first bot to acquire it fires; the others skip their trigger.
- Schedule silence timers server-side (not client-side) so that multiple browser tabs for different participants don't each independently fire the same timer.

**Relevant phase:** v3.0 Phase 1 (trigger infrastructure — build arbitration before wiring any personality to any trigger type)

**Confidence:** HIGH — typing indicator race is a documented failure mode in production bot systems; Supabase Presence for `is_typing` is a documented pattern; advisory lock for bot arbitration is inferred from Postgres locking primitives (MEDIUM confidence on the specific implementation).

---

### P21 — BYOK Cost Explosion from Proactive Trigger Cascade

**Problem:** Proactive triggers evaluate continuously. With 6 trigger types firing potentially every few seconds across multiple branches, and each evaluation requiring an LLM call (even a light model), the number of API calls multiplies. A session with 4 participants, 3 bots, 2 active branches, and a 30-second silence window can easily produce 50+ LLM calls per minute — entirely from trigger evaluation, before any actual facilitation message is generated. On the creator's BYOK key, this is a direct and immediate cost explosion with no platform-level ceiling.

**Warning signs:**
- Langfuse cost dashboard shows token usage spiking during periods of low human activity
- Creator receives Anthropic billing alerts during their own sessions
- Trigger-evaluation LangGraph nodes appear more frequently in traces than facilitation nodes
- Bot messages appear even in active conversations where humans are talking rapidly
- The same trigger type fires repeatedly within a single minute for the same branch

**Prevention strategy:**
- Separate trigger *classification* (is this trigger condition met?) from trigger *evaluation* (what should the bot say?). Classification should use cheap heuristics first: a silence window check is a timestamp comparison — zero LLM tokens needed. Only escalate to an LLM call when a heuristic threshold is crossed AND the bot arbitration lock is acquired.
- Assign hard token budgets per session, implemented as a server-side counter stored in Supabase. Before any proactive LLM call, check `session_token_budget_remaining`. If exhausted, suppress all proactive triggers until the next human message (which resets the counter for that window).
- Use the light model (e.g., `claude-haiku-4-5`) for all trigger classification and facilitation-move generation. Reserve the heavy model (`claude-sonnet-4-6`) exclusively for graph reasoning, fact-check, and unlinked assertion evaluation. Never use the heavy model for silence detection or semantic drift classification.
- Implement a per-trigger cooldown per bot per branch: after a bot fires for trigger type X on branch Y, that bot cannot fire for trigger X on branch Y again for at least 60 seconds (configurable). Store cooldown state in the LangGraph thread state so it survives process restarts.
- Cap the total number of proactive bot interventions per session-hour: if bots have spoken more than K times without a human response between their messages, halt proactive triggers entirely. This prevents the bot-loop failure mode where bots start talking to each other.
- Implement a circuit breaker: if the token rate (tokens per minute) exceeds a threshold for 3 consecutive check intervals, disable all proactive triggers for the session and surface a warning to the creator in the UI.

**Relevant phase:** v3.0 Phase 1 (trigger infrastructure) and v3.0 Phase 2 (model routing — must establish budget guard before any personality triggers are wired)

**Confidence:** HIGH — token accumulation pattern (O(N²) cost with conversation length) is documented in Anthropic and Claude API cost guides; circuit breaker pattern for token rate monitoring is documented in production AI agent cost-management articles; BYOK cost surface with no platform ceiling is an architectural reality confirmed by the project's own constraint definition.

---

### P22 — LangGraph Thread State Corruption from Proactive Writes Colliding with Human-Triggered Writes

**Problem:** The existing Mic Check Pattern ensures only one human-triggered graph run occurs at a time per branch. But proactive bots bypass the Mic Check — they fire autonomously. If a human sends a message and triggers a graph run at the same moment a proactive bot trigger evaluates and starts its own graph run on the same `thread_id` (= `branch_id`), two concurrent LangGraph writes occur on the same thread. LangGraph has no built-in mutex for concurrent writes to the same thread. The result is checkpoint write-skew: both runs read the same parent checkpoint, both update state, and one silently overwrites the other's changes.

**Warning signs:**
- Canvas nodes appear then disappear seconds later
- Bot's facilitation message in chat references a conversation state that no longer matches the canvas
- Langfuse shows two graph runs with the same `thread_id` overlapping in time
- Checkpoint table has two rows with the same `thread_ts` parent but different children (diverged DAG fork)
- Human's message is processed by the graph but its canvas mutations are missing from the final state

**Prevention strategy:**
- Extend the existing branch-level advisory lock to cover both human-triggered and bot-triggered graph invocations. Use `pg_advisory_xact_lock(branch_id_hash)` as a serialization gate for ALL LangGraph invocations on a branch, regardless of source. Proactive bots acquire this lock before invoking the graph; human-triggered runs already hold it via the Mic Check pattern.
- Design proactive bot runs as separate, non-overlapping graph invocations: if the lock is held (human is being processed), the proactive trigger is *deferred* (not discarded) — reschedule it for 5 seconds after the current run completes, using the Supabase `pg_cron` or a lightweight debounce timer.
- Consider using separate LangGraph `thread_id` values for bot-triggered facilitation versus human-triggered graph reasoning, merging relevant state back via explicit state update operations rather than concurrent writes to the same thread. This is the safest design: `thread_id = branch_id + ':human'` and `thread_id = branch_id + ':bot'`, with the bot thread reading from the human thread's checkpoint but writing to its own.
- If using a shared `thread_id`, implement CRDT-style reducers in LangGraph state for all fields that both human and bot runs can modify (e.g., `conversationGraph`, `userProfiles`) — this makes concurrent writes idempotent rather than destructive.

**Relevant phase:** v3.0 Phase 1 (graph architecture decision — the thread_id design must be finalized before any proactive trigger code is written)

**Confidence:** MEDIUM — write-skew under concurrent LangGraph invocations is documented (azguards.com postmortem); advisory lock mitigation is a standard Postgres pattern; the specific dual-thread_id design is inferred, not directly documented.

---

### P23 — In-Memory Conversation Graph and User Profiles Lost on Serverless Cold Start

**Problem:** The v3.0 design specifies that bots maintain an in-memory conversation graph and per-session user profiles (stated positions, key assertions, engagement patterns). On Vercel serverless, function instances are recycled when idle, evicted under memory pressure, or replaced during deployment. Any in-memory data is destroyed. On the next request, the bot has no memory of the conversation graph it was building — it starts fresh, asks questions the user already answered, and breaks the "personalized facilitation" experience entirely.

**Warning signs:**
- Bots ask questions the user definitively answered earlier in the session
- User profile data (stated positions) resets mid-session without any visible trigger
- Bot messages reference the graph correctly for the first 10 minutes, then revert to generic facilitation
- Langfuse traces show the `userProfiles` state key as empty at the start of a run that should have prior context
- Vercel dashboard shows function instance replacement events coinciding with bot memory loss

**Prevention strategy:**
- Do not use JavaScript process memory for conversation graph or user profiles. Store them in the LangGraph thread state backed by the PostgresSaver checkpointer, so they survive process restarts by design.
- Structure the LangGraph state to include `conversationGraph: { nodes: GraphNodeRef[], edges: GraphEdgeRef[] }` and `userProfiles: Record<userId, UserProfile>`. These fields are serialized to Postgres on every checkpoint write.
- Keep stored representations compact: `GraphNodeRef` should be `{ id, type, summary }` (20-50 bytes), not a full `CanvasNode` object. The full node is fetched from Supabase when needed. This prevents checkpoint bloat (see P18) while preserving bot memory.
- For user profiles, store only structured summaries (`statedPositions: string[]`, `assertionCount: number`, `engagementLevel: 'high'|'medium'|'low'`), not raw message history — the full message history is already in the branch's message tree in Supabase.
- Test memory persistence explicitly: deploy to Vercel, run a session for 15 minutes, trigger a manual function replacement (redeploy), then send a new message and verify the bot's context is intact.

**Relevant phase:** v3.0 Phase 1 (LangGraph state schema design — in-memory vs. persisted must be decided before any personality or profile logic is written)

**Confidence:** HIGH — serverless statelessness causing in-memory data loss is a foundational constraint; LangGraph PostgresSaver as the solution is documented; the specific state schema design is a project-specific recommendation derived from the constraint.

---

### P24 — Semantic Drift Classifier False Positive Rate Floods Chat with Redirection Bots

**Problem:** The semantic drift trigger fires when conversation leaves Blueprint scope. If the classifier (LLM or embedding-based) is too sensitive, it fires on every tangent, metaphor, or illustrative example — normal conversation moves that are not actual drift. In a 60-minute debate session, a poorly calibrated classifier can fire 20-30 times, each time sending a bot redirection message. Users experience the bots as pedantic, annoying, and authoritarian. The session degrades into humans fighting the bots rather than each other.

**Warning signs:**
- Semantic drift trigger fires more than 3 times in a 10-minute window on an active branch
- Users explicitly address the bots in hostile or dismissive language ("stop interrupting", "we know, we know")
- Langfuse traces show `DOMAIN_BRIDGE` classifications being escalated to bot interventions instead of being silently logged
- Bot messages contain phrases like "let's get back to..." more than twice per 15-minute window

**Prevention strategy:**
- Use a three-tier classification before triggering any bot message: (1) embedding distance from Blueprint centroid using a lightweight model — zero LLM tokens, (2) if distance exceeds threshold, classify with light LLM model (haiku) as `DOMAIN_MATCH / DOMAIN_BRIDGE / DOMAIN_DRIFT`, (3) only on confirmed `DOMAIN_DRIFT` with ≥2 consecutive drift signals should a bot intervention be queued.
- Distinguish `DOMAIN_BRIDGE` (conversation touches adjacent domain — allow silently) from `DOMAIN_DRIFT` (conversation has left Blueprint domain entirely — bot intervenes). The existing v2.0 Flex-Soft guardrail classification already produces these labels — use that classification output as the semantic drift trigger input rather than running a separate classifier.
- Apply a hysteresis rule: the drift trigger can only fire once per 10 minutes per branch, regardless of how many drift signals are detected. After a bot redirection, suppress the drift trigger for that window.
- When the drift trigger does fire, the Coach bot (Socratic) is the correct personality — not the Devil's Advocate or Analyst. A redirection question ("I'm curious how this connects to X from our Blueprint...") is less hostile than a statement.
- Log all `DOMAIN_BRIDGE` events to Langfuse without triggering a bot intervention. After launch, analyze the ratio of `DOMAIN_BRIDGE` to `DOMAIN_DRIFT` in real sessions. If `DOMAIN_BRIDGE` dominates, the threshold needs widening.

**Relevant phase:** v3.0 Phase 2 (trigger calibration) — classifier thresholds must be tuned against real session recordings before enabling the semantic drift trigger in production

**Confidence:** MEDIUM — false positive rate in semantic classification is a documented challenge in LLM-based content moderation; the specific thresholds are project-specific and will require empirical calibration; the three-tier approach is a recommended pattern from AI content moderation literature.

---

### P25 — Bot Persona Drift Over Long Sessions: Personality Consistency Breaks Down

**Problem:** Each bot personality (Coach, Devil's Advocate, Analyst) relies on a system prompt to enforce persona. LLMs are stateless — each invocation starts from the system prompt with the conversation history as context. As sessions grow long (60+ minutes, 100+ messages), two things happen: (1) the conversation history grows so large that the system prompt's persona instructions become diluted in proportion, and (2) if conversation history is truncated to manage context length, the bot loses the behavioral examples from earlier in the session that anchored its persona. Research documents that most LLMs begin diverging from assigned personas after approximately 100 conversational turns.

**Warning signs:**
- The Coach bot starts giving direct answers instead of asking questions after 45+ minutes
- The Devil's Advocate bot starts agreeing with the group instead of challenging
- The Analyst bot uses emotional or opinionated language inconsistent with its neutral persona
- Langfuse traces show persona prompt compressed or truncated in the messages array sent to Claude
- Users stop noticing personality differences between bots in long sessions

**Prevention strategy:**
- Anchor the persona in both the system prompt AND in a structured preamble inserted into the conversation history at a fixed interval (e.g., every 15 bot invocations). This preamble is a short in-character example exchange that reinforces the persona without consuming large amounts of context.
- When truncating conversation history for context management, always preserve: (a) the first 10 messages of the session (establishes conversation baseline), (b) the last 20 messages (recency for coherence), and (c) any message where the bot spoke (preserves persona-consistent examples). Never truncate to a simple "last N messages" sliding window — this removes the persona anchoring examples.
- Store `lastPersonaRefreshAt` in the LangGraph thread state. If more than 15 bot invocations have occurred since the last persona refresh, prepend the persona example exchange to the next invocation's context.
- Test persona consistency explicitly: run a 100-message synthetic session and evaluate each bot response against a rubric (Coach: questions only, no direct answers; Devil's Advocate: always identifies a risk or challenge; Analyst: no first-person opinion statements). This test should be part of the v3.0 acceptance criteria.
- Keep bot personalities mutually exclusive in their speaking patterns. Give each a distinct phrase pattern that is easy to evaluate: Coach ends statements with `?`, Devil's Advocate includes one explicit risk per message, Analyst references a data point or logical structure.

**Relevant phase:** v3.0 Phase 2 (bot personality implementation) — persona consistency testing must happen before enabling all three bots in the same session

**Confidence:** MEDIUM — persona drift research is documented (100-turn degradation); the specific mitigation patterns are inferred from LLM context management best practices and are not directly documented for this exact scenario.

---

### P26 — Proactive Bot Messages Written to Supabase Before SSE Stream Completes: Orphaned Messages

**Problem:** When a proactive bot trigger fires, the flow is: trigger detected → LangGraph invoked → Claude generates message → message streamed via SSE → message written to Supabase as an immutable chat message → other participants see it via Supabase Realtime. The trap: the existing reactive system assumes the SSE stream is the invoking client's connection — the human who sent a message. For proactive bots, there is no invoking client. The SSE stream has no recipient. But the message is still written to Supabase and broadcast to all participants via Realtime. If Claude's generation fails mid-stream (rate limit, timeout, malformed output), a partial bot message can be written to Supabase — an incomplete sentence or malformed JSON fragment that appears in all participants' chat.

**Warning signs:**
- Partial bot messages appear in chat (sentence that cuts off mid-word)
- Canvas mutations from a bot message appear but the corresponding chat message is missing
- Langfuse shows a graph run that ended in error, but the Supabase `messages` table has a row for that run
- Bot message IDs appear in the Supabase messages table with `status: 'generating'` that never transitions to `'complete'`

**Prevention strategy:**
- Use a write-only-if-complete discipline for proactive bot messages: buffer the entire generated text in memory during the streaming graph run. Only write to Supabase after the stream completes successfully with a full, schema-validated response. Do not write partial messages progressively the way the reactive system does for the invoking client's live preview.
- For the live preview experience (other participants see the bot "typing"), use Supabase Realtime `broadcast` to stream the partial text — this is ephemeral and not persisted. Write the final message to Supabase only on successful completion.
- Implement a message status state machine in the `messages` table: `pending → generating → complete | failed`. On any error during generation, transition to `failed` and broadcast a `bot_message_failed` event to participants so the UI can remove the typing indicator. Never leave a message in `generating` state indefinitely — add a `pg_cron` job that marks messages stuck in `generating` for > 60 seconds as `failed`.
- For canvas mutations that accompany bot messages, use a database transaction: write the bot message row and the canvas snapshot atomically. Either both succeed or neither is visible.

**Relevant phase:** v3.0 Phase 1 (proactive bot infrastructure) — write discipline must be established before any bot personality generates real messages

**Confidence:** HIGH — partial write on streaming failure is a documented problem in reactive AI chat systems; write-only-if-complete is the standard mitigation; the specific SSE/broadcast split for live preview vs. persistence is inferred from Supabase Realtime documentation and the project's existing architecture.

---

### P27 — LangGraph Schema Migration Breaks Existing Sessions Mid-Milestone

**Problem:** v3.0 adds new fields to the LangGraph thread state: `conversationGraph`, `userProfiles`, `botCooldowns`, `sessionTokenBudget`. If sessions are active when the new code is deployed, existing checkpoints were serialized without these fields. When LangGraph resumes an existing thread with the new graph schema, missing required fields cause deserialization errors. LangGraph provides no built-in schema migration tool — it will either throw on deserialization or silently produce `undefined` values for new fields, which then cause null-pointer errors in downstream nodes.

**Warning signs:**
- Error logs show `Cannot read properties of undefined` in bot nodes after deployment
- Existing sessions fail to produce bot messages after upgrading to v3.0 code
- New sessions work correctly but sessions that were active before the deployment do not
- LangGraph thread state shows `userProfiles: undefined` for sessions started before v3.0

**Prevention strategy:**
- All new LangGraph state fields added in v3.0 must have explicit default values that produce valid no-op behavior. Use TypeScript optional fields with defaults in the state schema definition:
  ```typescript
  conversationGraph: { nodes: [], edges: [] },   // empty graph = bot has no prior context
  userProfiles: {},                               // empty map = no profiles built yet
  botCooldowns: {},                               // empty = no cooldowns active
  sessionTokenBudget: DEFAULT_SESSION_BUDGET,     // conservative starting budget
  ```
- Write a defensive access wrapper for all new state fields in every node that reads them: `const graph = state.conversationGraph ?? { nodes: [], edges: [] }`. Do not assume the field exists even if the schema declares it.
- Plan v3.0 deployment as a zero-downtime migration: deploy during low-traffic hours, drain in-progress sessions (notify creators 10 minutes before deployment), and ensure all new state fields are backward-compatible (additive only, no renames or removals of existing fields).
- Before deployment, run a migration validation script that fetches 10 random existing checkpoints from Supabase and deserializes them against the new graph schema. If any fail, do not deploy.

**Relevant phase:** v3.0 Phase 1 (state schema design) — design backward-compatible schema before writing any node that touches new fields

**Confidence:** HIGH — LangGraph schema migration breaking existing threads is documented in GitHub issue #536 and the LangGraph state management guide; the defensive default pattern is the documented mitigation.

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
| **v3.0: Bot fires while human is typing (interruption storm)** | **Critical** | **v3 Phase 1** |
| **v3.0: BYOK cost explosion from proactive trigger cascade** | **Critical** | **v3 Phase 1–2** |
| **v3.0: Thread state corruption: bot + human concurrent writes** | **Critical** | **v3 Phase 1** |
| **v3.0: In-memory state lost on serverless cold start** | **High** | **v3 Phase 1** |
| **v3.0: Semantic drift classifier false positive rate** | **High** | **v3 Phase 2** |
| **v3.0: Bot persona drift over long sessions** | **High** | **v3 Phase 2** |
| **v3.0: Orphaned partial bot messages on stream failure** | **High** | **v3 Phase 1** |
| **v3.0: LangGraph schema migration breaks existing sessions** | **Medium** | **v3 Phase 1** |
