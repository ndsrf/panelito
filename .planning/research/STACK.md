# Stack Research: Project Multiverse v2.0 — NSAI Engine Additions

**Domain:** Neuro-Symbolic AI additions to an existing Next.js 15 + Hono + Supabase collaborative workspace
**Research date:** 2026-07-01
**Milestone:** v2.0 NSAI Engine

---

## Context: What Already Exists (Do Not Re-research)

The existing stack is validated and running:

| Package | Pinned Version | Location |
|---------|---------------|----------|
| `next` | 15.5.19 | `apps/web` |
| `hono` | 4.12.24 | `apps/api` + `apps/web` |
| `@supabase/supabase-js` | 2.108.0 | both |
| `@anthropic-ai/sdk` | 0.102.0 | both |
| `zod` | 4.4.3 | both |
| `zustand` | 5.0.14 | `apps/web` |
| `recharts` | 3.8.1 | `apps/web` |
| `framer-motion` | 12.40.0 | `apps/web` |
| `react` / `react-dom` | ^19.0.0 | `apps/web` |
| `openai` | ^6.44.0 | root + `apps/api` |
| `@google/genai` | ^2.8.0 | root + `apps/api` |

The project already has a multi-provider `AIProvider` abstraction (Anthropic, OpenAI, Gemini adapters).

---

## New Additions for v2.0

### 1. LangGraph JS — Agent Graph Orchestration

**Package:** `@langchain/langgraph`
**Current stable version:** `1.4.7` (published ~June 2026)
**Install in:** `apps/api`

**Why:** LangGraph is the only mature, production-ready stateful graph orchestration library for TypeScript agents. It provides `StateGraph`, typed state channels, conditional edges, and built-in checkpointing — exactly what the OrchestratorNode + domain-scoped Agent node architecture requires.

**Peer dependencies (must be installed explicitly in a monorepo):**

| Package | Required Version | Notes |
|---------|-----------------|-------|
| `@langchain/core` | `^1.1.48` | Peer dep of LangGraph; provides `BaseMessage`, `BaseChatModel`, RunnableInterface |
| `zod` | `^3.25.32 \|\| ^4.2.0` | Already satisfied by project's `zod@4.4.3` |

**Transitive dependencies (auto-installed):**

| Package | Version | Purpose |
|---------|---------|---------|
| `@langchain/langgraph-checkpoint` | `^1.1.3` | Base checkpointer interface; pulled by LangGraph automatically |
| `@langchain/langgraph-sdk` | `~1.9.25` | LangGraph SDK utilities; pulled automatically |

**Key design decision — AIProvider stays as-is:** LangGraph nodes are plain `async` functions. They call the existing `AIProvider` abstraction directly. There is no requirement to wrap `@anthropic-ai/sdk` in `ChatAnthropic` from `@langchain/anthropic`. This keeps the provider abstraction intact for v2 multi-provider support and avoids introducing `langchain` as a dependency.

```typescript
// LangGraph node calling existing AIProvider — no @langchain/anthropic needed
async function orchestratorNode(state: GraphState): Promise<Partial<GraphState>> {
  const response = await aiProvider.streamStructured(state.messages, state.blueprint);
  return { nodes: response.nodes, edges: response.edges };
}
```

**Vercel serverless compatibility:** LangGraph works on Vercel Node.js functions (not Edge). The graph executor runs in `apps/api` (Hono on Node.js runtime), so edge runtime is not a concern for graph execution. Set function timeout to 60+ seconds for long agent chains.

---

### 2. LangGraph Postgres Checkpointer — Persistent Graph State

**Package:** `@langchain/langgraph-checkpoint-postgres`
**Current stable version:** `1.0.4` (published June 25, 2026)
**Install in:** `apps/api`

**Why this over `MemorySaver`:** `MemorySaver` stores state in-process and is wiped on every cold start. Vercel serverless functions are ephemeral. Since `thread_id = branch_id`, graph state must persist across requests. `PostgresSaver` stores checkpoints in Supabase Postgres, survives cold starts, and enables time-travel debugging.

**Dependencies (must install alongside):**

| Package | Version | Purpose |
|---------|---------|---------|
| `pg` | `^8.12.0` | Node.js Postgres client (direct dependency of checkpoint package) |
| `@types/pg` | `^8.11.x` | TypeScript types for `pg` |

**Supabase connection string — use direct connection (port 5432), not transaction pooler:**

The Postgres checkpointer uses `pg.Pool` which expects long-lived connections and `LISTEN`/`NOTIFY` semantics. Supabase's transaction-mode pooler (port 6543) drops session state between transactions and is incompatible. Use the direct connection string (`db.[project-ref].supabase.co:5432`) or session-mode pooler as fallback for IPv4-only deployments.

```typescript
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const checkpointer = PostgresSaver.fromConnString(
  process.env.SUPABASE_DB_URL!, // direct connection, port 5432
  { schema: "public" }
);

// Call setup() ONCE on first deploy (creates checkpoint tables in Supabase)
await checkpointer.setup();

const graph = workflow.compile({ checkpointer });

// thread_id = existing branch_id from Supabase
const result = await graph.invoke(input, { configurable: { thread_id: branchId } });
```

**What `setup()` creates:** Two tables (`checkpoints` and `checkpoint_blobs`) plus indexes. These land in Supabase Postgres alongside existing tables — no schema conflicts with existing Realtime setup.

**Peer dependencies of `@langchain/langgraph-checkpoint-postgres`:**

| Package | Version | Satisfied by |
|---------|---------|-------------|
| `@langchain/core` | `^1.1.44` | Installed via LangGraph peer dep above |
| `@langchain/langgraph-checkpoint` | `^1.0.0` | Installed transitively by LangGraph |

---

### 3. Langfuse — LLM Observability

**Package:** `@langfuse/langchain`
**Current stable version:** `5.9.1` (published June 30, 2026 — updated daily)
**Install in:** `apps/api`

**Why `@langfuse/langchain` not `langfuse-langchain`:**
- `langfuse-langchain@3.x` has a hard peer dependency on `langchain >=0.0.157 <0.4.0` — the old monolithic `langchain` package. This is incompatible with `@langchain/langgraph@1.x` which uses the modular `@langchain/core@1.x` family.
- `@langfuse/langchain@5.x` peers on `@langchain/core >=0.3.8` (which covers 1.x) and is the current maintained package.
- `langfuse-langchain` is the legacy package; `@langfuse/langchain` is the active one.

**Dependencies (auto-installed with `@langfuse/langchain`):**

| Package | Auto-installed | Version |
|---------|---------------|---------|
| `@langfuse/core` | yes (dep) | `^5.9.1` |
| `@langfuse/tracing` | yes (dep) | `^5.9.1` |

**Peer dependencies (must install explicitly):**

| Package | Version | Notes |
|---------|---------|-------|
| `@opentelemetry/api` | `^1.9.0` | Required peer dep — `@langfuse/tracing` is OTel-based internally |

`@opentelemetry/api` is a thin instrumentation API package (no SDK, no exporter). It is safe to install without setting up a full OTel pipeline — Langfuse handles the exporting internally via `@langfuse/tracing`. Current version: `1.9.1`.

**Integration pattern:**

```typescript
import { CallbackHandler } from "@langfuse/langchain";

const langfuseHandler = new CallbackHandler({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL!, // https://cloud.langfuse.com
  sessionId: branchId,         // maps to conversation branch
  userId: sessionCreatorId,
  tags: ["v2.0", "nsai"],
});

// Pass to graph invocation
await graph.invoke(input, {
  configurable: { thread_id: branchId },
  callbacks: [langfuseHandler],
});
```

**What gets traced automatically:** Each LangGraph node invocation, token counts, latency per node, prompt content, and model outputs. LangGraph-specific tracing is currently in improvement — node calls appear as separate spans rather than a unified graph view, but cost and latency tracking work correctly.

**Required environment variables (add to `apps/api/.env`):**
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL` (default: `https://cloud.langfuse.com`)

---

### 4. Ajv — Blueprint JSON Schema Validation

**Package:** `ajv`
**Current stable version:** `8.20.0`
**Install in:** `apps/api` (Blueprint validation runs server-side before graph execution)

**Why Ajv:** Ajv is the fastest JSON Schema validator in the Node.js ecosystem, ships draft-07 and draft-2020-12 support, and produces structured error objects for actionable user feedback. Domain Blueprints are JSON documents loaded from Supabase at runtime and must be validated against a meta-schema before the graph compiles against them.

**Companion package:**

| Package | Version | Purpose |
|---------|---------|---------|
| `ajv-formats` | `3.0.1` | Adds `date-time`, `uri`, `email` format validators to Ajv v8 |

**Critical: Ajv does NOT run in Vercel Edge Runtime.** Ajv uses `new Function()` for code generation, which is forbidden in Edge Runtime. Blueprint validation runs in `apps/api` on Hono (Node.js runtime on Vercel), so this is not a concern. Never import Ajv in Next.js middleware or `edge` runtime routes.

**Integration pattern — validate Blueprint on load, compile validator once:**

```typescript
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// Compile the meta-schema validator once at module load
const validateBlueprint = ajv.compile(BLUEPRINT_META_SCHEMA);

// At runtime: validate Blueprint loaded from Supabase
function loadBlueprint(raw: unknown): Blueprint {
  const valid = validateBlueprint(raw);
  if (!valid) throw new BlueprintValidationError(validateBlueprint.errors!);
  return raw as Blueprint;
}
```

**Zod vs Ajv for this use case:** Zod is already used in the project for endpoint request/response validation. Use Ajv for Blueprint validation specifically because Blueprints are JSON Schema documents stored in Supabase (user-editable, runtime-loaded data). Zod is for compile-time TypeScript type validation; Ajv is for runtime validation of external data against portable JSON Schema — these are complementary roles, not competing.

---

### 5. Graph Canvas UI — Node/Edge Visualization

**Package:** `@xyflow/react`
**Current stable version:** `12.11.1` (released June 22, 2026)
**Install in:** `apps/web`

**Why `@xyflow/react` not `reactflow`:** `reactflow` is the legacy package name. The library was renamed to `@xyflow/react` in version 12. They are maintained by the same team but `@xyflow/react` is the active package receiving updates. Current version: `12.11.1`.

**Peer dependencies:** `react >=17`, `react-dom >=17` — both satisfied by `react@^19.0.0`.

**Critical Next.js 15 App Router integration requirement:** `@xyflow/react` relies on browser APIs (`ResizeObserver`, DOM measurement, `requestAnimationFrame`) that are unavailable in SSR. The graph canvas component **must** be:
1. Marked with `"use client"` at the top of the file
2. Loaded via `next/dynamic` with `{ ssr: false }` at the page level

```typescript
// apps/web/components/canvas/GraphCanvas.tsx
"use client";
import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
// ... component definition

// apps/web/app/(workspace)/page.tsx — App Router page
import dynamic from "next/dynamic";
const GraphCanvas = dynamic(
  () => import("@/components/canvas/GraphCanvas"),
  { ssr: false }
);
```

**State management integration:** Node and edge state lives in Zustand (already installed). `@xyflow/react` is controlled: pass `nodes`, `edges`, `onNodesChange`, and `onEdgesChange` from Zustand store. This enables Supabase Realtime mutations to flow directly into the graph canvas without React state duplication.

---

## Prompt Caching — No New Package Required

Prompt caching for the Anthropic `cache_control` feature is handled at the `@anthropic-ai/sdk` level (already installed at `0.102.0`). Apply `cache_control` headers directly in the `AIProvider` abstraction layer:

```typescript
// In the Anthropic adapter inside AIProvider
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-6",
  system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
  tools: [{ ...toolDef, cache_control: { type: "ephemeral" } }], // cache tool definitions
  messages: conversationHistory,
});
```

Do NOT install `langchain` (the monolithic `langchain` package) just for `anthropicPromptCachingMiddleware`. That middleware adds a full `langchain` dependency to get functionality already available natively in `@anthropic-ai/sdk`. Cache breakpoints on system message, tool definitions, and last user message are the correct pattern and are implemented directly.

For LangGraph state compression: implement by trimming `state.messages` to the last N turns before feeding them to the provider. This is a pure logic operation requiring no new package.

---

## Consolidated Install Commands

**`apps/api` additions:**

```bash
pnpm add @langchain/langgraph @langchain/core @langchain/langgraph-checkpoint-postgres pg @langfuse/langchain @opentelemetry/api ajv ajv-formats
pnpm add -D @types/pg
```

**`apps/web` additions:**

```bash
pnpm add @xyflow/react
```

---

## What NOT to Add

| Package | Why Not |
|---------|---------|
| `reactflow` | Legacy package name; replaced by `@xyflow/react` |
| `langchain` (monolithic) | Entire `langchain` package pulled in just for `anthropicPromptCachingMiddleware`; use `@anthropic-ai/sdk` cache_control directly |
| `langfuse-langchain` | Peers on old `langchain <0.4.0`; incompatible with `@langchain/langgraph@1.x` |
| `@langchain/anthropic` | Not needed — LangGraph nodes call AIProvider directly; adding this would create a parallel LangChain model wrapper alongside the existing abstraction |
| `@langchain/langgraph-sdk` | Installed transitively; do not add directly unless using LangGraph Cloud APIs |
| `@langchain/langgraph-checkpoint` | Installed transitively; included via `@langchain/langgraph` |
| `@opentelemetry/sdk-node` | Full OTel SDK is not needed; `@opentelemetry/api` (thin peer dep) is sufficient for Langfuse |
| `@skroyc/langgraph-supabase-checkpointer` | Community package; official `@langchain/langgraph-checkpoint-postgres` works with Supabase direct connection |
| `D3.js` | Still unnecessary; `@xyflow/react` handles graph layout; `recharts` handles analytics charts |
| `LangGraph Platform` | LangGraph Platform is a managed cloud service; explicitly not compatible with Vercel serverless. Use the open-source `@langchain/langgraph` library directly |

---

## Version Summary for v2.0

```json
{
  "apps/api additions": {
    "@langchain/langgraph": "1.4.7",
    "@langchain/core": "1.2.1",
    "@langchain/langgraph-checkpoint-postgres": "1.0.4",
    "pg": "8.22.0",
    "@langfuse/langchain": "5.9.1",
    "@opentelemetry/api": "1.9.1",
    "ajv": "8.20.0",
    "ajv-formats": "3.0.1"
  },
  "apps/web additions": {
    "@xyflow/react": "12.11.1"
  },
  "devDependencies (apps/api)": {
    "@types/pg": "8.11.x"
  }
}
```

---

## Integration Points with Existing Stack

| New Package | Integrates With | Integration Point |
|-------------|----------------|------------------|
| `@langchain/langgraph` | Hono `apps/api` | New Hono route `POST /api/graph/invoke` streams graph execution; existing streaming middleware reused |
| `@langchain/langgraph-checkpoint-postgres` | Supabase Postgres | Direct connection to same Postgres DB; checkpoint tables created alongside existing tables |
| `@langchain/langgraph` | `branch_id` | `thread_id = branch_id` — graph state is branch-scoped by design |
| `@langfuse/langchain` | Hono request context | `CallbackHandler` instantiated per request with `sessionId=branchId`; no global state |
| `ajv` | Supabase Postgres | Blueprint JSON loaded from `blueprints` table, validated before compilation |
| `@xyflow/react` | Zustand store | Nodes/edges live in Zustand; Supabase Realtime mutations update store; canvas reads from store |
| `@xyflow/react` | Recharts (existing) | Two separate view modes in the analytics panel: graph canvas (View A) vs. chart widgets (View B); toggled by Blueprint `view_mode` field |

---

## Confidence Levels

| Area | Confidence | Basis |
|------|-----------|-------|
| `@langchain/langgraph` 1.4.7 | HIGH | npm verified, peer deps checked, Zod v4 compatible |
| `@langchain/langgraph-checkpoint-postgres` 1.0.4 | HIGH | npm verified; published 6 days ago; uses pg ^8.x |
| Supabase direct connection for checkpointer | HIGH | Official Supabase docs confirm direct (port 5432) for persistent pools |
| `@langfuse/langchain` 5.9.1 vs `langfuse-langchain` | HIGH | Peer dep analysis confirms `langfuse-langchain` is incompatible with @langchain/core 1.x |
| `@xyflow/react` 12.11.1 | HIGH | Current package name confirmed; React 19 peer dep satisfied |
| Ajv edge runtime limitation | HIGH | Confirmed in GitHub discussion + Ajv docs; not a concern for Hono/Node.js runtime |
| Langfuse node-level tracing (not graph view) | MEDIUM | Known limitation; node calls traced as separate spans; Langfuse team working on graph view |
| `@opentelemetry/api` as thin peer dep (no full SDK needed) | MEDIUM | Inferred from `@langfuse/tracing` architecture; no full OTel pipeline required |
| LangGraph on Vercel serverless (not Platform) | HIGH | Confirmed; use Node.js function runtime, not Edge; set 60s timeout |
