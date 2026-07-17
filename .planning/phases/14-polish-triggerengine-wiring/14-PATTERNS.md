# Phase 14: Polish + TriggerEngine Wiring - Pattern Map

**Mapped:** 2026-07-17
**Files analyzed:** 15 (create/modify)
**Analogs found:** 13 / 15 (2 are pure rename/extend of the same file — analog is "self")

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|---------------|
| `apps/api/src/lib/trigger-engine.ts` (renamed/generalized from `silence-scan.ts`) | service (background loop) | event-driven / timer-poll | `apps/api/src/lib/silence-scan.ts` (itself — direct base) | exact (self, generalize in place) |
| `apps/api/src/server.ts` | config / entrypoint | event-driven (process lifecycle) | `apps/api/src/lib/auto-freeze.ts` (`clearAllTrackers`, SIGTERM doc-comment) + `apps/api/src/server.ts` (itself) | role-match |
| `apps/api/src/lib/auto-freeze.ts` | config | CRUD (constant only) | itself (one-line constant change) | exact (self) |
| `apps/api/src/lib/langfuse-otel.ts` | config / bootstrap | request-response (setup) | itself (extend with `environment` option) | exact (self) |
| `apps/api/src/lib/langfuse-generation.ts` (NEW) | utility | transform (wraps a stream + emits observation) | Pattern synthesized from `apps/api/src/routes/ai.ts:364-369` (`CallbackHandler` construction) + Langfuse docs (no existing codebase usage of `@langfuse/tracing`) | no strong analog — see "No Analog Found" |
| `apps/api/src/lib/adapters/anthropic.ts` | service (LLM adapter) | streaming | itself (extend `stream()` to emit `usage` event) | exact (self) |
| `apps/api/src/lib/adapters/openai.ts` | service (LLM adapter) | streaming | `apps/api/src/lib/adapters/anthropic.ts` (same interface, cross-adapter pattern) | exact (sibling adapter) |
| `apps/api/src/lib/adapters/gemini.ts` | service (LLM adapter) | streaming | `apps/api/src/lib/adapters/anthropic.ts` / `openai.ts` (same interface) | exact (sibling adapter) |
| `apps/api/src/graph/nodes/facilitation-agent.ts` | controller (LangGraph node) | request-response (prompt build + stream) | itself (extend with re-anchor counter + Generation wrap) | exact (self) |
| `apps/api/src/graph/nodes/analytics-agent.ts` | controller (LangGraph node) | request-response | `apps/api/src/graph/nodes/facilitation-agent.ts` (identical counter/re-anchor/Generation pattern, sibling Role node) | exact (sibling node) |
| `apps/api/src/graph/state.ts` | model (LangGraph state schema) | CRUD (checkpoint field) | itself (add `roleInvocationCounts` Annotation, mirrors `triggerMetadata`) | exact (self) |
| `apps/api/src/routes/ai.ts` | controller / route | request-response (SSE) | itself (extend `CallbackHandler` tags; remove `'[canvas updated]'` fallback) | exact (self) |
| `packages/types/src/speech-artifacts.ts` (NEW) | utility / model | transform | `packages/types/src/blueprint.ts` (Zod-adjacent shared-types module convention) + inline `Don't Hand-Roll` example in RESEARCH.md | role-match |
| `apps/web/components/workspace/MessageBubble.tsx` | component | request-response (render) | itself (apply blocklist filter to `message.content`/`streamingText`) | exact (self) |
| `apps/web/components/workspace/MessageList.tsx` | component | request-response (render) | itself (extend `.map()` filter to also suppress canvas-only/blocklisted rows) | exact (self) |
| `packages/types/src/blueprint.ts` (D-04 toggle field) | model (Zod schema) | CRUD | itself — `drift_detection_enabled` field (lines 80-84) is the direct precedent for the new toggle | exact (self, precedent-driven) |

## Pattern Assignments

### `apps/api/src/lib/trigger-engine.ts` (service, timer-poll — generalizes `silence-scan.ts`)

**Analog:** `apps/api/src/lib/silence-scan.ts` (440 lines) — this is the direct base to rename/extend, not a separate file to imitate.

**Imports pattern** (silence-scan.ts lines 25-37):
```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Blueprint, Personality, ProviderMessage, ProviderName } from '@panelito/types'
import { PersonalitySchema, ProviderSchema } from '@panelito/types'
import { checkSilenceGate } from './silence-gate'
import { runArbitration, releaseBotLock } from './bot-arbitrator'
import { checkBotBudget } from './bot-budget'
import { registerBots } from './bot-registration'
import { loadBlueprint } from './blueprint-loader'
import { decryptKey } from './crypto'
import { env } from './env'
import { CONTEXT_WINDOWS } from './bot-context'
import { createGraph } from '../graph/graph'
import { getCheckpointer } from './langgraph-checkpointer'
```
Keep this entire import block as-is when renaming to `trigger-engine.ts` — every helper is unchanged per RESEARCH.md's Runtime State Inventory conclusion ("low-risk rename").

**Core timer-loop pattern to REPLACE** (silence-scan.ts lines 132-143 — raw callback `setInterval`):
```typescript
setInterval(async () => {
  try {
    await runSilenceScan(supabase, resolvedGraph)
  } catch (err) {
    console.error('[silence-scan] uncaught error in scan tick', err)
  }
}, SCAN_INTERVAL_MS)
```
Replace with the `node:timers/promises` async-iterator form (RESEARCH.md Pattern 1) — same per-tick `try/catch` isolation, same log-prefix convention, but drift-aware and cancellable via `AbortController`. Return a stop function from `startTriggerEngine()` (new name for `startSilenceScanLoop()`) so `server.ts` can call it on SIGTERM/SIGINT (Pattern 2).

**Constants pattern to keep, just retune** (lines 45-63):
```typescript
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS ?? '15000', 10)
const SCAN_INTERVAL_FLOOR_MS = 5_000
if (SCAN_INTERVAL_MS < SCAN_INTERVAL_FLOOR_MS) {
  console.warn(`[silence-scan] WARNING: SCAN_INTERVAL_MS=${SCAN_INTERVAL_MS} is below the recommended minimum...`)
}
```
D-02 changes the default from `'15000'` to `'60000'` (~1 minute) — keep the floor-warning idiom, just update the default and log prefix (`[trigger-engine]` per the RESEARCH.md structure diagram, matching `[nodename]` convention named in CONTEXT.md's "Established Patterns").

**Per-branch pipeline to keep unchanged** (scanSession/scanBranch, lines 171-314): D-01 confirms the TriggerEngine's silence path continues to use `checkSilenceGate` → `runArbitration` → `checkBotBudget` exactly as today. Do not alter this control flow — only wrap the `graph.invoke()` call (lines 258-275) with:
1. A new per-request `CallbackHandler` (see Shared Patterns > Langfuse Tagging below) — this file currently passes **no** `callbacks` at all (confirmed gap, RESEARCH.md D-14/Pitfall 1).
2. Additional `config.configurable` keys (`supabase`, `serviceClient`, `branchId`) that `ai.ts` already sets but this file's `scanBranch()` never has (RESEARCH.md Pitfall 5) — needed for Coach participant-profile personalization to reach the proactive path.

**Cooldown read/write pattern to keep unchanged** (lines 394-440, `readCooldownUntil`/`recordCooldown`): uses `graph.getState()`/`graph.updateState()` against `triggerMetadata.silence_gate` in PostgresSaver checkpoint state — this is the exact BOT-05 precedent D-07's re-anchor counter should mirror (see `state.ts` / `facilitation-agent.ts` below), just for a different Annotation key.

**D-03/D-04 addition (new logic, no direct in-repo analog):** when silence fires, also read `phaseReadinessSkill.detect()` (`apps/api/src/lib/skills/phase-readiness.ts`) if the Blueprint's new toggle (mirroring `drift_detection_enabled`) is on — reuse the Skill's existing exported `detect()` function, do not duplicate its N/M gate logic (RESEARCH.md "Don't Hand-Roll" table).

---

### `apps/api/src/server.ts` (config / entrypoint — graceful shutdown wiring)

**Analog:** itself (current 33-line file) + `apps/api/src/lib/auto-freeze.ts`'s already-exported-but-never-called `clearAllTrackers()`.

**Current full pattern** (server.ts lines 1-33):
```typescript
import { serve } from "@hono/node-server";
import app from "./index";
import { env } from "./lib/env";
import { startAutoFreezeTracker } from "./lib/auto-freeze";
import { startSilenceScanLoop } from "./lib/silence-scan";
import { createServiceClient } from "./lib/supabase";
import { setupLangfuseOtel } from "./lib/langfuse-otel";

serve(
  { fetch: app.fetch, port: env.API_PORT },
  (info) => {
    console.log(`[panelito/api] Standalone server listening on port ${info.port}`);
    setupLangfuseOtel();
    startAutoFreezeTracker(createServiceClient()).catch((err) =>
      console.error("[panelito/api] auto-freeze tracker startup error:", err)
    );
    startSilenceScanLoop(createServiceClient()).catch((err) =>
      console.error("[panelito/api] silence-scan startup error:", err)
    );
  }
);
```
Change: rename `startSilenceScanLoop` import/call to `startTriggerEngine`, capture its returned stop function, and add `process.on('SIGTERM'/'SIGINT')` handlers calling that stop function plus `clearAllTrackers()` (already exported from `auto-freeze.ts` line 181, zero call sites today — confirmed by RESEARCH.md grep). Follow RESEARCH.md Pattern 2 verbatim; it already matches this file's `console.log('[panelito/api] ...')` prefix convention.

---

### `apps/api/src/lib/auto-freeze.ts` (config — D-05 constant change only)

**Analog:** itself.

**Exact line to change** (line 33):
```typescript
const FREEZE_AFTER_MS = parseInt(process.env.AUTO_FREEZE_AFTER_MS ?? '900000', 10)
```
→ default `'300000'` (5 min). The production-minimum warning at lines 42-47 also needs its threshold lowered from `900_000` to `300_000` to avoid spuriously warning on the new intended default — but do NOT lower `GRACE_MS`'s floor (line 36-41, unchanged per D-05: "the existing 30-second grace period is unchanged"). No other change to this file; `clearAllTrackers()` (line 181) is reused as-is (see server.ts above).

---

### `apps/api/src/lib/langfuse-otel.ts` (config — D-13 `environment` field)

**Analog:** itself.

**Exact construction site to extend** (lines 66-71):
```typescript
const processor = new LangfuseSpanProcessor()
const provider = new BasicTracerProvider({ spanProcessors: [processor] })
otelApi.trace.setGlobalTracerProvider(provider)
setLangfuseTracerProvider(provider)
;(globalThis as Record<symbol, unknown>)[_GLOBAL_KEY] = { processor }
```
Per RESEARCH.md's Anti-Patterns section: `environment` is a `LangfuseSpanProcessor` constructor option (or `LANGFUSE_TRACING_ENVIRONMENT` env var fallback — Assumption A3), NOT a per-request tag. Extend the `new LangfuseSpanProcessor()` call here, not `ai.ts`'s per-request `CallbackHandler`. Preserve the existing `_getState()`/globalThis hot-reload guard pattern (lines 40-46) unchanged.

---

### `apps/api/src/lib/langfuse-generation.ts` (NEW — no direct analog, first use of `@langfuse/tracing`)

**Analog:** none in-repo (RESEARCH.md confirms `@langfuse/tracing` has zero existing usages — `grep` confirmed). Nearest structural precedent is `apps/api/src/routes/ai.ts`'s per-request `CallbackHandler` construction (lines 364-369) for the "construct fresh per call, never module-level" convention, plus `langfuse-otel.ts`'s `flushLangfuse()` null-safe/never-throws wrapper style (lines 83-91).

**Pattern to follow (from RESEARCH.md Pattern 3, verify exact export name against installed `@langfuse/tracing@5.9.1` `.d.ts` first — Assumption A1):**
```typescript
import { startObservation } from '@langfuse/tracing'

const generation = startObservation('facilitation-coach', { asType: 'generation' }, {
  model: TASK_MODELS[providerName ?? 'anthropic'].facilitation,
  input: system,
})

let usage: { inputTokens: number; outputTokens: number } | undefined
for await (const event of adapter.stream(messages, [], { model, maxTokens: 256, system })) {
  if (event.type === 'text_delta') streamWriter?.(event.text)
  if (event.type === 'usage') usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens }
}

generation.update({
  usageDetails: usage ? { input: usage.inputTokens, output: usage.outputTokens } : undefined,
  metadata: { trigger: state.triggerType ?? state.firingSkillId ?? 'human-reactive', tier: 'fast' },
})
generation.end()
```
**Null-safety convention to copy from `langfuse-otel.ts`'s `flushLangfuse()`** (lines 83-91) — never let a Langfuse call throw and break the actual LLM invocation:
```typescript
export async function flushLangfuse(): Promise<void> {
  const processor = _getState()?.processor
  if (!processor) return
  try {
    await processor.forceFlush()
  } catch (err) {
    console.warn('[langfuse-otel] forceFlush error (non-fatal):', (err as Error).message)
  }
}
```
Wrap the new helper's `startObservation`/`.update()`/`.end()` calls the same way — a Langfuse SDK failure must never abort a Coach/Analyst turn.

---

### `apps/api/src/lib/adapters/anthropic.ts` / `openai.ts` / `gemini.ts` (service, streaming — add `usage` event)

**Analog:** each adapter is the analog for the other two — all three implement the same `AIProvider.stream()` contract (`packages/types/src/ai.ts`).

**Shared contract to extend** (`packages/types/src/ai.ts` — `AIStreamEvent` union, referenced but not shown in full above; confirmed 3-member union `text_delta | tool_use | done` per RESEARCH.md). Add a new member:
```typescript
{ type: 'usage'; inputTokens: number; outputTokens: number }
```

**Anthropic — exact insertion point** (anthropic.ts, inside the `try` block before the existing `finally { yield { type: 'done' } }`, lines 122-165):
```typescript
try {
  const apiStream = client.messages.stream(streamParams)
  apiStream.on('text', (text: string) => { enqueue({ type: 'text_delta', text }) })
  apiStream.on('contentBlock', (block: Anthropic.ContentBlock) => {
    if (block.type === 'tool_use') enqueue({ type: 'tool_use', name: block.name, input: block.input })
  })
  const donePromise = apiStream.done().then(() => { /* existing */ })
  // ... existing while(true) yield loop ...
  await donePromise
  // NEW: capture usage after the stream fully resolves
  const finalMessage = await apiStream.finalMessage()
  enqueue({ type: 'usage', inputTokens: finalMessage.usage.input_tokens, outputTokens: finalMessage.usage.output_tokens })
} finally {
  yield { type: 'done' }
}
```
Note the existing `apiStream.on('text', ...)` / `apiStream.on('contentBlock', ...)` / queue-based `enqueue()`/`waitForItem()` bridge (lines 90-109) — reuse this exact queue mechanism to enqueue the new `usage` event; do not build a second delivery path.

**OpenAI — same `try/finally` shape** (openai.ts lines 46-128): OpenAI's streaming API needs `stream_options: { include_usage: true }` added to the `client.chat.completions.stream({...})` call (line 73-78) to receive a final `usage` chunk (RESEARCH.md Assumption A2 — verify field name at implementation time). Follow the exact same "only emit after the chunk carrying it arrives" idiom already used here for `tool_calls` (`finish_reason === 'tool_calls'`, lines 111-122) — i.e., check for the presence of `chunk.usage` on the terminal chunk and `yield { type: 'usage', ... }` there, inside the existing `for await (const chunk of stream)` loop, before the `finally`.

**Gemini** — same `AIStreamEvent`/`try-finally` contract; capture `usageMetadata` off the final streamed chunk (RESEARCH.md Assumption A2). Use `anthropic.ts`/`openai.ts` as the two side-by-side reference implementations for the exact try/finally/queue shape gemini.ts already follows (109 lines, same interface).

**Anti-pattern to avoid (explicitly named in openai.ts's own doc comment, line 9):** `NEVER calls stream.finalMessage()` for OpenAI (kills first-token latency) — this only applies to OpenAI; Anthropic's adapter DOES call `finalMessage()` today (already used for `donePromise`), so adding usage capture there via the same `finalMessage()` call is safe and free (no extra network round-trip, it resolves off the already-streamed data).

---

### `apps/api/src/graph/nodes/facilitation-agent.ts` (controller / LangGraph node — D-06/D-07 re-anchor + Generation wrap)

**Analog:** itself — extend in place.

**Imports pattern** (lines 32-39, keep unchanged, add one new import for the Langfuse helper):
```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Blueprint, ProviderName, Personality, ArgNode, ArgEdge } from '@panelito/types'
import { createAdapter } from '../../lib/adapter-factory'
import { TASK_MODELS } from '../../lib/model-config'
import { summarizeArgGraph, summarizeParticipant, CONTEXT_WINDOWS } from '../../lib/bot-context'
import { getParticipantProfile } from '../../lib/participant-profile'
import { COACH_SKILLS } from '../../lib/skills'
import type { GraphState } from '../state'
```

**Fail-silent adapter pattern to preserve** (lines 120-127):
```typescript
const adapter =
  facilitationAdapter ??
  (providerName && plaintextKey ? createAdapter(providerName, plaintextKey) : null)

if (!adapter) {
  console.error('[facilitation] no adapter available (missing providerName/plaintextKey) — returning no output')
  return {}
}
```
Keep this exact fail-silent (`return {}`) convention for any new error path the re-anchor/Generation-wrap logic introduces.

**Core stream + partial-state-return pattern to extend** (lines 168-196):
```typescript
try {
  for await (const event of adapter.stream(
    state.messages.slice(-CONTEXT_WINDOWS.facilitation),
    [],
    { model: TASK_MODELS[providerName ?? 'anthropic'].facilitation, maxTokens: 256, system },
  )) {
    if (event.type === 'text_delta') {
      config?.configurable?.streamWriter?.(event.text)
    }
  }
} catch (err) {
  console.error('[facilitation] adapter.stream error — returning no output', err)
  return {}
}

const previous = state.triggerMetadata?.silence_gate
return {
  triggerMetadata: {
    ...state.triggerMetadata,
    silence_gate: {
      last_fired_at: new Date().toISOString(),
      cooldown_until: previous?.cooldown_until ?? null,
    },
  },
}
```
This is the exact overwrite-style partial-state-return idiom (`triggerMetadata`) that D-07's `roleInvocationCounts` field must mirror — add a sibling field to the returned object (see `state.ts` below), incremented from `state.roleInvocationCounts?.coach ?? 0`, per RESEARCH.md's Pitfall 4 code example:
```typescript
const REANCHOR_EVERY_N_INVOCATIONS = 15
const currentCount = (state.roleInvocationCounts?.coach ?? 0) + 1
const shouldReanchor = currentCount % REANCHOR_EVERY_N_INVOCATIONS === 0
// splice an extra-emphasized reminder into `system` (buildCoachSystemPrompt output) when shouldReanchor
return {
  roleInvocationCounts: { ...state.roleInvocationCounts, coach: currentCount },
  triggerMetadata: { /* unchanged, as above */ },
}
```
Also wrap the `adapter.stream()` loop with the new `langfuse-generation.ts` helper (see above) to capture `usage` events and construct a Generation observation tagged `trigger: state.triggerType ?? state.firingSkillId ?? 'human-reactive'`.

**Prompt composition pattern to extend (D-06 re-anchor text insertion point)** — `buildCoachSystemPrompt()` (lines 46-100) composes in strict order: Role rules → Blueprint context → argGraph context → Skill guidance → Personality voice (step 4, line 90-97, appended LAST). The re-anchor reminder must be positioned "close to the generation point" (D-06) — i.e., appended as a new final step AFTER Personality voice (or as the very last string in the returned prompt), not spliced into step 1, to satisfy the "recency boost against lost-in-the-middle" rationale while still respecting the fixed composition order comment at the top of the file ("NEVER reorder — Pitfall 4"): add step 5, do not reorder 1-4.

---

### `apps/api/src/graph/nodes/analytics-agent.ts` (controller / LangGraph node)

**Analog:** `apps/api/src/graph/nodes/facilitation-agent.ts` — identical pattern, sibling Role node (Analyst instead of Coach). Same imports shape (lines 38-46), same fail-silent convention, same `ANALYST_SKILLS` lookup mirroring `COACH_SKILLS`. Apply the exact same `roleInvocationCounts.analyst` counter increment and Generation-wrap pattern shown above, keyed `analyst` instead of `coach` (D-07: independent per-role counters within the same branch-scoped state field).

---

### `apps/api/src/graph/state.ts` (model — new Annotation field)

**Analog:** itself — `triggerMetadata` (lines 99-105) is the direct precedent for D-07's new field (overwrite-style, `Record`-shaped, defaults to `{}`, safe for human-thread invocations that never populate it).

**Exact pattern to copy** (lines 99-105):
```typescript
/** Trigger metadata map keyed by trigger type (e.g. 'silence_gate').
 *  Overwrite-style: trigger implementations replace specific keys in Phase 11+.
 *  Default: empty record — safe for human thread invocations. */
triggerMetadata: Annotation<TriggerMetadata>({
  reducer: (_: TriggerMetadata, v: TriggerMetadata) => v,
  default: () => ({}),
}),
```
New field to add (RESEARCH.md Code Examples section, exact shape given):
```typescript
roleInvocationCounts: Annotation<Record<string, number>>({
  reducer: (_: Record<string, number>, v: Record<string, number>) => v,
  default: () => ({}),
}),
```
Place it in the "Bot infrastructure fields (Phase 10 — BOT-05)" section (lines 87-105) alongside `triggerMetadata`, per the file's own section-comment organization.

---

### `apps/api/src/routes/ai.ts` (controller / route — D-10/D-11/D-12/D-13)

**Analog:** itself — the ONLY current `CallbackHandler` construction site.

**Tag extension point** (lines 364-369):
```typescript
const callbackHandler = new CallbackHandler({
  tags: [`session:${sessionId}`, `branch:${activeBranchId ?? 'main'}`],
})
```
Extend the `tags` array with `trigger:human-reactive` and a model-tier tag (D-13: "trigger type" + "model tier", minimum). Do NOT add `environment` here — that lives in `langfuse-otel.ts` (see Anti-Patterns note above). This is also the template every other new `CallbackHandler` construction site (the TriggerEngine's `graph.invoke()`) should copy verbatim for the "construct per-request, never module-level" convention (D-16 comment on line 365).

**Fallback-removal point** (line 469, exact line to delete):
```typescript
accumulatedText = '[canvas updated]'  // minimal fallback for messages_content_check constraint
```
Surrounding condition to widen (lines 466-470):
```typescript
// --- Message insert (RESEARCH Pitfall 7: handle empty accumulatedText) ---
// T-07-08: empty accumulatedText + no canvasOps → skip INSERT
if (!accumulatedText.trim() && (finalState as any)?.canvasOps?.length > 0) {
  accumulatedText = '[canvas updated]'  // minimal fallback for messages_content_check constraint
}

if (accumulatedText.length > 0) {
  // ... existing INSERT block (lines 472-501) ...
}
```
Per D-10/D-11 and RESEARCH.md Pitfall 2: change to skip the INSERT entirely whenever `accumulatedText.trim().length === 0`, regardless of `canvasOps.length` — i.e., delete the fallback-text branch and let the *existing* `if (accumulatedText.length > 0)` guard (line 472) naturally skip the whole insert block. This is the same skip-condition idiom `silence-scan.ts` already uses at lines 277-280 (`if (accumulatedText.trim().length === 0) { ...; return }`) — extend that same widened condition here, don't invent a new one.

---

### `packages/types/src/speech-artifacts.ts` (NEW — utility/model, shared blocklist)

**Analog:** structural convention from `packages/types/src/blueprint.ts` (co-located schema+export module pattern) — no functional precedent exists since this is a net-new small utility. RESEARCH.md's own Code Examples section supplies the exact target shape:
```typescript
export const SPEECH_ARTIFACT_BLOCKLIST: readonly string[] = [
  '[canvas updated]',
  '[graph modified]',
  '[node added]',
  // Claude's discretion: add any others discovered during implementation/audit
] as const

export function containsSpeechArtifact(content: string): boolean {
  return SPEECH_ARTIFACT_BLOCKLIST.some((pattern) => content.includes(pattern))
}
```
**Critical correctness note (RESEARCH.md Pitfall 3):** the check MUST be `content.includes(pattern)` (substring), never `content === pattern` (whole-message equality) — a naive equality check misses artifact strings embedded mid-sentence. Remember to export this from `packages/types/src/index.ts`'s barrel (mirrors how `TriggerMetadataSchema`/`TriggerMetadata` are re-exported at `index.ts` lines 73-75).

---

### `apps/web/components/workspace/MessageBubble.tsx` (component — SPEECH-02 filter)

**Analog:** itself — the two render sites for `message.content` (line 246, AI bubble; line 282, human bubble) and `streamingText` (lines 238-243).

**Exact render sites to filter** (line 246):
```tsx
{/* Final completed content (not streaming) */}
{!isStreaming && message.content}
```
And streaming text (lines 237-243):
```tsx
{isStreaming && streamingText && (
  <>
    {streamingText}
    <span className="text-primary animate-pulse ml-0.5">▋</span>
  </>
)}
```
Wrap `message.content` and `streamingText` reads with `containsSpeechArtifact()` from `@panelito/types` before rendering. Per D-11, this component itself does NOT need to render "nothing" for a canvas-only turn — that suppression decision belongs one level up in `MessageList.tsx` (the `.map()`/`.filter()` call site), matching the existing architectural split where `MessageList` decides *which* messages to pass to `MessageBubble` (e.g. the existing `isSystemMessage` branch, lines 245-249 of `MessageList.tsx`) and `MessageBubble` only renders what it's given.

---

### `apps/web/components/workspace/MessageList.tsx` (component — D-11 zero chat-stream presence)

**Analog:** itself — the existing `isSystemMessage` row-type branch (lines 245-249) is the direct precedent for "this row renders differently based on a content predicate."

**Exact pattern to extend** (`.map()` loop, lines 244-293):
```tsx
{messages.map((msg) => {
  const isSystemMessage =
    msg.display_name === SYSTEM_DISPLAY_NAME ||
    msg.author_id === SYSTEM_AUTHOR_ID
  if (isSystemMessage) {
    return <SystemMessageBubble key={msg.id} message={msg} />
  }
  const isAI = msg.role === 'assistant'
  // ... existing bubble render ...
  return bubble
})}
```
Add a new early-return branch (mirroring the `isSystemMessage` short-circuit shape) that returns `null` for assistant messages matching `containsSpeechArtifact(msg.content)` — per D-11, zero chat-stream presence means no bubble, no icon, no row at all (not even a dimmed placeholder). RESEARCH.md's own Code Example gives the filter-at-map-input variant:
```tsx
import { containsSpeechArtifact } from '@panelito/types'
{messages
  .filter((msg) => !(msg.role === 'assistant' && containsSpeechArtifact(msg.content)))
  .map((msg) => { /* existing render logic unchanged */ })}
```
Either the `.filter()`-before-`.map()` form or an early `return null` inside the existing `.map()` callback works — prefer whichever integrates more cleanly with the existing fork-separator wrapper logic (lines 276-290) that also keys off `msg.id`, since a filtered-out message must not break that fork-point lookup for adjacent messages.

---

### `packages/types/src/blueprint.ts` (model — D-04 silence↔phase-readiness toggle)

**Analog:** itself — `drift_detection_enabled` (lines 80-84) is the named, exact precedent (12-CONTEXT.md D-09).

**Exact precedent to copy the shape of** (lines 80-84):
```typescript
// D-09 (Phase 12): explicit opt-out for domains where an "on-topic scope" doesn't
// meaningfully apply. Follows the drift_reply_probability precedent — optional in DB,
// Zod supplies the default so existing seeded Blueprints (which lack this field) still parse.
drift_detection_enabled: z.boolean().default(true),
```
Add a new sibling boolean field for D-04 (exact name is Claude's discretion, e.g. `silence_phase_readiness_coupling_enabled: z.boolean().default(false)`), following the same "optional in DB, Zod supplies default, existing seeded Blueprints still parse" convention. Note the file also has a per-phase gate shape precedent (`phase_readiness_gate`, lines 49-54, nested inside `PhaseSequenceSchema`) if the toggle needs to be phase-scoped rather than Blueprint-global — confirm against D-04's exact wording (Blueprint-level, not phase-level, per CONTEXT.md's framing "Blueprints that opt in").

## Shared Patterns

### Per-request (never module-level) Langfuse `CallbackHandler` construction
**Source:** `apps/api/src/routes/ai.ts:364-369`
**Apply to:** `apps/api/src/routes/ai.ts` (extend existing) AND `apps/api/src/lib/trigger-engine.ts` (new construction site — today's `silence-scan.ts` passes `callbacks: []` nowhere at all, confirmed gap)
```typescript
const callbackHandler = new CallbackHandler({
  tags: [`session:${sessionId}`, `branch:${activeBranchId ?? 'main'}`],
})
// ...
{ configurable: {...}, callbacks: [callbackHandler] }
```
D-12/D-13 extend the `tags` array on both call sites with `trigger:<type>` and a model-tier tag; the array shape and per-request instantiation timing must not change.

### Fail-silent / fail-open error handling with `[modulename]` log prefix
**Source:** `apps/api/src/graph/nodes/facilitation-agent.ts:180-183`, `apps/api/src/lib/silence-scan.ts` (every `catch` block, e.g. lines 156-160, 185-188, 345-348)
```typescript
catch (err) {
  console.error('[facilitation] adapter.stream error — returning no output', err)
  return {}
}
```
Apply to: TriggerEngine's per-tick error isolation, adapter usage-capture additions, the new Langfuse Generation helper — every new failure path must degrade gracefully (never throw into the graph/HTTP response) and use the `[modulename]` bracket-prefix convention already established across this codebase.

### Overwrite-style `Annotation` field for per-role/per-branch state (BOT-05 invariant)
**Source:** `apps/api/src/graph/state.ts:99-105` (`triggerMetadata`)
```typescript
triggerMetadata: Annotation<TriggerMetadata>({
  reducer: (_: TriggerMetadata, v: TriggerMetadata) => v,
  default: () => ({}),
}),
```
Apply to: `roleInvocationCounts` (D-07's re-anchor counter) — MUST persist via `PostgresSaver` checkpoint (returned from the node function as partial state), never JS process memory (explicitly the anti-pattern named in RESEARCH.md Pitfall 4, contrasted against `auto-freeze.ts`'s explicitly-accepted-limitation `trackerMap`, which is NOT an acceptable precedent here).

### Explicit Blueprint boolean toggle, optional-with-default (never overload existing fields)
**Source:** `packages/types/src/blueprint.ts:80-84` (`drift_detection_enabled`)
Apply to: D-04's silence↔phase-readiness coupling toggle. New field, own name, `.default()` so existing seeded Blueprints (which lack it) still parse without a DB migration.

### `AIProvider.stream()` try/finally + queue-bridge shape (all three adapters)
**Source:** `apps/api/src/lib/adapters/anthropic.ts:122-165`, `apps/api/src/lib/adapters/openai.ts:46-128`
Apply to: adding the new `usage` `AIStreamEvent` member to all three adapters — the `finally { yield { type: 'done' } }` wrapper (RESEARCH.md Pitfall 4 precedent, "done emitted exactly once regardless of success or error") must remain outermost; the new usage-capture logic goes inside the `try`, before the implicit fall-through to `finally`.

## No Analog Found

Files/mechanisms with no close in-repo match — planner should lean on RESEARCH.md's own Code Examples/Pattern sections instead of a codebase analog:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/api/src/lib/langfuse-generation.ts` | utility | transform | `@langfuse/tracing`'s manual `startObservation`/Generation API has zero existing call sites anywhere in this codebase (confirmed via `grep`, RESEARCH.md) — no in-repo pattern to copy; RESEARCH.md Pattern 3 is the best available reference, verify exact export name against installed `.d.ts` first (Assumption A1) |
| `node:timers/promises`-based async-iterator loop in `trigger-engine.ts` | service | timer-poll | This codebase has no existing usage of `node:timers/promises`'s async-iterator `setInterval` anywhere (`silence-scan.ts` uses raw callback `setInterval`) — RESEARCH.md Pattern 1 is a synthesized-from-Node-docs pattern, not a codebase-derived one |
| SIGTERM/SIGINT graceful shutdown wiring | config | event-driven | Confirmed zero existing `process.on('SIGTERM'\|'SIGINT')` call sites anywhere in `apps/api/src` (RESEARCH.md verified grep) — `auto-freeze.ts`'s `clearAllTrackers()` is exported but has zero callers; RESEARCH.md Pattern 2 is the reference to follow |

## Metadata

**Analog search scope:** `apps/api/src/lib/`, `apps/api/src/graph/nodes/`, `apps/api/src/graph/`, `apps/api/src/routes/`, `apps/api/src/lib/adapters/`, `apps/api/src/lib/skills/`, `packages/types/src/`, `apps/web/components/workspace/`
**Files scanned:** 18 (direct reads) — `silence-scan.ts`, `server.ts`, `auto-freeze.ts`, `langfuse-otel.ts`, `ai.ts` (relevant sections), `state.ts`, `facilitation-agent.ts`, `analytics-agent.ts`, `anthropic.ts`, `openai.ts`, `blueprint.ts`, `ai.ts` (types), `MessageBubble.tsx`, `MessageList.tsx`, `phase-readiness.ts`, `trigger-gate.ts` (line-count only), `drift-redirect.ts` (line-count only), `bot.ts` (grep only)
**Pattern extraction date:** 2026-07-17
