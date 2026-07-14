import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { createServiceClient } from '../lib/supabase'
import type { AuthVariables } from '../middleware/auth'

// -----------------------------------------------------------------------
// bots.ts — creator-only per-session bot on/off toggle (PERSONA-01/02/03, D-09)
//
// Mirrors apps/api/src/routes/personas.ts (the pre-existing Role-toggle
// analog). Writes sessions.bot_overrides (a JSONB map keyed by Role id,
// e.g. { coach: true, analyst: false }) — structurally distinct from the
// legacy sessions.active_personas array (D-06).
// -----------------------------------------------------------------------

const PostBotBodySchema = z.object({
  botId: z.enum(['coach', 'analyst']),
  active: z.boolean(),
})

const botsRouter = new Hono<{ Variables: AuthVariables }>()

botsRouter.use('*', requireAuth)

botsRouter.post('/', async (c) => {
  const sessionId = c.req.param('id')
  const user = c.get('user')
  const supabase = createServiceClient()

  // Parse + validate body
  let body: z.infer<typeof PostBotBodySchema>
  try {
    const raw = await c.req.json()
    body = PostBotBodySchema.parse(raw)
  } catch {
    return c.json({ error: 'invalid_request', message: 'Invalid body' }, 400)
  }

  // Fetch the session first to verify creator_id (elevation of privilege protection)
  const { data: session, error: fetchError } = await supabase
    .from('sessions')
    .select('id, creator_id, bot_overrides')
    .eq('id', sessionId)
    .single()

  if (fetchError || !session) {
    return c.json({ error: 'not_found', message: 'Session not found' }, 404)
  }

  // T-11-21 / T-02-18 analog: Elevation of Privilege protection — verbatim
  // creator-only guard copied from personas.ts (must-copy per RESEARCH.md
  // Security Domain, not a design choice).
  if (session.creator_id !== user.id) {
    return c.json({ error: 'forbidden', message: 'Only the creator can toggle bots' }, 403)
  }

  // Compute the new bot_overrides jsonb, preserving other keys
  const botOverrides = (session.bot_overrides as Record<string, boolean>) || {}
  const newOverrides = { ...botOverrides, [body.botId]: body.active }

  // Update sessions.bot_overrides via the service-role client
  const { error: updateError } = await supabase
    .from('sessions')
    .update({ bot_overrides: newOverrides })
    .eq('id', sessionId)

  if (updateError) {
    console.error('[bots] update error', updateError)
    return c.json({ error: 'update_failed', message: updateError.message }, 500)
  }

  return c.json({ bot_overrides: newOverrides }, 200)
})

export default botsRouter
