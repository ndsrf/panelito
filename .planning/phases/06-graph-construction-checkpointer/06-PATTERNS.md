# Phase 6: Graph Construction + Checkpointer - Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 13 new/modified files
**Analogs found:** 12 / 13

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/types/src/canvas-tool.ts` | utility (type def) | transform | `packages/types/src/ai.ts` (renderPanelTool) | exact |
| `packages/types/src/blueprint.ts` | model (schema) | transform | self (additive change) | self-modification |
| `packages/types/src/index.ts` | config (barrel) | — | self (additive change) | self-modification |
| `apps/api/src/graph/state.ts` | utility (state schema) | transform | `packages/types/src/canvas.ts` (Zod Annotation pattern) | role-match |
| `apps/api/src/graph/graph.ts` | service (factory) | event-driven | `apps/api/src/lib/adapter-factory.ts` | role-match |
| `apps/api/src/graph/nodes/orchestrator.ts` | service (node) | event-driven | `apps/api/src/lib/cap-guard.ts` | role-match |
| `apps/api/src/graph/nodes/agent.ts` | service (node) | streaming | `apps/api/src/routes/ai.ts` (stream loop) | role-match |
| `apps/api/src/graph/nodes/mutation-gate.ts` | service (node) | transform | `apps/api/src/lib/cap-guard.ts` (threshold logic) | role-match |
| `apps/api/src/graph/nodes/drift-reply.ts` | service (node) | streaming | `apps/api/src/routes/ai.ts` (stream loop) | role-match |
| `apps/api/src/lib/langgraph-checkpointer.ts` | service (singleton) | CRUD | `apps/api/src/lib/supabase.ts` (client singleton) | exact |
| `apps/api/src/lib/langfuse-otel.ts` | service (startup) | event-driven | `apps/api/src/lib/auto-freeze.ts` (startup init) | role-match |
| `apps/api/src/graph/graph.test.ts` | test (unit) | — | `apps/api/src/lib/ai-provider.test.ts` | exact |
| `apps/api/src/graph/graph.integration.test.ts` | test (integration) | CRUD | `apps/api/src/routes/sessions.test.ts` | exact |
| `supabase/migrations/0009_sessions_current_phase.sql` | migration | — | `supabase/migrations/0008_nsai_foundation.sql` | exact |

---

## Pattern Assignments

### `packages/types/src/canvas-tool.ts` (utility, transform)

**Analog:** `packages/types/src/ai.ts` — `renderPanelTool` constant

**Imports pattern** (lines 1–3 of ai.ts — the ProviderTool type is the only import needed):
```typescript
import type { ProviderTool } from './ai'
```

**Core pattern** — `renderPanelTool` definition (lines 94–236 of ai.ts). Copy the `ProviderTool` literal shape exactly:
```typescript
export const canvasMutationTool: ProviderTool = {
  name: 'canvas_mutation',
  description: '...',
  parameters: {
    type: 'object',
    // uses `parameters` key (not `input_schema`) — adapter converts internally
    // oneOf for discriminated op union: ADD_NODE | ADD_EDGE | NO_ACTION
    // each branch has required: ['op', ...fields] and includes confidence: number
  },
}
```

Key constraints from ai.ts line 43: the `parameters` key (not `input_schema`) is the provider-agnostic contract. Each adapter (`adapters/anthropic.ts` lines 51–57) converts it to `input_schema` at call time. Never use `input_schema` directly in the tool definition.

---

### `packages/types/src/blueprint.ts` (model, additive change)

**Analog:** self — additive field only

**Current `BlueprintSchema`** (lines 56–66 of blueprint.ts):
```typescript
export const BlueprintSchema = z.object({
  id: z.string(),
  name: z.string(),
  canvas_view_mode: z.enum(["graph", "chart"]),
  node_types: z.array(NodeTypeConfigSchema).min(1),
  edge_types: z.array(EdgeTypeConfigSchema).min(1),
  phase_sequence: z.array(PhaseSequenceSchema).min(1),
  active_persona_ids: z.array(z.string()),
  // ADD HERE (D-02):
  drift_reply_probability: z.number().min(0).max(1).default(0.8),
})
```

**Ajv schema parallel** — `blueprint-loader.ts` lines 21–83 also needs the new field added to `BLUEPRINT_JSON_SCHEMA.properties` and `required` array. The Ajv schema must mirror the Zod schema (defense-in-depth pattern established in blueprint-loader.ts line 143).

---

### `packages/types/src/index.ts` (barrel, additive)

**Analog:** self — additive export only

**Existing export pattern** (index.ts lines 42–50 — how ai.ts exports are structured):
```typescript
// Provider-agnostic AI interface + types (D-01, D-02, Phase 4)
export type {
  ProviderMessage,
  ProviderTool,
  ...
} from "./ai";
export { ProviderSchema, renderPanelTool } from "./ai";
```

Add to index.ts after the `renderPanelTool` export line:
```typescript
// Canvas mutation tool (Phase 6 — canvasMutationTool follows renderPanelTool pattern)
export { canvasMutationTool } from "./canvas-tool";
```

---

### `apps/api/src/graph/state.ts` (utility, transform)

**Analog:** `packages/types/src/canvas.ts` — Zod discriminated union + type inference pattern. Also: RESEARCH.md Pattern 1 (lines 251–287) which is verified against LangGraph 1.4.7.

**Core pattern** — use `Annotation.Root` (not Zod, not plain TypeScript):
```typescript
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

export type GraphState = typeof GraphStateAnnotation.State
```

CRITICAL: Do NOT use `MessagesAnnotation` — it only works with `BaseMessage[]`. `ProviderMessage` is a plain `{ role, content }` object and is incompatible (RESEARCH.md Pitfall 6).

---

### `apps/api/src/graph/graph.ts` (service/factory, event-driven)

**Analog:** `apps/api/src/lib/adapter-factory.ts` — factory function with switch/return pattern.

**Imports pattern** from adapter-factory.ts (lines 9–12):
```typescript
import type { AIProvider, ProviderName } from '@panelito/types'
import { AnthropicAdapter } from './adapters/anthropic'
// ...
```

**Core factory pattern** from adapter-factory.ts (lines 14–25):
```typescript
export function createAdapter(provider: ProviderName, apiKey: string): AIProvider {
  switch (provider) {
    case 'anthropic': return new AnthropicAdapter(apiKey)
    // ...
    default:
      throw new Error(`Unknown provider: ${provider satisfies never}`)
  }
}
```

Apply this single-export factory pattern to `createGraph`:
```typescript
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
    return state.driftAction === 'replied' ? 'driftReply' : 'end'
  }
  return 'agent'
}
```

The `checkpointer` param (defaulting to `MemorySaver`) is the test/prod swap mechanism (D-66 discretion). Tests pass `new MemorySaver()` explicitly; prod passes `await getCheckpointer()`.

---

### `apps/api/src/graph/nodes/orchestrator.ts` (service/node, event-driven)

**Analog:** `apps/api/src/lib/cap-guard.ts` — pure function that reads state, applies threshold logic, returns result.

**Function signature pattern** from cap-guard.ts (lines 33–54):
```typescript
export async function checkCap(
  supabase: SupabaseClient,
  sessionId: string
): Promise<CapCheckResult> {
  const { data: session, error } = await supabase
    .from('sessions')
    .select('ai_response_count, ai_response_cap')
    .eq('id', sessionId)
    .single()

  if (error || !session) {
    console.error('[cap-guard] checkCap read error:', error?.message)
    return { ok: true }
  }
  // threshold logic
}
```

Apply to OrchestratorNode — a LangGraph node is a `(state, config?) => Partial<State>` function:
```typescript
import type { RunnableConfig } from '@langchain/core/runnables'
import type { GraphState } from '../state'
import type { Blueprint } from '@panelito/types'
import { createAdapter } from '../../lib/adapter-factory'

export async function orchestratorNode(
  state: GraphState,
  config?: RunnableConfig
): Promise<Partial<GraphState>> {
  const blueprint = config?.configurable?.blueprint as Blueprint
  const driftProbability = blueprint.drift_reply_probability ?? 0.8

  // D-03: call AIProvider via createAdapter() for classification
  // D-03: roll Math.random() for drift probability
  // D-04: log drift_probability, drift_roll, drift_action to Langfuse span (via config.callbacks)

  const lastMessage = state.messages[state.messages.length - 1]
  // ... classify using adapter.stream() with a minimal classification prompt ...
  // returns: { guardrailResult, driftAction }
}
```

Key: nodes never call Anthropic SDK directly — always use `createAdapter()` from `apps/api/src/lib/adapter-factory.ts` (lines 14–25). The Langfuse `CallbackHandler` in `config.callbacks` captures all AIProvider calls automatically.

---

### `apps/api/src/graph/nodes/agent.ts` (service/node, streaming)

**Analog:** `apps/api/src/routes/ai.ts` lines 247–278 — the `adapter.stream()` loop with tool_use event handling.

**Core streaming pattern** from ai.ts (lines 247–278):
```typescript
for await (const event of adapter.stream(promptArray, [renderPanelTool], {
  model: TASK_MODELS[providerName].analysis,
  maxTokens: 2048,
  system: BASE_SYSTEM_PROMPT + '\n\n' + personaInstructions,
})) {
  if (event.type === 'text_delta') {
    // handle text
  } else if (event.type === 'tool_use' && event.name === 'render_panel') {
    const parsed = PanelWidgetSchema.safeParse(event.input)
    if (parsed.success) { /* use it */ }
    else { console.error('[render_panel] schema validation failed', parsed.error.flatten()) }
  }
}
```

Apply to AgentNode — but use `canvasMutationTool` and `CanvasOpSchema`:
```typescript
import { CanvasOpSchema } from '@panelito/types'
import { canvasMutationTool } from '@panelito/types'

export async function agentNode(
  state: GraphState,
  config?: RunnableConfig
): Promise<Partial<GraphState>> {
  const blueprint = config?.configurable?.blueprint as Blueprint
  const adapter = createAdapter(providerName, plaintextKey)  // from config.configurable

  let agentConfidence: number | null = null

  for await (const event of adapter.stream(state.messages, [canvasMutationTool], {
    model: 'claude-sonnet-4-6',
    maxTokens: 1024,
    system: buildAgentSystemPrompt(blueprint, state.currentPhaseId),
  })) {
    if (event.type === 'tool_use' && event.name === 'canvas_mutation') {
      const parsed = CanvasOpSchema.safeParse(event.input)
      if (parsed.success) {
        agentConfidence = 'confidence' in parsed.data ? parsed.data.confidence : null
        // return { agentOutput: parsed.data, agentConfidence }
      }
    }
  }
  // return state patch
}
```

Note: ai.ts line 185 creates adapter via `createAdapter(providerName, plaintextKey)` — AgentNode must receive the provider name and decrypted key via `config.configurable` (passed from the Phase 7 route, which already has this pattern).

---

### `apps/api/src/graph/nodes/mutation-gate.ts` (service/node, transform)

**Analog:** `apps/api/src/lib/cap-guard.ts` lines 97–120 — multi-threshold branching logic (warning/cap/null).

**Threshold pattern** from cap-guard.ts (lines 97–120):
```typescript
const warningThreshold = Math.ceil(0.9 * cap)
let thresholdCrossed: 'warning' | 'cap' | null = null

if (newCount >= cap) {
  thresholdCrossed = 'cap'
  // side effect
} else if (prevCount < warningThreshold && newCount >= warningThreshold) {
  thresholdCrossed = 'warning'
  // side effect
}
```

Apply the same pattern for MutationGateNode confidence thresholds (D-07/ORCH-04):
```typescript
export async function mutationGateNode(
  state: GraphState,
  config?: RunnableConfig
): Promise<Partial<GraphState>> {
  const blueprint = config?.configurable?.blueprint as Blueprint
  const confidence = state.agentConfidence ?? 0
  const agentOutput = state.agentOutput  // CanvasOp from AgentNode

  if (!agentOutput || agentOutput.op === 'NO_ACTION') {
    return {}  // silent — no canvasOps appended
  }

  // Post-validate Blueprint vocabulary (D-07)
  if (agentOutput.op === 'ADD_NODE') {
    const validNodeType = blueprint.node_types.some(n => n.id === agentOutput.node_type_id)
    if (!validNodeType) {
      console.error('[mutation-gate] invalid node_type_id:', agentOutput.node_type_id)
      return {}  // silent — vocabulary violation
    }
  }

  // Threshold routing (ORCH-04)
  let status: 'committed' | 'ghost'
  if (confidence > 0.85) {
    status = 'committed'
  } else if (confidence >= 0.5) {
    status = 'ghost'
  } else {
    return {}  // silent — below minimum confidence
  }

  const op = { ...agentOutput, status }
  return { canvasOps: [op] }  // reducer appends to existing list
}
```

---

### `apps/api/src/graph/nodes/drift-reply.ts` (service/node, streaming)

**Analog:** `apps/api/src/routes/ai.ts` lines 247–278 — minimal streaming loop, text_delta only.

Use the same `adapter.stream()` loop as AgentNode, but only collect `text_delta` events and emit no canvas ops. No tool use — pass `[]` as the tools array:

```typescript
export async function driftReplyNode(
  state: GraphState,
  config?: RunnableConfig
): Promise<Partial<GraphState>> {
  const adapter = createAdapter(providerName, plaintextKey)  // from config.configurable
  const lastMessage = state.messages[state.messages.length - 1]

  // Minimal system prompt (D-01): respond naturally, no rejection, no canvas
  const system = 'Respond naturally and helpfully to this message. Do not refuse or reject it.'

  for await (const event of adapter.stream(
    [lastMessage],
    [],  // no tools — pure conversational reply (D-01, HUMAN-03)
    { model: 'claude-sonnet-4-6', maxTokens: 512, system }
  )) {
    if (event.type === 'text_delta') {
      // Phase 7 will consume this via stream events from config.callbacks
      // For Phase 6 tests: collect text_delta events for assertion
    }
  }
  // No canvas ops — drift reply never mutates canvas (HUMAN-03)
  return { driftAction: 'replied' }
}
```

---

### `apps/api/src/lib/langgraph-checkpointer.ts` (service/singleton, CRUD)

**Analog:** `apps/api/src/lib/supabase.ts` — module-level `null` guard + factory function pattern.

**Singleton pattern** from supabase.ts (lines 17–26):
```typescript
export function createServiceClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
```

Supabase creates a new client per call; PostgresSaver needs a singleton because `setup()` should only run once. Pattern from cap-guard.ts (module-level state) combined with supabase.ts (env usage):

```typescript
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { env } from './env'

let _checkpointer: PostgresSaver | null = null

export async function getCheckpointer(): Promise<PostgresSaver> {
  if (!_checkpointer) {
    _checkpointer = PostgresSaver.fromConnString(env.SUPABASE_DIRECT_URL, {
      schema: 'langgraph',  // CRITICAL: must be 'langgraph', not 'public' (RESEARCH Pitfall 3)
    })
    await _checkpointer.setup()  // idempotent — checks checkpoint_migrations version
  }
  return _checkpointer
}
```

`env.SUPABASE_DIRECT_URL` is already validated in `apps/api/src/lib/env.ts` (lines 21–28) — no additional env work needed.

---

### `apps/api/src/lib/langfuse-otel.ts` (service/startup, event-driven)

**Analog:** `apps/api/src/lib/auto-freeze.ts` — startup function called once from `server.ts`.

**Startup function pattern** from auto-freeze.ts (lines 76–93):
```typescript
export async function startAutoFreezeTracker(supabase: SupabaseClient): Promise<void> {
  const { data: activeSessions, error } = await supabase
    .from('sessions')
    .select('id, creator_id')
    .eq('status', 'active')

  if (error) {
    console.error('[auto-freeze] Failed to load active sessions:', error.message)
    return
  }
  // ...
  console.log(`[auto-freeze] Tracking ${activeSessions?.length ?? 0} active sessions`)
}
```

**Server startup wiring** from server.ts (lines 1–18):
```typescript
import { serve } from "@hono/node-server"
import app from "./index"
import { env } from "./lib/env"
import { startAutoFreezeTracker } from "./lib/auto-freeze"

serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
  console.log(`[panelito/api] Standalone server listening on port ${info.port}`)

  startAutoFreezeTracker(createServiceClient()).catch((err) =>
    console.error("[panelito/api] auto-freeze tracker startup error:", err)
  )
})
```

Apply same pattern to `langfuse-otel.ts`:
```typescript
import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { setLangfuseTracerProvider } from '@langfuse/tracing'

let _langfuseSpanProcessor: LangfuseSpanProcessor | null = null

export function setupLangfuseOtel(): void {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    console.warn('[langfuse] credentials not set — tracing disabled')
    return
  }
  _langfuseSpanProcessor = new LangfuseSpanProcessor()
  const provider = new NodeTracerProvider({
    spanProcessors: [_langfuseSpanProcessor],
  })
  provider.register()
  setLangfuseTracerProvider(provider)
}

export function getLangfuseSpanProcessor() {
  return _langfuseSpanProcessor
}
```

And in `server.ts` — add `setupLangfuseOtel()` call alongside `startAutoFreezeTracker`.

---

### `apps/api/src/graph/graph.test.ts` (test/unit)

**Analog:** `apps/api/src/lib/ai-provider.test.ts` — mock-based unit test with vi.mock() and deterministic stub events.

**Mock pattern** from ai-provider.test.ts (lines 20–62):
```typescript
type EventCallback = (...args: unknown[]) => void

function createMockController(): MockStreamController {
  let resolveDone!: () => void
  const donePromise = new Promise<void>((r) => { resolveDone = r })
  // ...
}

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic { /* ... */ }
  return { default: MockAnthropic }
})
```

**Test structure** from ai-provider.test.ts (lines 68–109):
```typescript
describe('AnthropicAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ctrl = createMockController()
  })

  it('yields text_delta, tool_use, done events in order', async () => {
    const adapter = new AnthropicAdapter('test-api-key')
    const gen = adapter.stream(messages, [renderPanelTool], { model: '...', maxTokens: 2048 })
    const collectPromise = (async () => {
      const events: unknown[] = []
      for await (const event of gen) { events.push(event) }
      return events
    })()
    await new Promise((r) => setTimeout(r, 0))
    // trigger events, then assert
  })
})
```

For Phase 6 graph tests: create `createMockAdapter(events: AIStreamEvent[]): AIProvider` returning a deterministic async generator. The 5 stubs from D-11 must cover all graph paths. Use `new MemorySaver()` as the checkpointer — never call `getCheckpointer()` in unit tests.

---

### `apps/api/src/graph/graph.integration.test.ts` (test/integration, CRUD)

**Analog:** `apps/api/src/routes/sessions.test.ts` — real Supabase calls via `createServiceClient()`, `beforeAll`/`afterAll` setup, real network.

**Structure pattern** from sessions.test.ts (lines 1–69):
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServiceClient } from '../lib/supabase'

let testSessionId: string
const supabase = createServiceClient()

beforeAll(async () => {
  // seed test data
})

afterAll(async () => {
  // clean up test data
})

describe('POST /api/sessions', () => {
  it('creates a session ...', async () => {
    // real HTTP call via app.fetch()
  })
})
```

Apply to PostgresSaver integration test (D-12):
```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { getCheckpointer } from '../lib/langgraph-checkpointer'
import { createGraph } from './graph'
import { loadBlueprint } from '../lib/blueprint-loader'

describe('PostgresSaver integration (D-12)', () => {
  it('stores checkpoint and resumes on second invocation', async () => {
    const checkpointer = await getCheckpointer()
    const graph = createGraph(checkpointer)
    const blueprint = await loadBlueprint('debate-strategy-v1')
    const threadId = `test-${Date.now()}`
    // invoke twice, verify state accumulation
  })
})
```

---

### `supabase/migrations/0009_sessions_current_phase.sql` (migration)

**Analog:** `supabase/migrations/0008_nsai_foundation.sql` — SQL migration with comment header, `IF NOT EXISTS` guards, and `COMMENT ON COLUMN`.

**Migration header pattern** from 0008 (lines 1–22):
```sql
-- =============================================================================
-- Migration: 0008_nsai_foundation
-- Project:   Project Multiverse (Panelito)
-- Created:   2026-07-01
-- ...
-- =============================================================================
```

Apply to 0009:
```sql
-- Migration: 0009_sessions_current_phase
-- Adds current_phase column to sessions for BLUE-04 (phase-aware prompt mutation).
-- NULL default handles the existing dev session safely.
-- Phase 7 updates sessions.ts to initialize current_phase on session create.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS current_phase TEXT NULL DEFAULT NULL;

COMMENT ON COLUMN public.sessions.current_phase IS
  'Active Blueprint phase id (references blueprint.phase_sequence[].id). ' ||
  'NULL means use blueprint.phase_sequence[0].id as fallback. ' ||
  'Updated only by explicit human action.';
```

---

## Shared Patterns

### AIProvider Usage (via adapter-factory)
**Source:** `apps/api/src/lib/adapter-factory.ts` lines 14–25  
**Apply to:** `nodes/orchestrator.ts`, `nodes/agent.ts`, `nodes/drift-reply.ts`

All LLM calls inside graph nodes MUST go through `createAdapter(providerName, plaintextKey)` — never import Anthropic SDK directly. The provider name and decrypted key are passed via `config.configurable` (same pattern as how the route passes them today; Phase 7 will wire this). For Phase 6 tests, the mock AIProvider replaces this entirely.

### Error Handling / Fail-Silent Pattern
**Source:** `apps/api/src/lib/cap-guard.ts` lines 43–54, and `apps/api/src/routes/ai.ts` lines 273–276  
**Apply to:** `nodes/agent.ts`, `nodes/mutation-gate.ts`

```typescript
// From cap-guard.ts lines 43-46:
if (error || !session) {
  console.error('[cap-guard] checkCap read error:', error?.message)
  return { ok: true }  // fail-open
}

// From ai.ts lines 273-276:
const parsed = PanelWidgetSchema.safeParse(event.input)
if (parsed.success) { /* use it */ }
else {
  console.error('[render_panel] schema validation failed', parsed.error.flatten())
  // drop silently — do not throw
}
```

In MutationGateNode: use `CanvasOpSchema.safeParse()` on AgentNode output. On validation failure: log + return `{}` (no canvasOps appended). Never throw from a graph node for recoverable errors — let the graph engine handle retries.

### Singleton with Lazy Init
**Source:** `apps/api/src/lib/auto-freeze.ts` (module-level `trackerMap`) + `apps/api/src/lib/supabase.ts` (per-call factory)  
**Apply to:** `lib/langgraph-checkpointer.ts`

```typescript
// Pattern: module-level null guard + async init
let _checkpointer: PostgresSaver | null = null
export async function getCheckpointer() {
  if (!_checkpointer) { /* init */ }
  return _checkpointer
}
```

### Zod + Ajv Double-Validation
**Source:** `apps/api/src/lib/blueprint-loader.ts` lines 89–143  
**Apply to:** `apps/api/src/lib/blueprint-loader.ts` (modification for drift_reply_probability), `nodes/mutation-gate.ts` (canvas op validation)

```typescript
// blueprint-loader.ts lines 132-143:
const valid = blueprintValidator(data.definition)  // Ajv: structural shape
if (!valid) { throw new Error(...blueprintValidator.errors...) }
return BlueprintSchema.parse(data.definition)  // Zod: produces typed value
```

In MutationGateNode: use `CanvasOpSchema.safeParse()` (Zod) for type safety; use Blueprint array membership check (manual) for vocabulary validation (D-07).

### Module Imports — @panelito/types Alias
**Source:** All existing API files — `apps/api/src/routes/ai.ts` line 34, `apps/api/src/lib/blueprint-loader.ts` line 13  
**Apply to:** All new files in `apps/api/src/graph/`

```typescript
import { CanvasOpSchema, Blueprint, CanvasOp, ProviderMessage } from '@panelito/types'
import type { AIProvider, ProviderTool } from '@panelito/types'
```

Always use the `@panelito/types` workspace alias — never use relative imports (`../../packages/types/src/...`).

### Logging Convention
**Source:** `apps/api/src/lib/cap-guard.ts`, `apps/api/src/lib/auto-freeze.ts`, `apps/api/src/routes/ai.ts`  
**Apply to:** All graph nodes and lib files

```typescript
// Bracket prefix pattern: '[module-name] message'
console.error('[cap-guard] checkCap read error:', error?.message)
console.log('[auto-freeze] Tracking ${count} active sessions')
console.error('[ai] stream error:', (err as Error).message)
```

New files should use: `[orchestrator]`, `[agent]`, `[mutation-gate]`, `[drift-reply]`, `[langgraph-checkpointer]`, `[langfuse-otel]`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/api/src/graph/state.ts` (LangGraph Annotation API) | utility | transform | No LangGraph state files exist in the codebase yet — RESEARCH.md Pattern 1 is the reference (verified against `@langchain/langgraph@1.4.7` dist) |

All other files have structural analogs in the codebase. The LangGraph-specific APIs (`Annotation.Root`, `StateGraph`, `addConditionalEdges`, `PostgresSaver`) have no prior codebase usage — use RESEARCH.md Patterns 1–7 exclusively for those APIs.

---

## Metadata

**Analog search scope:** `apps/api/src/`, `packages/types/src/`, `supabase/migrations/`
**Files scanned:** 14 source files read in full
**Pattern extraction date:** 2026-07-02

**Key constraint reminders extracted from analogs:**
- `parameters` key (not `input_schema`) in ProviderTool — adapters convert internally (ai.ts line 43, anthropic.ts lines 51–57)
- Never import `@anthropic-ai/sdk` in graph nodes — only `createAdapter()` from adapter-factory.ts
- Langfuse module-level singleton is explicitly banned (REQUIREMENTS.md) — create `new CallbackHandler()` inside each graph invocation
- `schema: 'langgraph'` is mandatory in `PostgresSaver.fromConnString()` — default is `'public'` (RESEARCH Pitfall 3)
- `MemorySaver` in unit tests, `PostgresSaver` in integration tests and prod — never call `getCheckpointer()` in unit tests
