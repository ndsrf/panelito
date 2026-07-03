# Phase 7: /invoke Route Modification - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 5 modified files + 1 new file
**Analogs found:** 6 / 6

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/api/src/routes/ai.ts` | route/controller | streaming + request-response | self (current version) | self — surgical replacement of steps 8-9 |
| `apps/api/src/graph/nodes/agent.ts` | graph node | streaming + event-driven | `apps/api/src/graph/nodes/drift-reply.ts` | exact |
| `apps/api/src/graph/nodes/drift-reply.ts` | graph node | streaming + event-driven | `apps/api/src/graph/nodes/agent.ts` | exact |
| `apps/api/src/graph/nodes/orchestrator.ts` | graph node | event-driven | self (current version) | self — DOMAIN_BRIDGE extension |
| `apps/api/src/graph/state.ts` | schema/model | — | self (current version) | self — one new field added |
| `apps/api/src/lib/env.ts` | config | — | self (current version) | self — one new env var added |
| `.env.example` | config | — | self (current version) | self — one line added |
| `apps/api/src/routes/ai.test.ts` | test | request-response | `apps/api/src/routes/sessions.test.ts` | role-match |

---

## Pattern Assignments

### `apps/api/src/routes/ai.ts` (route, streaming)

**Analog:** self — current `apps/api/src/routes/ai.ts`

This file is not replaced wholesale. Steps 1-7 are preserved with a surgical expansion
of the session SELECT and the insertion of a blueprint gate + loadBlueprint call. Steps
8-9 (the direct `adapter.stream()` loop and `streamSSE` body) are completely replaced.

**Session SELECT expansion** — current lines 79-80 become:

```typescript
const { data: session, error: sessionErr } = await supabase
  .from('sessions')
  .select('id, creator_id, active_personas, blueprint_id, current_phase')  // D-03: added blueprint_id + current_phase
  .eq('id', sessionId)
  .single()
```

**Blueprint gate pattern** — insert after session null-check (after line 87), before cap check:

```typescript
// Step 1.5: Blueprint gate — V1 sessions without blueprint_id are rejected (D-01)
if (!session.blueprint_id) {
  return c.json({ error: 'no_blueprint' }, 400)
}
```

**loadBlueprint call pattern** — insert between step 7 (message fetch) and the SSE open; copy error
handling pattern from `apps/api/src/lib/blueprint-loader.ts` throw-based contract:

```typescript
// Step 7.5: Load Blueprint before opening SSE stream (D-04)
// MUST complete before return streamSSE(...) — errors here return JSON 500, not SSE error events.
// See RESEARCH.md Pitfall 1: opening SSE before blueprint load bricks error response.
let blueprint: Blueprint
try {
  blueprint = await loadBlueprint(session.blueprint_id)
} catch (err) {
  console.error('[ai] blueprint load failed:', (err as Error).message)
  return c.json({ error: 'blueprint_load_failed' }, 500)
}
```

**getCheckpointer pattern** — from `apps/api/src/lib/langgraph-checkpointer.ts` lines 51-76:

```typescript
// Step 8: Initialize PostgresSaver checkpointer (lazy singleton — safe to call per-request)
const checkpointer = await getCheckpointer()
const graph = createGraph(checkpointer)
```

**Async queue + streamWriter seam pattern** — core of the new `streamSSE` body (D-05, D-06):

```typescript
return streamSSE(c, async (stream) => {
  // --- Async queue backed by streamWriter ---
  const textChunks: string[] = []
  let _notify: (() => void) | null = null
  let graphDone = false

  function streamWriter(text: string): void {
    if (graphDone) return  // guard: no-op after graph completes (RESEARCH Pitfall 3)
    textChunks.push(text)
    _notify?.()
  }

  // --- graph.astream config (D-05, D-10, D-14, D-15) ---
  const callbackHandler = new CallbackHandler({
    tags: [`session:${sessionId}`, `branch:${activeBranchId ?? 'main'}`],
  })

  const graphConfig = {
    configurable: {
      thread_id: activeBranchId ?? sessionId,  // ORCH-05: thread_id = branch_id (RESEARCH Pitfall 5)
      blueprint,
      providerName,
      plaintextKey,
      activePersonas: activePersonas,  // D-10: passes active_personas as string[]
      streamWriter,                    // D-05: text token seam
    },
    callbacks: [callbackHandler],
    signal: c.req.raw.signal,          // D-14: abort propagation
  }

  const initialState = {
    blueprintId: session.blueprint_id,
    currentPhaseId: session.current_phase ?? blueprint.phase_sequence[0].id,  // BLUE-04
    messages: promptArray,
    canvasOps: [],
  }

  // --- SSE drain loop ---
  let accumulatedText = ''

  async function drainQueue(): Promise<void> {
    while (!graphDone || textChunks.length > 0) {
      while (textChunks.length > 0) {
        const text = textChunks.shift()!
        accumulatedText += text
        await stream.writeSSE({ event: 'text_delta', data: JSON.stringify({ text }) })
      }
      if (!graphDone) {
        await new Promise<void>((resolve) => { _notify = resolve })
        _notify = null
      }
    }
  }

  // --- graph execution loop ---
  let finalState: Record<string, unknown> = {}

  async function runGraph(): Promise<void> {
    try {
      for await (const chunk of graph.astream(initialState, graphConfig)) {
        // chunk is a partial state snapshot — text flows via streamWriter out-of-band
        Object.assign(finalState, chunk)
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // D-14: log disconnect to Langfuse (RESEARCH Pitfall 6)
        console.info('[ai] client_disconnected', { sessionId, branchId: activeBranchId })
        return
      }
      throw err
    } finally {
      graphDone = true
      _notify?.()  // wake drainQueue for final flush
    }
  }

  try {
    await Promise.all([runGraph(), drainQueue()])

    // --- Message insert (RESEARCH Pitfall 7: handle empty accumulatedText) ---
    if (!accumulatedText.trim() && (finalState as any)?.canvasOps?.length > 0) {
      accumulatedText = '[canvas updated]'  // minimal fallback for messages_content_check constraint
    }

    if (accumulatedText.length > 0) {
      const { data: row, error: insertError } = await supabase
        .from('messages')
        .insert({
          session_id: sessionId,
          author_id: session.creator_id,
          display_name: matchedPersonas[0]?.name ?? 'AI',
          parent_id: null,
          path_id: activePathId,
          branch_id: activeBranchId,
          role: 'assistant',
          content: accumulatedText,
          canvas_snapshot_state: null,  // Phase 7: null — canvas DB writes are Phase 8
        })
        .select()
        .single()

      if (insertError || !row) {
        console.error('[ai] message insert error', insertError)
      } else {
        supabase
          .channel(`session:${sessionId}`)
          .httpSend('new_message', row)
          .catch((err) => console.error('[ai] broadcast failed', err))
      }

      await incrementCount(supabase, sessionId)
    }

    // OBS-02: flush Langfuse traces before function exit
    await getLangfuseTracerProvider().forceFlush().catch((err) => {
      console.warn('[ai] Langfuse forceFlush error (non-fatal):', (err as Error).message)
    })

    await stream.writeSSE({ event: 'done', data: '{}' })
  } catch (err) {
    console.error('[ai] stream error:', (err as Error).message)
    // T-04-15: no provider-specific detail
    await stream.writeSSE({
      event: 'error',
      data: JSON.stringify({ message: 'stream_failed' }),
    })
  }
})
```

**Imports to add/replace at top of ai.ts** — copy import block pattern from current file (lines 24-35),
remove `renderPanelTool` and `PanelWidgetSchema`, add new imports:

```typescript
import { streamSSE } from 'hono/streaming'
import { createGraph } from '../graph/graph'
import { getCheckpointer } from '../lib/langgraph-checkpointer'
import { loadBlueprint } from '../lib/blueprint-loader'
import { getLangfuseTracerProvider } from '@langfuse/tracing'
import { CallbackHandler } from '@langfuse/langchain'
import type { Blueprint } from '@panelito/types'
// Remove: renderPanelTool, PanelWidgetSchema (v1 only — RESEARCH Pitfall 4)
// Remove: BASE_SYSTEM_PROMPT constant (replaced by buildAgentSystemPrompt in agent.ts)
```

---

### `apps/api/src/graph/nodes/agent.ts` (graph node, streaming)

**Analog:** `apps/api/src/graph/nodes/drift-reply.ts` (same adapter.stream loop pattern)

**streamWriter seam** — add to `text_delta` branch inside the `adapter.stream()` loop (D-05):

Current loop at lines 94-117 has no `text_delta` handling — the tool_use branch breaks early.
Add a `text_delta` branch BEFORE the `tool_use` branch:

```typescript
for await (const event of adapter.stream(state.messages, [canvasMutationTool], {
  model: 'claude-sonnet-4-6',
  maxTokens: 1024,
  system,
})) {
  if (event.type === 'text_delta') {
    // D-05: Phase 7 streamWriter seam — routes tokens to SSE via route's async queue
    config?.configurable?.streamWriter?.(event.text)
  } else if (event.type === 'tool_use' && event.name === 'canvas_mutation') {
    // ... existing tool_use handling unchanged ...
  }
}
```

**buildAgentSystemPrompt signature extension** — current signature at line 25:

```typescript
// BEFORE (Phase 6):
export function buildAgentSystemPrompt(blueprint: Blueprint, currentPhaseId: string): string

// AFTER (Phase 7) — D-10: accept optional activePersonaInstructions:
export function buildAgentSystemPrompt(
  blueprint: Blueprint,
  currentPhaseId: string,
  activePersonaInstructions?: string,  // NEW: appended after Blueprint phase instructions
): string {
  // ... existing node_types/edge_types/phase sections unchanged (lines 30-60) ...

  const rules = [
    // ... existing rules unchanged ...
    // D-08: ban canvas meta-commentary (append to existing rules array)
    '- NEVER describe your canvas operations in text. Do not say "I added a node", "I mapped this to",',
    '  "I connected", "I\'ve recorded", or describe what you did to the canvas.',
    // D-09: prefer silence
    '- Produce text output ONLY when the information cannot be fully represented in the canvas mutation.',
    '  If the canvas mutation fully captures the insight, produce NO text. Prefer silence.',
    '  When you do produce text, limit it to 1-2 sentences of substantive insight or implication.',
  ]

  const base = [ /* existing join */ ].join('\n')

  // D-10: append persona instructions after Blueprint phase instructions
  if (activePersonaInstructions) {
    return base + '\n\n' + rules.join('\n') + '\n\nPersona style:\n' + activePersonaInstructions
  }
  return base + '\n\n' + rules.join('\n')
}
```

**activePersonas consumption in agentNode** — add alongside existing configurable reads (lines 65-72):

```typescript
// After existing blueprint/providerName/plaintextKey reads:
const activePersonas = config?.configurable?.activePersonas as string[] | undefined
// Build persona instructions string for buildAgentSystemPrompt (D-10):
const personaInstructions = activePersonas?.join('\n') // route passes string[] of persona systemPromptAddition values

// Then pass to buildAgentSystemPrompt:
const system = buildAgentSystemPrompt(blueprint, state.currentPhaseId, personaInstructions)
```

**steeringTextEnabled consumption for DOMAIN_BRIDGE steering** — read from state (D-11, Open Question 2):

```typescript
// Read OrchestratorNode-set flag from state (D-11)
const steeringTextEnabled = (state as any).steeringTextEnabled as boolean | null | undefined
// When true AND AgentNode produces canvas mutation → also emit steering text via streamWriter
// Steering text: polite, never says "blueprint"/"domain"/"ontology" (D-12)
```

---

### `apps/api/src/graph/nodes/drift-reply.ts` (graph node, streaming)

**Analog:** `apps/api/src/graph/nodes/agent.ts` (same one-line seam pattern)

**streamWriter seam** — one-line change to the `text_delta` branch (D-05):

Current lines 57-60 are a comment block. Replace with:

```typescript
// BEFORE (Phase 6):
if (event.type === 'text_delta') {
  // Phase 6: events are collected but not streamed (no SSE context available in graph node)
  // Phase 7: Phase 7 route will consume these via adapter.stream() directly or callbacks
  // The text_delta events flow naturally — this loop exhausts the iterator
}

// AFTER (Phase 7):
if (event.type === 'text_delta') {
  // D-05: Phase 7 streamWriter seam — routes tokens to SSE via route's async queue
  config?.configurable?.streamWriter?.(event.text)
}
```

No other changes to `drift-reply.ts`. The one-line addition is the entire Phase 7 scope for this file.

---

### `apps/api/src/graph/nodes/orchestrator.ts` (graph node, event-driven)

**Analog:** self — current `apps/api/src/graph/nodes/orchestrator.ts`

**DOMAIN_BRIDGE probability roll** — extend the existing `DOMAIN_DRIFT` roll block (lines 144-157)
to also handle DOMAIN_BRIDGE with the same `blueprint.drift_reply_probability` pattern (D-11):

```typescript
// Existing DOMAIN_DRIFT block (lines 144-157) — preserved unchanged.

// NEW: DOMAIN_BRIDGE steering text probability roll (D-11)
// Same probability roll as DOMAIN_DRIFT, but steers instead of fully replying.
let steeringTextEnabled: boolean | null = null

if (guardrailResult === 'DOMAIN_BRIDGE') {
  const steeringProbability = blueprint.drift_reply_probability ?? 0.8
  const steeringRoll = Math.random()
  steeringTextEnabled = steeringRoll < steeringProbability

  console.info('[orchestrator] bridge steering event', {
    steering_probability: steeringProbability,
    steering_roll: steeringRoll,
    steering_enabled: steeringTextEnabled,
  })
}

return {
  guardrailResult,
  driftAction,
  currentPhaseId: resolvedPhaseId,
  steeringTextEnabled,  // NEW: consumed by AgentNode (D-11, Open Question 2)
}
```

Copy the existing `console.info('[orchestrator] drift event', {...})` pattern (line 152) for the
new DOMAIN_BRIDGE log — same structure, different prefix.

---

### `apps/api/src/graph/state.ts` (schema/model)

**Analog:** self — current `apps/api/src/graph/state.ts`

**steeringTextEnabled field** — add to GraphStateAnnotation after `agentOutput` (line 69), using
the same identity-reducer pattern as `guardrailResult`, `agentConfidence`, `driftAction`:

```typescript
// NEW in Phase 7 (D-11, Open Question 2)
/** Whether OrchestratorNode approved steering text on DOMAIN_BRIDGE.
 *  null = not a DOMAIN_BRIDGE path; true/false = probability roll result. */
steeringTextEnabled: Annotation<boolean | null>({
  reducer: (_: boolean | null, v: boolean | null) => v,
  default: () => null,
}),
```

Copy the reducer boilerplate exactly from `driftAction` (lines 63-65):

```typescript
driftAction: Annotation<'replied' | 'ignored' | null>({
  reducer: (_: 'replied' | 'ignored' | null, v: 'replied' | 'ignored' | null) => v,
  default: () => null,
}),
```

---

### `apps/api/src/lib/env.ts` (config)

**Analog:** self — current `apps/api/src/lib/env.ts`

**LANGFUSE_TRACE_LEVEL addition** — add to `EnvSchema` object (after line 39, before the closing `}`),
using the Zod `.enum().default()` pattern consistent with API_PORT's `.default('8787')` at line 33:

```typescript
// D-15: Langfuse trace detail level
// 'graph' (default): per-request CallbackHandler on graph.astream() only
// 'full': wrap entire route handler in a Langfuse parent span (debugging tool)
LANGFUSE_TRACE_LEVEL: z
  .enum(['graph', 'full'])
  .default('graph'),
```

The `env` export and `safeParse` validation pattern at lines 42-55 require no changes — the new
field gets validated automatically via the existing `EnvSchema.safeParse(process.env)` call.

---

### `.env.example` (config)

**Analog:** self — current `.env.example`

**Addition** — append after the `LANGFUSE_BASE_URL` line (line 47) in the Langfuse section:

```
# Langfuse trace detail level: 'graph' traces LangGraph execution only;
# 'full' also traces DB queries and route overhead (debugging tool).
LANGFUSE_TRACE_LEVEL=graph
```

---

### `apps/api/src/routes/ai.test.ts` (test, new file)

**Analog:** `apps/api/src/routes/sessions.test.ts`

**Test file structure** — copy imports and mounting pattern from sessions.test.ts (lines 1-27):

```typescript
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import aiRouter from './ai'

const app = new Hono()
app.route('/api/sessions', aiRouter)
```

**Mock injection pattern** — copy `createMockAdapter` factory from `apps/api/src/graph/graph.test.ts`
lines 27-44 (exact copy — it's already the established mock pattern):

```typescript
function createMockAdapter(events: AIStreamEvent[]): AIProvider {
  return {
    capabilities: () => ({ streaming: true, toolUse: true, /* ... */ }),
    async *stream(): AsyncIterable<AIStreamEvent> {
      for (const event of events) yield event
    },
  }
}
```

**Test SC-1: no_blueprint 400 gate** — Supabase mock returns session with `blueprint_id: null`:

```typescript
describe('POST /api/sessions/:id/invoke — no_blueprint gate (SC-1)', () => {
  it('returns 400 no_blueprint when session has no blueprint_id', async () => {
    // vi.mock supabase to return session without blueprint_id
    // call app.fetch() with valid JWT
    // assert response.status === 400 and body.error === 'no_blueprint'
  })
})
```

**Test SC-2: SSE delivers text_delta + done** — inject MemorySaver graph with mock adapters
via `config.configurable.agentAdapter` / `classifierAdapter` seam (established in Phase 6):

```typescript
describe('POST /api/sessions/:id/invoke — SSE stream (SC-2)', () => {
  it('delivers text_delta events and done event via SSE', async () => {
    // vi.mock supabase + blueprint-loader + langgraph-checkpointer
    // inject mock adapters via config.configurable
    // consume SSE response and assert text_delta + done event order
  })
})
```

**Test SC-3: abort signal** — verify signal is passed to graph config (at minimum):

```typescript
describe('POST /api/sessions/:id/invoke — abort propagation (SC-3)', () => {
  it('passes c.req.raw.signal to graph.astream config.signal', async () => {
    // spy on graph.astream to capture the config argument
    // assert config.signal is defined and is an AbortSignal
  })
})
```

---

## Shared Patterns

### Fail-Silent Error Handling
**Source:** `apps/api/src/graph/nodes/agent.ts` lines 118-121
**Apply to:** All graph nodes, route SSE catch block
```typescript
} catch (err) {
  console.error('[agent] adapter.stream error — returning no output', err)
  return {}
}
```
Use `[filename]` prefix convention for all error logs. Never throw from graph nodes — always return `{}` or a safe partial state.

### config.configurable Access Pattern
**Source:** `apps/api/src/graph/nodes/agent.ts` lines 65-72
**Apply to:** All graph nodes that add new configurable reads
```typescript
const blueprint = config?.configurable?.blueprint as Blueprint | undefined
const providerName = config?.configurable?.providerName as ProviderName | undefined
const plaintextKey = config?.configurable?.plaintextKey as string | undefined
```
Always use optional chaining + explicit `as Type | undefined` cast. Never destructure `config` directly.

### Test Injection Seam Pattern
**Source:** `apps/api/src/graph/nodes/agent.ts` lines 70-73
**Apply to:** Any new configurable field that tests need to override
```typescript
// Test injection seam: allows passing a deterministic mock adapter
const agentAdapter = config?.configurable?.agentAdapter as
  | import('@panelito/types').AIProvider
  | undefined
```

### Zod Env Var Addition
**Source:** `apps/api/src/lib/env.ts` lines 13-39
**Apply to:** LANGFUSE_TRACE_LEVEL addition
```typescript
// Pattern: add to EnvSchema object body; existing safeParse call validates automatically.
// Use .default() for optional vars; use .min(1) for required string vars.
FIELD_NAME: z.enum(['option1', 'option2']).default('option1'),
```

### LangGraph State Field Addition
**Source:** `apps/api/src/graph/state.ts` lines 51-65 (identity reducer pattern)
**Apply to:** `steeringTextEnabled` field
```typescript
fieldName: Annotation<ValueType | null>({
  reducer: (_: ValueType | null, v: ValueType | null) => v,
  default: () => null,
}),
```

### Supabase httpSend Broadcast
**Source:** `apps/api/src/routes/ai.ts` lines 268-272
**Apply to:** Message insert broadcast in modified route (preserved unchanged)
```typescript
supabase
  .channel(`session:${sessionId}`)
  .httpSend('new_message', row)
  .catch((err) => console.error('[ai] broadcast failed', err))
```

### Per-Request Langfuse CallbackHandler
**Source:** `apps/api/src/graph/graph.integration.test.ts` lines 22-26
**Apply to:** Route SSE body (only for real invocations, never early-exit paths per D-16)
```typescript
import { CallbackHandler } from '@langfuse/langchain'
import { getLangfuseTracerProvider } from '@langfuse/tracing'

// Inside streamSSE callback:
const callbackHandler = new CallbackHandler({
  tags: [`session:${sessionId}`, `branch:${activeBranchId ?? 'main'}`],
})
// After Promise.all:
await getLangfuseTracerProvider().forceFlush().catch((err) => {
  console.warn('[ai] Langfuse forceFlush error (non-fatal):', (err as Error).message)
})
```

---

## No Analog Found

No files in Phase 7 lack a close codebase analog. All patterns are grounded in Phase 6 deliverables.

The async queue + `Promise.all` coordination pattern (D-06) has no direct codebase analog because
Phase 6 did not implement SSE streaming from graph nodes. The reference pattern is documented in
RESEARCH.md §Pattern 1 (streamWriter seam) and §Pattern 2 (abort signal wiring). The planner
should use those RESEARCH.md patterns as the template for that specific section of `ai.ts`.

---

## Metadata

**Analog search scope:** `apps/api/src/routes/`, `apps/api/src/graph/`, `apps/api/src/graph/nodes/`, `apps/api/src/lib/`
**Files read:** `ai.ts`, `agent.ts`, `drift-reply.ts`, `orchestrator.ts`, `state.ts`, `graph.ts`, `env.ts`, `langgraph-checkpointer.ts`, `blueprint-loader.ts`, `langfuse-otel.ts`, `.env.example`, `sessions.test.ts`, `graph.test.ts`, `graph.integration.test.ts`
**Pattern extraction date:** 2026-07-03
