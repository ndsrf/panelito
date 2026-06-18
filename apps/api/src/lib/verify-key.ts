/**
 * verify-key.ts — Per-provider API key verification helpers (D-10).
 *
 * Each function performs a minimal live request to the provider's API to
 * confirm the key is valid without consuming meaningful quota.
 *
 * Security:
 *   - Keys are NEVER logged (T-04-03 / T-06-03 pattern from anthropic.ts)
 *   - Only the error class name is logged on failure
 *   - VerifyResult returns only enum values (invalid_key/rate_limited/network_error)
 *     — no provider-specific error detail leaked to caller (T-04-04)
 */

import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import type { VerifyResult } from './anthropic'

// Re-export VerifyResult so callers only need to import from this file
export type { VerifyResult }

// ---------------------------------------------------------------------------
// verifyOpenAIKey — D-10
// ---------------------------------------------------------------------------

/**
 * Verify an OpenAI API key by calling models.list() (minimal cost, no token consumption).
 * Maps OpenAI SDK error classes to the shared VerifyResult shape.
 *
 * IMPORTANT: The key is NEVER logged. Only the error class name is recorded on failure (T-04-03).
 */
export async function verifyOpenAIKey(key: string): Promise<VerifyResult> {
  const client = new OpenAI({ apiKey: key })
  try {
    await client.models.list()
    return { ok: true }
  } catch (err) {
    // Log only the error class name — never the key (T-04-03)
    const className = (err as Error)?.constructor?.name ?? 'UnknownError'
    console.error('[verifyOpenAIKey] error class:', className)

    if (err instanceof OpenAI.AuthenticationError) {
      return { ok: false, error: 'invalid_key' }
    }
    if (err instanceof OpenAI.PermissionDeniedError) {
      return { ok: false, error: 'invalid_key' }
    }
    if (err instanceof OpenAI.RateLimitError) {
      return { ok: false, error: 'rate_limited' }
    }
    // Any other OpenAI.APIError means the key reached the API — treat as valid
    if (err instanceof OpenAI.APIError) {
      return { ok: true }
    }
    // Non-APIError: DNS failure, timeout, connection refused, etc.
    return { ok: false, error: 'network_error' }
  }
}

// ---------------------------------------------------------------------------
// verifyGeminiKey — D-10
// ---------------------------------------------------------------------------

// [ASSUMED] Gemini error shape — verify against live API; see RESEARCH Open Question 1
// The @google/genai v2 SDK throws generic Error objects with message strings rather than
// typed error subclasses. The message matching below is based on documented Gemini API
// error codes (API_KEY_INVALID, PERMISSION_DENIED, RESOURCE_EXHAUSTED) but has not been
// verified against live API responses. Update after confirming with a live key test.

/**
 * Verify a Gemini API key by calling models.list() (minimal cost, no token consumption).
 * Maps Gemini SDK error message patterns to the shared VerifyResult shape.
 *
 * IMPORTANT: The key is NEVER logged. Only the error class name is recorded on failure (T-04-03).
 */
export async function verifyGeminiKey(key: string): Promise<VerifyResult> {
  const ai = new GoogleGenAI({ apiKey: key })
  try {
    await ai.models.list()
    return { ok: true }
  } catch (err) {
    // Log only the error class name — never the key (T-04-03)
    const className = (err as Error)?.constructor?.name ?? 'UnknownError'
    console.error('[verifyGeminiKey] error class:', className)

    const message = (err as Error)?.message ?? ''

    if (message.includes('API_KEY_INVALID') || message.includes('PERMISSION_DENIED')) {
      return { ok: false, error: 'invalid_key' }
    }
    if (message.includes('RESOURCE_EXHAUSTED')) {
      return { ok: false, error: 'rate_limited' }
    }
    // If we can't identify the error pattern, assume network-level failure
    return { ok: false, error: 'network_error' }
  }
}
