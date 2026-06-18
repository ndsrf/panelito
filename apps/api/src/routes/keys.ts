/**
 * BYOK API key management routes — multi-provider (D-10, D-11, D-13).
 *
 * POST /verify           — validate + encrypt + persist key for a given provider (AI-01, AI-10)
 * GET  /status           — return MultiProviderStatus: per-provider has_key/last4/is_active (AI-02)
 * DELETE /               — null out the stored key for a given provider (preserves cap, D-12)
 * PUT  /active-provider  — update active_provider in creator_settings (D-13)
 *
 * T-04-07: all three key columns are service-role only (migration 0006 REVOKE).
 * T-04-08: per-provider prefix validation guards against key stored in wrong column.
 * T-04-09: active_provider updated only via authenticated PUT; RLS enforces auth.uid()=user_id.
 * T-04-10: rate limit POST /verify to 5 requests/min/user.
 * T-04-11: GET /status returns only last4 — never the encrypted blob or plaintext.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import {
  ApiKeyVerifyRequestSchema,
  ProviderSchema,
  type MultiProviderStatus,
} from '@panelito/types'
import { createServiceClient } from '../lib/supabase'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { encryptKey, decryptKey } from '../lib/crypto'
import { verifyApiKey } from '../lib/anthropic'
import { verifyOpenAIKey, verifyGeminiKey } from '../lib/verify-key'
import { env } from '../lib/env'
import { rateLimit } from '../lib/rate-limit'
import type { VerifyResult } from '../lib/anthropic'

// ---------------------------------------------------------------------------
// Per-provider key prefix guards (T-04-08 — Tampering mitigation)
// ---------------------------------------------------------------------------

const PROVIDER_KEY_PREFIXES: Record<string, string> = {
  anthropic: 'sk-ant-',
  openai: 'sk-',
  gemini: 'AI',
}

function validateKeyPrefix(provider: string, key: string): boolean {
  const prefix = PROVIDER_KEY_PREFIXES[provider]
  if (!prefix) return false
  return key.startsWith(prefix)
}

// ---------------------------------------------------------------------------
// Rate limiting — T-04-10 / T-06-07: 5 verify attempts per minute per user
// ---------------------------------------------------------------------------

const verifyRateLimit = rateLimit({
  keyFn: (c) => `${(c.get('user') as { id: string }).id}:verify`,
  limit: 5,
  windowMs: 60_000,
})

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const keysRouter = new Hono<{ Variables: AuthVariables }>()

keysRouter.use('/*', requireAuth)

/**
 * POST /api/keys/verify
 *
 * 1. Validate body (provider enum + key length).
 * 2. Per-provider prefix check (sk-ant- / sk- / AI) — T-04-08.
 * 3. Rate limit (5/min/user, T-04-10).
 * 4. Call provider-specific verifyKey() — BEFORE any DB write (AI-10).
 * 5. On ok: encrypt and upsert to the matching provider column (cap-preserving).
 * 6. Return 200 { success: true } or 400/429/502 { success: false, error }.
 */
keysRouter.post('/verify', verifyRateLimit, async (c) => {
  const user = c.get('user')

  // Validate body
  const body = await c.req.json().catch(() => null)
  const parsed = ApiKeyVerifyRequestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ success: false, error: 'invalid_request', details: parsed.error.issues }, 400)
  }

  const { provider, key } = parsed.data

  // Per-provider prefix validation (T-04-08 — guard against wrong-column write)
  if (!validateKeyPrefix(provider, key)) {
    return c.json(
      {
        success: false,
        error: 'invalid_request',
        details: `Key does not match expected prefix for provider "${provider}"`,
      },
      400,
    )
  }

  // Dispatch verification by provider (AI-10: handshake BEFORE persistence)
  let result: VerifyResult
  switch (provider) {
    case 'anthropic':
      result = await verifyApiKey(key)
      break
    case 'openai':
      result = await verifyOpenAIKey(key)
      break
    case 'gemini':
      result = await verifyGeminiKey(key)
      break
  }

  if (!result.ok) {
    const status =
      result.error === 'invalid_key'
        ? 400
        : result.error === 'rate_limited'
          ? 429
          : 502 // network_error — server-side failure reaching provider
    return c.json({ success: false, error: result.error }, status)
  }

  // Encrypt
  const encrypted = encryptKey(key, env.KEY_ENCRYPTION_SECRET)

  // Cap-preserving upsert to the provider-specific column:
  // If a row exists -> only update the matching key column (preserve custom cap).
  // If no row -> insert with the default cap (150).
  const supabase = createServiceClient()
  const { data: existing } = await supabase
    .from('creator_settings')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const keyColumn = `${provider}_api_key`

  if (existing) {
    const { error: updateErr } = await supabase
      .from('creator_settings')
      .update({ [keyColumn]: encrypted })
      .eq('user_id', user.id)
    if (updateErr) {
      console.error('[keys/verify] DB update error:', updateErr.code)
      return c.json({ success: false, error: 'server_error' }, 500)
    }
  } else {
    const { error: insertErr } = await supabase
      .from('creator_settings')
      .insert({ user_id: user.id, [keyColumn]: encrypted, api_response_cap: 150 })
    if (insertErr) {
      console.error('[keys/verify] DB insert error:', insertErr.code)
      return c.json({ success: false, error: 'server_error' }, 500)
    }
  }

  return c.json({ success: true }, 200)
})

/**
 * GET /api/keys/status
 *
 * Returns MultiProviderStatus: active_provider + per-provider { has_key, last4, is_active }.
 * The encrypted blobs and plaintext keys are NEVER returned (AI-02, T-04-11).
 */
keysRouter.get('/status', async (c) => {
  const user = c.get('user')
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('creator_settings')
    .select('anthropic_api_key, openai_api_key, gemini_api_key, active_provider')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[keys/status] DB error:', error.code)
    return c.json({ error: 'server_error' }, 500)
  }

  const activeProvider = (data?.active_provider ?? 'anthropic') as 'anthropic' | 'openai' | 'gemini'

  // Decrypt each key to last4 — never expose full key or blob (T-04-11)
  const getKeyStatus = (
    provider: 'anthropic' | 'openai' | 'gemini',
    encryptedKey: string | null | undefined,
  ) => {
    if (!encryptedKey) {
      return { provider, has_key: false, last4: null, is_active: provider === activeProvider }
    }
    try {
      const plaintext = decryptKey(encryptedKey, env.KEY_ENCRYPTION_SECRET)
      return {
        provider,
        has_key: true,
        last4: plaintext.slice(-4),
        is_active: provider === activeProvider,
      }
    } catch {
      // Auth tag mismatch or tampered data — treat as no key (T-06-04)
      return { provider, has_key: false, last4: null, is_active: provider === activeProvider }
    }
  }

  const response: MultiProviderStatus = {
    active_provider: activeProvider,
    providers: [
      getKeyStatus('anthropic', data?.anthropic_api_key),
      getKeyStatus('openai', data?.openai_api_key),
      getKeyStatus('gemini', data?.gemini_api_key),
    ],
  }

  return c.json(response, 200)
})

/**
 * DELETE /api/keys?provider=anthropic
 *
 * NULLs out the specified provider's key column. Does NOT delete the row — preserves
 * the cap and the other providers' keys (D-12: keys for inactive providers persist silently).
 * Defaults to 'anthropic' if no provider query param supplied.
 * Returns 204 No Content.
 */
keysRouter.delete('/', async (c) => {
  const user = c.get('user')

  const providerParam = c.req.query('provider') ?? 'anthropic'
  const providerParsed = ProviderSchema.safeParse(providerParam)
  if (!providerParsed.success) {
    return c.json({ error: 'invalid_provider' }, 400)
  }
  const provider = providerParsed.data

  const supabase = createServiceClient()
  const keyColumn = `${provider}_api_key`

  const { error } = await supabase
    .from('creator_settings')
    .update({ [keyColumn]: null })
    .eq('user_id', user.id)

  if (error) {
    console.error('[keys/delete] DB error:', error.code)
    return c.json({ error: 'server_error' }, 500)
  }

  return new Response(null, { status: 204 })
})

/**
 * PUT /api/keys/active-provider
 *
 * Updates the active_provider column for the authenticated user (D-13).
 * RLS enforces auth.uid() = user_id (T-04-09).
 *
 * Body: { provider: 'anthropic' | 'openai' | 'gemini' }
 * Returns 200 { active_provider }.
 */
keysRouter.put('/active-provider', async (c) => {
  const user = c.get('user')

  const body = await c.req.json().catch(() => null)
  const parsed = z.object({ provider: ProviderSchema }).safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400)
  }

  const { provider } = parsed.data
  const supabase = createServiceClient()

  // Check if row exists (cap-preserving upsert pattern)
  const { data: existing } = await supabase
    .from('creator_settings')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('creator_settings')
      .update({ active_provider: provider })
      .eq('user_id', user.id)
    if (error) {
      console.error('[keys/active-provider] DB update error:', error.code)
      return c.json({ error: 'server_error' }, 500)
    }
  } else {
    const { error } = await supabase
      .from('creator_settings')
      .insert({ user_id: user.id, active_provider: provider, api_response_cap: 150 })
    if (error) {
      console.error('[keys/active-provider] DB insert error:', error.code)
      return c.json({ error: 'server_error' }, 500)
    }
  }

  return c.json({ active_provider: provider }, 200)
})

export default keysRouter
