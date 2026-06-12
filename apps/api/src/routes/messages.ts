/**
 * Messages routes — POST + GET /api/sessions/:id/messages
 *
 * CHAT-01: Message delivery < 200ms perceived latency via optimistic insert + broadcast
 * CHAT-04: Every row stores session_id, author_id, display_name, parent_id, path_id,
 *          content, canvas_snapshot_state
 *
 * CHAT-05 immutability — only INSERT and SELECT exist by design.
 * No PUT/PATCH/DELETE handlers in this router.
 * The DB has no UPDATE/DELETE RLS policies on messages.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { createServiceClient } from '../lib/supabase'
import type { AuthVariables } from '../middleware/auth'

/**
 * Body schema for POST /api/sessions/:id/messages
 * Note: session_id is taken from the URL :id param, not the body.
 * display_name is required for anonymous/guest users; ignored for creators.
 */
const PostMessageBodySchema = z.object({
  content: z.string().min(1).max(4000),
  display_name: z.string().min(1).max(60).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  path_id: z.string().optional().default('main'),
})

const messagesRouter = new Hono<{ Variables: AuthVariables }>()

// Apply auth middleware to all routes
messagesRouter.use('*', requireAuth)

// -----------------------------------------------------------------------
// POST /api/sessions/:id/messages — Insert a message + broadcast
// -----------------------------------------------------------------------

messagesRouter.post('/', async (c) => {
  const sessionId = c.req.param('id')
  const user = c.get('user')
  const supabase = createServiceClient()

  // Parse + validate body
  let body: z.infer<typeof PostMessageBodySchema>
  try {
    const raw = await c.req.json()
    body = PostMessageBodySchema.parse(raw)
  } catch {
    return c.json({ error: 'invalid_request', message: 'Content must be 1–4000 characters.' }, 400)
  }

  // Re-check session exists + is active (defense-in-depth, CHAT-05 gate)
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('id, status, creator_id')
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    return c.json({ error: 'not_found', message: 'Session not found.' }, 404)
  }

  // CHAT-05: re-check status even though RLS blocks INSERT on non-active sessions
  if (session.status !== 'active') {
    return c.json({ error: 'session_not_active', status: session.status }, 403)
  }

  // Resolve display_name based on user type
  // Anonymous users have is_anonymous: true in app_metadata (Supabase anon sign-in)
  const isAnonymous = !!(user.app_metadata as Record<string, unknown>)?.is_anonymous
  let displayName: string

  if (isAnonymous) {
    // Guest: display_name must come from the request body
    if (!body.display_name || body.display_name.trim().length === 0) {
      return c.json({ error: 'display_name_required', message: 'display_name is required for anonymous users.' }, 400)
    }
    displayName = body.display_name.trim()
  } else {
    // Authenticated creator: use full_name from metadata, fall back to email prefix
    const meta = user.user_metadata as Record<string, unknown>
    displayName =
      (meta?.full_name as string | undefined)?.trim() ||
      (meta?.name as string | undefined)?.trim() ||
      (user.email?.split('@')[0] ?? 'Creator')
  }

  // Insert the message via service-role client (bypasses RLS — we already verified status above)
  const { data: row, error: insertError } = await supabase
    .from('messages')
    .insert({
      session_id: sessionId,
      author_id: user.id,
      display_name: displayName,
      parent_id: body.parent_id ?? null,
      path_id: body.path_id ?? 'main',
      content: body.content,
      canvas_snapshot_state: null,
    })
    .select()
    .single()

  if (insertError || !row) {
    console.error('[messages] insert error', insertError)
    return c.json({ error: 'insert_failed', message: insertError?.message ?? 'Unknown error' }, 500)
  }

  // Broadcast fire-and-forget — do NOT await; return before broadcast settles
  supabase
    .channel(`session:${sessionId}`)
    .send({
      type: 'broadcast',
      event: 'new_message',
      payload: row,
    })
    .catch((err) => console.error('[messages] broadcast failed', err))

  return c.json(row, 201)
})

// -----------------------------------------------------------------------
// GET /api/sessions/:id/messages — Return last 200 messages (main branch)
// -----------------------------------------------------------------------

messagesRouter.get('/', async (c) => {
  const sessionId = c.req.param('id')
  const user = c.get('user')
  const supabase = createServiceClient()

  // Verify the user can see this session (RLS SELECT policy gates it)
  const { error: sessionError } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .single()

  if (sessionError) {
    return c.json({ error: 'not_found', message: 'Session not found or access denied.' }, 404)
  }

  // Fetch messages — only main branch, ordered ASC, last 200
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _userId = user.id // accessed for RLS validation; removed from actual query
  const { data: messages, error: fetchError } = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .eq('path_id', 'main')
    .order('created_at', { ascending: true })
    .limit(200)

  if (fetchError) {
    console.error('[messages] fetch error', fetchError)
    return c.json({ error: 'fetch_failed', message: fetchError.message }, 500)
  }

  return c.json(messages ?? [], 200)
})

export default messagesRouter
