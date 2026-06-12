/**
 * Creator settings routes.
 *
 * GET /api/settings  — return { user_id, has_api_key, api_response_cap, updated_at }
 * PUT /api/settings  — update api_response_cap
 *
 * NEVER returns encrypted_api_key (AI-02, T-06-02).
 * has_api_key is computed from (encrypted_api_key IS NOT NULL).
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { createServiceClient } from '../lib/supabase'
import { requireAuth, type AuthVariables } from '../middleware/auth'

// ---------------------------------------------------------------------------
// Validation schema for PUT body
// ---------------------------------------------------------------------------

const UpdateSettingsSchema = z.object({
  api_response_cap: z
    .number()
    .int()
    .min(1, 'api_response_cap must be at least 1')
    .max(10000, 'api_response_cap must be at most 10000')
    .optional(),
})

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const settingsRouter = new Hono<{ Variables: AuthVariables }>()

settingsRouter.use('/*', requireAuth)

/**
 * GET /api/settings
 *
 * Returns the public-safe CreatorSettings shape.
 * has_api_key is derived from (encrypted_api_key IS NOT NULL) — never the blob.
 */
settingsRouter.get('/', async (c) => {
  const user = c.get('user')
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('creator_settings')
    .select('user_id, encrypted_api_key, api_response_cap, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[settings/get] DB error:', error.code)
    return c.json({ error: 'server_error' }, 500)
  }

  if (!data) {
    // No row yet — return defaults
    return c.json({
      user_id: user.id,
      has_api_key: false,
      api_response_cap: 150,
      updated_at: null,
    }, 200)
  }

  // Compute has_api_key server-side; strip encrypted_api_key from response (T-06-02)
  const { encrypted_api_key: _omit, ...rest } = data
  return c.json({
    ...rest,
    has_api_key: _omit !== null,
  }, 200)
})

/**
 * PUT /api/settings
 *
 * Accepts { api_response_cap?: number } (int 1..10000).
 * Updates only the provided fields.
 * Returns the updated settings.
 */
settingsRouter.put('/', async (c) => {
  const user = c.get('user')

  const body = await c.req.json().catch(() => null)
  const parsed = UpdateSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400)
  }

  const updates = parsed.data
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'no fields to update' }, 400)
  }

  const supabase = createServiceClient()

  // Upsert: if row exists update it, else create with defaults
  const { data: existing } = await supabase
    .from('creator_settings')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('creator_settings')
      .update(updates)
      .eq('user_id', user.id)
    if (error) {
      console.error('[settings/put] DB update error:', error.code)
      return c.json({ error: 'server_error' }, 500)
    }
  } else {
    const { error } = await supabase
      .from('creator_settings')
      .insert({ user_id: user.id, ...updates })
    if (error) {
      console.error('[settings/put] DB insert error:', error.code)
      return c.json({ error: 'server_error' }, 500)
    }
  }

  // Return updated settings
  const { data, error: fetchErr } = await supabase
    .from('creator_settings')
    .select('user_id, encrypted_api_key, api_response_cap, updated_at')
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !data) {
    return c.json({ error: 'server_error' }, 500)
  }

  const { encrypted_api_key: _omit, ...rest } = data
  return c.json({
    ...rest,
    has_api_key: _omit !== null,
  }, 200)
})

export default settingsRouter
