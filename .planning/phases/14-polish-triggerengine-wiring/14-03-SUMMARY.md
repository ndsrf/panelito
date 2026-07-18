---
phase: 14-polish-triggerengine-wiring
plan: 03
subsystem: observability
tags: [langfuse, cost-tracking, anthropic-sdk, openai-sdk, gemini-sdk, otel]

# Dependency graph
requires:
  - phase: 14-polish-triggerengine-wiring (14-01)
    provides: "AIStreamEvent 'usage' union member added to packages/types/src/ai.ts"
provides:
  - "streamWithGeneration() helper (apps/api/src/lib/langfuse-generation.ts) — manual Langfuse Generation observation wrapping an adapter's AsyncIterable<AIStreamEvent>"
  - "usage AIStreamEvent emission from all three provider adapters (Anthropic, OpenAI, Gemini) with real provider-reported token counts"
  - "Langfuse environment field set at the LangfuseSpanProcessor level (D-13)"
affects: ["14-06 (Role node wiring consumes streamWithGeneration + usage events)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Manual Langfuse Generation observation via @langfuse/tracing startObservation({ asType: 'generation' }) + .update({ usageDetails }) + .end() — required because adapter.stream() is a plain async generator, not a LangChain BaseChatModel, so CallbackHandler never sees model/usage"
    - "Never-throw wrapper convention for all @langfuse/* SDK calls (mirrors flushLangfuse's '(non-fatal)' warn-and-continue pattern)"
    - "Provider usage capture: Anthropic reuses the already-awaited finalMessage() (free, no extra round-trip); OpenAI reads chunk.usage off the terminal streamed chunk (stream_options.include_usage: true, never calls finalMessage()); Gemini captures usageMetadata off the last streamed chunk"

key-files:
  created:
    - apps/api/src/lib/langfuse-generation.ts
    - apps/api/src/lib/langfuse-generation.test.ts
  modified:
    - apps/api/src/lib/adapters/anthropic.ts
    - apps/api/src/lib/adapters/openai.ts
    - apps/api/src/lib/adapters/gemini.ts
    - apps/api/src/lib/adapters/openai.test.ts
    - apps/api/src/lib/adapters/gemini.test.ts
    - apps/api/src/lib/langfuse-otel.ts

key-decisions:
  - "Confirmed @langfuse/tracing@5.9.1's exported symbol is startObservation(name, attributes, { asType: 'generation' }) returning LangfuseGeneration (RESEARCH Open Question 3 / Assumption A1 resolved) — read directly from the installed .d.ts, not assumed"
  - "GenerationMetadata given an index signature ([key: string]: unknown) so it satisfies LangfuseGenerationAttributes.metadata's Record<string, unknown> shape"
  - "ReturnType<typeof startObservation> resolves to the fallback LangfuseSpan overload (no usageDetails) — explicitly typed the local variable as LangfuseGeneration instead"
  - "Langfuse environment resolved as process.env.LANGFUSE_TRACING_ENVIRONMENT ?? (NODE_ENV === 'production' ? 'production' : 'development'), passed to the LangfuseSpanProcessor constructor at setupLangfuseOtel() bootstrap — confirmed the constructor accepts an environment option directly (RESEARCH Assumption A3 resolved as true for this installed version, so no LANGFUSE_TRACING_ENVIRONMENT-only fallback was needed)"

patterns-established:
  - "streamWithGeneration(stream, { name, model, metadata, input?, streamWriter? }) → { text, usage? } is the shape future Role node call sites (Plan 06) should use to wrap adapter.stream() calls with cost observability"

requirements-completed: [COST-03]

duration: 4min
completed: 2026-07-18
---

# Phase 14 Plan 03: Cost-Observability Infrastructure Summary

**Manual Langfuse Generation observation helper (`streamWithGeneration`) plus real provider-reported `usage` events surfaced from all three adapters (Anthropic `finalMessage().usage`, OpenAI `stream_options.include_usage`, Gemini `usageMetadata`), and the Langfuse `environment` field set once at the `LangfuseSpanProcessor` constructor level.**

## Performance

- **Duration:** ~4 min (commit-to-commit)
- **Started:** 2026-07-18T05:45:40Z
- **Completed:** 2026-07-18T05:49:07Z
- **Tasks:** 3 completed
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments
- `apps/api/src/lib/langfuse-generation.ts` — `streamWithGeneration()` wraps any `AsyncIterable<AIStreamEvent>` in a manual Langfuse `generation`-type observation, forwarding `text_delta` to an optional `streamWriter` and capturing `usage` into `usageDetails: { input, output }` on `.end()`. Every Langfuse call is wrapped so an SDK failure or outage never aborts the calling Role node's turn — 7 unit tests cover text collection, streamWriter forwarding, usage capture, missing-usage handling, and non-fatal error paths for both `startObservation()` and `.update()/.end()`.
- All three provider adapters now emit exactly one `{ type: 'usage'; inputTokens; outputTokens }` event, before the outer `finally { yield { type: 'done' } }`, with real provider-reported token counts (never estimated from character counts):
  - Anthropic: reuses the already-awaited `apiStream.finalMessage()` (donePromise path) — free, no extra network round-trip.
  - OpenAI: adds `stream_options: { include_usage: true }`; reads `chunk.usage.prompt_tokens`/`completion_tokens` off the terminal streamed chunk only — does not call `finalMessage()` (preserves the existing latency-sensitive doc-comment constraint).
  - Gemini: captures `chunk.usageMetadata.promptTokenCount`/`candidatesTokenCount` off the last streamed chunk, emitted after `tool_use` events.
- `langfuse-otel.ts` now resolves and passes an `environment` option to `new LangfuseSpanProcessor({ environment })` at bootstrap — confirmed against the installed `@langfuse/otel@5.9.1` `.d.ts` that the constructor accepts this option directly. The existing `_getState()` hot-reload guard and no-op-when-keys-absent behavior are unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: Verify @langfuse/tracing API shape and build the Generation helper** - `7bc1869` (feat)
2. **Task 2: Emit `usage` events from all three provider adapters** - `4b6d052` (feat)
3. **Task 3: Set the Langfuse environment field at the processor level** - `6017ea1` (feat)

**Interstitial fix:** `1b68d11` (fix) — typing correction in `langfuse-generation.ts`, discovered running `tsc --noEmit` during Task 2 verification (see Deviations).

_Note: this worktree does not create a separate "docs: complete plan" metadata commit — SUMMARY.md is committed by the orchestrator's post-wave step._

## Files Created/Modified
- `apps/api/src/lib/langfuse-generation.ts` - `streamWithGeneration()` manual Generation observation helper
- `apps/api/src/lib/langfuse-generation.test.ts` - 7 unit tests (text/usage capture, never-throw guarantees)
- `apps/api/src/lib/adapters/anthropic.ts` - usage event from `finalMessage().usage`
- `apps/api/src/lib/adapters/openai.ts` - `stream_options.include_usage`, usage event from terminal chunk
- `apps/api/src/lib/adapters/gemini.ts` - usage event from `usageMetadata` on the last streamed chunk
- `apps/api/src/lib/adapters/openai.test.ts` - usage-event assertions (numeric fields, ordering before `done`, omission when absent, `include_usage` request param)
- `apps/api/src/lib/adapters/gemini.test.ts` - usage-event assertions (same coverage as OpenAI, plus last-seen-wins across multiple usage-carrying chunks)
- `apps/api/src/lib/langfuse-otel.ts` - `environment` resolved and passed to `LangfuseSpanProcessor`

## Decisions Made
- Confirmed `startObservation` (not `startActiveObservation`) is the correct top-level export for a manual, non-function-scoped generation observation in `@langfuse/tracing@5.9.1`, read directly from the installed `.d.ts` rather than assumed from RESEARCH.
- `GenerationMetadata` needed `[key: string]: unknown` to satisfy `LangfuseGenerationAttributes.metadata`'s `Record<string, unknown>` typing — a plain `{ trigger: string; tier: string }` interface without an index signature does not structurally match.
- `environment` is resolved with a `NODE_ENV`-derived fallback (`production`/`development`) rather than requiring `LANGFUSE_TRACING_ENVIRONMENT` to always be set, since the installed SDK's constructor option was confirmed available (Assumption A3 resolved true) — deployment can still override via the env var, which the SDK also reads independently.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `langfuse-generation.ts` typing errors surfaced by `tsc --noEmit`**
- **Found during:** Task 2 (running `npx tsc --noEmit` as part of Task 2's verification step, since Task 1's own verify only ran vitest, not tsc)
- **Issue:** `GenerationMetadata` (no index signature) was not assignable to `LangfuseGenerationAttributes.metadata: Record<string, unknown>`; `ReturnType<typeof startObservation>` resolved to the fallback `LangfuseSpan` overload (the last overload in the union), which has no `usageDetails` field, causing `generation.update({ usageDetails: ... })` to fail to typecheck.
- **Fix:** Added `[key: string]: unknown` to `GenerationMetadata`; explicitly typed the local `generation` variable as `LangfuseGeneration` (imported from `@langfuse/tracing`) instead of relying on `ReturnType<>` inference.
- **Files modified:** `apps/api/src/lib/langfuse-generation.ts`
- **Verification:** `cd apps/api && npx tsc --noEmit` exits 0; `npx vitest run src/lib/langfuse-generation.test.ts` still passes (7/7).
- **Committed in:** `1b68d11` (separate fix commit, since Task 1's commit had already landed before `tsc` was run as part of Task 2's verification)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Pure typing correction, no behavior change. No scope creep — required for `npx tsc --noEmit` (part of the plan's own `<verification>` block) to pass.

## Issues Encountered
None beyond the typing fix documented above.

## User Setup Required
None - no external service configuration required. Existing `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` absence still degrades gracefully (tracing/cost silently disabled, unchanged from prior phases). `LANGFUSE_TRACING_ENVIRONMENT` is optional — falls back to a `NODE_ENV`-derived value.

## Next Phase Readiness
- `streamWithGeneration()` is ready to be wired into Role node call sites (`facilitation-agent.ts`, `analytics-agent.ts`, and others named in RESEARCH's Architectural Responsibility Map) by Plan 06 — this plan intentionally did not touch node files, matching its `files_modified` scope.
- All three adapters now surface real usage data; the Langfuse dashboard's "Generations" tab will populate cost once `streamWithGeneration()` is actually called from a node (this plan built the infrastructure, not the wiring — confirmed in-scope per plan objective).
- No blockers identified for 14-06.

---
*Phase: 14-polish-triggerengine-wiring*
*Completed: 2026-07-18*
