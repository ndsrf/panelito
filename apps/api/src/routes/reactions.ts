/**
 * Reactions routes — POST /api/sessions/:id/reactions
 *
 * REACT-01: POST /reactions persists a reaction row (deduped per emoji per user per message)
 * REACT-02: D-09 — fire/pin/target emojis signal AI follow-up; brain does not
 * REACT-03: RLS WITH CHECK (auth.uid() = author_id) — enforced at DB level (Plan 01 migration)
 * REACT-04: UNIQUE (message_id, author_id, emoji) constraint prevents duplicate reactions
 * REACT-05: Supabase Realtime broadcasts reaction rows automatically via publication
 *
 * T-02-07: reactionRateLimit 60/min/user (defense against reaction-spam → runaway AI cost)
 * T-02-09: RLS enforces author_id = auth.uid() (Plan 01 migration) — server-side gate
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { createServiceClient } from '../lib/supabase'
import type { AuthVariables } from '../middleware/auth'
import { rateLimit } from '../lib/rate-limit'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const PostReactionBodySchema = z.object({
  messageId: z.string().uuid(),
  emoji: z.enum(['🧠', '🔥', '📌', '🎯']),
})

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const reactionsRouter = new Hono<{ Variables: AuthVariables }>()

reactionsRouter.use('*', requireAuth)

// T-02-07: 60 reactions/min per user — defends against reaction-spam → AI cost
const reactionRateLimit = rateLimit({
  keyFn: (c) => `${(c.get('user') as { id: string }).id}:reactions`,
  limit: 60,
  windowMs: 60_000,
})

// -----------------------------------------------------------------------
// POST /api/sessions/:id/reactions — Upsert a reaction
// -----------------------------------------------------------------------

reactionsRouter.post('/', reactionRateLimit, async (c) => {
  const sessionId = c.req.param('id')
  const user = c.get('user')
  const supabase = createServiceClient()

  // Parse + validate body
  let body: z.infer<typeof PostReactionBodySchema>
  try {
    const raw = await c.req.json()
    body = PostReactionBodySchema.parse(raw)
  } catch {
    return c.json({ error: 'invalid_request', message: 'messageId must be a UUID and emoji must be one of 🧠 🔥 📌 🎯.' }, 400)
  }

  // Upsert: deduplicate per (message_id, author_id, emoji) — REACT-04
  // ignoreDuplicates: true means we don't fail on a repeat tap of the same emoji
  const { data: row, error: insertError } = await supabase
    .from('reactions')
    .upsert(
      {
        message_id: body.messageId,
        session_id: sessionId,
        author_id: user.id,
        emoji: body.emoji,
      },
      { onConflict: 'message_id,author_id,emoji', ignoreDuplicates: true }
    )
    .select()
    .single()

  if (insertError) {
    console.error('[reactions] insert error', insertError)
    return c.json({ error: 'insert_failed', message: insertError.message }, 500)
  }

  // D-09: 🔥 (Intensify) + 📌 (Pin to Panel) + 🎯 (Simplify) trigger AI follow-up
  // 🧠 (Insight) marks for summary only — does NOT trigger AI (D-11)
  const triggersAI = ['🔥', '📌', '🎯'].includes(body.emoji)

  // Broadcast the new reaction to all session participants in real-time
  // (ensures delivery under LongPoll and WebSockets alike)
  supabase
    .channel(`session:${sessionId}`)
    .httpSend('new_reaction', row)
    .catch((err) => console.error('[reactions] broadcast failed', err))

  return c.json({ ...row, triggersAI }, 201)
})

export default reactionsRouter
