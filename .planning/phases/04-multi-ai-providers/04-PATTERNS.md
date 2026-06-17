# Phase 4: Multi-AI Providers - Pattern Map

**Mapped:** 2026-06-17
**Files analyzed:** 11 new/modified files
**Analogs found:** 11 / 11

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/types/src/ai.ts` | model/types | transform | `packages/types/src/panel.ts` | role-match (shared type file with Zod schemas) |
| `packages/types/src/api-key.ts` | model/types | transform | itself (modification) | exact |
| `apps/api/src/lib/ai-provider.ts` | interface | transform | itself (modification — strip to interface-only) | exact |
| `apps/api/src/lib/adapters/anthropic.ts` | service | streaming | `apps/api/src/lib/ai-provider.ts` (AnthropicAdapter) | exact (extraction) |
| `apps/api/src/lib/adapters/openai.ts` | service | streaming | `apps/api/src/lib/ai-provider.ts` (AnthropicAdapter) | role-match |
| `apps/api/src/lib/adapters/gemini.ts` | service | streaming | `apps/api/src/lib/ai-provider.ts` (AnthropicAdapter) | role-match |
| `apps/api/src/lib/adapter-factory.ts` | utility | transform | `apps/api/src/lib/rate-limit.ts` (factory function pattern) | partial-match |
| `apps/api/src/lib/model-config.ts` | config | transform | `apps/api/src/lib/env.ts` (typed config export) | partial-match |
| `apps/api/src/lib/anthropic.ts` | service | request-response | itself (modification) | exact |
| `apps/api/src/routes/keys.ts` | route | request-response | itself (modification) | exact |
| `apps/api/src/routes/settings.ts` | route | request-response | itself (modification) | exact |
| `apps/api/src/routes/ai.ts` | route | streaming | itself (modification) | exact |
| `apps/web/app/(protected)/settings/settings-form.tsx` | component | request-response | itself (modification) | exact |
| `supabase/migrations/0006_multi_provider_keys.sql` | migration | CRUD | `supabase/migrations/0002_creator_settings_grants.sql` | role-match |
| `apps/api/src/lib/ai-provider.test.ts` | test | — | itself (modification) | exact |

---

## Pattern Assignments

### `packages/types/src/ai.ts` (model/types, transform) — NEW FILE

**Analog:** `packages/types/src/panel.ts`

The types package follows a consistent pattern: one file per domain, Zod schemas alongside TypeScript types, all re-exported from `packages/types/src/index.ts`.

**Imports pattern** (`packages/types/src/panel.ts`, lines 1):
```typescript
import { z } from 'zod'
```

**Type + schema co-location pattern** (`packages/types/src/panel.ts`, lines 7-57):
```typescript
// Sub-schemas first, discriminated union last, inferred type at bottom
const BentoCardSchema = z.object({ ... })
export const PanelWidgetSchema = z.discriminatedUnion('widget_type', [ ... ])
export type PanelWidget = z.infer<typeof PanelWidgetSchema>
```

**What to create in `ai.ts`:**
```typescript
import { z } from 'zod'

// ProviderMessage, ProviderTool, ProviderCapabilities as plain TS interfaces
// (no Zod needed — these are internal types, not validated over the wire)
export interface ProviderMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}
export interface ProviderTool {
  name: string
  description: string
  parameters: Record<string, unknown>  // JSON Schema object
}
export interface ProviderCapabilities {
  streaming: boolean
  toolUse: boolean
  contextCaching: boolean
  semanticCaching: boolean
  imageInput: boolean
  voiceInput: boolean
  compression: boolean
}
// AIProvider interface — D-01: no Anthropic SDK imports
export interface AIProvider {
  capabilities(): ProviderCapabilities
  stream(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    options: { model: string; maxTokens: number; system?: string; systemPromptOverride?: string }
  ): AsyncIterable<AIStreamEvent>
}
// AIStreamEvent — move here from packages/types/src/panel.ts
export type AIStreamEvent = TextDeltaEvent | ToolUseEvent | DoneEvent
// renderPanelTool as ProviderTool (not Anthropic.Tool)
export const renderPanelTool: ProviderTool = { ... }
// ProviderName + ProviderSchema (Zod) for validation in routes
export const ProviderSchema = z.enum(['anthropic', 'openai', 'gemini'])
export type ProviderName = z.infer<typeof ProviderSchema>
```

**Index re-export pattern** (`packages/types/src/index.ts`, lines 8-38):
```typescript
export type { ProviderMessage, ProviderTool, ProviderCapabilities, AIProvider, ProviderName } from './ai'
export { ProviderSchema, renderPanelTool } from './ai'
```

---

### `packages/types/src/api-key.ts` (model/types, transform) — MODIFIED

**Analog:** itself — extend existing schemas to support multi-provider

**Current pattern** (`packages/types/src/api-key.ts`, lines 7-48):
```typescript
export const ApiKeyVerifyRequestSchema = z.object({
  key: z.string().min(50).refine((k) => k.startsWith('sk-ant-'), { ... }),
})
export const CreatorSettingsSchema = z.object({
  user_id: z.string().uuid(),
  has_api_key: z.boolean(),
  api_response_cap: z.number().int().positive().max(10000),
  updated_at: z.string(),
})
```

**What to add** (see RESEARCH.md Code Examples):
```typescript
// Replace single-provider ApiKeyVerifyRequestSchema with multi-provider variant
export const ApiKeyVerifyRequestSchema = z.object({
  provider: ProviderSchema,   // import from ./ai
  key: z.string().min(10),    // per-provider prefix validation applied in route
})

// New: per-provider key status shape
export const ProviderKeyStatusSchema = z.object({
  provider: ProviderSchema,
  has_key: z.boolean(),
  last4: z.string().nullable(),
  is_active: z.boolean(),
})
export const MultiProviderStatusSchema = z.object({
  active_provider: ProviderSchema,
  providers: z.array(ProviderKeyStatusSchema),
})
export type MultiProviderStatus = z.infer<typeof MultiProviderStatusSchema>

// Extend CreatorSettingsSchema for active_provider
export const CreatorSettingsSchema = z.object({
  user_id: z.string().uuid(),
  has_api_key: z.boolean(),        // keep for backward compat
  api_response_cap: z.number().int().positive().max(10000),
  active_provider: ProviderSchema,
  updated_at: z.string(),
})
```

---

### `apps/api/src/lib/ai-provider.ts` (interface, transform) — MODIFIED (strip to interface-only)

**Analog:** itself — Phase 4 removes `AnthropicAdapter` and `renderPanelTool` from this file; keeps only re-exports

**Current file** (`apps/api/src/lib/ai-provider.ts`, lines 1-167): Contains `AIStreamEvent` types, `AIProvider` interface, `renderPanelTool`, and `AnthropicAdapter` all in one file.

**After refactor:** This file becomes a thin re-export shim OR is deleted; the interface moves to `packages/types/src/ai.ts`. If kept, it re-exports from the types package:
```typescript
// apps/api/src/lib/ai-provider.ts — after Phase 4 refactor
// Re-export interface types from shared package so existing imports don't break
export type { AIProvider, AIStreamEvent, ProviderMessage, ProviderTool } from '@panelito/types'
export { renderPanelTool } from '@panelito/types'
// AnthropicAdapter moved to ./adapters/anthropic
// renderPanelTool now typed as ProviderTool (not Anthropic.Tool)
```

**Key change:** `renderPanelTool` type changes from `Anthropic.Tool` (with `input_schema`) to `ProviderTool` (with `parameters`). The test file at line 144 accesses `renderPanelTool.input_schema.properties` — update to `renderPanelTool.parameters.properties` after refactor.

---

### `apps/api/src/lib/adapters/anthropic.ts` (service, streaming) — NEW (extracted from ai-provider.ts)

**Analog:** `apps/api/src/lib/ai-provider.ts` (the existing `AnthropicAdapter` class, lines 85-167)

**Imports pattern** (from `apps/api/src/lib/ai-provider.ts`, lines 15-16):
```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources'
```

After extraction, add import from types package:
```typescript
import type { AIProvider, AIStreamEvent, ProviderMessage, ProviderTool, ProviderCapabilities } from '@panelito/types'
```

**Core adapter class pattern** (`apps/api/src/lib/ai-provider.ts`, lines 85-167 — copy verbatim, then adapt):
```typescript
export class AnthropicAdapter implements AIProvider {
  constructor(private readonly apiKey: string) {}

  capabilities(): ProviderCapabilities {
    return {
      streaming: true, toolUse: true,
      contextCaching: false, semanticCaching: false,
      imageInput: false, voiceInput: false, compression: false,
    }
  }

  async *stream(
    messages: ProviderMessage[],    // was MessageParam[]
    tools: ProviderTool[],          // was Anthropic.Tool[]
    options: { model: string; maxTokens: number; system?: string }
  ): AsyncIterable<AIStreamEvent> {
    const client = new Anthropic({ apiKey: this.apiKey })

    // Convert ProviderTool[] → Anthropic.Tool[]
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: { type: 'object' as const, ...t.parameters },
    }))

    // Convert ProviderMessage[] → MessageParam[]
    // cache_control injection moves HERE from assemblePromptArray()
    const anthropicMessages: MessageParam[] = messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))
    // NOTE: cache_control on static prefix must be re-applied here after conversion
    // See assemblePromptArray refactor in anthropic.ts for how the cache breakpoint
    // is signaled from the route to the adapter (e.g., index-based or separator message)

    const streamParams: Anthropic.MessageStreamParams = {
      model: options.model,
      max_tokens: options.maxTokens,
      tools: anthropicTools,
      messages: anthropicMessages,
      ...(options.system ? { system: options.system } : {}),
    }

    // ... rest of queue/callback pattern IDENTICAL to current ai-provider.ts lines 96-166
    // (copy the queue, resolve, enqueue, waitForItem pattern verbatim)
  }
}
```

**Queue/callback bridge pattern** (`apps/api/src/lib/ai-provider.ts`, lines 96-166) — copy verbatim:
```typescript
const queue: AIStreamEvent[] = []
let resolve: (() => void) | null = null
let isDone = false

function enqueue(event: AIStreamEvent) {
  queue.push(event)
  if (resolve) { const r = resolve; resolve = null; r() }
}
function waitForItem(): Promise<void> {
  if (queue.length > 0) return Promise.resolve()
  return new Promise<void>((r) => { resolve = r })
}
const apiStream = client.messages.stream(streamParams)
apiStream.on('text', (text: string) => { enqueue({ type: 'text_delta', text }) })
apiStream.on('contentBlock', (block: Anthropic.ContentBlock) => {
  if (block.type === 'tool_use') {
    enqueue({ type: 'tool_use', name: block.name, input: block.input })
  }
})
const donePromise = apiStream.done().then(() => {
  isDone = true
  if (resolve) { const r = resolve; resolve = null; r() }
})
while (true) {
  await waitForItem()
  while (queue.length > 0) { yield queue.shift()! }
  if (isDone && queue.length === 0) break
}
await donePromise
yield { type: 'done' }
```

**try/finally guard** (Pitfall 4 from RESEARCH.md — wrap entire body):
```typescript
async *stream(...): AsyncIterable<AIStreamEvent> {
  try {
    // ... all existing logic
  } finally {
    yield { type: 'done' }  // always emitted, even on error
  }
}
```

---

### `apps/api/src/lib/adapters/openai.ts` (service, streaming) — NEW

**Analog:** `apps/api/src/lib/adapters/anthropic.ts` (structural twin — same interface, different SDK)

**Imports pattern:**
```typescript
// @google/genai v2 — do NOT use @google/generative-ai (legacy v1)
import OpenAI from 'openai'
import type { AIProvider, AIStreamEvent, ProviderMessage, ProviderTool, ProviderCapabilities } from '@panelito/types'
```

**Core pattern** (RESEARCH.md Pattern 1 — OpenAI accumulation, lines 217-246):
```typescript
export class OpenAIAdapter implements AIProvider {
  constructor(private readonly apiKey: string) {}

  capabilities(): ProviderCapabilities {
    return { streaming: true, toolUse: true, contextCaching: false,
             semanticCaching: false, imageInput: false, voiceInput: false, compression: false }
  }

  async *stream(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    options: { model: string; maxTokens: number; system?: string }
  ): AsyncIterable<AIStreamEvent> {
    try {
      const client = new OpenAI({ apiKey: this.apiKey })

      // System prompt: first element in messages array (Pattern 2)
      const oaiMessages: OpenAI.ChatCompletionMessageParam[] = []
      if (options.system) {
        oaiMessages.push({ role: 'system', content: options.system })
      }
      for (const m of messages) {
        if (m.role === 'system') continue  // system already handled above
        oaiMessages.push({ role: m.role as 'user' | 'assistant', content: m.content })
      }

      // Convert ProviderTool[] → OpenAI function tool format
      const oaiTools: OpenAI.ChatCompletionTool[] = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))

      const stream = await client.chat.completions.stream({
        model: options.model,
        max_tokens: options.maxTokens,
        messages: oaiMessages,
        tools: oaiTools,
      })
      // DO NOT call stream.finalMessage() — kills first-token latency (anti-pattern)

      // Tool call accumulator keyed by index (parallel_tool_calls = default on)
      const toolCallAccumulator: Record<number, { id: string; name: string; arguments: string }> = {}

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta
        if (!delta) continue

        if (delta.content) {
          yield { type: 'text_delta', text: delta.content }
        }

        for (const tc of delta.tool_calls ?? []) {
          const idx = tc.index
          if (!toolCallAccumulator[idx]) {
            toolCallAccumulator[idx] = { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' }
          }
          toolCallAccumulator[idx].arguments += tc.function?.arguments ?? ''
        }

        // Only parse + emit AFTER finish_reason === 'tool_calls'
        if (chunk.choices[0]?.finish_reason === 'tool_calls') {
          for (const tc of Object.values(toolCallAccumulator)) {
            let parsed: unknown
            try { parsed = JSON.parse(tc.arguments) } catch { continue }
            yield { type: 'tool_use', name: tc.name, input: parsed }
          }
        }
      }
    } finally {
      yield { type: 'done' }
    }
  }
}
```

---

### `apps/api/src/lib/adapters/gemini.ts` (service, streaming) — NEW

**Analog:** `apps/api/src/lib/adapters/anthropic.ts` (structural twin — same interface, different SDK)

**Imports pattern** (RESEARCH.md Pitfall 5 — comment is mandatory):
```typescript
// @google/genai v2 — do NOT use @google/generative-ai (legacy v1 SDK)
// Wrong: import { GoogleGenerativeAI } from '@google/generative-ai'
// Correct:
import { GoogleGenAI } from '@google/genai'
import type { AIProvider, AIStreamEvent, ProviderMessage, ProviderTool, ProviderCapabilities } from '@panelito/types'
```

**Core pattern** (RESEARCH.md Pattern 1 — Gemini accumulation, lines 249-268 + Pattern 2 + Pattern 3):
```typescript
export class GeminiAdapter implements AIProvider {
  constructor(private readonly apiKey: string) {}

  capabilities(): ProviderCapabilities {
    return { streaming: true, toolUse: true, contextCaching: false,
             semanticCaching: false, imageInput: false, voiceInput: false, compression: false }
  }

  async *stream(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    options: { model: string; maxTokens: number; system?: string }
  ): AsyncIterable<AIStreamEvent> {
    try {
      const ai = new GoogleGenAI({ apiKey: this.apiKey })

      // Pattern 3: filter system role + map 'assistant' → 'model'
      const contents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }))

      // Convert ProviderTool[] → Gemini FunctionDeclaration[]
      const functionDeclarations = tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }))

      const responseStream = await ai.models.generateContentStream({
        model: options.model,
        contents,
        config: {
          maxOutputTokens: options.maxTokens,
          ...(options.system ? { systemInstruction: options.system } : {}),
          tools: [{ functionDeclarations }],
        },
      })

      // Gemini: functionCalls returns COMPLETE objects (not partial strings)
      // Accumulate across chunks, emit after loop
      let accumulatedFunctionCalls: Array<{ name: string; args: unknown }> = []

      for await (const chunk of responseStream) {
        if (chunk.text) {
          yield { type: 'text_delta', text: chunk.text }
        }
        if (chunk.functionCalls && chunk.functionCalls.length > 0) {
          for (const fc of chunk.functionCalls) {
            accumulatedFunctionCalls.push({ name: fc.name ?? '', args: fc.args ?? {} })
          }
        }
      }

      for (const fc of accumulatedFunctionCalls) {
        yield { type: 'tool_use', name: fc.name, input: fc.args }
      }
    } finally {
      yield { type: 'done' }
    }
  }
}
```

---

### `apps/api/src/lib/adapter-factory.ts` (utility, transform) — NEW

**Analog:** `apps/api/src/lib/rate-limit.ts` (factory function pattern — returns a typed callable from config options)

**Factory function pattern** (`apps/api/src/lib/rate-limit.ts`, lines 42-76):
```typescript
export function rateLimit({ keyFn, limit, windowMs }: RateLimitOptions): MiddlewareHandler {
  // ... returns a configured handler
}
```

**What to create** (RESEARCH.md Pattern 4):
```typescript
// apps/api/src/lib/adapter-factory.ts
import type { AIProvider } from '@panelito/types'
import type { ProviderName } from '@panelito/types'
import { AnthropicAdapter } from './adapters/anthropic'
import { OpenAIAdapter } from './adapters/openai'
import { GeminiAdapter } from './adapters/gemini'

export function createAdapter(provider: ProviderName, apiKey: string): AIProvider {
  switch (provider) {
    case 'anthropic': return new AnthropicAdapter(apiKey)
    case 'openai':    return new OpenAIAdapter(apiKey)
    case 'gemini':    return new GeminiAdapter(apiKey)
    default: throw new Error(`Unknown provider: ${provider satisfies never}`)
  }
}
```

---

### `apps/api/src/lib/model-config.ts` (config, transform) — NEW

**Analog:** `apps/api/src/lib/env.ts` (typed, validated config export — single source of truth for environment-derived values)

**Pattern:** Simple typed const export, no Zod needed (values are static compile-time constants):
```typescript
// apps/api/src/lib/model-config.ts
import type { ProviderName } from '@panelito/types'

export type TaskType = 'analysis' | 'compression' | 'categorization'

export const TASK_MODELS: Record<ProviderName, Record<TaskType, string>> = {
  anthropic: {
    analysis:      'claude-sonnet-4-6',
    compression:   'claude-haiku-4-5-20251001',
    categorization:'claude-haiku-4-5-20251001',
  },
  openai: {
    analysis:      'gpt-5.4',
    compression:   'gpt-5.4-mini',
    categorization:'gpt-5.4-mini',
  },
  gemini: {
    analysis:      'gemini-2.5-flash',
    compression:   'gemini-2.5-flash',
    categorization:'gemini-2.5-flash',
  },
} as const
```

---

### `apps/api/src/lib/anthropic.ts` (service, request-response) — MODIFIED

**Analog:** itself — three targeted changes

**Change 1 — `verifyApiKey` pattern** (`apps/api/src/lib/anthropic.ts`, lines 39-70): Copy verbatim for OpenAI/Gemini variants. Add new exported functions `verifyOpenAIKey` and `verifyGeminiKey` using same `VerifyResult` type. Pattern from RESEARCH.md Pattern 5:
```typescript
export async function verifyOpenAIKey(key: string): Promise<VerifyResult> {
  const client = new OpenAI({ apiKey: key })
  try {
    await client.models.list()
    return { ok: true }
  } catch (err) {
    if (err instanceof OpenAI.AuthenticationError) return { ok: false, error: 'invalid_key' }
    if (err instanceof OpenAI.PermissionDeniedError) return { ok: false, error: 'invalid_key' }
    if (err instanceof OpenAI.RateLimitError) return { ok: false, error: 'rate_limited' }
    if (err instanceof OpenAI.APIError) return { ok: true }
    return { ok: false, error: 'network_error' }
  }
}
```

**Change 2 — `assemblePromptArray` return type** (`apps/api/src/lib/anthropic.ts`, lines 102-140): Change return type from `MessageParam[]` to `ProviderMessage[]`. Move `cache_control` injection into `AnthropicAdapter.stream()` (it is Anthropic-specific). The function signature and logic remain the same; only the type annotation and `cache_control` block change.

**Change 3 — `compressHistory` signature** (`apps/api/src/lib/anthropic.ts`, lines 155-174): Change from `client: Anthropic` parameter to `adapter: AIProvider`. Use `adapter.stream()` with a compression prompt instead of direct `client.messages.create()`. Preserve the `if (messages.length === 0) return ''` short-circuit (line 159).

---

### `apps/api/src/routes/keys.ts` (route, request-response) — MODIFIED

**Analog:** itself — extend to multi-provider. All structural patterns (rate limiting, auth, Zod validation, encrypt/upsert) are preserved.

**Existing rate limit pattern** (`apps/api/src/routes/keys.ts`, lines 27-31):
```typescript
const verifyRateLimit = rateLimit({
  keyFn: (c) => `${(c.get('user') as { id: string }).id}:verify`,
  limit: 5,
  windowMs: 60_000,
})
```

**Existing verify handler pattern** (`apps/api/src/routes/keys.ts`, lines 50-103) — extend to dispatch by provider:
```typescript
keysRouter.post('/verify', verifyRateLimit, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => null)
  const parsed = ApiKeyVerifyRequestSchema.safeParse(body)  // now includes provider field
  if (!parsed.success) {
    return c.json({ success: false, error: 'invalid_request', details: parsed.error.issues }, 400)
  }
  const { key, provider } = parsed.data

  // Per-provider verification (replaces single verifyApiKey call)
  let result: VerifyResult
  switch (provider) {
    case 'anthropic': result = await verifyApiKey(key); break
    case 'openai':    result = await verifyOpenAIKey(key); break
    case 'gemini':    result = await verifyGeminiKey(key); break
  }
  // ... error handling identical to lines 64-69

  // Encrypt + upsert to provider-specific column
  const encrypted = encryptKey(key, env.KEY_ENCRYPTION_SECRET)
  const columnName = `${provider}_api_key` as const  // 'anthropic_api_key' | 'openai_api_key' | 'gemini_api_key'
  // ... same cap-preserving upsert pattern as lines 76-101
})
```

**Existing status pattern** (`apps/api/src/routes/keys.ts`, lines 112-140) — extend to return `MultiProviderStatus`:
```typescript
keysRouter.get('/status', async (c) => {
  // Select all three key columns + active_provider
  const { data } = await supabase
    .from('creator_settings')
    .select('anthropic_api_key, openai_api_key, gemini_api_key, active_provider')
    .eq('user_id', user.id)
    .maybeSingle()
  // Build MultiProviderStatus response — decrypt each to get last4, never return blob
  // Pattern: same decrypt-for-last4 as lines 132-135
})
```

**Add new route for active provider update:**
```typescript
keysRouter.put('/active-provider', async (c) => {
  // Validate provider enum, update active_provider column
  // Pattern: same as settings.ts PUT handler lines 83-141
})
```

---

### `apps/api/src/routes/settings.ts` (route, request-response) — MODIFIED

**Analog:** itself — extend `UpdateSettingsSchema` and `GET` response to include `active_provider`

**Existing schema pattern** (`apps/api/src/routes/settings.ts`, lines 20-27):
```typescript
const UpdateSettingsSchema = z.object({
  api_response_cap: z.number().int().min(1).max(10000).optional(),
})
```

**Extend to include active_provider:**
```typescript
const UpdateSettingsSchema = z.object({
  api_response_cap: z.number().int().min(1).max(10000).optional(),
  active_provider: ProviderSchema.optional(),
})
```

**Existing GET response pattern** (`apps/api/src/routes/settings.ts`, lines 43-74) — strip pattern for sensitive columns:
```typescript
const { encrypted_api_key: _omit, ...rest } = data
return c.json({ ...rest, has_api_key: _omit !== null }, 200)
```

**After refactor** — strip all three key columns:
```typescript
const { anthropic_api_key: _a, openai_api_key: _o, gemini_api_key: _g, ...rest } = data
return c.json({ ...rest, has_api_key: _a !== null }, 200)
```

---

### `apps/api/src/routes/ai.ts` (route, streaming) — MODIFIED

**Analog:** itself — targeted changes; streaming/SSE structure unchanged

**Existing adapter instantiation** (`apps/api/src/routes/ai.ts`, lines 204-210):
```typescript
const provider = new AnthropicAdapter(plaintextKey)
for await (const event of provider.stream(promptArray, [renderPanelTool], {
  model: 'claude-sonnet-4-6',
  maxTokens: 2048,
})) { ... }
```

**After refactor** (RESEARCH.md Code Examples — /invoke route refactored):
```typescript
// Step 5: Expand DB select to include all provider columns
const { data: creatorSettings } = await supabase
  .from('creator_settings')
  .select('anthropic_api_key, openai_api_key, gemini_api_key, active_provider')
  .eq('user_id', session.creator_id)
  .maybeSingle()

const providerName = (creatorSettings?.active_provider ?? 'anthropic') as ProviderName
const encryptedKey = creatorSettings?.[`${providerName}_api_key`]
if (!encryptedKey) return c.json({ error: 'no_api_key' }, 400)
const plaintextKey = decryptKey(encryptedKey as string, env.KEY_ENCRYPTION_SECRET)

// Step 7: assembleProviderMessages returns ProviderMessage[] (not MessageParam[])
const providerMessages = assemblePromptArray({ ... })  // now returns ProviderMessage[]

// Step 8: Factory creates correct adapter
const adapter = createAdapter(providerName, plaintextKey)
for await (const event of adapter.stream(providerMessages, [renderPanelTool], {
  model: TASK_MODELS[providerName].analysis,
  maxTokens: 2048,
  system: BASE_SYSTEM_PROMPT + '\n\n' + personaInstructions,
})) { ... }
```

**compressHistory call** (`apps/api/src/routes/ai.ts`, lines 176-184) — update to pass adapter:
```typescript
// Before: compressHistory(haiku, olderMessages)  — Anthropic-specific
// After:
historicalSummary = await compressHistory(adapter, olderMessages)  // adapter: AIProvider
```

**Remove import** (`apps/api/src/routes/ai.ts`, line 28):
```typescript
// Remove: import Anthropic from '@anthropic-ai/sdk'
// Remove: import { AnthropicAdapter, renderPanelTool } from '../lib/ai-provider'
// Add:
import { createAdapter } from '../lib/adapter-factory'
import { renderPanelTool } from '@panelito/types'
import { TASK_MODELS } from '../lib/model-config'
import type { ProviderName } from '@panelito/types'
```

---

### `apps/web/app/(protected)/settings/settings-form.tsx` (component, request-response) — MODIFIED

**Analog:** itself — replace single-provider card with three-provider selector UI

**Existing card pattern** (`apps/web/app/(protected)/settings/settings-form.tsx`, lines 99-177) — Card component with conditional content:
```typescript
<Card>
  <CardHeader><CardTitle className="text-[16px]">Clave API de Anthropic</CardTitle></CardHeader>
  <CardContent>
    {settings.has_api_key ? (
      <div className="space-y-4"> ... </div>
    ) : (
      <div className="rounded-lg border border-dashed ..."> ... </div>
    )}
  </CardContent>
</Card>
```

**Existing apiFetch pattern** (`apps/web/app/(protected)/settings/settings-form.tsx`, lines 61-94):
```typescript
const handleDisconnect = async () => {
  setDisconnecting(true)
  try {
    await apiFetch('/api/keys', { method: 'DELETE' })
    router.refresh()
  } catch { router.refresh() }
  finally { setDisconnecting(false) }
}
```

**New structure** — three provider cards in a row, each with same Card + conditional content pattern:
- Map over `['anthropic', 'openai', 'gemini']` and render one `<Card>` per provider
- Active provider = colored icon, inactive = greyed (Tailwind `opacity-40` or `text-muted-foreground`)
- Each card: icon + key input masked display + validation badge + `apiFetch('/api/keys/verify', { method: 'POST', body: JSON.stringify({ provider, key }) })`
- Clicking icon: `apiFetch('/api/keys/active-provider', { method: 'PUT', body: JSON.stringify({ provider }) })` then `router.refresh()`
- State pattern: same `useState` per-provider booleans as existing `[capSaving, setCapSaving]`

**Import additions:**
```typescript
import type { MultiProviderStatus } from '@panelito/types'
// Provider icons: use simple text abbreviations or SVG imports
// No new UI primitive libraries needed — existing Card, Button, Input, Dialog suffice
```

---

### `supabase/migrations/0006_multi_provider_keys.sql` (migration, CRUD) — NEW

**Analog:** `supabase/migrations/0002_creator_settings_grants.sql` (column-level REVOKE pattern)

**REVOKE pattern** (`supabase/migrations/0002_creator_settings_grants.sql`, lines 15-20):
```sql
revoke select (encrypted_api_key) on public.creator_settings from authenticated;
grant select (user_id, api_response_cap, updated_at) on public.creator_settings to authenticated;
```

**What to create** (RESEARCH.md Pattern 6):
```sql
-- Migration: 0006_multi_provider_keys
-- Add openai_api_key, gemini_api_key, active_provider columns
-- Rename encrypted_api_key → anthropic_api_key (data-preserving)

ALTER TABLE public.creator_settings
  RENAME COLUMN encrypted_api_key TO anthropic_api_key;

ALTER TABLE public.creator_settings
  ADD COLUMN IF NOT EXISTS openai_api_key text,
  ADD COLUMN IF NOT EXISTS gemini_api_key text,
  ADD COLUMN IF NOT EXISTS active_provider text
    DEFAULT 'anthropic'
    CHECK (active_provider IN ('anthropic', 'openai', 'gemini'));

-- Column-level lockdown — T-06-01 equivalent for new columns
-- Must also revoke anthropic_api_key since it was renamed (old grant no longer covers it)
REVOKE SELECT (anthropic_api_key, openai_api_key, gemini_api_key)
  ON public.creator_settings FROM authenticated;

-- Re-grant safe columns (add active_provider as safe to read)
GRANT SELECT (user_id, api_response_cap, active_provider, updated_at)
  ON public.creator_settings TO authenticated;
```

**Critical note:** The column rename from `encrypted_api_key` → `anthropic_api_key` must be applied atomically with all route code changes. All existing Supabase queries referencing `encrypted_api_key` in `keys.ts`, `settings.ts`, and `ai.ts` must be updated in the same plan wave.

---

### `apps/api/src/lib/ai-provider.test.ts` (test) — MODIFIED

**Analog:** itself — update imports and add new test cases

**Existing import that breaks** (`apps/api/src/lib/ai-provider.test.ts`, line 63):
```typescript
import { AnthropicAdapter, renderPanelTool } from './ai-provider'
```

**After refactor:**
```typescript
import { AnthropicAdapter } from './adapters/anthropic'
import { renderPanelTool } from '@panelito/types'
```

**Test accessing `renderPanelTool.input_schema.properties`** (line 144) — update to `renderPanelTool.parameters.properties` after `renderPanelTool` type changes from `Anthropic.Tool` to `ProviderTool`.

**Mock structure** (`apps/api/src/lib/ai-provider.test.ts`, lines 47-61): The `vi.mock('@anthropic-ai/sdk', ...)` mock remains valid — `AnthropicAdapter` still uses the Anthropic SDK internally. The mock only needs to move to the new import path in the test file.

**Add new test cases** mirroring existing `AnthropicAdapter` tests for `OpenAIAdapter` and `GeminiAdapter`:
- OpenAI: mock `openai` package; verify `toolCallAccumulator` only emits after `finish_reason === 'tool_calls'`
- Gemini: mock `@google/genai`; verify `functionCalls` are accumulated and emitted after stream ends
- Both: verify `done` is always yielded (try/finally invariant)

---

## Shared Patterns

### Authentication (all routes)
**Source:** `apps/api/src/middleware/auth.ts`, lines 29-47
**Apply to:** All new/modified route handlers — `keys.ts`, `settings.ts`, `ai.ts`
```typescript
keysRouter.use('/*', requireAuth)
// All route handlers access: const user = c.get('user')
```

### Error Handling (Hono routes)
**Source:** `apps/api/src/routes/keys.ts`, lines 64-69 and `apps/api/src/routes/settings.ts`, lines 51-55
**Apply to:** All route handlers
```typescript
if (error) {
  console.error('[keys/verify] DB error:', error.code)
  return c.json({ success: false, error: 'server_error' }, 500)
}
```
Log only error code or error class name — never the key, never full error object (T-06-03).

### Encryption (key storage)
**Source:** `apps/api/src/lib/crypto.ts`
**Apply to:** All three provider key columns in `keys.ts`
```typescript
// Encrypt before write
const encrypted = encryptKey(key, env.KEY_ENCRYPTION_SECRET)
// Decrypt for verification (never expose to client)
const plaintext = decryptKey(data.encrypted_key, env.KEY_ENCRYPTION_SECRET)
const last4 = plaintext.slice(-4)
```
Same `encryptKey`/`decryptKey` functions — no changes needed. Works for any string key.

### VerifyResult type (key verification)
**Source:** `apps/api/src/lib/anthropic.ts`, lines 24-26
**Apply to:** `verifyOpenAIKey` and `verifyGeminiKey` in `anthropic.ts` (or new `verify-key.ts`)
```typescript
export type VerifyResult =
  | { ok: true }
  | { ok: false; error: 'invalid_key' | 'rate_limited' | 'network_error' }
```

### Rate limiting (verify endpoints)
**Source:** `apps/api/src/routes/keys.ts`, lines 27-31
**Apply to:** All `/api/keys/verify` calls (already applied; no change needed if endpoint is shared)
```typescript
const verifyRateLimit = rateLimit({
  keyFn: (c) => `${(c.get('user') as { id: string }).id}:verify`,
  limit: 5,
  windowMs: 60_000,
})
```

### Zod validation before DB write
**Source:** `apps/api/src/routes/keys.ts`, lines 55-58 and `apps/api/src/routes/settings.ts`, lines 87-90
**Apply to:** All route POST/PUT handlers
```typescript
const parsed = SomeSchema.safeParse(body)
if (!parsed.success) {
  return c.json({ success: false, error: 'invalid_request', details: parsed.error.issues }, 400)
}
```

### Cap-preserving upsert
**Source:** `apps/api/src/routes/keys.ts`, lines 76-101
**Apply to:** `keys.ts` `/verify` handler when writing to `[provider]_api_key` column
```typescript
const { data: existing } = await supabase
  .from('creator_settings')
  .select('user_id')
  .eq('user_id', user.id)
  .maybeSingle()
if (existing) {
  await supabase.from('creator_settings').update({ [columnName]: encrypted }).eq('user_id', user.id)
} else {
  await supabase.from('creator_settings').insert({ user_id: user.id, [columnName]: encrypted, api_response_cap: 150 })
}
```

### PanelWidgetSchema validation gate
**Source:** `packages/types/src/panel.ts`, line 34
**Apply to:** `apps/api/src/routes/ai.ts` SSE loop — unchanged; already provider-agnostic
```typescript
// AI-05: validate before emitting panel_update
const parseResult = PanelWidgetSchema.safeParse(event.input)
if (parseResult.success) {
  await stream.writeSSE({ event: 'panel_update', data: JSON.stringify(parseResult.data) })
} else {
  console.error('[ai] invalid panel payload:', parseResult.error.issues)
  // Drop silently — do not crash stream
}
```
Note: The current `ai.ts` route does NOT call `PanelWidgetSchema.safeParse()` — it passes `event.input` directly to SSE. Phase 4 is the right time to add this gate per AI-05.

---

## No Analog Found

No files in Phase 4 lack a codebase analog. All new files have either a direct extraction point or a structural twin in the existing codebase.

---

## Critical Ordering Constraints

These must be reflected in plan wave sequencing:

1. **`packages/types/src/ai.ts` must be created first** — all adapters and the refactored interface import from it.
2. **Migration 0006 must land before route code is deployed** — `encrypted_api_key` rename breaks queries atomically.
3. **`AnthropicAdapter` extraction before `OpenAIAdapter`/`GeminiAdapter` creation** — new adapters copy the class skeleton; extract first.
4. **`ai-provider.test.ts` import update before running tests** — tests fail at import resolution after `AnthropicAdapter` moves.
5. **`assemblePromptArray` return type change before `ai.ts` route refactor** — route depends on `ProviderMessage[]`.

---

## Metadata

**Analog search scope:** `apps/api/src/lib/`, `apps/api/src/routes/`, `apps/api/src/middleware/`, `apps/web/app/(protected)/settings/`, `packages/types/src/`, `supabase/migrations/`
**Files scanned:** 17
**Pattern extraction date:** 2026-06-17
