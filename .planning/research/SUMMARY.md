# Project Research Summary

**Project:** Project Multiverse v2.0 — NSAI Engine
**Domain:** Neuro-Symbolic AI collaborative workspace (stateful multi-agent orchestration layered onto existing real-time group chat)
**Researched:** 2026-07-01
**Confidence:** HIGH

---

## Executive Summary

Project Multiverse v2.0 adds a Neuro-Symbolic AI engine on top of a fully-working v1 real-time workspace. The integration path is surgical: the existing `/invoke` route's direct `adapter.stream()` call is replaced with a LangGraph `StateGraph` execution, while auth, cap checks, message persistence, SSE delivery, and the Supabase Realtime broadcast pattern all remain unchanged. The v2.0 system introduces four new architectural concepts: Domain Blueprints (runtime-loaded ontology JSON), a LangGraph graph with three nodes (OrchestratorNode → AgentNode → MutationGateNode), a confidence-based autonomy matrix that controls whether AI canvas mutations are committed directly/rendered as ghost nodes/suppressed entirely, and a shared graph canvas (`@xyflow/react`) synchronized across all participants via Supabase Realtime broadcast.

The recommended build sequence has nine layers of strict dependency: Supabase schema migrations must precede TypeScript type definitions, which must precede Blueprint validation infrastructure, which must precede LangGraph graph construction, which must precede the Postgres checkpointer swap, which must precede the `/invoke` route modification (the highest-risk seam), which must precede canvas writes, which must precede the canvas hydration endpoint, which must precede the Zustand canvas store, which must precede the `GraphCanvas` frontend component. This layered order allows each layer to be tested in isolation before the next is added, minimizing risk to the existing v1 user experience.

The four most dangerous pitfalls are: (1) LangGraph's `graph.astream()` not composing transparently with Hono's `streamSSE` unless the pattern is written exactly right with abort wiring and explicit error events; (2) Langfuse dropping traces in Vercel serverless without `waitUntil(langfuse.flushAsync())` rather than a plain `await`; (3) Ajv crashing with `EvalError` if Blueprint validation code inadvertently runs in any Vercel Edge Runtime context; and (4) the LangGraph Postgres checkpointer producing `prepared statement already exists` errors when pointed at Supabase's transaction-mode pooler (port 6543) without `prepare: false`. All four must be solved in Phase 1 before any domain agent work begins.

---

## Stack Additions

The v1 stack is not replaced — only extended. All new packages install in `apps/api` except `@xyflow/react` which installs in `apps/web`.

**`apps/api` additions:**

```bash
pnpm add @langchain/langgraph @langchain/core @langchain/langgraph-checkpoint-postgres pg @langfuse/langchain @opentelemetry/api ajv ajv-formats
pnpm add -D @types/pg
```

| Package | Version | Purpose |
|---------|---------|---------|
| `@langchain/langgraph` | `1.4.7` | Stateful agent graph; the only mature TypeScript-native option with checkpointing and conditional edges |
| `@langchain/core` | `^1.1.48` | Required peer dep of LangGraph; provides `BaseMessage` and runnable interfaces |
| `@langchain/langgraph-checkpoint-postgres` | `1.0.4` | Postgres-backed checkpointer; required because Vercel serverless is ephemeral and `MemorySaver` loses all state on cold start |
| `pg` | `^8.12.0` | Direct dependency of the checkpointer package |
| `@langfuse/langchain` | `5.9.1` | LLM observability; the `@langfuse/` scoped package (NOT `langfuse-langchain`), which peers on old monolithic `langchain <0.4.0`, incompatible with `@langchain/langgraph@1.x` |
| `@opentelemetry/api` | `1.9.1` | Thin peer dep of `@langfuse/langchain`; does NOT require a full OTel pipeline |
| `ajv` | `8.20.0` | Blueprint JSON Schema validation; compile validators once at module load (never per-request) |
| `ajv-formats` | `3.0.1` | Adds `date-time`, `uri`, `email` format validators to Ajv v8 |

**`apps/web` addition:**

```bash
pnpm add @xyflow/react
```

| Package | Version | Critical Integration Note |
|---------|---------|--------------------------|
| `@xyflow/react` | `12.11.1` | `reactflow` is the legacy name; must be loaded via `next/dynamic({ ssr: false })` because it uses `ResizeObserver`/`requestAnimationFrame` unavailable during SSR |

**What NOT to install:**

| Package | Why Not |
|---------|---------|
| `reactflow` | Legacy package name; use `@xyflow/react` |
| `langchain` (monolithic) | Only needed for `anthropicPromptCachingMiddleware`; use `@anthropic-ai/sdk` `cache_control` directly |
| `langfuse-langchain` | Peers on old `langchain <0.4.0`; incompatible with `@langchain/langgraph@1.x` |
| `@langchain/anthropic` | Not needed — LangGraph nodes call existing `AIProvider` directly; preserves multi-provider abstraction |
| `@opentelemetry/sdk-node` | Full OTel SDK not needed; `@opentelemetry/api` (thin peer) is sufficient for Langfuse |

---

## Feature Table Stakes

The NSAI system fails to deliver its core thesis without all of the following. Missing any one either breaks human control, canvas synchronization, or domain isolation.

**Must have (system non-functional without these):**

| Feature | Complexity | Core Requirement |
|---------|------------|-----------------|
| LangGraph OrchestratorNode + Agent nodes | HIGH | `thread_id = branch_id`; Postgres checkpointer for cross-request state persistence across Vercel cold starts |
| Domain Blueprints + Ajv validation | MEDIUM | JSON ontology loaded from Supabase, validated against meta-schema; defines node types, edge types, personas, phase sequence, `canvas_view_mode` |
| Universal CanvasNode + CanvasEdge schema | LOW | Single schema with `status` field: `"committed"` / `"ghost"` / `"silent"`; all domains customize vocabulary only |
| Confidence-based autonomy matrix | MEDIUM | >0.85 = direct mutation; 0.5–0.85 = ghost node (dashed border, 40% opacity); <0.5 = text-only sidebar; thresholds are design-intent, require empirical calibration |
| Flex-Soft domain guardrails (DOMAIN_MATCH / DOMAIN_BRIDGE / DOMAIN_DRIFT) | MEDIUM | Classifier node before every agent call; DOMAIN_DRIFT routes to plain LLM with no canvas mutation (does NOT refuse the message) |
| Mic Check Pattern | LOW | `mic_check` in Supabase Realtime broadcast (not DB); 30s auto-release on typing timeout; makes concurrent graph runs on same branch impossible by design |
| Human Consensus Pattern (phase gating) | LOW–MEDIUM | `current_phase` in Supabase session table; LLM emits `phase_signal` but cannot call any tool that changes `current_phase`; human clicks "Advance Phase" |
| Langfuse observability | LOW | `CallbackHandler` per-request (NOT module singleton); `waitUntil(langfuse.flushAsync())` for Vercel; cost, latency, DOMAIN_DRIFT rate, confidence distribution from day 1 |

**Autonomy matrix detail:**

| Confidence | Action | UX Signal |
|------------|--------|-----------|
| > 0.85 | Direct canvas mutation — node/edge committed immediately | Node appears solid, full opacity |
| 0.5 – 0.85 | Ghost mutation — tentative rendering | Dashed border, ~40% opacity, "Click to confirm" affordance |
| < 0.5 | No canvas mutation | Grey suggestion text in chat sidebar only |

**Guardrail routing:**

| Classification | Route | Canvas Impact |
|---------------|-------|--------------|
| `DOMAIN_MATCH` | Domain Agent node | Yes — full mutation pipeline |
| `DOMAIN_BRIDGE` | Domain Agent node with context note | LLM decides |
| `DOMAIN_DRIFT` | Plain LLM (no agent) | None — conversation continues freely |

**Explicitly deferred to v2.1:**
- Prompt caching + LangGraph state compression (optimize after basic flow is proven)
- Branch fork as LangGraph thread copy (start fork from empty thread in v2.0)
- Additional Blueprints beyond Debate/Strategy
- CRDT/Yjs for canvas sync ("last write wins" is sufficient for v1 session sizes)
- LangGraph `interrupt()` for Mic Check (use two-request pattern instead; see P16)

---

## Architecture Build Order

The dependencies form a strict 9-layer chain. Each layer is testable in isolation before the next begins. This is not a suggested order — it is a dependency-enforced order.

| Layer | Name | Why This Position |
|-------|------|-------------------|
| 0 | **Supabase Schema Migrations** | `canvas_nodes` references `branches`; everything else writes to these tables |
| 1 | **Types Package** | Shared `CanvasNode`/`CanvasEdge`/`Blueprint` types used by both API and frontend; define once, prevent type-chasing |
| 2 | **Blueprint Loading + Ajv Validation** | Proves Blueprint round-trip (DB → API → Ajv) before touching LangGraph; fail fast on schema issues |
| 3 | **LangGraph Graph Construction (MemorySaver)** | Build and unit-test graph in isolation; `MemorySaver` decouples graph logic from DB connectivity |
| 4 | **Postgres Checkpointer Swap** | Infrastructure swap only (MemorySaver → PostgresSaver); logic-neutral; verify cross-request state resumption |
| 5 | **`/invoke` Route Modification** | Highest-risk seam — touches existing v1 streaming path; only changed after graph + checkpointer are proven |
| 6 | **Canvas Writes + Realtime Broadcast** | New data path; prove Supabase upserts and `httpSend` broadcast land correctly before adding frontend consumer |
| 7 | **Canvas Hydration Endpoint** | Frontend cannot load initial canvas state without `GET /api/sessions/:id/canvas?branch_id=` |
| 8 | **Zustand Canvas Store** | State management before UI component; factory + React context pattern (not module singleton) |
| 9 | **GraphCanvas Frontend Component** | Final consumer; all data flows proven before any React rendering is written |

**New files by layer:**

```
Layer 0: Supabase migrations (canvas_nodes, canvas_edges, domain_blueprints + RLS)
Layer 1: packages/types/src/canvas.ts, packages/types/src/blueprint.ts
Layer 2: apps/api/src/lib/nsai/blueprint-loader.ts, blueprint-validator.ts
         apps/api/src/routes/ → GET /blueprints/active
Layer 3: apps/api/src/lib/nsai/graph.ts (buildNSAIGraph factory)
         apps/api/src/lib/nsai/nodes/orchestrator.ts
         apps/api/src/lib/nsai/nodes/agent.ts
         apps/api/src/lib/nsai/nodes/mutation-gate.ts
Layer 4: apps/api/src/lib/nsai/checkpointer.ts (PostgresSaver singleton)
Layer 5: apps/api/src/routes/ai.ts (MODIFIED — replace adapter.stream() with graph.astream())
Layer 6: apps/api/src/lib/nsai/canvas-writer.ts
         apps/api/src/routes/ → after-stream broadcast call
Layer 7: apps/api/src/routes/canvas.ts → GET /canvas
Layer 8: apps/web/store/canvas-store.ts (factory + context)
         apps/web/hooks/use-session-channel.ts (MODIFIED — add canvas_mutation handler)
Layer 9: apps/web/components/canvas/GraphCanvas.tsx ("use client" + next/dynamic ssr:false)
```

**Canvas write data flow:**
```
mutationGateNode → custom stream chunk → route stream loop
  → canvas-writer (Supabase upsert) → httpSend broadcast
    → use-session-channel handler → canvasStore.applyMutation()
      → GraphCanvas re-render
```

**Canvas read flow (join / branch switch):**
```
GET /api/sessions/:id/canvas?branch_id= → canvas_nodes + canvas_edges
  → canvasStore.loadBranch() → GraphCanvas initial render
```

**Parallel track (no phase dependency):** Mic Check Pattern + Human Consensus Pattern touch only Supabase Realtime broadcast and Zustand state — no LangGraph changes — and can be built concurrently with Layers 3–5.

---

## Critical Watch-Outs

All four v2.0 Critical pitfalls must be resolved before any agent node code is written. They affect the infrastructure that all agent work depends on.

### P9 — LangGraph `graph.stream()` + Hono `streamSSE` Composition

**Risk:** SSE connection opens but no events reach the browser; client hangs on LLM failure until function timeout.

**Prevention pattern:**
```typescript
app.post('/invoke', streamSSE(async (stream) => {
  const abortController = new AbortController();
  stream.onAbort(() => abortController.abort()); // wire abort
  try {
    const graphStream = await graph.astream(input, {  // astream() not stream()
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
    await stream.close(); // always close explicitly
  }
}));
```

**Rules:** Always `graph.astream()` (never `graph.stream()`) inside async Hono routes; always wire abort; always emit typed `error` event and close on exception; set `maxDuration = 300` explicitly in `vercel.json`. **Confidence: HIGH.**

---

### P10 — Langfuse Trace Drops in Serverless (Missing `waitUntil`)

**Risk:** Traces appear inconsistently in Langfuse dashboard; cost/latency data absent for completed runs.

**Prevention:**
```typescript
import { waitUntil } from '@vercel/functions';

// After stream loop completes, before SSE 'done' event:
waitUntil(langfuse.flushAsync()); // NOT await — lets Vercel keep instance alive for flush
await stream.writeSSE({ event: 'done', data: '{}' });
```

**Rules:** Create new `CallbackHandler` per-request (NOT module-level singleton — handler instances accumulate trace context and sharing corrupts traces); use `waitUntil` not `await`; set `flushAt: 1` in development for immediate trace visibility. **Confidence: HIGH.**

---

### P11 — Ajv `eval` / `new Function` Blocked in Vercel Edge Runtime

**Risk:** `EvalError: Code generation from strings disallowed` in deployment; Blueprint validation crashes entire request handler.

**Prevention:**
- All Blueprint validation runs in Hono on Node.js runtime — never in `middleware.ts` (edge by default)
- Add explicit runtime declaration in `vercel.json`:
  ```json
  { "functions": { "api/graph/**": { "runtime": "nodejs22.x" } } }
  ```
- Cache compiled validators: `Map<blueprintId, ValidateFunction>` — `ajv.compile()` runs once per Blueprint, never per-request (10–100ms per compile; <1ms per validate)

**Confidence: HIGH** — confirmed in Vercel GitHub discussion #47063.

---

### P12 — Postgres Checkpointer + Supabase Pooler: Prepared Statement Conflicts

**Risk:** `prepared statement "s0" already exists` errors; connection exhaustion under concurrent sessions.

**Root cause:** `@langchain/langgraph-checkpoint-postgres` uses prepared statements by default; Supabase's transaction-mode pooler (port 6543) does not support prepared statements across multiplexed connections.

**Prevention:**
```typescript
import postgres from 'postgres';
const sql = postgres(process.env.SUPABASE_DB_URL!, {
  prepare: false,   // disable prepared statements for pooler compatibility
  max: 5,           // keep pool small — Vercel has multiple function instances
});
// OR: use direct connection string (port 5432, bypasses pooler entirely)
const checkpointer = PostgresSaver.fromConnString(
  process.env.SUPABASE_DIRECT_URL!, // separate env var from anon-key URL
  { schema: 'langgraph' }           // separate schema to avoid namespace collisions
);
```

Set a separate `SUPABASE_DIRECT_URL` env var for the checkpointer. The existing `@supabase/supabase-js` client continues using its existing credentials. Run `checkpointer.setup()` once at module level (idempotent). **Confidence: HIGH.**

---

### P19 — Supabase Realtime Canvas: At-Most-Once Delivery

**Risk:** Client that disconnects briefly misses canvas mutations; canvas diverges between participants.

**Root cause:** Supabase Realtime `broadcast` is in-order but NOT guaranteed delivery. Unlike Postgres changes (which replay from WAL on reconnect), missed broadcasts are lost.

**Prevention:**
- After each LangGraph graph run completes, upsert a canonical canvas snapshot row per branch
- On Realtime `CLOSED → SUBSCRIBED` reconnect, fetch snapshot from DB and reconcile with local state
- Ghost-path mutations (0.5–0.85 confidence) use broadcast-only with no DB write — ephemeral by design, should disappear on reconnect

**Confidence: HIGH** — Supabase Realtime docs explicitly state broadcast is not guaranteed delivery.

---

### Additional High-Severity Pitfalls (by phase)

| Pitfall | Phase | Prevention Summary |
|---------|-------|--------------------|
| P13: Concurrent users same branch (thread contamination) | v2 Phase 2 | Mic Check Pattern makes concurrent graph runs impossible by design (Issue B); verify `@langchain/langgraph` ≥ fix for #2040 (Issue A) |
| P14: Zustand SSR singleton data leak | v2 Phase 3 | Use Zustand factory function + React context, not module-level `create(...)` |
| P15: Stale closures (Zustand + Realtime) | v2 Phase 3 | Include `branchId` in `useEffect` deps; `useShallow` for array selectors; callbacks as Zustand actions not inline handlers |
| P16: `interrupt()` incompatible with short-lived Vercel functions | v2 Phase 2 | Design Mic Check as two-request pattern; never put side effects before `interrupt()` in a node |
| P17: Graph compilation per-request memory leak | v2 Phase 1 | Compile `StateGraph` at module level (singleton) — confirmed thread-safe by LangGraph maintainers |
| P18: LangGraph checkpoint unbounded growth | v2 Phase 1 | Write `pg_cron` job to delete checkpoints for sessions closed > 7 days; keep LangGraph state minimal (IDs + scores, not full objects) |

---

## Open Questions

These are unresolved decisions that need phase-specific empirical verification or explicit design choices before the relevant layer is built.

**1. ReactFlow / `@xyflow/react` licensing**
The MIT license on `@xyflow/react@12.11.1` is confirmed sufficient for this use case per FEATURES.md. Verify license terms have not changed before starting Layer 9 (GraphCanvas component). The `@xyflow/react` team introduced the `Pro` subscription tier alongside the package rename; confirm MIT is still fully functional for interactive canvas (drag, zoom, custom nodes) without subscribing to Pro.

**2. LangGraph state compression placement**
State compression (summarize older messages into a compact summary node when `len(messages) > threshold`) is documented as a standard LangGraph pattern but the exact implementation is unresolved: where in the graph topology does it run (conditional node, inline in agent node, or as a post-agent step)? How does summarization avoid losing critical ontology context (the Hypothesis/Evidence/Action node references that were proposed in older turns)? This must be designed before Layer 1 (Types Package) because the state shape must accommodate it — even if compression itself is deferred to v2.1, the state type cannot be a breaking-change retrofit.

**3. Blueprint hot-reload / cache invalidation**
If a creator updates a Blueprint mid-session, two caches become stale: the Ajv compiled validator cache (keyed by `blueprintId`) and the module-level compiled LangGraph graph. For v2.0, restarting the session is an acceptable mitigation. Before public launch, a cache-busting mechanism using the Blueprint `version` field must be designed. The `domain_blueprints` table has a `version int` column already in the schema — the trigger for recompilation needs to be wired.

**4. Empirical confidence threshold calibration**
The 0.85/0.5 autonomy thresholds are design-intent values, not measured accuracy thresholds. RLHF training decouples LLM verbal confidence from actual epistemic state. After the first 10 production sessions, measure ghost promotion rate (what % of ghost nodes get confirmed vs rejected): high rejection rate means lower the direct-mutation threshold; zero ghosts means threshold is too high. Plan a threshold review checkpoint explicitly in the Phase 2 roadmap.

**5. Langfuse `CallbackHandler` compatibility with `graph.stream()` vs `graph.invoke()`**
FEATURES.md flags this: the callback handler is documented for `graph.invoke()` but the NSAI route uses `graph.astream()` (streaming mode). Verify empirically in Layer 5 that the `CallbackHandler` attaches correctly to streaming mode and that all node spans are captured (not just the final invoke result). If streaming mode requires different handler attachment, resolve before Layer 5 is considered complete.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack additions (package versions, peer deps) | HIGH | All packages npm-verified as of 2026-07-01; peer dep cross-checks completed |
| Feature table stakes | HIGH | All 8 table stakes grounded in official docs and production reports |
| Architecture build order | HIGH | Derived from strict dependency analysis; all integration points verified against official docs and live codebase |
| Critical pitfalls P9–P12, P19 | HIGH | Verified against GitHub issues, official docs, community production reports |
| Confidence thresholds (0.85/0.5) | MEDIUM | Design-intent values; empirical calibration required from production sessions |
| Langfuse graph-level tracing (unified view) | MEDIUM | Node-level tracing works correctly; unified graph view is on Langfuse roadmap but not yet available |
| `@opentelemetry/api` as thin peer dep | MEDIUM | Inferred from `@langfuse/tracing` architecture; no full OTel pipeline required but not deeply tested |
| LangGraph memory leak root cause (P17) | MEDIUM | GitHub issue documented but root cause not definitively confirmed; module-level singleton is the confirmed mitigation |

**Overall confidence: HIGH**

---

## Sources

### Primary (HIGH confidence)
- LangGraph JS official docs — graph construction, streaming modes, checkpointing, HITL patterns
- `@langchain/langgraph@1.4.7` npm — peer deps verified, Zod v4 compatible
- `@langchain/langgraph-checkpoint-postgres@1.0.4` npm — published 2026-06-25
- `@langfuse/langchain@5.9.1` npm — published 2026-06-30; `@langfuse/` vs `langfuse-langchain` peer dep analysis
- `@xyflow/react@12.11.1` npm — published 2026-06-22; React 19 peer dep satisfied
- Supabase connection modes: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase Realtime broadcast: https://supabase.com/docs/guides/realtime/broadcast
- Vercel function duration limits: https://vercel.com/docs/functions/configuring-functions/duration
- Anthropic prompt caching: https://www.anthropic.com/news/prompt-caching
- Ajv edge runtime: Vercel GitHub discussion #47063
- Zustand Next.js App Router guide: https://zustand.docs.pmnd.rs/guides/nextjs

### Secondary (MEDIUM confidence)
- Langfuse serverless flush pattern: https://langfuse.com/docs/langchain/typescript
- LangGraph memory leak: langchain-ai/langgraphjs#1746
- LangGraph AsyncLocalStorage contamination: langchain-ai/langgraphjs#2040
- LangGraph checkpoint unbounded growth: langchain-ai/langgraphjs#1138
- LLM confidence calibration: https://tianpan.co/blog/2026-04-20-llm-calibration-production-overconfidence
- Phase-gated LLM facilitation: https://www.researchgate.net/publication/379476302_An_Automated_Multi-Phase_Facilitation_Agent_Based_on_LLM

### Needs Empirical Validation
- Langfuse `CallbackHandler` compatibility with `graph.astream()` (streaming mode) vs `graph.invoke()` — verify in Layer 5
- `@xyflow/react@12.x` React 19 runtime compatibility — peer dep satisfied; verify in Layer 9

---

*Research completed: 2026-07-01*
*Ready for roadmap: yes*
