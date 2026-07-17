# Phase 14: Polish + TriggerEngine Wiring - Research

**Researched:** 2026-07-17
**Domain:** Node.js long-running background loops, LangGraph node instrumentation, LLM output filtering, Langfuse cost observability with a custom multi-provider adapter layer
**Confidence:** HIGH for codebase-derived findings (read directly from source); MEDIUM-HIGH for Langfuse SDK behavior (WebFetch-verified against official docs, no Context7 available in this environment); MEDIUM for Node.js timer best-practice claims (WebSearch, cross-checked against Node docs/GitHub issue)

## Summary

This phase is almost entirely **integration and hardening**, not new subsystem construction. Five of six trigger types are already reactive and complete (Phases 12-13); the only genuinely new runtime component is a persistent `setInterval`-driven re-evaluation of the **silence-window** trigger, generalized from the existing Phase 11 `startSilenceScanLoop()` in `apps/api/src/lib/silence-scan.ts`. That module already does 90% of what TRIGGER-07 asks for — it just needs a rename/generalization (per CONTEXT.md D-01), a longer interval (D-02), drift-correction/graceful-shutdown hygiene it currently lacks, and closure of a confirmed Langfuse tracing gap.

The most significant finding from this research is that **COST-03's D-14 concern is not hypothetical — it is confirmed by direct code inspection**: every LLM call in this codebase (`facilitation-agent.ts`, `analytics-agent.ts`, `agent.ts`, `orchestrator.ts`, `drift-reply.ts`, `arg-graph-builder.ts`) calls `adapter.stream()` from this project's own custom `AIProvider` interface (`createAdapter()` → `AnthropicAdapter`/`OpenAIAdapter`/`GeminiAdapter`), never a LangChain `BaseChatModel`. Langfuse's `@langfuse/langchain` `CallbackHandler` only auto-populates generation-level cost/usage when the underlying LLM call itself is a LangChain model invocation (`on_llm_start`/`on_llm_end` events) — a plain async function calling the Anthropic/OpenAI/Gemini SDKs directly, inside a LangGraph node, produces only **chain-level spans with no model name and no token usage**. Worse, the `AIStreamEvent` union (`text_delta | tool_use | done`) that all three adapters emit **carries no usage/token data at all today** — none of the three adapters read `usage` off the underlying SDK response. This means cost attribution cannot "just work" by adding tags; it requires (a) a new `usage` event surfaced by each adapter from data the underlying SDKs already return for free, and (b) manual Langfuse `Generation` observations (`startObservation({ asType: 'generation' })` + `usageDetails`) constructed at each LLM call site, since ingested usage always takes priority over Langfuse's model-based inference.

**Primary recommendation:** Rename/generalize `silence-scan.ts` into a `trigger-engine.ts` module using a drift-aware async loop (prefer `setInterval` from `node:timers/promises` over the raw callback-based `setInterval`, matching Node 22's built-in support), add SIGTERM/SIGINT-based graceful shutdown (currently absent anywhere in this codebase), extend all three `AIProvider` adapters to emit a `usage` event carrying real token counts, wrap every `graph.invoke()`/`graph.stream()` call site (`ai.ts`, the new TriggerEngine module) with a per-request `CallbackHandler` carrying `trigger`/`tier` tags, and manually construct Langfuse `Generation` observations with `usageDetails` at each node's `adapter.stream()` call using the now-real usage data.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TriggerEngine `setInterval`/timer loop | API / Backend (standalone Node server, `server.ts`) | Database/Storage (PostgresSaver cooldown state) | Must survive the full session lifetime independent of any HTTP request; genuinely backend-owned. Cooldown/counter state is read/written via LangGraph checkpoints, not held in process memory (BOT-05) |
| Persona re-anchor (invocation counter + prompt injection) | API / Backend (`facilitation-agent.ts`/`analytics-agent.ts` node functions) | Database/Storage (PostgresSaver thread state) | Counter increments happen inside the Role node itself; must persist across cold starts/restarts per BOT-05, not JS process memory |
| Speech artifact filtering — prompt discipline (SPEECH-01) | API / Backend (system prompt text in each Role node) | — | Purely a prompt-engineering concern; no runtime enforcement code, only instructional text |
| Speech artifact filtering — defense-in-depth (SPEECH-02) | Browser / Client (React render layer, `MessageBubble.tsx`/`MessageList.tsx`) | — | Locked decision D-09 explicitly places this at the frontend rendering layer only; no backend/API filtering layer in scope |
| Canvas-only turn zero-presence (SPEECH-03/D-11) | Browser / Client (render-time row suppression) + API / Backend (skip-insert logic in `ai.ts`) | — | Two-sided fix: backend must stop writing a placeholder row (`ai.ts:469`), frontend must not render a row for content matching the blocklist |
| Cost attribution tagging (COST-03) | API / Backend (every `graph.invoke()`/`graph.stream()` call site + adapter-level usage capture) | External: Langfuse (observability backend, not app DB) | Tags/metadata and generation observations must be constructed exactly where the LLM call happens; today only `ai.ts` constructs a `CallbackHandler` and it carries no trigger/tier tags |
| Auto-freeze timeout adjustment (D-05) | API / Backend (single constant in `auto-freeze.ts`) | — | Pure configuration change, no new architecture |

## Project Constraints (from CLAUDE.md)

- **AI coupling:** all LLM calls MUST route through `TASK_MODELS`/`adapter-factory.ts` across anthropic/openai/gemini (BYOK) — confirmed as the existing pattern in every graph node; any adapter changes for usage-token capture (see Cost Attribution findings below) must preserve this abstraction, never leak provider-specific types into `packages/types/src/ai.ts`.
- **Supabase-first:** real-time subscriptions/auth/storage stay in Supabase — no new backend infra needed for this phase.
- **Budget (BYOK):** the creator's API key is the cost surface — directly relevant to D-05's auto-freeze reduction and to COST-03; any new Langfuse instrumentation must not itself become a hidden cost (Langfuse SDK calls are free/local-tracing, no LLM calls of their own).
- **What NOT to use:** no Socket.io (Supabase Realtime only, already the pattern in `silence-scan.ts`'s `httpSend` broadcast); no tRPC; no Prisma. None of these are implicated by this phase's scope.
- **Mobile-first / IME:** not implicated — this phase touches no viewport/keyboard-sensitive UI, only message-bubble render logic (SPEECH-02/03) and no new layout surfaces.

## Package Legitimacy Audit

No new external packages are required for this phase. All work uses libraries already installed and locked in `apps/api/package.json` (`@langfuse/langchain`, `@langfuse/otel`, `@langfuse/tracing` at `5.9.1`) plus Node.js 22 built-ins (`node:timers/promises`, `AbortController`, `process.on('SIGTERM'/'SIGINT')`). `node --version` on this machine confirms `v22.17.1`, satisfying the `engines.node: ">=22"` constraint in `package.json`.

**Packages removed due to slopcheck [SLOP] verdict:** none (no new packages proposed)
**Packages flagged as suspicious [SUS]:** none

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@langfuse/langchain` | 5.9.1 (installed, `[VERIFIED: apps/api/package.json]`) | `CallbackHandler` for per-request trace construction | Already the project's chosen Langfuse integration since Phase 6/7 (OBS-01/OBS-02) |
| `@langfuse/otel` | 5.9.1 (installed) | `LangfuseSpanProcessor` — OTel span exporter, environment field lives here | Already bootstrapped in `langfuse-otel.ts` |
| `@langfuse/tracing` | 5.9.1 (installed) | Low-level `startObservation`/`updateActiveObservation` for **manual** Generation observations | Required net-new for this phase — see Cost Attribution findings; not currently imported anywhere in the codebase (`grep` confirmed zero usages) |
| `node:timers/promises` | Node 22 built-in | Async-iterator `setInterval` for the TriggerEngine loop | Avoids manual re-entrancy/drift bookkeeping the current `silence-scan.ts` callback-based `setInterval` doesn't handle `[CITED: nodejs.org/api/timers.html]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | already a dependency across the monorepo | Schema for a new shared speech-artifact blocklist module in `@panelito/types`, if a typed export is preferred over a plain `string[]` | Optional — a plain exported `const` array is sufficient per D-08's "curated exact-string list" decision |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:timers/promises setInterval` async loop | Recursive `setTimeout` (manual reschedule after each async tick completes) | Functionally equivalent (both avoid overlap by construction); `timers/promises` is less code and is the pattern Node's own docs and 2026-era guides recommend for async work `[CITED: WebSearch/nodejs.org]` — recommended over hand-rolling. |
| Manual Langfuse `Generation` observations via `@langfuse/tracing` | Wrapping each provider adapter in a thin LangChain `BaseChatModel` subclass so `CallbackHandler` auto-detects usage | Rejected: this would be a much larger refactor of `adapter-factory.ts`/`AIProvider` (CLAUDE.md's "AI coupling" constraint names this exact abstraction as load-bearing) for uncertain benefit; manual instrumentation is additive and does not touch the adapter interface's calling contract from node code (only its return shape). |

**Installation:**
No new packages to install. `@langfuse/tracing` is already a transitive/direct dependency at `5.9.1` — only a new import is needed (`import { startActiveObservation } from '@langfuse/tracing'` or `startObservation`, confirm exact export name against the installed version's `.d.ts` at implementation time since this project's version is not yet exercised this way anywhere in the codebase).

**Version verification:** `apps/api/package.json` pins all three `@langfuse/*` packages at exactly `5.9.1` — confirmed via direct file read, not registry lookup (no version bump needed or recommended this phase).

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────┐
                         │         server.ts (standalone Node)      │
                         │                                           │
   Human message ──────► │  POST /invoke (ai.ts)                    │
                         │    │                                     │
                         │    ├─► per-request CallbackHandler        │
                         │    │     tags: [session, branch,          │
                         │    │            trigger:human-reactive]   │──┐
                         │    │                                     │  │
                         │    └─► graph.stream(..., {callbacks})     │  │
                         │          │                                │  │
                         │          ▼                                │  │
                         │   ┌────────────────────────────┐          │  │
                         │   │  LangGraph StateGraph        │          │  │
   TriggerEngine tick ──►│   │  START → orchestrator/       │          │  │
   (setInterval,         │   │  facilitation/analysis →     │          │  │
    ~1 min, silence-     │   │  mutationGate → triggerGate  │          │  │
    window only) ────────┤   │  → facilitation | analysis   │          │  │
                         │   └────────────┬─────────────────┘          │  │
                         │                │ adapter.stream()            │  │
                         │                ▼                             │  │
                         │   ┌──────────────────────────────┐          │  │
                         │   │ createAdapter(provider,key)   │          │  │
                         │   │ Anthropic/OpenAI/Gemini SDK    │          │  │
                         │   │ (NEW: emits `usage` event)     │──────────┘  │
                         │   └──────────────────────────────┘               │
                         │                │ text_delta / tool_use / usage   │
                         │                ▼                                 │
                         │   manual Generation observation                  │
                         │   (asType:'generation', usageDetails,             │
                         │    model, tags: trigger-type + tier)  ───────────┘
                         │                │
                         │                ▼
                         │   messages INSERT (Supabase) — SKIPPED entirely
                         │   when accumulatedText is empty (D-11), never a
                         │   '[canvas updated]' placeholder
                         └─────────────────────────────┬─────────────────────┘
                                                        │ Supabase Realtime broadcast
                                                        ▼
                                          ┌───────────────────────────┐
                                          │  apps/web (Next.js client) │
                                          │  MessageList → MessageBubble│
                                          │  SPEECH-02 blocklist filter │
                                          │  (shared @panelito/types    │
                                          │   list) → render nothing    │
                                          │   for matched content       │
                                          └───────────────────────────┘
                                                        │
                                                        ▼
                                          Langfuse Cloud (external) ── dashboard
                                          groups traces by trigger-type tag,
                                          shows per-generation cost via
                                          ingested usageDetails
```

### Recommended Project Structure

No new top-level directories. Additive/renamed files within existing structure:

```
apps/api/src/
├── lib/
│   ├── trigger-engine.ts       # renamed/generalized from silence-scan.ts (D-01)
│   ├── auto-freeze.ts          # AUTO_FREEZE_AFTER_MS constant changed only (D-05)
│   ├── langfuse-otel.ts        # + environment field passed to LangfuseSpanProcessor
│   ├── langfuse-generation.ts  # NEW: shared helper wrapping startObservation for manual Generation spans
│   └── adapters/
│       ├── anthropic.ts        # + usage AIStreamEvent variant
│       ├── openai.ts           # + usage AIStreamEvent variant
│       └── gemini.ts           # + usage AIStreamEvent variant
├── graph/nodes/
│   ├── facilitation-agent.ts   # + re-anchor counter read/increment, + Generation wrapping around adapter.stream()
│   └── analytics-agent.ts      # + re-anchor counter, + Generation wrapping
├── graph/state.ts              # + new Annotation field for per-role invocation counters
└── routes/ai.ts                # tag extension (trigger:human-reactive/tier), remove '[canvas updated]' fallback

packages/types/src/
└── speech-artifacts.ts         # NEW: shared blocklist array + isSpeechArtifact() helper

apps/web/components/workspace/
├── MessageBubble.tsx           # apply blocklist filter to message.content / streamingText
└── MessageList.tsx             # suppress the entire row for canvas-only / blocklisted turns (D-11)
```

### Pattern 1: Drift-aware persistent scan loop (replaces raw `setInterval`)

**What:** Use the async-iterator form of `setInterval` from `node:timers/promises` so each tick is awaited before the next fires — this removes the overlap hazard raw `setInterval` has when a tick's async body outlives the interval period, and needs no manual `Date.now()` drift bookkeeping.
**When to use:** Any persistent per-branch scan loop that must survive the full session lifetime, including the TriggerEngine.
**Example:**
```typescript
// Source: node:timers/promises — Node.js v22 API docs [CITED: nodejs.org/api/timers.html]
import { setInterval as asyncInterval } from 'node:timers/promises'

export async function startTriggerEngine(supabase: SupabaseClient, graph: CompiledGraph): Promise<() => void> {
  const controller = new AbortController()

  ;(async () => {
    try {
      for await (const _tick of asyncInterval(SCAN_INTERVAL_MS, undefined, { signal: controller.signal })) {
        try {
          await runSilenceScan(supabase, graph)
        } catch (err) {
          // Per-tick error isolation — one bad tick must never kill the loop
          console.error('[trigger-engine] uncaught error in scan tick', err)
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[trigger-engine] loop terminated unexpectedly', err)
      }
    }
  })()

  console.log(`[trigger-engine] scan loop started (interval: ${SCAN_INTERVAL_MS}ms)`)

  // Return a stop function for graceful shutdown (Pattern 2)
  return () => controller.abort()
}
```

### Pattern 2: Graceful shutdown wiring (currently absent in this codebase)

**What:** Register `SIGTERM`/`SIGINT` handlers in `server.ts` that stop the TriggerEngine loop and the existing auto-freeze trackers before process exit.
**When to use:** Any standalone (non-serverless) Node process with background timers — required here because `server.ts` is explicitly a long-running standalone process (TRIGGER-07), unlike the Vercel-hosted Hono bridge.
**Example:**
```typescript
// Source: pattern synthesized from Node.js process docs + WebSearch (oneuptime.com graceful shutdown guide)
// [CITED: nodejs.org/api/process.html#signal-events]
const stopTriggerEngine = await startTriggerEngine(supabase, graph)

function shutdown(signal: string): void {
  console.log(`[panelito/api] received ${signal}, shutting down`)
  stopTriggerEngine()
  clearAllTrackers() // apps/api/src/lib/auto-freeze.ts — already exported, never called today
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
```
**Verified gap:** `grep -rn "SIGTERM\|process.on(" apps/api/src` returns only the doc-comment in `auto-freeze.ts` mentioning `clearAllTrackers` — the function is exported but has **zero call sites** anywhere in the codebase today `[VERIFIED: codebase grep]`. This phase is a natural place to close that gap since it is explicitly about the standalone server's lifecycle.

### Pattern 3: Manual Langfuse Generation observation for a non-LangChain LLM call

**What:** Since `adapter.stream()` is a plain async generator (not a LangChain `BaseChatModel`), `CallbackHandler` cannot auto-detect the model call inside a node. Wrap each node's `adapter.stream()` call with a manually-constructed `generation` observation, closing it with real usage data once the stream completes.
**When to use:** Every node that calls `createAdapter(...).stream(...)` — `facilitation-agent.ts`, `analytics-agent.ts`, `agent.ts`, `orchestrator.ts`, `drift-reply.ts`, `arg-graph-builder.ts`.
**Example:**
```typescript
// Source: Langfuse Token & Cost Tracking docs [CITED: langfuse.com/docs/observability/features/token-and-cost-tracking]
// Exact export name (`startObservation` vs `startActiveObservation`) must be confirmed against
// the installed @langfuse/tracing@5.9.1 .d.ts at implementation time — not yet exercised in this codebase.
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

### Anti-Patterns to Avoid

- **Assuming `CallbackHandler` tags alone will populate Langfuse's cost dashboard:** confirmed false for this codebase — cost requires model name + usage on a `generation`-type observation, and this project's adapters emit neither today. Tags are necessary but not sufficient for COST-03.
- **Setting `environment` inside the per-request `CallbackHandler` constructor:** the `environment` field is configured on `LangfuseSpanProcessor` (module-level, at `setupLangfuseOtel()`'s one-time bootstrap) or via `LANGFUSE_TRACING_ENVIRONMENT` — not per-invocation in the JS/TS SDK `[CITED: langfuse.com/docs/observability/features/environments]`. This is a one-time config change in `langfuse-otel.ts`, not a per-request tag.
- **Raw `setInterval` without an async-completion guard for a tick whose body can outlive the interval:** the existing `silence-scan.ts` code is safe today only because per-branch `runArbitration`'s DB-level lock prevents double-firing, but the loop itself does not prevent overlapping `runSilenceScan` calls if the DB round-trips are slow. Prefer Pattern 1.
- **Writing `'[canvas updated]'` (or any other placeholder) as message content to satisfy the DB's `content between 1 and 4000` check constraint:** this is the exact string SPEECH-01 forbids. The fix is to skip the INSERT entirely (see Common Pitfalls) — matches the existing `T-07-08` precedent in `ai.ts` that already skips insert when there's no text AND no canvasOps; this phase extends that same skip condition to also cover the canvasOps-present case.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drift-correcting scan loop timing | Manual `Date.now()` delta tracking + recursive `setTimeout` | `node:timers/promises`'s async-iterator `setInterval` | Built into Node 22 already installed; zero new dependencies, avoids reinventing overlap/backoff logic `[CITED: nodejs.org]` |
| Two independently-maintained artifact blocklists (one for LLM prompt text, one for frontend filtering) | Copy-pasted string arrays in both `facilitation-agent.ts`'s system prompt and `MessageBubble.tsx` | A single exported array/helper in `@panelito/types` (already the shared package both apps depend on) | Prevents the two lists silently drifting apart — a newly discovered artifact string only needs to be added once |
| Token/cost estimation from character or word counts | A heuristic "~4 chars per token" estimator for Langfuse cost tags | The real `usage.input_tokens`/`usage.output_tokens` already returned free by Anthropic's `stream.finalMessage()`, OpenAI's streaming `usage` chunk, and Gemini's `usageMetadata` | These are exact, provider-reported numbers already available in each SDK response — the current adapters simply don't surface them yet; capturing them costs nothing extra |
| Reimplementing "nobody's adding anything → suggest advancing" phase logic inside the new TriggerEngine | A parallel phase-readiness heuristic duplicated from `phase-readiness.ts` | `phaseReadinessSkill.detect()` (already exists, already Blueprint-aware, already fails closed) | D-03 explicitly reads this existing Skill rather than duplicating its N/M gate + coverage-judgment LLM call |

**Key insight:** every piece of this phase that looks like "build a new X" is actually "wire an existing X in one more place." The one place genuinely missing infrastructure — Langfuse cost attribution — is missing it for a concrete, verifiable reason (custom adapter layer bypasses LangChain's auto-instrumentation hook), not because nobody built it; the fix is surfacing data the provider SDKs already compute, not inventing a new cost model.

## Runtime State Inventory

> Included because TRIGGER-07 involves renaming/generalizing `silence-scan.ts` into a `TriggerEngine` module (D-01).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `triggerMetadata.silence_gate` key persisted in LangGraph `PostgresSaver` checkpoints (`state.ts` `TriggerMetadata` type, keyed by trigger id string `'silence_gate'`, not by module/file name) | None — the key name is independent of the module being renamed; renaming `silence-scan.ts` → `trigger-engine.ts` does not require any data migration |
| Live service config | None found — no external service (n8n-style) holds this module's name in a UI-managed config | None |
| OS-registered state | None found — `server.ts` runs as a plain Node process (no systemd unit, no pm2 name, no Task Scheduler entry referencing "silence-scan") | None |
| Secrets/env vars | `SCAN_INTERVAL_MS`, `SILENCE_THRESHOLD_MS` read directly via `process.env` inside `silence-scan.ts` (not part of the Zod `EnvSchema` in `env.ts`) — renaming the file does not require renaming these env vars, though the planner may choose to rename them for consistency (e.g. `TRIGGER_ENGINE_SCAN_INTERVAL_MS`) since they are pure runtime config knobs, not persisted anywhere | Optional rename, no migration needed either way — confirm any `.env`/deploy config referencing the old names is updated if renamed |
| Build artifacts | None — this is a TypeScript source rename within a monorepo package; `tsc`/`tsx` regenerate output from source on every build, no stale compiled artifact carries the old name | None |

**Conclusion:** this is a low-risk rename — nothing outside the source file itself needs to change for the rename/generalization to be safe.

## Common Pitfalls

### Pitfall 1: Assuming Langfuse cost auto-populates once tags are added
**What goes wrong:** COST-03's dashboard shows traces with correct trigger-type tags but $0.00 or blank cost for every generation.
**Why it happens:** `CallbackHandler` (`@langfuse/langchain`) infers cost from LangChain's own `on_llm_start`/`on_llm_end` callback events, which only fire for LangChain `BaseChatModel` invocations. This project's LLM calls go through `adapter.stream()` (a plain async generator wrapping the Anthropic/OpenAI/Gemini SDKs directly) — confirmed via direct inspection of every graph node file (`facilitation-agent.ts`, `analytics-agent.ts`, `agent.ts`, `orchestrator.ts`, `drift-reply.ts`, `arg-graph-builder.ts`) `[VERIFIED: codebase]`. No `on_llm_*` event is ever emitted, so Langfuse sees only chain-level spans with no model name and no usage.
**How to avoid:** Manually construct a `generation`-type observation (Pattern 3) at each `adapter.stream()` call site, with real `usageDetails` sourced from a new `usage` event the adapters must be extended to emit.
**Warning signs:** Langfuse trace view shows nested spans for `facilitation`/`analysis` nodes but the "Generations" tab of the dashboard is empty or shows no cost column populated.

### Pitfall 2: Writing a placeholder string to satisfy the `messages` table CHECK constraint
**What goes wrong:** A canvas-only bot turn (no chat text) either violates `content between 1 and 4000` on INSERT, or (today's workaround) gets `'[canvas updated]'` written as a literal string — exactly what SPEECH-01 forbids.
**Why it happens:** `supabase/migrations/0001_initial_schema.sql` line 86: `content text not null check (length(content) between 1 and 4000)` `[VERIFIED: supabase/migrations/0001_initial_schema.sql:86]`. `ai.ts:469` currently works around this by inserting the literal artifact string when `accumulatedText` is empty but `canvasOps.length > 0`.
**How to avoid:** Skip the INSERT entirely when `accumulatedText.trim().length === 0`, regardless of whether `canvasOps` is non-empty — this already happens today for the *no-canvasOps* case (`T-07-08`); the fix is widening that same skip condition rather than picking different fallback text (D-10).
**Warning signs:** grep for the literal string `'[canvas updated]'` — it should have zero occurrences in `apps/api/src` after this phase.

### Pitfall 3: Frontend blocklist implemented as a strict-equality check on the whole message
**What goes wrong:** SPEECH-02's filter only catches messages that are *exactly* `"[canvas updated]"` and misses any message that contains the artifact string as a substring of otherwise-legitimate text (e.g. "Great, [canvas updated] — let's continue").
**Why it happens:** D-08 specifies an exact-string blocklist, but "exact string" should mean exact substring match against a curated list, not exact whole-message equality — the check needs to be `content.includes(blockedString)`, not `content === blockedString`.
**How to avoid:** Implement `isSpeechArtifact(content: string): boolean` as `SPEECH_ARTIFACT_BLOCKLIST.some(s => content.includes(s))`, and place it in `@panelito/types` so both a future prompt-discipline reference and the frontend filter share one implementation.
**Warning signs:** the 100-turn synthetic session (success criterion 3) still surfaces an artifact string embedded mid-message.

### Pitfall 4: Persona re-anchor counter stored in JS process memory
**What goes wrong:** The counter resets to 0 on every server restart/deploy, so re-anchor "every 15 invocations" silently stops firing at the intended cadence after any redeploy — and worse, on Vercel-hosted paths (if this logic is ever reached from a serverless function) the counter would never persist at all between invocations.
**Why it happens:** It is tempting to keep a `Map<branchId, Record<role, number>>` at module scope in `facilitation-agent.ts`/`analytics-agent.ts`, mirroring how `auto-freeze.ts`'s `trackerMap` works — but `auto-freeze.ts` is explicitly documented as accepting this limitation ("In-memory state does not survive API process restarts... acceptable for solo-developer demo scale"), which is NOT an acceptable precedent for PERSONA-04 given BOT-05's standing invariant.
**How to avoid:** Add a new overwrite-style `Annotation` field to `GraphStateAnnotation` (state.ts) for per-role invocation counts, incremented by returning a partial state update from the node function itself (mirrors how `triggerMetadata` is already updated) — this checkpoints automatically via `PostgresSaver` on every `graph.invoke()`, matching the `bot_cooldowns` `Record<roleId,...>` scoping precedent named in D-07.
**Warning signs:** counter resets to 0 after every deploy in a staging environment; re-anchor text never appears in Langfuse traces after 15 real invocations following a restart.

### Pitfall 5: TriggerEngine's `graph.invoke()` call still missing `supabase`/`branchId`/`participantId` in `config.configurable`
**What goes wrong:** Even after generalizing `silence-scan.ts` into the TriggerEngine, Coach silence-fires never get participant-profile personalization (`getParticipantProfile`/`summarizeParticipant` in `facilitation-agent.ts`), because those calls require `config.configurable.supabase` and `config.configurable.branchId`/`participantId`, which the current `scanBranch()` implementation never sets — only `thread_id`, `blueprint`, `providerName`, `plaintextKey`, `personality`, and `streamWriter` are set today `[VERIFIED: apps/api/src/lib/silence-scan.ts scanBranch() graph.invoke() call]`.
**Why it happens:** This config-key set predates Phase 13's participant-profile work; `ai.ts` (the human path) was updated to add these keys (13-CONTEXT.md D-12/D-13) but `silence-scan.ts` (the proactive path) was never symmetrically updated.
**How to avoid:** When generalizing into the TriggerEngine, add the same `supabase`/`serviceClient`/`branchId` keys `ai.ts` already sets. `participantId` for a silence-fire has no obvious "last human author" the way `ai.ts` derives it — Claude's discretion whether to resolve it from the most recent human message on the branch, or omit it (Coach personalization degrades gracefully to a generic summary via `summarizeParticipant(null)`, which never throws).
**Warning signs:** Coach's silence-triggered messages never reference "Earlier you mentioned X" — always generic phrasing — even in sessions with rich participant history.

### Pitfall 6: `botOverrides` role-activation gate confusion between TriggerGateNode and the silence path
**What goes wrong:** Assuming the new TriggerEngine needs to also pass `botOverrides` into `config.configurable` for `TriggerGateNode`'s role-activation gate.
**Why it happens:** `routeFromStart` (`graph.ts`) routes `triggerType === 'silence_gate'` directly to `'facilitation'`, **bypassing `TriggerGateNode` entirely** `[VERIFIED: apps/api/src/graph/graph.ts routeFromStart()]` — so `TriggerGateNode`'s `botOverrides ?? bot_defaults ?? false` gate is never consulted for this path. The Coach on/off check for silence fires already happens earlier in `scanSession()` via `session.bot_overrides?.coach ?? blueprint.bot_defaults?.coach ?? false`, independently of `TriggerGateNode`.
**How to avoid:** No change needed here — this is confirmed correct as-is. Do not add `botOverrides` to the TriggerEngine's `graph.invoke()` config under the assumption it's needed for `TriggerGateNode`; it is a dead key on this specific path.
**Warning signs:** none — this is a "don't fix what isn't broken" pitfall, listed to prevent an unnecessary code change during planning.

## Code Examples

### Adapter usage-event extension (Anthropic, illustrative — same idea applies to OpenAI/Gemini adapters)
```typescript
// Source: pattern derived from Anthropic TypeScript SDK docs [CITED: platform.claude.com/docs + WebSearch cross-check]
// Existing code (apps/api/src/lib/adapters/anthropic.ts) already does:
//   const apiStream = client.messages.stream(streamParams)
//   const donePromise = apiStream.done().then(() => { ... })
// Extend it to also capture usage before yielding the final 'done' event:
try {
  const apiStream = client.messages.stream(streamParams)
  apiStream.on('text', (text: string) => enqueue({ type: 'text_delta', text }))
  apiStream.on('contentBlock', (block) => {
    if (block.type === 'tool_use') enqueue({ type: 'tool_use', name: block.name, input: block.input })
  })

  const finalMessage = await apiStream.finalMessage() // resolves after stream completes; includes .usage
  enqueue({
    type: 'usage',
    inputTokens: finalMessage.usage.input_tokens,
    outputTokens: finalMessage.usage.output_tokens,
  })
  // ... existing done-signaling logic
} finally {
  yield { type: 'done' }
}
```
Note: `AIStreamEvent` (`packages/types/src/ai.ts`) needs a new union member: `{ type: 'usage'; inputTokens: number; outputTokens: number }`. All three adapters (Anthropic, OpenAI, Gemini) need this — OpenAI's streaming chunks include a final `usage` object when `stream_options: { include_usage: true }` is set; Gemini's SDK exposes `usageMetadata` on the final chunk. Confirm exact field names per-SDK at implementation time (not yet exercised in this codebase for any of the three).

### Shared speech-artifact blocklist
```typescript
// Source: new module, packages/types/src/speech-artifacts.ts — D-08 (curated exact-string list)
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
```tsx
// apps/web/components/workspace/MessageList.tsx — D-11 zero chat-stream presence
import { containsSpeechArtifact } from '@panelito/types'
// ...
{messages
  .filter((msg) => !(msg.role === 'assistant' && containsSpeechArtifact(msg.content)))
  .map((msg) => { /* existing render logic unchanged */ })}
```

### Per-role invocation counter (GraphState extension for PERSONA-04)
```typescript
// Source: new Annotation field, apps/api/src/graph/state.ts — mirrors triggerMetadata's
// overwrite-style pattern (D-07: per role, per branch — branch scoping already comes from
// the bot thread_id `${branchId}:bot`, so only role-keying is needed within state)
roleInvocationCounts: Annotation<Record<string, number>>({
  reducer: (_: Record<string, number>, v: Record<string, number>) => v,
  default: () => ({}),
}),
```
```typescript
// facilitation-agent.ts — increment + re-anchor check (exact field shape is Claude's discretion)
const REANCHOR_EVERY_N_INVOCATIONS = 15
const currentCount = (state.roleInvocationCounts?.coach ?? 0) + 1
const shouldReanchor = currentCount % REANCHOR_EVERY_N_INVOCATIONS === 0
// ... splice an extra-emphasized reminder of the Role contract close to the generation
// point in the prompt when shouldReanchor is true (D-06: prompt-only, no LLM call)
return {
  roleInvocationCounts: { ...state.roleInvocationCounts, coach: currentCount },
  // ...existing triggerMetadata return
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Single-trigger interim `startSilenceScanLoop()` (Phase 11) | Generalized TriggerEngine, still silence-only on the timer (D-01) | This phase | Module rename/hardening, not a topology change — 5/6 triggers remain event-driven |
| Raw callback `setInterval` (current `silence-scan.ts`) | `node:timers/promises` async-iterator `setInterval` | Recommended this phase | Removes tick-overlap risk without manual drift math |
| No CallbackHandler tags beyond `session`/`branch` (`ai.ts:367`) | `trigger`/`tier` tags on every `graph.invoke()`/`stream()` call site, every LLM call (human + proactive) tagged | This phase (COST-03/D-12/D-13) | Enables trigger-type cost comparison in Langfuse dashboard — but only once usage capture (Pitfall 1) is also fixed |
| `'[canvas updated]'` fallback text on empty-content bot turns | Skip INSERT entirely for canvas-only turns | This phase (D-10/D-11) | Eliminates the last SPEECH-01 violation already known to exist in the codebase |

**Deprecated/outdated:**
- The `ai.ts:469` `'[canvas updated]'` fallback is explicitly slated for removal this phase (D-10) — do not extend or "fix" it with different text; remove the write path entirely for this case.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The exact export name from `@langfuse/tracing@5.9.1` for creating a manual generation observation is `startObservation` (possibly `startActiveObservation` in some SDK minor versions) | Architecture Patterns / Code Examples | Low — this is a one-line import fix at implementation time; the planner should have a task verify the exact API surface against the installed package's `.d.ts` before writing the real implementation, since this codebase has zero existing usages of `@langfuse/tracing` to copy from |
| A2 | OpenAI's Chat Completions streaming API requires `stream_options: { include_usage: true }` to get a final usage chunk, and Gemini's SDK exposes `usageMetadata` similarly on its final streamed chunk | Code Examples (adapter usage-event extension) | Medium — if these exact option/field names have changed, the OpenAI/Gemini adapter usage-capture code will need adjustment; Anthropic's `finalMessage().usage` is the most solidly WebFetch-confirmed of the three `[CITED]` |
| A3 | `LangfuseSpanProcessor`'s `environment` constructor option is available in the installed `@langfuse/otel@5.9.1` (confirmed via WebFetch of current docs, not against this specific pinned version's changelog) | Anti-Patterns / Standard Stack | Low-Medium — if the installed version predates this option, the fallback is the `LANGFUSE_TRACING_ENVIRONMENT` env var, which the docs confirm is supported as an alternative in the same generation of the SDK |

## Open Questions

1. **Exact field/module name for the generalized TriggerEngine**
   - What we know: CONTEXT.md D-01 says "generalizes/replaces" `silence-scan.ts`; no exact target filename is locked.
   - What's unclear: whether the planner should rename the file (`trigger-engine.ts`) or keep `silence-scan.ts`'s name and only change its internals/exports.
   - Recommendation: rename for clarity given TRIGGER-07's requirement literally names "A TriggerEngine module" — confirmed low-risk per the Runtime State Inventory above.

2. **Whether `participantId` should be resolved for silence-fires**
   - What we know: `ai.ts` resolves it as "the resolved AUTHOR of the last human message on the active branch" (WR-04); `silence-scan.ts` has no equivalent resolution today.
   - What's unclear: whether adding this resolution is in-scope for this phase (not explicitly named in CONTEXT.md's decisions) or should be logged as a follow-up.
   - Recommendation: flagged in Pitfall 5 — low-cost to add (one more Supabase query mirroring `ai.ts`'s existing pattern), and directly serves PERSONA-01/PROFILE-02's existing intent; the planner should decide whether it's in-scope or explicitly deferred.

3. **Exact `@langfuse/tracing` manual-observation API shape for this installed version**
   - What we know: the documented pattern (`startObservation`/`updateActiveObservation` with `asType: 'generation'`) is current as of the fetched docs.
   - What's unclear: whether `5.9.1` specifically matches this exact API without changes (no existing codebase usage to confirm against).
   - Recommendation: first implementation task touching this should start with a small spike/smoke-test confirming the exact call shape compiles and produces a generation-type observation in a local Langfuse trace, before wiring it into all six node call sites.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | TriggerEngine, all graph nodes | Yes | v22.17.1 (`[VERIFIED: node --version]`) | — |
| `node:timers/promises` | Pattern 1 (drift-aware loop) | Yes (Node 22 built-in) | — | — |
| `@langfuse/otel`/`@langfuse/langchain`/`@langfuse/tracing` | Cost attribution, existing tracing | Yes, importable (`[VERIFIED: node -e "require('@langfuse/otel')"` succeeded`]`) | 5.9.1 | Already gracefully degrades to a no-op when `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` are absent (existing `setupLangfuseOtel()` behavior) |
| Supabase Postgres / PostgresSaver | Persona re-anchor counter, TriggerEngine cooldown state | Assumed available in deploy environments (unchanged from Phases 6-13) | — | — |
| Langfuse Cloud (external service) | COST-03 dashboard visibility | Assumed available (creator-configured); existing pattern already tolerates absence | — | Traces/cost simply don't appear; no code path breaks |

**Missing dependencies with no fallback:** none identified.
**Missing dependencies with fallback:** Langfuse credentials absent → tracing/cost silently disabled (existing, unchanged behavior).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Unchanged this phase — no new auth surfaces |
| V3 Session Management | No | Unchanged — `thread_id` dual-separation (BOT-04) already established |
| V4 Access Control | No | Unchanged — session ownership gate (T-02-05) untouched |
| V5 Input Validation | Yes | Blocklist substring matching (`containsSpeechArtifact`) is a simple, injection-safe string `.includes()` check — no regex, no user-controlled pattern compilation (D-08's exact-string choice is itself a security-adjacent decision: no ReDoS surface) |
| V6 Cryptography | No | Unchanged — API key decrypt/encrypt paths (`decryptKey`, `KEY_ENCRYPTION_SECRET`) untouched by this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via participant-authored content reaching the persona re-anchor's "recency boost" reinforcement text | Tampering | Reuse the existing `escapeUntrustedText()` helper (`bot-context.ts`) already applied to argGraph/message content elsewhere in this codebase — the re-anchor text itself is static/hardcoded (D-06: prompt-reinforcement only, no dynamic user content interpolated into it), so this is low-risk but any dynamic content it might reference should go through the same escaping |
| Unbounded proactive-invocation cost (DoS on creator's BYOK key) via the TriggerEngine firing more aggressively than intended | Denial of Service | Already mitigated by the existing budget circuit breaker (`checkBotBudget`, BOT-01), arbitration lock (BOT-02), two-signal silence gate (BOT-03), and D-05's auto-freeze reduction to 5 minutes specifically to bound this new proactive cost surface — this phase must preserve all of these unchanged, not introduce a path that bypasses them |
| Langfuse trace/tag data leaking secrets | Information Disclosure | Existing `T-06-05` convention (never log Langfuse key values) already followed in `langfuse-otel.ts`; new tags (trigger type, model tier) are non-sensitive enum-like strings — no new leakage surface introduced |
| A malicious/compromised LLM response embedding a blocked artifact string mid-sentence to evade a naive whole-message-equality filter | Tampering | Substring `.includes()` matching (Pitfall 3) rather than whole-message equality closes this gap |

## Sources

### Primary (HIGH confidence)
- Direct codebase reads: `apps/api/src/lib/silence-scan.ts`, `apps/api/src/graph/nodes/trigger-gate.ts`, `apps/api/src/graph/nodes/facilitation-agent.ts`, `apps/api/src/graph/nodes/analytics-agent.ts`, `apps/api/src/graph/graph.ts`, `apps/api/src/graph/state.ts`, `apps/api/src/routes/ai.ts`, `apps/api/src/lib/adapters/anthropic.ts`, `apps/api/src/lib/adapters/openai.ts`, `apps/api/src/lib/adapters/gemini.ts`, `apps/api/src/lib/adapter-factory.ts`, `apps/api/src/lib/model-config.ts`, `apps/api/src/lib/langfuse-otel.ts`, `apps/api/src/lib/auto-freeze.ts`, `apps/api/src/lib/skills/phase-readiness.ts`, `apps/api/src/lib/skills.ts`, `packages/types/src/ai.ts`, `packages/types/src/blueprint.ts`, `packages/types/src/bot.ts`, `packages/types/src/message.ts`, `supabase/migrations/0001_initial_schema.sql`, `apps/web/components/workspace/MessageBubble.tsx`, `apps/web/components/workspace/MessageList.tsx`

### Secondary (MEDIUM-HIGH confidence)
- [Langfuse: Token & Cost Tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking) — cost computation requirements, manual usageDetails API
- [Langfuse: Environments](https://langfuse.com/docs/observability/features/environments) — environment field is processor-level, not per-request in JS/TS
- [Langfuse: LangChain/LangGraph framework integration](https://langfuse.com/integrations/frameworks/langchain) — CallbackHandler tags/metadata patterns

### Tertiary (LOW-MEDIUM confidence, cross-checked)
- [Node.js Timers docs](https://nodejs.org/api/timers.html) — `node:timers/promises` API existence
- WebSearch results on Node.js setInterval drift/graceful shutdown best practices (multiple independent sources cross-referenced: nodejs/node GitHub issue #21822, oneuptime.com 2026 guide) — general pattern confirmed across sources, not a single authoritative doc
- WebSearch on Anthropic TypeScript SDK `finalMessage().usage` — confirmed via multiple search result summaries (DeepWiki, Anthropic docs), not directly WebFetched from the SDK's own `.d.ts`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, all versions read directly from `package.json`
- Architecture: HIGH for the "what's already wired vs. what's missing" claims (direct code reads); MEDIUM for exact Langfuse SDK call shapes (no Context7 available, WebFetch-only verification against current docs, not against the pinned `5.9.1` version specifically)
- Pitfalls: HIGH — Pitfalls 1, 2, 5, 6 are all directly verified by reading the actual source files, not inferred

**Research date:** 2026-07-17
**Valid until:** 30 days for the codebase-derived findings (stable until this phase's own implementation changes them); 14 days for the Langfuse SDK-specific claims (fast-moving library, version-sensitive) — re-verify the exact `@langfuse/tracing` API shape against the installed `.d.ts` at implementation time regardless of this validity window.
