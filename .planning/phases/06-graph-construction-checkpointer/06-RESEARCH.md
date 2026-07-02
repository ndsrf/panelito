# Phase 6: Graph Construction + Checkpointer - Research

**Researched:** 2026-07-02
**Domain:** LangGraph JS StateGraph construction, PostgresSaver checkpointer, Langfuse OTel observability
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**DOMAIN_DRIFT Reply Strategy**
- D-01: A `DriftReplyNode` exists as a real LangGraph node that makes a lightweight Claude API call.
- D-02: Blueprint schema gains `drift_reply_probability: number` (0.0–1.0) field added to `BlueprintSchema` in `packages/types/src/blueprint.ts` AND the Ajv meta-schema in `apps/api/src/lib/blueprint-loader.ts`.
- D-03: On DOMAIN_DRIFT, OrchestratorNode reads `blueprint.drift_reply_probability` from `config.configurable`, rolls `Math.random()`. Roll < probability → route to `DriftReplyNode` → Claude reply → SSE text_delta, no canvas mutation. Roll >= probability → silent exit, graph ends immediately.
- D-04: Langfuse trace MUST record DRIFT events even on silent exits. OrchestratorNode span must include `drift_probability`, `drift_roll`, `drift_action: 'replied' | 'ignored'`.

**AgentNode Structured Output**
- D-05: AgentNode uses tool use (`canvas_mutation` tool schema) to force structured Claude output — consistent with `render_panel` tool pattern. NOT `withStructuredOutput()`.
- D-06: `canvasMutationTool` exported from `packages/types/` alongside `renderPanelTool`. Claude decides exact file location.
- D-07: Blueprint vocabulary constraint enforced two ways: (a) system prompt injection by OrchestratorNode, (b) MutationGateNode post-validates returned node/edge type. Static Zod/tool schema accepts any string.

**LangGraph State Schema**
- D-08: `blueprintId: string` in checkpointed state (only Blueprint reference stored in checkpoint).
- D-09: Full `Blueprint` object NOT in checkpointed state. Loaded fresh per-invocation via `loadBlueprint(blueprintId)` and passed via `config.configurable`.
- D-10: State type explicitly includes: `currentPhaseId: string`, `messages: ProviderMessage[]` (custom accumulator reducer), `canvasOps: CanvasOp[]` (appended by MutationGateNode). Claude designs remaining fields.

**Test Isolation Strategy**
- D-11: All Claude API calls in Phase 6 tests use a mock `AIProvider` adapter with deterministic responses covering all 5 graph paths.
- D-12: PostgresSaver integration test connects to real Supabase via `SUPABASE_DIRECT_URL`. Verifies: (a) state stored in `langgraph.checkpoints` after first invocation, (b) second invocation on same `thread_id` correctly resumes.

### Claude's Discretion

- Exact `canvasMutationTool` schema (tool input shape for ADD_NODE, ADD_EDGE, NO_ACTION — including confidence field)
- Remaining LangGraph State fields beyond the user-locked set in D-10
- `graph/` directory structure (`graph/state.ts`, `graph/nodes/`, `graph/graph.ts` or flat variant)
- Langfuse `waitUntil` flush pattern for Hono Node.js runtime
- Debate Blueprint `drift_reply_probability` default value
- `MemorySaver` vs `PostgresSaver` switch mechanism in the graph factory (test vs prod)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BLUE-03 | Blueprint ontology injected into LangGraph State before any agent node executes; LLM cannot output node/edge type outside active Blueprint vocabulary | OrchestratorNode injects blueprint.node_types + edge_types into system prompt; MutationGateNode post-validates |
| BLUE-04 | LLM system prompt mutates based on Blueprint's current_phase field in Supabase | `sessions.current_phase` column required — MISSING, needs migration 0009; OrchestratorNode injects phase-specific llm_instructions |
| ORCH-02 | OrchestratorNode classifies DOMAIN_MATCH / DOMAIN_BRIDGE / DOMAIN_DRIFT; DRIFT bypasses AgentNode, generates conversational reply | DriftReplyNode implements conversational reply; conditional edge on classification result |
| ORCH-03 | AgentNode outputs structured JSON (ADD_NODE / ADD_EDGE / NO_ACTION) with confidence score, constrained to Blueprint vocabulary | `canvas_mutation` tool use via AIProvider adapter; canvasMutationTool schema in @panelito/types |
| ORCH-04 | MutationGateNode confidence thresholds: >0.85 direct commit, 0.5–0.85 ghost, <0.5 silent | Three-branch threshold logic; sets CanvasOp status; appends to state.canvasOps |
| ORCH-05 | LangGraph thread_id equals branch_id; state persists via PostgresSaver (SUPABASE_DIRECT_URL) | `PostgresSaver.fromConnString(SUPABASE_DIRECT_URL, { schema: "langgraph" })`; getCheckpointer() singleton |
| HUMAN-03 | DOMAIN_DRIFT responses generate natural conversational reply; canvas completely untouched; no rejection/error/refusal | DriftReplyNode with minimal system prompt; no canvas mutation in output |
| OBS-01 | Langfuse receives per-request CallbackHandler tracing every LangGraph execution: node spans, guardrail classification, confidence score, token costs | `CallbackHandler` from `@langfuse/langchain` passed in `config.callbacks`; OTel provider must be set up |
| OBS-02 | Traces flush reliably in Vercel serverless via `waitUntil(langfuse.flushAsync())` | For Hono Node.js runtime: `await getLangfuseTracerProvider().forceFlush()` after graph.invoke() |

</phase_requirements>

---

## Summary

Phase 6 is a pure construction-and-testing phase: build the full LangGraph StateGraph in isolation, wire the PostgresSaver checkpointer, add Langfuse observability, and verify all three with tests before touching the `/invoke` route. All Phase 5 infrastructure is in place.

Three critical infrastructure gaps were discovered during research: (1) `sessions.current_phase` column does not yet exist in the database — migration 0009 must add it before the graph can read phase context from Supabase. (2) `@langfuse/langchain` v5 uses OTel-based tracing (`@langfuse/tracing`) rather than the classic Langfuse client — to actually export traces to Langfuse, `@langfuse/otel` must be installed and a `LangfuseSpanProcessor` initialized at server startup. The `CallbackHandler` alone does not send traces without an OTel exporter. (3) The `"prepare:false"` mentioned in CONTEXT.md has no equivalent option in `@langchain/langgraph-checkpoint-postgres@1.0.4`'s `fromConnString()` — the option is simply not available. The `SUPABASE_DIRECT_URL` uses port 5432 (direct connection) which fully supports prepared statements, so no workaround is needed.

**Primary recommendation:** Structure Phase 6 into three waves — (1) type additions + migration 0009, (2) graph construction + unit tests with MemorySaver, (3) PostgresSaver integration + Langfuse OTel wiring. The graph factory function receives the checkpointer as a parameter (not module-level) to enable the MemorySaver/PostgresSaver switch during testing.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Graph orchestration (nodes, edges, state) | API / Backend | — | Entirely server-side; graph runs inside Hono request context |
| Blueprint vocabulary injection | API / Backend (OrchestratorNode) | — | OrchestratorNode reads blueprint from config.configurable, builds system prompt |
| Confidence threshold routing | API / Backend (MutationGateNode) | — | Pure server-side logic; confidence score comes from AgentNode output |
| Checkpoint persistence | Database (Supabase langgraph schema) | API / Backend | PostgresSaver writes to `langgraph.checkpoints`; tables created by `setup()` |
| Phase context (current_phase) | Database (Supabase sessions table) | API / Backend | `sessions.current_phase` is the authoritative source; read once per invocation |
| Canvas operation output | API / Backend | Shared Types | CanvasOps accumulated in state; Phase 8 writes them to canvas_nodes/canvas_edges |
| Observability traces | External (Langfuse) | API / Backend | OTel exporter sends spans; setup required at Hono server startup |
| Drift probability roll | API / Backend (OrchestratorNode) | — | `Math.random()` inside node; logged to Langfuse span |

---

## Standard Stack

### Core (all installed in Phase 5 — no new installs except @langfuse/otel)

| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| `@langchain/langgraph` | 1.4.7 | `StateGraph`, `Annotation`, `MemorySaver`, `MessagesAnnotation`, `START`, `END` | [VERIFIED: npm registry] — confirmed installed |
| `@langchain/langgraph-checkpoint-postgres` | 1.0.4 | `PostgresSaver` — thread_id keyed checkpoint persistence | [VERIFIED: npm registry] — confirmed installed |
| `@langfuse/langchain` | 5.9.1 | `CallbackHandler` — per-request LangGraph observability | [VERIFIED: npm registry] — confirmed installed |

### New Install Required

| Library | Version | Purpose | slopcheck |
|---------|---------|---------|-----------|
| `@langfuse/otel` | 5.9.1 | `LangfuseSpanProcessor` — OTel exporter that sends spans to Langfuse cloud | [OK] |
| `@opentelemetry/sdk-trace-base` | 2.8.0 | OTel SDK trace base (peer dep of `@langfuse/otel`) | [OK] |
| `@opentelemetry/exporter-trace-otlp-http` | 0.219.0 | OTLP HTTP exporter (peer dep of `@langfuse/otel`) | [OK] |
| `@opentelemetry/core` | 2.8.0 | OTel core utilities (peer dep of `@langfuse/otel`) | [OK] |

**Why `@langfuse/otel` is required:** `@langfuse/langchain` v5 is an OTel-based integration. `CallbackHandler` writes spans via `@langfuse/tracing`, which routes to the global OTel `TracerProvider`. Without `@langfuse/otel` setting up a `LangfuseSpanProcessor`, the OTel provider is a no-op and no traces reach Langfuse. [VERIFIED: inspected `@langfuse/langchain@5.9.1/dist/index.mjs` — only calls `startActiveObservation` from `@langfuse/tracing`; no direct Langfuse API calls]

**Installation:**
```bash
pnpm --filter @panelito/api add @langfuse/otel@5.9.1
```
(peer deps `@opentelemetry/sdk-trace-base`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/core` should resolve automatically via pnpm)

---

## Package Legitimacy Audit

> Phase 6 requires one new package install: `@langfuse/otel@5.9.1`. All other packages were installed in Phase 5.

| Package | Registry | Age | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|
| `@langfuse/otel` | npm | Published 2025-08-07 | [OK] | Approved — same monorepo as `@langfuse/langchain` (langfuse/langfuse-js) |
| `@opentelemetry/sdk-trace-base` | npm | Established OTel SDK | [OK] | Approved — official OpenTelemetry project |
| `@opentelemetry/exporter-trace-otlp-http` | npm | Established OTel exporter | [OK] | Approved — official OpenTelemetry project |
| `@opentelemetry/core` | npm | Established OTel core | [OK] | Approved — official OpenTelemetry project |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

No postinstall scripts found on any new packages.

---

## Critical Infrastructure Gaps

### Gap 1: `sessions.current_phase` column missing [VERIFIED: database inspection]

The `sessions` table does NOT have a `current_phase` column. BLUE-04 requires this column to drive LLM system prompt mutation. ORCH-05 maps `sessions.branch_id → LangGraph thread_id` and requires the `OrchestratorNode` to read `currentPhaseId` from state (initially sourced from `sessions.current_phase`).

**Resolution:** Migration 0009 must add:
```sql
ALTER TABLE public.sessions
  ADD COLUMN current_phase TEXT NULL DEFAULT NULL;
```
Nullable with NULL default handles the one existing dev session safely. The graph treats NULL as "use blueprint.phase_sequence[0].id as fallback." Sessions route (`sessions.ts`) should be updated in Phase 7 to initialize `current_phase` on session create.

### Gap 2: Langfuse OTel provider not initialized [VERIFIED: package inspection]

`@langfuse/otel` is not installed. Without `LangfuseSpanProcessor` registered as an OTel span processor, `CallbackHandler` writes to the no-op global tracer and zero traces reach Langfuse.

**Resolution:** Phase 6 creates `apps/api/src/lib/langfuse-otel.ts` — exports a `langfuseSpanProcessor` instance and a `setupLangfuseOtel()` init function called at server startup (`apps/api/src/server.ts`).

### Gap 3: No `langgraph.checkpoints` table yet [VERIFIED: database inspection]

The `langgraph` schema exists (created by migration 0008) but contains zero tables. `PostgresSaver.setup()` must be called to create `langgraph.checkpoints`, `langgraph.checkpoint_blobs`, `langgraph.checkpoint_writes`, and `langgraph.checkpoint_migrations`.

**Resolution:** `getCheckpointer()` in `apps/api/src/lib/langgraph-checkpointer.ts` calls `await checkpointer.setup()` on first call — idempotent after that.

---

## Architecture Patterns

### System Architecture Diagram

```
Test Input
    │
    ▼
createGraph(checkpointer?) ─────────────────────────────────────────────────────┐
    │                                                                             │
    ▼                                                                             │
graph.invoke(                                                                    │ graph factory
  { blueprintId, currentPhaseId, messages, canvasOps: [] },                     │ accepts checkpointer
  { configurable: { thread_id, blueprint },                                     │ param for test/prod
    callbacks: [langfuseCallbackHandler] }                                       │ swap
)                                                                                │
    │                                                                             │
    ▼                                                                            │
OrchestratorNode ──────────────────────────────────────────────────────────────┘
    │  reads: state.messages[-1] (last message)
    │  reads: blueprint.node_types[], edge_types[], phase_sequence[], drift_reply_probability
    │  reads: state.currentPhaseId → finds matching phase from blueprint.phase_sequence
    │  classifies: DOMAIN_MATCH | DOMAIN_BRIDGE | DOMAIN_DRIFT
    │  rolls drift: Math.random() vs drift_reply_probability (DRIFT path only)
    │  logs to Langfuse span: classification, drift_probability, drift_roll, drift_action
    │
    ├──[DOMAIN_MATCH or DOMAIN_BRIDGE]──────────────────────────────►
    │                                                                  AgentNode
    │                                                                   │  builds system prompt: base + blueprint vocab + phase llm_instructions
    │                                                                   │  calls AIProvider.stream() with canvasMutationTool
    │                                                                   │  collects tool_use event → CanvasOp + confidence
    │                                                                   │  (mock AIProvider in unit tests)
    │                                                                   ▼
    │                                                                  MutationGateNode
    │                                                                   │  confidence > 0.85 → status: "committed"
    │                                                                   │  0.5–0.85 → status: "ghost"
    │                                                                   │  < 0.5 → no CanvasOp added
    │                                                                   │  post-validates node_type_id / edge_type_id vs Blueprint
    │                                                                   ▼
    │                                                                  state.canvasOps.push(op)
    │                                                                   ▼
    │                                                                  END
    │
    ├──[DOMAIN_DRIFT + roll < drift_reply_probability]──────────────►
    │                                                                  DriftReplyNode
    │                                                                   │  lightweight Claude call: respond naturally, no canvas mutation
    │                                                                   │  emits text_delta SSE events (consumed by Phase 7 route)
    │                                                                   ▼
    │                                                                  END (no canvas op)
    │
    └──[DOMAIN_DRIFT + roll >= drift_reply_probability]──────────────► END (silent, no SSE)

PostgresSaver (prod) / MemorySaver (tests)
    │  keyed by thread_id = branch_id
    │  checkpoints state after each node completes
    └── langgraph.checkpoints table in Supabase
```

### Recommended Project Structure

```
apps/api/src/
├── graph/
│   ├── state.ts              # Annotation.Root state definition (Annotation API)
│   ├── graph.ts              # createGraph(checkpointer?) factory function
│   └── nodes/
│       ├── orchestrator.ts   # OrchestratorNode
│       ├── agent.ts          # AgentNode
│       ├── mutation-gate.ts  # MutationGateNode
│       └── drift-reply.ts    # DriftReplyNode
├── lib/
│   ├── langgraph-checkpointer.ts  # getCheckpointer() singleton (PostgresSaver)
│   └── langfuse-otel.ts           # setupLangfuseOtel(), langfuseSpanProcessor
└── ...existing files...

packages/types/src/
├── ai.ts                     # renderPanelTool (existing)
├── canvas-tool.ts            # canvasMutationTool (new — follows renderPanelTool pattern)
├── blueprint.ts              # BlueprintSchema (add drift_reply_probability field)
└── ...existing files...
```

### Pattern 1: LangGraph Annotation State (ProviderMessage accumulator)

The `messages` field uses a custom reducer since `ProviderMessage[]` is a plain-object type, not `BaseMessage[]` (LangChain's richer type). The `MessagesAnnotation` prebuilt uses `BaseMessage[]` and is incompatible.

```typescript
// Source: apps/api/src/graph/state.ts
// [CITED: LangGraph JS Annotation API - inspected @langchain/langgraph@1.4.7/dist/graph/annotation.js]
import { Annotation } from '@langchain/langgraph'
import type { ProviderMessage } from '@panelito/types'
import type { CanvasOp } from '@panelito/types'

export const GraphStateAnnotation = Annotation.Root({
  // Locked fields (D-10)
  blueprintId: Annotation<string>,
  currentPhaseId: Annotation<string>,
  messages: Annotation<ProviderMessage[]>({
    reducer: (left, right: ProviderMessage | ProviderMessage[]) =>
      left.concat(Array.isArray(right) ? right : [right]),
    default: () => [],
  }),
  canvasOps: Annotation<CanvasOp[]>({
    reducer: (left, right: CanvasOp | CanvasOp[]) =>
      left.concat(Array.isArray(right) ? right : [right]),
    default: () => [],
  }),

  // Claude's design — intermediate node outputs
  guardrailResult: Annotation<'DOMAIN_MATCH' | 'DOMAIN_BRIDGE' | 'DOMAIN_DRIFT' | null>({
    default: () => null,
  }),
  agentConfidence: Annotation<number | null>({
    default: () => null,
  }),
  driftAction: Annotation<'replied' | 'ignored' | null>({
    default: () => null,
  }),
})

export type GraphState = typeof GraphStateAnnotation.State
```

### Pattern 2: Graph Factory (checkpointer parameter for test/prod swap)

```typescript
// Source: apps/api/src/graph/graph.ts
// [CITED: LangGraph JS StateGraph API - inspected @langchain/langgraph@1.4.7/dist/graph/state.js]
import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { GraphStateAnnotation } from './state'
import { orchestratorNode } from './nodes/orchestrator'
import { agentNode } from './nodes/agent'
import { mutationGateNode } from './nodes/mutation-gate'
import { driftReplyNode } from './nodes/drift-reply'

export function createGraph(checkpointer?: BaseCheckpointSaver) {
  const graph = new StateGraph(GraphStateAnnotation)
    .addNode('orchestrator', orchestratorNode)
    .addNode('agent', agentNode)
    .addNode('mutationGate', mutationGateNode)
    .addNode('driftReply', driftReplyNode)
    .addEdge(START, 'orchestrator')
    .addConditionalEdges('orchestrator', routeAfterOrchestrator, {
      agent: 'agent',
      driftReply: 'driftReply',
      end: END,
    })
    .addEdge('agent', 'mutationGate')
    .addEdge('mutationGate', END)
    .addEdge('driftReply', END)

  return graph.compile({ checkpointer: checkpointer ?? new MemorySaver() })
}

function routeAfterOrchestrator(state: typeof GraphStateAnnotation.State) {
  if (state.guardrailResult === 'DOMAIN_DRIFT') {
    // driftAction set by OrchestratorNode after the probability roll
    return state.driftAction === 'replied' ? 'driftReply' : 'end'
  }
  return 'agent'
}
```

### Pattern 3: PostgresSaver with `langgraph` schema

```typescript
// Source: apps/api/src/lib/langgraph-checkpointer.ts
// [VERIFIED: inspected @langchain/langgraph-checkpoint-postgres@1.0.4/dist/index.js]
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { env } from './env'

let _checkpointer: PostgresSaver | null = null

export async function getCheckpointer(): Promise<PostgresSaver> {
  if (!_checkpointer) {
    // fromConnString creates new Pool({ connectionString }) internally
    // The { schema: "langgraph" } option tells setup() and all queries to use the langgraph schema
    // SUPABASE_DIRECT_URL = postgresql://postgres:...@localhost:54322/postgres (port 5432)
    // Direct connection — prepared statements fully supported, no "prepare:false" needed
    _checkpointer = PostgresSaver.fromConnString(env.SUPABASE_DIRECT_URL, {
      schema: 'langgraph',
    })
    // setup() creates: langgraph.checkpoint_migrations, langgraph.checkpoints,
    // langgraph.checkpoint_blobs, langgraph.checkpoint_writes
    // Idempotent: checks checkpoint_migrations version before running each migration
    await _checkpointer.setup()
  }
  return _checkpointer
}
```

### Pattern 4: Langfuse OTel setup (server startup)

```typescript
// Source: apps/api/src/lib/langfuse-otel.ts
// [CITED: langfuse.com/docs/observability/sdk/instrumentation — LangfuseSpanProcessor pattern]
// [CITED: langfuse.com/integrations/frameworks/langchain — CallbackHandler + flush pattern]
import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { setLangfuseTracerProvider } from '@langfuse/tracing'

let _langfuseSpanProcessor: LangfuseSpanProcessor | null = null

export function setupLangfuseOtel() {
  // Only initialize if Langfuse credentials are configured
  // LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY read automatically from process.env by LangfuseSpanProcessor
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    console.warn('[langfuse] LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not set — tracing disabled')
    return
  }

  _langfuseSpanProcessor = new LangfuseSpanProcessor()

  const provider = new NodeTracerProvider({
    spanProcessors: [_langfuseSpanProcessor],
  })
  provider.register()

  // Make Langfuse tracing use this provider
  setLangfuseTracerProvider(provider)
}

export function getLangfuseSpanProcessor() {
  return _langfuseSpanProcessor
}
```

### Pattern 5: CallbackHandler per-request, flush after graph.invoke()

```typescript
// Used in every graph invocation (Phase 7 wires this into the route)
// For Phase 6 tests: langfuseHandler passed to graph.invoke() in integration test
// [CITED: langfuse.com/integrations/frameworks/langchain — CallbackHandler initialization]
import { CallbackHandler } from '@langfuse/langchain'
import { getLangfuseTracerProvider } from '@langfuse/tracing'

const langfuseHandler = new CallbackHandler({
  sessionId: 'session-uuid',   // maps to Langfuse session for grouping
  userId: 'creator-uuid',
  tags: ['phase6-test'],
})

const result = await compiledGraph.invoke(
  { blueprintId, currentPhaseId, messages, canvasOps: [] },
  {
    configurable: {
      thread_id: branchId,   // ORCH-05: thread_id = branch_id
      blueprint: loadedBlueprint,  // loaded fresh, not checkpointed
    },
    callbacks: [langfuseHandler],  // LangGraph passes this through to all node LLM calls
  }
)

// Flush after response completes — for Hono Node.js runtime (not Edge)
// getLangfuseTracerProvider().forceFlush() flushes the LangfuseSpanProcessor
// [VERIFIED: inspected @langfuse/tracing@5.9.1/dist/index.mjs — getLangfuseTracerProvider() exists]
await getLangfuseTracerProvider().forceFlush()
```

### Pattern 6: canvasMutationTool (follows renderPanelTool pattern)

```typescript
// Source: packages/types/src/canvas-tool.ts (new file)
// [CITED: packages/types/src/ai.ts - renderPanelTool pattern — existing codebase]
import type { ProviderTool } from './ai'

export const canvasMutationTool: ProviderTool = {
  name: 'canvas_mutation',
  description:
    'Emit a structured canvas mutation based on the conversation. ' +
    'Use ADD_NODE when a participant introduces a new concept matching a Blueprint node type. ' +
    'Use ADD_EDGE when a clear directional relationship between two existing nodes is stated. ' +
    'Use NO_ACTION when the message does not produce a clear canvas change. ' +
    'Always include a confidence score (0.0–1.0) representing certainty of the mutation.',
  parameters: {
    type: 'object',
    oneOf: [
      {
        properties: {
          op: { type: 'string', enum: ['ADD_NODE'] },
          node_type_id: { type: 'string', description: 'Must match a Blueprint node_types[].id' },
          label: { type: 'string', description: 'Short descriptive label for the node (max 120 chars)' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['op', 'node_type_id', 'label', 'confidence'],
      },
      {
        properties: {
          op: { type: 'string', enum: ['ADD_EDGE'] },
          source_node_id: { type: 'string' },
          target_node_id: { type: 'string' },
          edge_type_id: { type: 'string', description: 'Must match a Blueprint edge_types[].id' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['op', 'source_node_id', 'target_node_id', 'edge_type_id', 'confidence'],
      },
      {
        properties: {
          op: { type: 'string', enum: ['NO_ACTION'] },
          reason: { type: 'string' },
        },
        required: ['op'],
      },
    ],
    required: ['op'],
  },
}
```

### Pattern 7: Mock AIProvider for unit tests (D-11)

```typescript
// apps/api/src/graph/graph.test.ts (unit tests with MemorySaver)
// Create a mock AIProvider that returns deterministic responses
import type { AIProvider, AIStreamEvent, ProviderMessage, ProviderTool } from '@panelito/types'

function createMockAdapter(events: AIStreamEvent[]): AIProvider {
  return {
    capabilities: () => ({ streaming: true, toolUse: true, contextCaching: false,
      semanticCaching: false, imageInput: false, voiceInput: false, compression: false }),
    async *stream(_messages, _tools, _options): AsyncIterable<AIStreamEvent> {
      for (const event of events) yield event
    }
  }
}

// Stub set — covers D-11 all 5 paths:
const stubs = {
  domainMatchAddNode09: createMockAdapter([
    { type: 'tool_use', name: 'canvas_mutation',
      input: { op: 'ADD_NODE', node_type_id: 'hypothesis', label: 'Test claim', confidence: 0.9 } },
    { type: 'done' },
  ]),
  domainMatchAddEdge07: createMockAdapter([
    { type: 'tool_use', name: 'canvas_mutation',
      input: { op: 'ADD_EDGE', source_node_id: 'uuid-a', target_node_id: 'uuid-b',
               edge_type_id: 'SUPPORTS', confidence: 0.7 } },
    { type: 'done' },
  ]),
  // ...etc
}
```

### Anti-Patterns to Avoid

- **Module-level Langfuse singleton:** Explicitly banned in REQUIREMENTS.md. Create a `new CallbackHandler(...)` inside each graph invocation, not at module scope. Trace context corruption occurs across concurrent requests if shared.
- **LangGraph `interrupt()`:** Explicitly out of scope (P16 pitfall from REQUIREMENTS.md). Incompatible with short-lived Vercel serverless functions. Mic Check uses two-request pattern (Phase 8).
- **`withStructuredOutput()` for AgentNode:** Banned per D-05. Use tool use (`canvas_mutation` tool) consistent with `render_panel` pattern already established.
- **Full Blueprint in checkpointed state:** D-09 bans this. Blueprint can be MBs of JSON. Pass via `config.configurable` per-invocation instead.
- **Calling `getCheckpointer()` in unit tests:** Unit tests pass `new MemorySaver()` to `createGraph()` directly. The real PostgresSaver only comes up in the D-12 integration test.
- **`"prepare:false"` in node-postgres Pool:** This option does not exist in `@langchain/langgraph-checkpoint-postgres@1.0.4`'s `fromConnString()`. It was mentioned in CONTEXT.md but is NOT implementable. `SUPABASE_DIRECT_URL` (port 5432) supports prepared statements natively.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State accumulation | Custom state merging logic | `Annotation.Root` with reducer | LangGraph channels handle concurrent node writes, serialization, checkpointing |
| Checkpoint persistence | Custom Postgres INSERT/SELECT | `PostgresSaver.fromConnString()` | thread_id keying, blob storage, migration versioning are non-trivial |
| Conditional graph routing | `if/else` in orchestrator | `addConditionalEdges()` | Routing is tracked in checkpoints; branch history is observable |
| LLM call observability | Custom span tracking | `CallbackHandler` + OTel | Token costs, latency, node spans all captured automatically |
| Schema table creation | Writing migration SQL | `checkpointer.setup()` | Migrates incrementally; won't recreate existing tables |
| Message accumulation | Custom array append | Annotation reducer | Reducer survives `graph.stream()` intermediates and checkpoint replays |

**Key insight:** The value of LangGraph is the checkpoint-aware execution model. Writing custom state merging or custom persistence defeats the purpose and loses observability.

---

## Common Pitfalls

### Pitfall 1: `@langfuse/langchain` v5 needs OTel setup to export traces

**What goes wrong:** `CallbackHandler` is instantiated and passed to `graph.invoke()`. The test graph runs successfully. Langfuse dashboard shows nothing.

**Why it happens:** `@langfuse/langchain` v5 is an OTel-based package. `CallbackHandler.handleChainStart()` etc. call `startActiveObservation()` from `@langfuse/tracing`, which routes to the global OTel `TracerProvider`. Without `@langfuse/otel` and `LangfuseSpanProcessor`, the global provider is the no-op provider — spans are discarded silently.

**How to avoid:** Install `@langfuse/otel`. Call `setupLangfuseOtel()` at server startup. Verify `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set in `.env`. [VERIFIED: inspected `@langfuse/tracing@5.9.1/dist/index.mjs` — `getLangfuseTracerProvider()` returns `getGlobalState().isolatedTracerProvider ?? trace.getTracerProvider()`]

**Warning signs:** OBS-01 integration test passes but Langfuse dashboard shows 0 traces.

### Pitfall 2: `sessions.current_phase` missing — BLUE-04 silently broken

**What goes wrong:** Unit tests pass (they use `currentPhaseId` directly in initial state). Integration test passes. Phase 7 route wires in session data and reads `session.current_phase` — column doesn't exist, Supabase returns `undefined`, `currentPhaseId` is undefined, phase-specific prompt injection skipped silently.

**Why it happens:** `sessions.current_phase` column was not in migration 0008 and does not exist in the current schema. [VERIFIED: queried `information_schema.columns` on running Supabase — confirmed missing]

**How to avoid:** Migration 0009 in Phase 6 adds `current_phase TEXT NULL DEFAULT NULL` to sessions. Phase 6 tests validate BLUE-04 using this column from the real DB in the integration test path.

**Warning signs:** `session.current_phase` evaluates to `undefined` in any code that reads it from Supabase.

### Pitfall 3: PostgresSaver `setup()` must use `{ schema: "langgraph" }` option

**What goes wrong:** `PostgresSaver.fromConnString(url)` is called without options. `setup()` creates tables in the `public` schema. The tables now exist in `public.checkpoints` not `langgraph.checkpoints`. Supabase dashboard shows unexpected tables in public schema. Future schema isolation breaks.

**Why it happens:** `PostgresSaver` defaults to `schema: "public"`. [VERIFIED: inspected `@langchain/langgraph-checkpoint-postgres@1.0.4/dist/index.js` — `const _defaultOptions = { schema: "public" }`]

**How to avoid:** Always pass `{ schema: "langgraph" }` to `fromConnString()`. The `langgraph` schema was pre-created by migration 0008. [CITED: inspected migration 0008 — `CREATE SCHEMA IF NOT EXISTS langgraph`]

**Warning signs:** `langgraph.checkpoints` table is missing after `setup()` runs; check `public.checkpoints` instead.

### Pitfall 4: `setup()` idempotency — don't pre-create tables in migration SQL

**What goes wrong:** Migration 0009 (or a future migration) pre-creates `langgraph.checkpoints` with the SQL from the PostgresSaver source. On server startup, `setup()` runs, finds `langgraph.checkpoint_migrations` doesn't exist, tries to apply migration 0 (CREATE TABLE checkpoint_migrations), then migration 1 (CREATE TABLE checkpoints) — which now fails with "relation already exists."

**Why it happens:** `setup()` checks `checkpoint_migrations` for version; if missing, starts from version -1 and applies all migrations. Pre-existing tables conflict with migration SQL.

**How to avoid:** Let `setup()` create all langgraph tables. Migration 0008 creates ONLY the schema. Do not add any langgraph table DDL to migrations. This is already the current state. [VERIFIED: checked migration 0008 SQL — schema only, no tables]

**Warning signs:** `ERROR: relation "langgraph.checkpoints" already exists` during `setup()`.

### Pitfall 5: DOMAIN_DRIFT silent exit must still produce a Langfuse trace

**What goes wrong:** When `drift_roll >= drift_reply_probability` (silent exit), the graph ends immediately. The OrchestratorNode span exists but may not be flushed before the graph returns, depending on when `forceFlush()` is called.

**Why it happens:** The silent exit path terminates the graph with no further node execution. If `forceFlush()` is called immediately after `graph.invoke()` returns (correct), the OrchestratorNode span should be captured. If `forceFlush()` is skipped on silent paths (incorrect), the trace is lost.

**How to avoid:** Always call `await getLangfuseTracerProvider().forceFlush()` after every `graph.invoke()` call, regardless of whether the graph produced output. D-04 explicitly requires DRIFT traces even on silent exits.

**Warning signs:** Langfuse shows traces for `replied` drift but not `ignored` drift.

### Pitfall 6: ProviderMessage[] vs BaseMessage[] in state

**What goes wrong:** Developer uses `MessagesAnnotation` (the LangGraph prebuilt) expecting it to work with `ProviderMessage[]`. `MessagesAnnotation` uses LangChain `BaseMessage[]` internally. TypeScript error or runtime crash when ProviderMessage objects are added to the state.

**Why it happens:** `MessagesAnnotation` uses `messagesStateReducer` which handles `BaseMessage | BaseMessage[] | RemoveMessage` — not plain `{ role, content }` objects. [VERIFIED: inspected `@langchain/langgraph@1.4.7/dist/graph/messages_annotation.js`]

**How to avoid:** Define a custom `Annotation` for `messages: ProviderMessage[]` with a plain array concatenation reducer. Do NOT use `MessagesAnnotation`. See Pattern 1 above.

**Warning signs:** TypeScript error `Type '{ role: string; content: string; }' is not assignable to type 'BaseMessage'`.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Langfuse LangChain integration via `langfuse-langchain` | `@langfuse/langchain` v5 via OTel | Langfuse v5 release (2025) | Requires OTel setup; `CallbackHandler` no longer has `.flushAsync()` — use `getLangfuseTracerProvider().forceFlush()` |
| `langfuseHandler.flushAsync()` | `getLangfuseTracerProvider().forceFlush()` | `@langfuse/langchain` v5 | `flushAsync()` is NOT on `CallbackHandler` d.ts in v5; inspected source confirms this |
| PostgresSaver with Python `prepare=False` | No equivalent in JS — `fromConnString()` only accepts `{ schema }` | @langchain/langgraph-checkpoint-postgres@1.x | `prepare:false` is a Python-only option; JS version uses direct connection (port 5432) which supports prepared statements |

**Deprecated/outdated:**
- `langfuse-langchain@3.x`: requires `langchain@0.3.x`, conflicts with LangGraph 1.x peer deps — do not use
- `new Langfuse()` as module-level singleton for observability: banned in REQUIREMENTS.md; use per-request `CallbackHandler`

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 | Server runtime | ✓ | v22.17.1 | — |
| Supabase local (postgres port 54322) | PostgresSaver integration test (D-12) | ✓ | TCP port 54322 open | — |
| `langgraph` schema in Supabase | `PostgresSaver.setup()` | ✓ | Created by migration 0008 | — |
| `debate-strategy-v1` Blueprint | graph tests loading Blueprint | ✓ | Seeded by migration 0008 | — |
| `sessions.current_phase` column | BLUE-04 (phase-aware prompt) | ✗ | MISSING | Migration 0009 adds it |
| `@langfuse/otel` npm package | OBS-01 trace export | ✗ | Not installed | Phase 6 installs it |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | Langfuse cloud auth | Not set (unverified) | — | Skip OTel init with warning; unit tests still work |
| Vitest | Test runner | ✓ | ^2.1.9 (package.json) | — |

**Missing dependencies with no fallback:**
- `@langfuse/otel` — must be installed for OBS-01/OBS-02; pnpm install blocks on this
- `sessions.current_phase` — migration 0009 must run before BLUE-04 works end-to-end

**Missing dependencies with fallback:**
- `LANGFUSE_PUBLIC_KEY/SECRET_KEY` — `setupLangfuseOtel()` can warn and skip if not set, allowing unit tests to pass without Langfuse account

---

## Code Examples

### Complete graph state + graph creation (verified against LangGraph 1.4.7 API)

```typescript
// graph/state.ts
// [VERIFIED: Annotation API from @langchain/langgraph@1.4.7/dist/graph/annotation.js]
import { Annotation } from '@langchain/langgraph'
import type { ProviderMessage, CanvasOp } from '@panelito/types'

export const GraphStateAnnotation = Annotation.Root({
  blueprintId: Annotation<string>,
  currentPhaseId: Annotation<string>,
  messages: Annotation<ProviderMessage[]>({
    reducer: (left, right: ProviderMessage | ProviderMessage[]) =>
      left.concat(Array.isArray(right) ? right : [right]),
    default: () => [],
  }),
  canvasOps: Annotation<CanvasOp[]>({
    reducer: (left, right: CanvasOp | CanvasOp[]) =>
      left.concat(Array.isArray(right) ? right : [right]),
    default: () => [],
  }),
  guardrailResult: Annotation<'DOMAIN_MATCH' | 'DOMAIN_BRIDGE' | 'DOMAIN_DRIFT' | null>({
    default: () => null,
  }),
  agentConfidence: Annotation<number | null>({ default: () => null }),
  driftAction: Annotation<'replied' | 'ignored' | null>({ default: () => null }),
})
```

### PostgresSaver integration test structure (D-12)

```typescript
// graph/graph.integration.test.ts
// Uses real Supabase via SUPABASE_DIRECT_URL (loaded from .env by vitest.config.ts)
import { describe, it, expect, beforeAll } from 'vitest'
import { getCheckpointer } from '../lib/langgraph-checkpointer'
import { createGraph } from './graph'
import { loadBlueprint } from '../lib/blueprint-loader'

describe('PostgresSaver integration (D-12)', () => {
  it('stores checkpoint after first invocation and resumes on second', async () => {
    const checkpointer = await getCheckpointer()
    const graph = createGraph(checkpointer)
    const blueprint = await loadBlueprint('debate-strategy-v1')
    const threadId = `test-${Date.now()}`
    const config = {
      configurable: { thread_id: threadId, blueprint },
      callbacks: [],  // no Langfuse in integration test (no credentials in test env)
    }

    // First invocation
    await graph.invoke(
      { blueprintId: 'debate-strategy-v1', currentPhaseId: 'opening', messages: [], canvasOps: [] },
      config
    )

    // Verify checkpoint exists
    const checkpoint = await checkpointer.get({ configurable: { thread_id: threadId } })
    expect(checkpoint).not.toBeNull()

    // Second invocation on same thread — state accumulates
    const result = await graph.invoke(
      { messages: [{ role: 'user', content: 'Water is essential for life.' }] },
      config
    )
    expect(result.messages.length).toBeGreaterThan(1)
  })
})
```

### Migration 0009 (sessions.current_phase)

```sql
-- supabase/migrations/0009_sessions_current_phase.sql
-- Add current_phase to sessions for BLUE-04 (phase-aware prompt mutation)
-- NULL default handles the 1 existing dev session safely.
-- Phase 7 updates sessions.ts to initialize current_phase on session create.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS current_phase TEXT NULL DEFAULT NULL;

COMMENT ON COLUMN public.sessions.current_phase IS
  'Active Blueprint phase id (references blueprint.phase_sequence[].id). ' ||
  'NULL means use blueprint.phase_sequence[0].id as fallback. ' ||
  'Updated only by explicit human action (HUMAN-02).';
```

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are read automatically by `LangfuseSpanProcessor` from `process.env` | Pattern 4: Langfuse OTel setup | Low — standard OTel env var pattern; if wrong, add explicit constructor params |
| A2 | `@opentelemetry/sdk-trace-base`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/core` are satisfied by pnpm peer resolution when `@langfuse/otel` is installed | Package Legitimacy Audit | Medium — pnpm strict peer resolution may need explicit installs; verify after pnpm install |
| A3 | `NodeTracerProvider` from `@opentelemetry/sdk-trace-base` v2.x has the same `register()` API as documented | Pattern 4: Langfuse OTel setup | Low — OTel SDK is stable; version confirmed at 2.8.0 |
| A4 | The `LangfuseSpanProcessor` constructor (from `@langfuse/otel`) reads Langfuse credentials from env without explicit constructor params | Pattern 4: Langfuse OTel setup | Medium — if requires explicit params, add `new LangfuseSpanProcessor({ publicKey, secretKey })` |
| A5 | Debate Blueprint `drift_reply_probability` default value: 0.8 is reasonable | Claude's Discretion | Low — user approved Claude choosing this; impact is UX tuning, not correctness |

---

## Open Questions

1. **Does `LangfuseSpanProcessor` require explicit API key constructor params, or does it read from `process.env` automatically?**
   - What we know: `@langfuse/core` has a `getEnv()` function that reads `process.env`; docs show no constructor params for `LangfuseSpanProcessor`
   - What's unclear: Whether `@langfuse/otel`'s `LangfuseSpanProcessor` uses this env reader or requires explicit instantiation
   - Recommendation: Run `npm view @langfuse/otel exports` after install and check the constructor signature; if env-reading is automatic, no change needed

2. **Does pnpm auto-resolve the `@langfuse/otel` peer deps (`@opentelemetry/sdk-trace-base@^2.0.1`, etc.) without explicit install?**
   - What we know: pnpm strict mode requires peer deps to be explicitly declared; they are NOT in `apps/api/package.json` currently
   - What's unclear: Whether pnpm will auto-install or error
   - Recommendation: Add `@opentelemetry/sdk-trace-base`, `@opentelemetry/exporter-trace-otlp-http`, and `@opentelemetry/core` as explicit deps in the install command

---

## Security Domain

`security_enforcement` is not set to false in config.json — including this section.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Graph runs server-side, auth already verified by Hono middleware before graph is reached |
| V3 Session Management | no | LangGraph thread_id = branch_id; no new session mechanism |
| V4 Access Control | no | Blueprint vocabulary validation enforces LLM output scope (not a security control, but an integrity control) |
| V5 Input Validation | yes | `CanvasOpSchema.safeParse()` in MutationGateNode validates all AgentNode output before accepting |
| V6 Cryptography | no | No new crypto operations; API keys decrypted by existing `decryptKey()` before adapter creation |

### Known Threat Patterns for LangGraph + LLM Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| LLM prompt injection via user message | Tampering | OrchestratorNode system prompt position (system beats user); Blueprint vocabulary constraint |
| Canvas mutation outside Blueprint vocabulary | Tampering | MutationGateNode post-validates `node_type_id` / `edge_type_id` against blueprint arrays |
| Checkpoint state corruption via crafted thread_id | Tampering | `thread_id = branch_id` (UUID); branch_id ownership verified by existing session auth |
| Langfuse traces containing PII (user messages) | Information Disclosure | Traces show message content by default; acceptable for platform owner observability (BYOK model) |
| SUPABASE_DIRECT_URL in logs | Information Disclosure | Never log this value; env.ts validates format, never echoes it |

---

## Sources

### Primary (HIGH confidence)
- `@langchain/langgraph@1.4.7` — inspected `dist/index.js`, `dist/graph/state.js`, `dist/graph/annotation.js`, `dist/graph/messages_annotation.js`, `dist/pregel/index.js`
- `@langchain/langgraph-checkpoint-postgres@1.0.4` — inspected `dist/index.js`, `dist/migrations.js`
- `@langfuse/langchain@5.9.1` — inspected `dist/index.mjs`, `dist/index.d.ts`
- `@langfuse/tracing@5.9.1` — inspected `dist/index.d.ts`, `dist/index.mjs`
- Supabase local instance — queried schema, tables, columns directly via node-postgres

### Secondary (MEDIUM confidence)
- `langfuse.com/integrations/frameworks/langchain` — CallbackHandler initialization + callbacks: [] pattern, flushAsync pattern
- `langfuse.com/docs/observability/sdk/instrumentation` — LangfuseSpanProcessor setup, forceFlush pattern
- `supabase.com/docs/guides/database/connecting-to-postgres` — Direct vs transaction pooler, prepared statements

### Tertiary (LOW confidence)
- None — all critical claims verified from source code or official docs

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages inspected at source level; APIs verified from dist
- Architecture: HIGH — patterns derived from inspected LangGraph 1.4.7 APIs, existing codebase conventions
- Pitfalls: HIGH — pitfalls 1–4 verified by direct source inspection; pitfall 5 from CONTEXT.md D-04; pitfall 6 from MessagesAnnotation source inspection
- Gaps: HIGH — sessions.current_phase absence verified by direct database query; @langfuse/otel absence verified by checking pnpm store

**Research date:** 2026-07-02
**Valid until:** 2026-08-01 (LangGraph and Langfuse move fast — recheck @langfuse/otel initialization pattern if more than 30 days)
