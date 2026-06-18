/**
 * Anthropic client helpers.
 *
 * AI-10: verifyApiKey performs a minimal handshake against api.anthropic.com
 *        BEFORE the key is saved. No key is ever logged (T-06-03).
 *
 * AI-11: assemblePromptArray now returns ProviderMessage[] (provider-agnostic).
 *        cache_control has moved into AnthropicAdapter (adapters/anthropic.ts)
 *        where it is re-applied to the first user message's content block during
 *        the ProviderMessage[] → MessageParam[] conversion.
 *
 * AI-08 (D-03): compressHistory is now provider-agnostic — it accepts an AIProvider
 *        and a model string, allowing any active provider to perform compression.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, ProviderMessage } from '@panelito/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; error: 'invalid_key' | 'rate_limited' | 'network_error' }

// ---------------------------------------------------------------------------
// verifyApiKey — AI-10
// ---------------------------------------------------------------------------

/**
 * Verify an Anthropic API key by performing a minimal messages.create call
 * (max_tokens=1). Maps SDK error classes to structured results.
 *
 * IMPORTANT: The key is NEVER logged. Only the error class name is recorded
 * on failure (T-06-03).
 */
export async function verifyApiKey(key: string): Promise<VerifyResult> {
  const client = new Anthropic({ apiKey: key })
  try {
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    })
    return { ok: true }
  } catch (err) {
    // Log only the error class name — never the key (T-06-03).
    const className = (err as Error)?.constructor?.name ?? 'UnknownError'
    console.error('[verifyApiKey] error class:', className)

    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: 'invalid_key' }
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, error: 'invalid_key' }
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'rate_limited' }
    }
    // Any other APIError means Anthropic responded (key reached the API).
    // Treat as valid — the key works, something else went wrong server-side.
    if (err instanceof Anthropic.APIError) {
      return { ok: true }
    }
    // Non-APIError: DNS failure, timeout, connection refused, etc.
    return { ok: false, error: 'network_error' }
  }
}

// ---------------------------------------------------------------------------
// assemblePromptArray — AI-11
// ---------------------------------------------------------------------------

export interface AssembleOptions {
  systemPrompt: string
  personaInstructions: string
  historicalSummary: string
  recentMessages: Message[]
  userMessage: string
}

/**
 * Build the ProviderMessage[] for a session turn.
 *
 * Returns provider-agnostic ProviderMessage[] (role + string content only).
 * cache_control is NO LONGER attached here — it has moved into AnthropicAdapter
 * (apps/api/src/lib/adapters/anthropic.ts) where it is re-applied to the first
 * user message (the static prefix) during the ProviderMessage[] → MessageParam[]
 * conversion. This keeps anthropic.ts free of Anthropic SDK-specific constructs.
 *
 * AI-11: The static prefix (systemPrompt + personaInstructions + historicalSummary)
 * is concatenated into a single user message string. AnthropicAdapter applies
 * cache_control to this message.
 *
 * Dynamic tail (recentMessages + userMessage) follows AFTER the static prefix.
 */
export function assemblePromptArray(opts: AssembleOptions): ProviderMessage[] {
  const {
    systemPrompt,
    personaInstructions,
    historicalSummary,
    recentMessages,
    userMessage,
  } = opts

  // Static prefix — concatenated into a single string for the first user message.
  // AI-11: AnthropicAdapter applies cache_control to this message during conversion.
  const staticPrefixContent = [systemPrompt, personaInstructions, historicalSummary]
    .filter(Boolean)
    .join('\n\n')

  const staticPrefixMessage: ProviderMessage = {
    role: 'user',
    content: staticPrefixContent,
  }

  // Dynamic tail — NOT cached; recentMessages + current userMessage
  const dynamicTail: ProviderMessage[] = [
    ...recentMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ]

  return [staticPrefixMessage, ...dynamicTail]
}

// ---------------------------------------------------------------------------
// compressHistory — AI-08 sliding window history compression (D-03 provider-aware)
// ---------------------------------------------------------------------------

/**
 * Compress older conversation history into a 3-5 sentence summary using
 * the active provider's compression model.
 *
 * Returns '' when messages is empty to short-circuit the API call.
 * The summary is passed as historicalSummary in assemblePromptArray().
 *
 * AI-08: Sliding window — last 8 messages passed raw; older messages compressed here.
 * D-03: Uses the active provider's adapter so all tasks use the selected provider.
 *
 * @param adapter  Active AIProvider adapter (instantiated with the creator's key)
 * @param model    The compression model for the active provider (from TASK_MODELS)
 * @param messages Older messages to compress
 */
export async function compressHistory(
  adapter: AIProvider,
  model: string,
  messages: Message[]
): Promise<string> {
  if (messages.length === 0) return ''

  const compressionPrompt = `Summarize this conversation in 3–5 sentences, capturing the key points, decisions, and unresolved questions:\n${JSON.stringify(messages)}`

  const compressionMessage: ProviderMessage = {
    role: 'user',
    content: compressionPrompt,
  }

  let summary = ''
  for await (const event of adapter.stream([compressionMessage], [], {
    model,
    maxTokens: 512,
    system: 'You are a concise summarizer. Produce a short, accurate summary of the conversation provided.',
  })) {
    if (event.type === 'text_delta') {
      summary += event.text
    }
    // tool_use events are ignored; done event ends the iterator naturally
  }

  return summary
}
