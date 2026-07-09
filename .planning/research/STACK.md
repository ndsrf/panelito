# Stack Research: Project Multiverse v3.0 — Proactive Bot Facilitation

**Domain:** Proactive bot engine additions to an existing LangGraph + Supabase + Anthropic collaborative workspace
**Research date:** 2026-07-09
**Milestone:** v3.0 Proactive Bot Facilitation

---

## Context: What Already Exists (Do Not Re-research)

All packages below are installed and running in production. They cover more of the v3.0 needs than the feature list initially implies.

| Package | Pinned Version | Location | v3.0 Coverage |
|---------|---------------|----------|---------------|
| `@langchain/langgraph` | 1.4.7 | `apps/api` | Graph orchestration, InMemoryStore, parallel nodes, deferred nodes |
| `@langchain/core` | (transitive) | `apps/api` | State types, message abstractions |
| `@langchain/langgraph-checkpoint-postgres` | 1.0.4 | `apps/api` | Per-branch state persistence |
| `@anthropic-ai/sdk` | 0.102.0 | both | Claude API calls, streaming |
| `@supabase/supabase-js` | 2.108.0 | both | Realtime pub/sub, DB, pg_cron integration |
| `@langfuse/langchain` | 5.9.1 | `apps/api` | Observability tracing |
| `zod` | 4.4.3 | both | Schema validation |
| `zustand` | 5.0.14 | `apps/web` | Frontend state |
| `hono` | 4.12.24 | `apps/api` | SSE streaming endpoint |
| `ajv` | 8.20.0 | `apps/api` | Blueprint validation |
| `@xyflow/react` | 12.11.1 | `apps/web` | Graph canvas |

Existing TASK_MODELS registry (`apps/api/src/lib/model-config.ts`) already has:
- `analysis` -> `claude-sonnet-4-6` (heavy, full-context reasoning)
- `classification` -> `claude-haiku-4-5-20251001` (light, low-token classifier)
- `compression` -> `claude-haiku-4-5-20251001`
- `categorization` -> `claude-haiku-4-5-20251001`

Existing persona system (`packages/types/src/persona.ts`) has one persona (`analista_cientifico`). The `PersonaConfig` schema with `systemPromptAddition` is already the right shape for v3.0 bot personalities. It just needs two more entries and the `PERSONA_IDS` tuple expanded.

---

## New Additions for v3.0

### 1. `@huggingface/transformers` -- Semantic Drift Detection Embeddings

**Package:** `@huggingface/transformers`
**Current version:** `4.2.0` (v4 released February 2026; v4 is the stable npm package, replacing the legacy `@xenova/transformers`)
**Install in:** `apps/api`
**Model to cache:** `Xenova/all-MiniLM-L6-v2` (384-dimensional, CPU-native, ~80MB on first load)

**Why this is needed:** The semantic drift trigger requires detecting when a conversation has shifted topic specifically when recent messages are not topically related to the Blueprint domain. The existing `DOMAIN_MATCH / DOMAIN_BRIDGE / DOMAIN_DRIFT` classification in the OrchestratorNode is reactive: it classifies one message after a human sends it. The proactive semantic drift trigger needs to compare a rolling window of recent messages against a Blueprint domain centroid *before* a human speaks. That comparison requires local embeddings + cosine distance, not a generative LLM call.

**Why not use the Claude/Anthropic API for this?** Running Haiku to classify drift for a background timer check on every active session every N seconds would consume API tokens continuously and incur cost even when no human is speaking. A local embedding model computes cosine distance at zero token cost, sub-millisecond latency once warmed, and is appropriate for scalar similarity scoring -- not language generation.

**Why `@huggingface/transformers` not `@xenova/transformers`:** `@xenova/transformers` is the legacy v2 package. v3 and v4 shipped under `@huggingface/transformers`. The v4 package on npm is the currently maintained package. Node.js server-side inference works out of the box via the bundled ONNX runtime (no GPU, no Python).

**Critical: singleton pipeline warm-up.** The model downloads ~80MB on first use and is cached in the filesystem. First inference takes ~3-5s on cold start; subsequent calls are fast (<30ms). Initialize the pipeline once at module load, not per-request:

```typescript
// apps/api/src/lib/embeddings.ts
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

let _pipe: FeatureExtractionPipeline | null = null

export async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!_pipe) {
    _pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q4' })
  }
  return _pipe
}

export async function embed(text: string): Promise<number[]> {
  const pipe = await getEmbedder()
  const output = await pipe(text, { pooling: 'mean', normalize: true })
  return Array.from(output.data as Float32Array)
}

// Vectors are pre-normalized by normalize:true, so dot product equals cosine similarity
export function cosineSimilarity(a: number[], b: number[]): number {
  return a.reduce((sum, v, i) => sum + v * b[i]!, 0)
}
```

**Vercel constraint:** The model file cache persists across warm invocations but is wiped on cold start unless `TRANSFORMERS_CACHE` points to a persistent volume. On Vercel, accept the ~3-5s cold start penalty for the silence-window checker. Since the silence window is measured in tens of seconds (30-120s), a 5s cold start does not affect trigger semantics.

**dtype: 'q4':** Use 4-bit quantization. Reduces model footprint to ~25MB and inference to ~10ms on CPU. Accuracy degradation is acceptable for cosine similarity at this scale.

**Install:**
```bash
pnpm add @huggingface/transformers
```

---

### 2. `node-cron` -- Evaluated and Rejected

**Why evaluated:** The silence-window trigger fires after N seconds of no human message in a branch. This requires a timer that persists within the same Hono server process.

**Why not `node-cron`:** `node-cron` adds a dependency for a pattern that is 5 lines of native Node.js. A plain `Map<string, NodeJS.Timeout>` keyed by `branchId` is the silence timer. On each new human message received (via Supabase Realtime subscription on the server): call `clearTimeout(timers.get(branchId))`, then call `timers.set(branchId, setTimeout(fireBotTrigger, SILENCE_WINDOW_MS))`. No package needed.

**Why not `pg_cron`:** `pg_cron` fires Postgres functions, not Hono route handlers, and has minute-level granularity. The silence window target is 45 seconds. Additionally, `pg_cron` + `pg_net` calling back into Vercel serverless would re-instantiate a cold function on each tick, losing the in-process timer map.

**Decision: no new package. Use native `setTimeout` + `Map`.**

---

## Existing Packages That Cover New v3.0 Needs (No New Install Required)

### LangGraph `InMemoryStore` -- Per-Session User Profiles

**Capability:** `InMemoryStore` from `@langchain/langgraph` (already installed at 1.4.7) provides a namespace-keyed key-value store that holds per-participant profile data: stated positions, key assertions, engagement pattern.

```typescript
import { InMemoryStore } from '@langchain/langgraph'

// Module-level singleton -- survives across requests in the same process
const profileStore = new InMemoryStore()

// Inside a bot node, read and update participant profile:
const namespace = [sessionId, participantId, 'profile']
await profileStore.put(namespace, 'state', {
  statedPositions: ['participant supports renewable energy'],
  assertionCount: 3,
  engagementPattern: 'frequent',
})
const entries = await profileStore.search(namespace)
```

**Limitation:** `InMemoryStore` is process-local -- lost on cold start. The v3.0 requirement is explicitly "in-memory, not persisted", so this is correct. If v4.0 needs persistence, upgrade to `PostgresStore` (the checkpoint package already ships a Postgres store adapter).

**Pattern for in-memory conversation graph:** Use the same `InMemoryStore` namespaced by `[sessionId, 'graph']`. Each entry is a node record with its edge relationships. No separate graph library is needed -- the canvas node UUIDs already form a graph in Supabase; the in-memory store indexes them by type and edge for fast bot context lookups within a session.

### LangGraph Parallel Nodes -- Multi-Bot Simultaneous Runs

**Capability:** LangGraph's `addEdge` fan-out from one node to multiple destination nodes creates a superstep where all destinations execute concurrently. This enables running Coach, Devil's Advocate, and Analyst bot nodes in parallel when multiple personas are active.

**Integration:** The existing graph topology `orchestrator -> agent` becomes `orchestrator -> [coachBot, advocateBot, analystBot]` via fan-out, with a `mergeBotOutputs` deferred node that collects all three outputs. Setting `defer: true` on the merge node ensures it only runs after all parallel bot nodes complete.

This is a topology change to the existing `@langchain/langgraph` graph -- zero new packages.

### Existing `TASK_MODELS` Registry -- Model Cost Routing

**What v3.0 needs:** Route graph reasoning and fact-check tasks to `claude-sonnet-4-6` (heavy); route facilitation moves and trigger classification to `claude-haiku-4-5-20251001` (light).

**What already exists:** The `TASK_MODELS` registry already covers `analysis` (Sonnet) and `classification` (Haiku). The only change is adding two new `TaskType` literals to the existing union type and populating their model entries:

```typescript
// apps/api/src/lib/model-config.ts -- additions only
export type TaskType =
  | 'analysis'        // existing -- graph reasoning, canvas mutation (Sonnet)
  | 'compression'     // existing -- history summarization (Haiku)
  | 'categorization'  // existing -- tag assignment (Haiku)
  | 'classification'  // existing -- domain guardrail (Haiku)
  | 'facilitation'    // NEW -- bot speech, facilitation moves (Haiku: fast, cheap)
  | 'fact_check'      // NEW -- fact-checking responses (Sonnet: same tier as analysis)
```

No new package. One file change.

### Existing `PERSONA_LIBRARY` -- Bot Personality System

**What already exists:** `packages/types/src/persona.ts` has a `PersonaConfig` type with `id`, `displayName`, `description`, `systemPromptAddition`, `icon`, and `active`. The `systemPromptAddition` field is the hook for distinct bot personalities. The existing `agentNode.ts` already reads `config.configurable.activePersonas` and appends persona instructions to the system prompt.

**What v3.0 needs:** Add two new persona entries (Coach, Devil's Advocate) and expand the `PERSONA_IDS` tuple:

```typescript
// packages/types/src/persona.ts -- PERSONA_IDS update only
export const PERSONA_IDS = [
  'analista_cientifico',  // existing Analyst/Fact-Checker
  'coach',                // NEW Coach persona
  'devils_advocate',      // NEW Devil's Advocate persona
] as const
```

Each persona's distinct character lives entirely in the `systemPromptAddition` string. The toggle API, graph config injection, and multi-persona concatenation infrastructure already handle multiple active personas.

**Trigger affinity per persona:** Coach fires on silence windows and phase signals; Devil's Advocate fires on fact-check and unlinked assertion triggers; Analyst fires on drift and moderation triggers. This affinity belongs in the trigger scheduler logic, not the persona definition schema.

No new package. One file change plus persona prompt content.

### Supabase Realtime -- Trigger Event Distribution

**What already exists:** Supabase Realtime `httpSend` broadcasts fire for every canvas update and message insert. The frontend subscribes to `session:{id}` channel events.

**What v3.0 needs:** A new channel event type `bot_trigger` that the silence timer emits to signal all clients that a bot intervention is happening. No new package -- just a new event name on the existing Supabase channel.

### Hono `streamSSE` -- Bot-Initiated Message Streaming

**What already exists:** The `POST /api/sessions/:id/invoke` route handles the full graph execution + SSE streaming + message insert + Realtime broadcast pipeline.

**What v3.0 needs:** A new Hono route `POST /api/sessions/:id/bot-trigger` (or reuse `/invoke` with a `triggerSource` body field distinguishing human vs. timer invocation). The route is structurally identical to `/invoke` -- same graph, same SSE pattern, same Supabase writes. The difference is that the silence timer calls this route internally instead of a human HTTP client calling it. No new package.

### `[canvas updated]` Artifact Fix -- No New Package

**Root cause:** In `apps/api/src/routes/ai.ts`, the existing fallback:
```typescript
if (!accumulatedText.trim() && (finalState as any)?.canvasOps?.length > 0) {
  accumulatedText = '[canvas updated]'  // minimal fallback for messages_content_check constraint
}
```
exists because the `messages` table has a Postgres CHECK constraint requiring `content` to be non-empty.

**Fix -- two parts, no new packages:**

1. Relax the `messages_content_check` Postgres CHECK constraint from `length(content) > 0` to `content IS NOT NULL`. This allows storing an empty string for canvas-only bot messages.

2. In the frontend chat renderer, skip rendering a message bubble when `role === 'assistant'` and `content.trim() === ''`. The canvas update already renders separately via the `canvas_update` SSE event; the empty message row is just the DB audit record.

This removes the `[canvas updated]` fallback entirely without any new library. The fix is one Supabase migration + one frontend conditional.

---

## What NOT to Add

| Package | Why Not |
|---------|---------|
| `node-cron` | Native `setTimeout` + `Map<branchId, NodeJS.Timeout>` is 5 lines of code; cron library is over-engineering for a simple debounce |
| `langchain` (monolithic) | Avoided in v2.0; still not needed -- all LLM calls go through the existing AIProvider abstraction |
| `@langchain/anthropic` | Not needed -- bot nodes call `createAdapter()` like all existing nodes |
| `openai` (for embeddings) | `text-embedding-3-small` would cost API tokens per drift check; local `@huggingface/transformers` is zero-cost per call |
| `pg_cron` for silence timer | Minute-level precision is too coarse for a 45-second silence window; in-process timer has no cold start problem |
| `BullMQ` / `Redis` | Job queue for three trigger types is overkill for a solo-dev product with a handful of concurrent sessions |
| `socket.io` | Already excluded from the project; Supabase Realtime covers pub/sub for trigger notifications |
| `@langchain/langgraph-sdk` | Installed transitively; using LangGraph Platform APIs would be incompatible with Vercel serverless deployment |
| `LangMem` / `@langgraphjs/toolkit` | External memory package for long-term summarization; `InMemoryStore` built into `@langchain/langgraph` satisfies the v3.0 in-memory-only requirement |
| Any graph database (Neo4j, etc.) | The in-memory conversation graph is a flat namespace store keyed by node UUID; the data structure already exists in `canvas_nodes` + `canvas_edges` Supabase tables |
| `D3.js` | Still unnecessary; xyflow handles graph layout; recharts handles analytics charts |

---

## Consolidated Install Command for v3.0

**`apps/api` -- one new package:**

```bash
pnpm add @huggingface/transformers
```

All other v3.0 features are code changes to existing files, not new package installs.

---

## Version Summary for v3.0

```json
{
  "apps/api additions": {
    "@huggingface/transformers": "4.2.0"
  },
  "apps/web additions": {},
  "devDependencies additions": {}
}
```

---

## Integration Points

| v3.0 Feature | Implementation | Package(s) |
|-------------|---------------|-----------|
| Silence-window timer | `Map<branchId, NodeJS.Timeout>` in-process; reset on each new human message via Supabase Realtime subscription on the server | Native Node.js |
| Semantic drift detection | `@huggingface/transformers` embedding pipeline; cosine similarity of rolling message window vs. Blueprint domain centroid | `@huggingface/transformers` (NEW) |
| Blueprint phase signal detection | Already in `agentNode.ts` -- `phase_signal` field emitted by LLM and read by the route; OrchestratorNode already reads `phase_sequence` | `@langchain/langgraph` (existing) |
| Bot personality system | Expand `PERSONA_IDS` + add 2 entries to `PERSONA_LIBRARY`; existing `systemPromptAddition` injection handles the rest | `@panelito/types` (code change only) |
| Model cost routing | Add `facilitation` and `fact_check` to `TASK_MODELS`; call them from new bot nodes | `apps/api/src/lib/model-config.ts` (code change only) |
| In-memory user profiles | `InMemoryStore` namespaced by `[sessionId, participantId, 'profile']` | `@langchain/langgraph` (existing) |
| Conversation graph context | `InMemoryStore` namespaced by `[sessionId, 'graph']`; entries keyed by canvas node UUID | `@langchain/langgraph` (existing) |
| Multi-bot parallel execution | LangGraph fan-out topology: `orchestrator -> [coachNode, advocateNode, analystNode] -> deferredMerge` | `@langchain/langgraph` (existing) |
| `[canvas updated]` removal | DB constraint relaxation (Supabase migration) + frontend renderer conditional | Postgres migration + React (no new packages) |
| Bot-initiated SSE stream | New Hono route `POST /api/sessions/:id/bot-trigger`; structurally identical to existing `/invoke` | `hono` (existing) |

---

## Confidence Levels

| Area | Confidence | Basis |
|------|-----------|-------|
| `@huggingface/transformers` 4.2.0 for server-side embeddings | HIGH | npm verified; v4 released Feb 2026; Node.js server-side inference confirmed in official HuggingFace docs |
| `all-MiniLM-L6-v2` + `dtype: 'q4'` for cosine similarity | HIGH | Community-confirmed for lightweight semantic similarity; pre-normalized vectors make dot product equal cosine similarity |
| `InMemoryStore` for per-session profiles | HIGH | LangGraph JS official docs confirm namespace-keyed storage; process-local matches v3.0 in-memory requirement |
| LangGraph fan-out for multi-bot parallel execution | HIGH | LangGraph JS docs confirm superstep parallel execution via `addEdge` fan-out; deferred node pattern confirmed |
| Native `setTimeout` map for silence window | HIGH | Standard Node.js pattern; zero dependency risk |
| TASK_MODELS extension for facilitation/fact_check | HIGH | Purely additive change to existing typed registry |
| PERSONA_LIBRARY expansion for Coach + Devil's Advocate | HIGH | Existing schema covers it; no structural change required |
| `[canvas updated]` fix via DB constraint relaxation | MEDIUM | Requires Supabase migration; standard Postgres DDL ALTER CONSTRAINT; risk is low but untested |
| Supabase pg_net as alternative silence timer (rejected) | MEDIUM | pg_cron + pg_net can POST to Vercel endpoints but minute-level precision and cold start loss of timer state make it unsuitable |
