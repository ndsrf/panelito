/**
 * Creator settings routes.
 *
 * GET /api/settings  — return { user_id, has_api_key, api_response_cap, active_provider, updated_at }
 * PUT /api/settings  — update api_response_cap and/or active_provider
 *
 * NEVER returns anthropic_api_key, openai_api_key, or gemini_api_key (AI-02, T-04-07).
 * has_api_key is true when ANY of the three provider key columns is non-null.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { ProviderSchema } from '@panelito/types'
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
  active_provider: ProviderSchema.optional(),
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
 * has_api_key is true when any provider key is set — never the blob itself.
 * All three key columns are stripped server-side before responding (T-04-07).
 */
settingsRouter.get('/', async (c) => {
  const user = c.get('user')
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('creator_settings')
    .select('user_id, anthropic_api_key, openai_api_key, gemini_api_key, api_response_cap, active_provider, updated_at')
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
      active_provider: 'anthropic',
      updated_at: null,
    }, 200)
  }

  // Strip all three key columns server-side — never expose to client (T-04-07, AI-02)
  const { anthropic_api_key: _a, openai_api_key: _o, gemini_api_key: _g, ...rest } = data
  return c.json({
    ...rest,
    has_api_key: _a !== null || _o !== null || _g !== null,
  }, 200)
})

/**
 * PUT /api/settings
 *
 * Accepts { api_response_cap?: number; active_provider?: ProviderName }.
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

  // Return updated settings (strip all key columns)
  const { data, error: fetchErr } = await supabase
    .from('creator_settings')
    .select('user_id, anthropic_api_key, openai_api_key, gemini_api_key, api_response_cap, active_provider, updated_at')
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !data) {
    return c.json({ error: 'server_error' }, 500)
  }

  const { anthropic_api_key: _a, openai_api_key: _o, gemini_api_key: _g, ...rest } = data
  return c.json({
    ...rest,
    has_api_key: _a !== null || _o !== null || _g !== null,
  }, 200)
})

export default settingsRouter
