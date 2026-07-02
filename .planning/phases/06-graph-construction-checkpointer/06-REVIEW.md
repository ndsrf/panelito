---
phase: 06-graph-construction-checkpointer
reviewed: 2026-07-02T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - packages/types/src/canvas-tool.ts
  - packages/types/src/canvas-tool.test.ts
  - packages/types/src/index.ts
  - packages/types/src/blueprint.ts
  - apps/api/src/lib/blueprint-loader.ts
  - apps/api/src/lib/blueprint-loader.test.ts
  - apps/api/src/lib/langgraph-checkpointer.ts
  - apps/api/src/lib/langfuse-otel.ts
  - apps/api/src/graph/state.ts
  - apps/api/src/graph/nodes/orchestrator.ts
  - apps/api/src/graph/nodes/agent.ts
  - apps/api/src/graph/nodes/mutation-gate.ts
  - apps/api/src/graph/nodes/drift-reply.ts
  - apps/api/src/graph/graph.ts
  - apps/api/src/graph/graph.test.ts
  - apps/api/src/graph/graph.integration.test.ts
  - apps/api/src/server.ts
  - apps/api/vitest.config.ts
  - supabase/migrations/0009_sessions_current_phase.sql
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-07-02
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Phase 6 implements a complete LangGraph StateGraph (orchestrator → agent/driftReply → mutationGate) with PostgresSaver checkpointing and Langfuse OTel observability. The overall structure is sound, the node-seam test injection pattern is clean, and the blueprint vocabulary validation in MutationGateNode is correctly applied. However, two critical issues require fixes before this code ships: a type-system lie in MutationGateNode that silently writes a `status` field that CanvasOp consumers will not see, and a tool schema structure that lacks a top-level `properties` object that the Anthropic API requires. Six warnings cover a concurrency race on the checkpointer singleton, a misleading `driftAction` return value, and a test that can never fail.

---

## Critical Issues

### CR-01: `canvasMutationTool` schema has no top-level `properties` — Anthropic API may reject the tool at runtime

**File:** `packages/types/src/canvas-tool.ts:29-97`

**Issue:** The `parameters` object has the shape `{ type: 'object', oneOf: [...], required: ['op'] }` — no top-level `properties` key. When `AnthropicAdapter` converts this to `input_schema` (by spreading `t.parameters` into `{ type: 'object', ...t.parameters }`), the resulting schema sent to the Anthropic API is `{ type: 'object', oneOf: [...], required: ['op'] }`.

The Anthropic tool-use specification requires `input_schema` to be a valid JSON Schema object with at minimum a `properties` dictionary at the top level. A schema with `oneOf` but no `properties` at root level is non-standard for Anthropic tool schemas, and the API may silently return an error or ignore the tool. Because `agentNode` wraps the adapter call in a try/catch that logs and returns `{}` on failure, this failure mode is silent — `agentOutput` is always null, MutationGateNode short-circuits immediately, and no canvas ops are ever produced. Unit tests use mock adapters that bypass the Anthropic API entirely, so this cannot be caught by the current test suite.

The schema is also missing `additionalProperties: false` on each `oneOf` branch, which means the Claude model is not told that extra fields are prohibited in each branch — this weakens schema enforcement even if the API accepts it.

**Fix:** Restructure `parameters` to use a flat `properties` object at the top level with discriminator-based descriptions, matching Anthropic's documented format. If a discriminated union is essential, flatten the union into a single `properties` block and note which fields are op-conditional in descriptions:

```typescript
parameters: {
  type: 'object',
  properties: {
    op: {
      type: 'string',
      enum: ['ADD_NODE', 'ADD_EDGE', 'NO_ACTION'],
      description: 'The canvas operation type.',
    },
    node_type_id: {
      type: 'string',
      description: 'Required for ADD_NODE. Must match a Blueprint node_types[].id.',
    },
    label: {
      type: 'string',
      description: 'Required for ADD_NODE. Short descriptive label (max 120 chars).',
    },
    source_node_id: {
      type: 'string',
      description: 'Required for ADD_EDGE. UUID of the source canvas node.',
    },
    target_node_id: {
      type: 'string',
      description: 'Required for ADD_EDGE. UUID of the target canvas node.',
    },
    edge_type_id: {
      type: 'string',
      description: 'Required for ADD_EDGE. Must match a Blueprint edge_types[].id.',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Required for ADD_NODE/ADD_EDGE. Certainty 0.0–1.0.',
    },
    reason: {
      type: 'string',
      description: 'Optional. For NO_ACTION: why no canvas change was made.',
    },
  },
  required: ['op'],
},
```

`CanvasOpSchema.safeParse` in `agentNode` handles the runtime validation; the tool schema's job is only to guide the model.

---

### CR-02: `mutationGateNode` appends `status` to `CanvasOp` but casts away the type — downstream consumers cannot read it

**File:** `apps/api/src/graph/nodes/mutation-gate.ts:76-79`

**Issue:** The node constructs `committedOp = { ...op, status }` and then casts it `as CanvasOp` before pushing to `canvasOps`. `CanvasOp` (from `canvas.ts`) is a discriminated union of `ADD_NODE`, `ADD_EDGE`, and `NO_ACTION` — none of which have a `status` field. The type is `z.infer<typeof CanvasOpSchema>`, which TypeScript will not allow to carry `status`.

The double cast (`as CanvasOp & { status: CanvasNodeStatus }` then `as CanvasOp`) erases `status` from the TypeScript type. Code that later reads `state.canvasOps[i].status` — which is the entire purpose of this field (to distinguish 'committed' from 'ghost' for the canvas renderer in Phase 7) — will get a TypeScript error or have to suppress it with `as any`. The field exists at runtime via the spread, so it works today, but only through type suppression on the consumer side.

**Fix:** Either extend `CanvasOpSchema` and the `CanvasOp` type to include an optional `status` field (preferred — it is part of the output contract), or introduce a separate type for the gated output:

```typescript
// In canvas.ts, extend the CanvasOp variants that carry status:
export const GatedCanvasOpSchema = z.intersection(
  CanvasOpSchema,
  z.object({ status: CanvasNodeStatusSchema })
)
export type GatedCanvasOp = z.infer<typeof GatedCanvasOpSchema>
```

Or, if the simplest fix is preferred, add `status` as an optional field to the ADD_NODE and ADD_EDGE branches of `CanvasOpSchema` (since NO_ACTION never reaches the gate). Either way, `canvasOps` in `GraphStateAnnotation` should be typed as an array of the extended type.

---

## Warnings

### WR-01: `getCheckpointer()` has no concurrency guard — concurrent startup calls create multiple pools, leak one

**File:** `apps/api/src/lib/langgraph-checkpointer.ts:42-64`

**Issue:** The singleton pattern uses a bare `if (!_checkpointer)` check. If two requests arrive simultaneously during cold start before `_checkpointer` is assigned, both see `null`, both call `PostgresSaver.fromConnString()` (opening a new `pg.Pool`), both call `setup()`, and the second write to `_checkpointer` orphans the first pool permanently — it is never closed and leaks database connections. The comment says `setup()` is idempotent, but the pool leak and double-initialization are not addressed.

**Fix:** Store the in-flight Promise as the singleton:

```typescript
let _checkpointerPromise: Promise<PostgresSaver> | null = null

export function getCheckpointer(): Promise<PostgresSaver> {
  if (!_checkpointerPromise) {
    _checkpointerPromise = (async () => {
      console.log('[langgraph-checkpointer] Initializing PostgresSaver (langgraph schema)')
      const saver = PostgresSaver.fromConnString(env.SUPABASE_DIRECT_URL, { schema: 'langgraph' })
      await saver.setup()
      console.log('[langgraph-checkpointer] PostgresSaver ready (langgraph schema)')
      return saver
    })()
  }
  return _checkpointerPromise
}
```

Concurrent callers all await the same Promise and receive the same instance.

---

### WR-02: `driftReplyNode` returns `driftAction: 'replied'` even when no adapter is available

**File:** `apps/api/src/graph/nodes/drift-reply.ts:31-33`

**Issue:** When no adapter is available (both `driftReplyAdapter` and `providerName`/`plaintextKey` are missing), the node logs an error and returns `{ driftAction: 'replied' }`. No reply was actually generated. The graph records `'replied'` in the checkpoint and any downstream logic (Phase 7 SSE streaming, analytics) will believe a reply was sent to the user when it was not.

The same pattern occurs at line 44-46 when `lastMessage` is absent — `driftAction: 'replied'` is returned but no text was generated.

**Fix:** Return `{ driftAction: 'ignored' }` on failure paths where no reply was produced:

```typescript
if (!adapter) {
  console.error('[drift-reply] no adapter available — cannot generate reply')
  return { driftAction: 'ignored' }  // no reply was made
}
// ...
if (!lastMessage) {
  console.warn('[drift-reply] no messages in state — skipping reply')
  return { driftAction: 'ignored' }  // no reply was made
}
```

---

### WR-03: Integration Test B (`Langfuse OTel smoke`) has no assertions — cannot fail

**File:** `apps/api/src/graph/graph.integration.test.ts:212-279`

**Issue:** Test B calls `graph.invoke()`, catches any `forceFlush()` error, and resolves. There are zero `expect()` calls. A test that can never fail provides no regression coverage. If `setupLangfuseOtel()` is broken, the span processor is null, `getLangfuseTracerProvider()` returns a no-op, and `forceFlush()` silently succeeds — the test still passes.

The intent (comment says "dashboard verification is the human-verify checkpoint") documents a manual step that is not enforced by automation.

**Fix:** Add at least one assertion that `graph.invoke()` produced a non-null result, and assert that `getLangfuseTracerProvider()` is non-null after `setupLangfuseOtel()` runs:

```typescript
const provider = getLangfuseTracerProvider()
expect(provider).not.toBeNull()   // setupLangfuseOtel() wired a real provider

const result = await graph.invoke(...)
expect(result.guardrailResult).toBe('DOMAIN_MATCH')
expect(result.canvasOps.length).toBeGreaterThan(0)
```

---

### WR-04: `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` missing from `.env.example`

**File:** `.env.example` (entire file)

**Issue:** Phase 6 introduces two new required-for-tracing env vars (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`) that are checked in `langfuse-otel.ts` and `graph.integration.test.ts`. Neither is documented in `.env.example`. A developer setting up the project will not know to add them, and `setupLangfuseOtel()` will silently disable tracing with just a console warning.

Additionally, `SUPABASE_DIRECT_URL` is listed under the "Next.js" section of `.env.example` (line 17) even though it is only consumed by the Hono API. It should be under the "Hono API" section.

**Fix:** Add to the Hono API section of `.env.example`:

```bash
# Langfuse observability (optional — tracing disabled if absent)
# Get from: https://cloud.langfuse.com → Settings → API Keys
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
```

Move `SUPABASE_DIRECT_URL=` from line 17 into the Hono API section.

---

### WR-05: `vitest.config.ts` embeds a hardcoded absolute path tied to one developer's machine

**File:** `apps/api/vitest.config.ts:14` and `apps/api/vitest.config.ts:74`

**Issue:** Two hardcoded paths reference `/home/jgm/dev/projects/web-projects/panelito/...`. These will silently fail to resolve on any other developer's machine or in CI, causing the worktree fallback to not find node_modules or the .env file. The `require('fs')` on line 103 in an otherwise ESM-style file is also unusual, though it works in practice because `tsconfig.json` targets CommonJS and vitest transpiles the config.

```
candidates = [
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '../../../apps/api/.env'),
  path.resolve(__dirname, '/home/jgm/dev/projects/web-projects/panelito/apps/api/.env'),  // ← machine-specific
]
```

**Fix:** Remove the hardcoded absolute path entries from `candidates` (lines 14, 74). The relative path candidates are sufficient for worktree resolution:

```typescript
const candidates = [
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '../../../apps/api/.env'),
]
```

The machine-specific fallback is dead code for any other environment and misleading to read.

---

### WR-06: `makeConfig()` in `graph.test.ts` declares `forceDriftAction` but never passes it to the graph

**File:** `apps/api/src/graph/graph.test.ts:151-165`

**Issue:** The `makeConfig()` helper's options type declares `forceDriftAction?: 'replied' | 'ignored'` but the returned config object never includes this field. The `orchestratorNode` does not check for `forceDriftAction` in `config.configurable` either. The option is dead code that misleads the reader into thinking the configuration can pre-seed `driftAction` to bypass the probability roll. Instead, Paths 4 and 5 control the outcome via `drift_reply_probability: 1.0 / 0.0` — which is the correct approach.

**Fix:** Remove `forceDriftAction` from the `makeConfig()` options type declaration, since it is unused and was apparently superseded by the probability override approach.

---

## Info

### IN-01: Redundant `?? 0.8` fallback for `drift_reply_probability` in `orchestrator.ts`

**File:** `apps/api/src/graph/nodes/orchestrator.ts:147`

**Issue:** `const driftProbability = blueprint.drift_reply_probability ?? 0.8` — `blueprint` at this point is a value that passed through `BlueprintSchema.parse()` (via `loadBlueprint`), which declares `drift_reply_probability: z.number().min(0).max(1).default(0.8)`. The Zod schema guarantees the field is always a number after parsing. The `?? 0.8` fallback is unreachable dead code.

**Fix:** Use `blueprint.drift_reply_probability` directly; the Zod default provides the semantic fallback.

---

### IN-02: `HAS_SUPABASE` guard in integration test checks the wrong variable

**File:** `apps/api/src/graph/graph.integration.test.ts:33`

**Issue:** `const HAS_SUPABASE = !!process.env.SUPABASE_DIRECT_URL`. The integration tests also call `loadBlueprint()`, which uses `createServiceClient()` (requiring `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`). A developer who has only `SUPABASE_DIRECT_URL` set but not the others will hit an `env.ts` validation throw at module load time rather than a clean skip. The guard name is also imprecise about what "has Supabase" means.

**Fix:** Rename to `HAS_POSTGRES` or check all required Supabase vars:
```typescript
const HAS_POSTGRES = !!process.env.SUPABASE_DIRECT_URL
const HAS_SUPABASE = !!(process.env.SUPABASE_DIRECT_URL && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
```

In practice, `env.ts` validates all three at module load, so this is low risk in a properly configured environment.

---

### IN-03: `canvasMutationTool` test comment in `graph.test.ts` says "NO_ACTION conf 0.3" but mock has no `confidence` field

**File:** `apps/api/src/graph/graph.test.ts:7` and `125-133`

**Issue:** The test suite header comment says `3. DOMAIN_MATCH + NO_ACTION conf 0.3 → 0 canvasOps` and the mock variable is named `agentNoAction03`, implying a 0.3 confidence value. But the mock's `input` is `{ op: 'NO_ACTION', reason: 'Message is ambiguous' }` — no `confidence` field. `CanvasOpSchema` for `NO_ACTION` has no `confidence` field either. The "0.3" in the variable name and comment is misleading.

**Fix:** Rename the variable to `agentNoAction` and update the test description header to remove the confidence notation for Path 3.

---

### IN-04: `GraphStateAnnotation.currentPhaseId` has no `default()` but is typed as `string`

**File:** `apps/api/src/graph/state.ts:26`

**Issue:** `currentPhaseId: Annotation<string>` — a bare `Annotation<T>` without a `default()` creates a `LastValue` channel that starts as `undefined` at runtime but is typed as `string`. Code that receives `currentPhaseId` as `string` (e.g., `buildAgentSystemPrompt(blueprint, state.currentPhaseId)`) will pass `undefined` to a `string` parameter. Both `orchestratorNode` and `agentNode` have `find()` fallbacks that handle `undefined` gracefully, but the type contract misrepresents the value.

**Fix:** Add a default that expresses the intent (empty string or `null`):

```typescript
currentPhaseId: Annotation<string | null>({
  reducer: (_: string | null, v: string | null) => v,
  default: () => null,
}),
```

Then update the `find()` comparisons, which already handle `null` correctly (`p.id === null` never matches, falls through to `[0]`).

---

## Verdict: PASS-WITH-WARNINGS

The graph logic, routing, blueprint vocabulary validation, and test injection seams are correct. Two issues need to be resolved before Phase 7 integration:

1. **CR-01** (tool schema shape) must be fixed before the agent node can produce real canvas mutations against the Anthropic API. Mock-adapter tests will continue to pass either way.
2. **CR-02** (type erasure on `status`) must be resolved before Phase 7 writes `status` from `canvasOps` to the canvas_nodes table — the type system will fight back at the point of consumption.

The warnings (especially WR-02 wrong `driftAction` on failure, WR-03 non-asserting test, WR-04 missing env docs) degrade observability and test reliability but do not block Phase 7 from starting.

---

_Reviewed: 2026-07-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
