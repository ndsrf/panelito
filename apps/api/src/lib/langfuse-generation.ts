/**
 * langfuse-generation.ts — manual Langfuse Generation observation helper (COST-03).
 *
 * Why this exists (RESEARCH.md Pitfall 1):
 *   Every LLM call in this codebase goes through this project's own `AIProvider.stream()`
 *   (Anthropic/OpenAI/Gemini adapters), never a LangChain `BaseChatModel`. Langfuse's
 *   `CallbackHandler` (@langfuse/langchain) only auto-populates model name + token usage
 *   on a generation-type observation when it sees LangChain's own `on_llm_start`/
 *   `on_llm_end` callback events — which never fire for a plain async generator. Without
 *   this helper, the Langfuse dashboard shows correct trigger/tier tags but $0.00 cost
 *   for every generation.
 *
 * What this does:
 *   Wraps an adapter's `AsyncIterable<AIStreamEvent>` with a manually-constructed
 *   `generation`-type Langfuse observation (@langfuse/tracing `startObservation`,
 *   confirmed export name against the installed 5.9.1 `.d.ts` — see 14-RESEARCH.md
 *   Open Question 3 / Assumption A1). Forwards `text_delta` events to an optional
 *   `streamWriter` callback (same contract Role nodes already use), accumulates the
 *   full text, and captures the `usage` event's `inputTokens`/`outputTokens` into
 *   `usageDetails` on `.end()` (Langfuse ingested usage takes priority over its own
 *   model-based cost inference).
 *
 * Never-throw contract (mirrors langfuse-otel.ts flushLangfuse()):
 *   Every @langfuse/tracing call (start/update/end) is wrapped in try/catch. A Langfuse
 *   SDK failure or outage must NEVER abort the calling Role node's turn (T-14-03b) — the
 *   caller always receives the accumulated assistant text and usage regardless of
 *   whether Langfuse is configured/reachable.
 */

import { startObservation } from '@langfuse/tracing'
import type { LangfuseGeneration } from '@langfuse/tracing'
import type { AIStreamEvent } from '@panelito/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Non-sensitive enum-like metadata attached to the generation (T-14-03a: no PII,
 * no API keys — trigger type and model tier only).
 */
export interface GenerationMetadata {
  trigger: string
  tier: string
  [key: string]: unknown
}

export interface StreamWithGenerationParams {
  /** Observation name shown in the Langfuse UI, e.g. 'facilitation-coach'. */
  name: string
  /** Model identifier, e.g. TASK_MODELS[provider][taskType]. */
  model: string
  metadata: GenerationMetadata
  /** Optional input payload recorded on the observation (e.g. system prompt). */
  input?: unknown
  /** Forwards each text_delta's text immediately, same contract as config.configurable.streamWriter. */
  streamWriter?: (text: string) => void
}

export interface StreamWithGenerationResult {
  /** Full accumulated assistant text from all text_delta events. */
  text: string
  /** Present only if the adapter emitted a usage event (never fabricated — RESEARCH Don't-Hand-Roll). */
  usage?: { inputTokens: number; outputTokens: number }
}

// ---------------------------------------------------------------------------
// streamWithGeneration
// ---------------------------------------------------------------------------

/**
 * Iterates an adapter's AIStreamEvent stream, wrapping it in a manual Langfuse
 * Generation observation. Never throws — Langfuse failures are caught and logged
 * non-fatally; the returned text/usage are always the source of truth for the caller.
 */
export async function streamWithGeneration(
  stream: AsyncIterable<AIStreamEvent>,
  params: StreamWithGenerationParams
): Promise<StreamWithGenerationResult> {
  const { name, model, metadata, input, streamWriter } = params

  let generation: LangfuseGeneration | undefined
  try {
    generation = startObservation(name, { model, input, metadata }, { asType: 'generation' })
  } catch (err) {
    console.warn('[langfuse-generation] startObservation failed (non-fatal):', (err as Error).message)
  }

  let text = ''
  let usage: { inputTokens: number; outputTokens: number } | undefined

  for await (const event of stream) {
    if (event.type === 'text_delta') {
      text += event.text
      streamWriter?.(event.text)
    } else if (event.type === 'usage') {
      usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens }
    }
  }

  if (generation) {
    try {
      generation.update({
        usageDetails: usage ? { input: usage.inputTokens, output: usage.outputTokens } : undefined,
        model,
        metadata,
      })
      generation.end()
    } catch (err) {
      console.warn('[langfuse-generation] update/end failed (non-fatal):', (err as Error).message)
    }
  }

  return { text, usage }
}
