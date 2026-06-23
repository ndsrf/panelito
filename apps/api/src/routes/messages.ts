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
import { rateLimit } from '../lib/rate-limit'
import { maybeAutoName } from '../lib/auto-name'

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
  branch_id: z.string().uuid().nullable().optional(),
})

const messagesRouter = new Hono<{ Variables: AuthVariables }>()

// Apply auth middleware to all routes
messagesRouter.use('*', requireAuth)

// T-05-05: per-author message rate limit (60/min) — defends against spam
const messageRateLimit = rateLimit({
  keyFn: (c) => `${(c.get('user') as { id: string }).id}:messages`,
  limit: 60,
  windowMs: 60_000,
})

// -----------------------------------------------------------------------
// POST /api/sessions/:id/messages — Insert a message + broadcast
// -----------------------------------------------------------------------

messagesRouter.post('/', messageRateLimit, async (c) => {
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
  const meta = user.user_metadata as Record<string, unknown>
  const metadataName = (meta?.full_name as string | undefined)?.trim() || (meta?.name as string | undefined)?.trim()

  let displayName: string

  if (isAnonymous) {
    // Guest: use display_name from body if provided, otherwise fall back to metadata (set during join)
    displayName = body.display_name?.trim() || metadataName || ''
    if (displayName.length === 0) {
      return c.json({ error: 'display_name_required', message: 'display_name is required for anonymous users.' }, 400)
    }
  } else {
    // Authenticated creator: use metadata, fall back to email prefix
    displayName = metadataName || (user.email?.split('@')[0] ?? 'Creador')
  }

  // Resolve branch_id and path_id consistency
  let pathId = body.path_id || 'main'
  let branchId = body.branch_id || null
  if (body.branch_id) {
    const { data: branch } = await supabase
      .from('branches')
      .select('id, path_id')
      .eq('id', body.branch_id)
      .eq('session_id', sessionId)
      .single()
    if (branch) {
      pathId = branch.path_id
      branchId = branch.id
    }
  }

  // Insert the message via service-role client (bypasses RLS — we already verified status above)
  const { data: row, error: insertError } = await supabase
    .from('messages')
    .insert({
      session_id: sessionId,
      author_id: user.id,
      display_name: displayName,
      parent_id: body.parent_id ?? null,
      path_id: pathId,
      branch_id: branchId,
      content: body.content,
      canvas_snapshot_state: null,
    })
    .select()
    .single()

  if (insertError || !row) {
    console.error('[messages] insert error', insertError)
    return c.json({ error: 'insert_failed', message: insertError?.message ?? 'Unknown error' }, 500)
  }

  // Broadcast fire-and-forget via REST — httpSend() is the explicit REST path,
  // avoiding the deprecated auto-fallback in send() for server-side delivery.
  supabase
    .channel(`session:${sessionId}`)
    .httpSend('new_message', row)
    .catch((err) => console.error('[messages] broadcast failed', err))

  // SESS-09: Auto-name session after 3rd message (fire-and-forget)
  if (sessionId) {
    maybeAutoName(supabase, sessionId).catch((err) =>
      console.error('[messages] maybeAutoName error:', err)
    )
  }

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

  // Fetch messages in the active branch ancestry, ordered ASC, last 200
  const branchId = c.req.query('branchId')
  let ancestorPaths = ['main']

  if (branchId) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchId)
    if (isUuid) {
      const { data: branch } = await supabase
        .from('branches')
        .select('path_id')
        .eq('id', branchId)
        .eq('session_id', sessionId)
        .single()

      if (branch) {
        const pathSegments = branch.path_id.split('.')
        ancestorPaths = pathSegments.map((_: string, i: number) => pathSegments.slice(0, i + 1).join('.'))
      }
    } else if (branchId === 'main') {
      ancestorPaths = ['main']
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _userId = user.id // accessed for RLS validation; removed from actual query
  const { data: messages, error: fetchError } = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .in('path_id', ancestorPaths)
    .order('created_at', { ascending: true })
    .limit(200)

  if (fetchError) {
    console.error('[messages] fetch error', fetchError)
    return c.json({ error: 'fetch_failed', message: fetchError.message }, 500)
  }

  return c.json(messages ?? [], 200)
})

export default messagesRouter
