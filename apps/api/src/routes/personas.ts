import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { createServiceClient } from '../lib/supabase'
import type { AuthVariables } from '../middleware/auth'
import { PERSONA_IDS } from '@panelito/types'

const PostPersonaBodySchema = z.object({
  personaId: z.enum(PERSONA_IDS),
  active: z.boolean(),
})

const personasRouter = new Hono<{ Variables: AuthVariables }>()

personasRouter.use('*', requireAuth)

personasRouter.post('/', async (c) => {
  const sessionId = c.req.param('id')
  const user = c.get('user')
  const supabase = createServiceClient()

  // Parse + validate body
  let body: z.infer<typeof PostPersonaBodySchema>
  try {
    const raw = await c.req.json()
    body = PostPersonaBodySchema.parse(raw)
  } catch {
    return c.json({ error: 'invalid_request', message: 'Invalid body' }, 400)
  }

  // Fetch the session first to verify creator_id (elevation of privilege protection)
  const { data: session, error: fetchError } = await supabase
    .from('sessions')
    .select('id, creator_id, active_personas')
    .eq('id', sessionId)
    .single()

  if (fetchError || !session) {
    return c.json({ error: 'not_found', message: 'Session not found' }, 404)
  }

  // T-02-18: Elevation of Privilege protection
  if (session.creator_id !== user.id) {
    return c.json({ error: 'forbidden', message: 'Only the creator can toggle personas' }, 403)
  }

  // Compute the new active_personas array
  const activePersonas = (session.active_personas as string[]) || []
  let newArray: string[]
  if (body.active) {
    // Add personaId if absent
    if (activePersonas.includes(body.personaId)) {
      newArray = activePersonas
    } else {
      newArray = [...activePersonas, body.personaId]
    }
  } else {
    // Remove personaId
    newArray = activePersonas.filter(id => id !== body.personaId)
  }

  // Update sessions.active_personas via service-role client
  const { error: updateError } = await supabase
    .from('sessions')
    .update({ active_personas: newArray })
    .eq('id', sessionId)

  if (updateError) {
    console.error('[personas] update error', updateError)
    return c.json({ error: 'update_failed', message: updateError.message }, 500)
  }

  return c.json({ active_personas: newArray }, 200)
})

export default personasRouter
