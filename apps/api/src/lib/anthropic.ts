/**
 * Anthropic client helpers.
 *
 * AI-10: verifyApiKey performs a minimal handshake against api.anthropic.com
 *        BEFORE the key is saved. No key is ever logged (T-06-03).
 *
 * AI-11: assemblePromptArray builds the MessageParam[] with a cache_control
 *        breakpoint at the END of the static prefix. The dynamic tail
 *        (recent messages + current user message) follows after.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources'

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
 * Build the Anthropic MessageParam[] for a session turn.
 *
 * Static prefix (system + persona + summary):
 *   The last block of the static prefix carries cache_control: 'ephemeral' —
 *   this instructs Anthropic to cache everything up to and including this block.
 *
 * AI-11 — cache_control is placed at the end of the static prefix.
 * Anthropic requires the cached prefix to be >= 1024 tokens AND
 * bitwise-identical across requests. The historicalSummary block must NOT
 * contain timestamps or session IDs that vary between calls.
 *
 * Dynamic tail (recentMessages + userMessage) follows AFTER the cache
 * breakpoint and is NOT cached.
 *
 * The returned array is ready to pass to client.messages.create({ messages }).
 * Phase 2 wires the actual invocation.
 */
export function assemblePromptArray(opts: AssembleOptions): MessageParam[] {
  const {
    systemPrompt,
    personaInstructions,
    historicalSummary,
    recentMessages,
    userMessage,
  } = opts

  // Static prefix — assembled as a single "user" message with multiple content
  // blocks so we can attach cache_control to the last block only.
  // The first two blocks (system + persona) are not cached individually;
  // the third (historical summary) carries the cache breakpoint.
  const staticPrefixMessage: MessageParam = {
    role: 'user',
    content: [
      { type: 'text', text: systemPrompt },
      { type: 'text', text: personaInstructions },
      // AI-11 cache breakpoint: last block of the static prefix
      {
        type: 'text',
        text: historicalSummary,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cache_control: { type: 'ephemeral' } as any,
      },
    ],
  }

  // Dynamic tail — NOT cached
  const dynamicTail: MessageParam[] = [
    ...recentMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ]

  return [staticPrefixMessage, ...dynamicTail]
}
