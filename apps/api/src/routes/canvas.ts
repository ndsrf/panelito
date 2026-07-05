/**
 * Canvas routes — GET /sessions/:id/canvas + PATCH /canvas_nodes/:id
 *
 * CANVAS-03: GET returns committed canvas state for a branch on reconnect/branch-switch.
 * D-03: Ghost nodes are NOT returned on fetch — they are ephemeral per invocation.
 * D-11/D-12: PATCH accepts status='committed' (confirm) or 'silent' (dismiss).
 * D-16: PATCH broadcasts canvas_update to all session participants via httpSend.
 *
 * T-09-01: PATCH fetches node.session_id and verifies caller is a session participant
 *          (creator or guest who has sent a message). Service client bypasses RLS so
 *          this MUST be an explicit application-level check (ASVS V4).
 * T-09-02: PATCH body validated with z.enum(['committed', 'silent']) — returns 400 on violation.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { createServiceClient } from '../lib/supabase'
import { requireAuth, type AuthVariables } from '../middleware/auth'

// -----------------------------------------------------------------------
// canvasSessionRouter — handles GET /sessions/:id/canvas
// Mount at app.route("/sessions", canvasSessionRouter) → resolves to
// /api/sessions/:id/canvas
// -----------------------------------------------------------------------

export const canvasSessionRouter = new Hono<{ Variables: AuthVariables }>()

/**
 * GET /api/sessions/:id/canvas?branch_id=
 *
 * Returns committed-only nodes and edges for a branch.
 * D-03: Ghost nodes discarded on reconnect — client-side ephemeral.
 */
canvasSessionRouter.get('/:id/canvas', requireAuth, async (c) => {
  const { id } = c.req.param()
  const branchId = c.req.query('branch_id')
  const supabase = createServiceClient()

  // D-03: Return committed nodes only — ghosts are discarded on reconnect
  const [{ data: nodes, error: nodesErr }, { data: edges, error: edgesErr }] = await Promise.all([
    supabase
      .from('canvas_nodes')
      .select('*')
      .eq('session_id', id)
      .eq('branch_id', branchId ?? '')
      .eq('status', 'committed'),
    supabase
      .from('canvas_edges')
      .select('*')
      .eq('session_id', id)
      .eq('branch_id', branchId ?? '')
      .eq('status', 'committed'),
  ])

  if (nodesErr || edgesErr) {
    console.error('[canvas] fetch error', nodesErr?.message ?? edgesErr?.message)
    return c.json({ error: 'internal' }, 500)
  }

  return c.json({ nodes: nodes ?? [], edges: edges ?? [] }, 200)
})

// -----------------------------------------------------------------------
// canvasNodesRouter — handles PATCH /canvas_nodes/:id
// Mount at app.route("/canvas_nodes", canvasNodesRouter) → resolves to
// /api/canvas_nodes/:id
// -----------------------------------------------------------------------

export const canvasNodesRouter = new Hono<{ Variables: AuthVariables }>()

/**
 * Status schema — D-11 confirm='committed', D-12 dismiss='silent'
 * Rejects 'ghost' or any arbitrary value (T-09-02).
 */
const PatchCanvasNodeBodySchema = z.object({
  status: z.enum(['committed', 'silent']),
})

/**
 * PATCH /api/canvas_nodes/:id
 *
 * Updates node status (confirm or dismiss a ghost node).
 * Verifies session membership before update (T-09-01 — service client bypasses RLS).
 * Broadcasts canvas_update fire-and-forget after successful update (D-16).
 */
canvasNodesRouter.patch('/:id', requireAuth, async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')
  const supabase = createServiceClient()

  // T-09-02: Validate status enum before any DB call
  const rawBody = await c.req.json().catch(() => ({}))
  const parsed = PatchCanvasNodeBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return c.json({ error: 'invalid_status' }, 400)
  }

  // T-09-01: Fetch the node first to get its session_id for membership check.
  // The service client bypasses RLS so this MUST be an explicit check.
  const { data: existingNode, error: fetchErr } = await supabase
    .from('canvas_nodes')
    .select('id, session_id')
    .eq('id', id)
    .single()

  if (fetchErr || !existingNode) {
    return c.json({ error: 'not_found' }, 404)
  }

  const sessionId = existingNode.session_id

  // T-09-01: Session membership check — caller must be the creator OR a session participant
  // (guest who has sent at least one message). Creator check is fast; participant check falls
  // back to a messages SELECT. First-click-wins semantics (D-10).
  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .select('creator_id')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !session) {
    return c.json({ error: 'not_found' }, 404)
  }

  const isCreator = session.creator_id === user.id

  if (!isCreator) {
    // Check if caller has sent at least one message in this session (participant gate)
    const { count, error: msgErr } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('author_id', user.id)

    if (msgErr || !count || count < 1) {
      return c.json({ error: 'forbidden' }, 403)
    }
  }

  // Update the node status
  const { data: node, error: updateErr } = await supabase
    .from('canvas_nodes')
    .update({ status: parsed.data.status })
    .eq('id', id)
    .select()
    .single()

  if (updateErr || !node) {
    return c.json({ error: 'not_found' }, 404)
  }

  // D-16: Fire-and-forget canvas_update broadcast so all participants see the status change
  supabase
    .channel(`session:${sessionId}`)
    .httpSend('canvas_update', { nodes: [node], edges: [] })
    .catch((err) => console.error('[canvas_nodes] broadcast failed', err))

  return c.json(node, 200)
})
