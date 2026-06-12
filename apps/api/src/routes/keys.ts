/**
 * BYOK API key management routes.
 *
 * POST /verify  — validate + encrypt + persist creator's Anthropic key (AI-01, AI-10)
 * GET  /status  — return { has_api_key, last4 } — NEVER the key itself (AI-02)
 * DELETE /      — null out the stored key (preserves the cap)
 *
 * T-06-01: encrypted_api_key column is service-role only.
 * T-06-02: no route returns the encrypted blob or the plaintext key.
 * T-06-07: rate limit POST /verify to 5 requests/min/user.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { ApiKeyVerifyRequestSchema } from '@panelito/types'
import { createServiceClient } from '../lib/supabase'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { encryptKey, decryptKey } from '../lib/crypto'
import { verifyApiKey } from '../lib/anthropic'
import { env } from '../lib/env'

// ---------------------------------------------------------------------------
// Rate limiting — T-06-07: 5 verify attempts per minute per user
// ---------------------------------------------------------------------------

interface TokenBucket {
  tokens: number
  lastRefill: number
}

const verifyBuckets = new Map<string, TokenBucket>()
const MAX_VERIFY_PER_MINUTE = 5
const MINUTE_MS = 60_000

function checkVerifyRateLimit(userId: string): boolean {
  const now = Date.now()
  let bucket = verifyBuckets.get(userId)
  if (!bucket) {
    bucket = { tokens: MAX_VERIFY_PER_MINUTE - 1, lastRefill: now }
    verifyBuckets.set(userId, bucket)
    return true
  }
  const elapsed = now - bucket.lastRefill
  if (elapsed >= MINUTE_MS) {
    bucket.tokens = MAX_VERIFY_PER_MINUTE
    bucket.lastRefill = now
  }
  if (bucket.tokens <= 0) return false
  bucket.tokens--
  return true
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const keysRouter = new Hono<{ Variables: AuthVariables }>()

keysRouter.use('/*', requireAuth)

/**
 * POST /api/keys/verify
 *
 * 1. Validate body (sk-ant-* prefix, length >= 50).
 * 2. Rate limit (5/min/user, T-06-07).
 * 3. Call verifyApiKey() — BEFORE any DB write (AI-10).
 * 4. On ok: encrypt and upsert (cap-preserving logic).
 * 5. Return 200 { success: true } or 400 { success: false, error }.
 */
keysRouter.post('/verify', async (c) => {
  const user = c.get('user')

  // Rate limit
  if (!checkVerifyRateLimit(user.id)) {
    return c.json({ success: false, error: 'rate_limited' }, 429)
  }

  // Validate body
  const body = await c.req.json().catch(() => null)
  const parsed = ApiKeyVerifyRequestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ success: false, error: 'invalid_request', details: parsed.error.issues }, 400)
  }

  const { key } = parsed.data

  // Handshake BEFORE persistence (AI-10)
  const result = await verifyApiKey(key)
  if (!result.ok) {
    return c.json({ success: false, error: result.error }, 400)
  }

  // Encrypt
  const encrypted = encryptKey(key, env.KEY_ENCRYPTION_SECRET)

  // Cap-preserving upsert:
  // If a row exists -> only update encrypted_api_key (preserve custom cap).
  // If no row -> insert with the default cap (150 per D-06 / SESS-12).
  const supabase = createServiceClient()
  const { data: existing } = await supabase
    .from('creator_settings')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    const { error: updateErr } = await supabase
      .from('creator_settings')
      .update({ encrypted_api_key: encrypted })
      .eq('user_id', user.id)
    if (updateErr) {
      console.error('[keys/verify] DB update error:', updateErr.code)
      return c.json({ success: false, error: 'server_error' }, 500)
    }
  } else {
    const { error: insertErr } = await supabase
      .from('creator_settings')
      .insert({ user_id: user.id, encrypted_api_key: encrypted, api_response_cap: 150 })
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
 * Returns { has_api_key: boolean; last4: string | null }.
 * The encrypted blob and plaintext key are NEVER returned (AI-02, T-06-02).
 */
keysRouter.get('/status', async (c) => {
  const user = c.get('user')
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('creator_settings')
    .select('encrypted_api_key')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[keys/status] DB error:', error.code)
    return c.json({ error: 'server_error' }, 500)
  }

  if (!data || !data.encrypted_api_key) {
    return c.json({ has_api_key: false, last4: null }, 200)
  }

  // Decrypt to get last 4 chars — never expose full key
  try {
    const plaintext = decryptKey(data.encrypted_api_key, env.KEY_ENCRYPTION_SECRET)
    const last4 = plaintext.slice(-4)
    return c.json({ has_api_key: true, last4 }, 200)
  } catch {
    // Auth tag mismatch or tampered data — treat as no key (T-06-04)
    return c.json({ has_api_key: false, last4: null }, 200)
  }
})

/**
 * DELETE /api/keys
 *
 * NULLs out encrypted_api_key. Does NOT delete the row — preserves the cap.
 * Returns 204 No Content.
 */
keysRouter.delete('/', async (c) => {
  const user = c.get('user')
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('creator_settings')
    .update({ encrypted_api_key: null })
    .eq('user_id', user.id)

  if (error) {
    console.error('[keys/delete] DB error:', error.code)
    return c.json({ error: 'server_error' }, 500)
  }

  return new Response(null, { status: 204 })
})

export default keysRouter
