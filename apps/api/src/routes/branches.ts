import { Hono } from 'hono'
import { z } from 'zod'
import { createServiceClient } from '../lib/supabase'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { generateBranchLabel } from '../services/labeler'
import { decryptKey } from '../lib/crypto'
import { env } from '../lib/env'
import type { ProviderName } from '@panelito/types'

// 50-branch soft limit (D-13)
const MAX_ACTIVE_BRANCHES = 50

const ForkBodySchema = z.object({
  forkMessageId: z.string().uuid(),
})

const UpdateBranchBodySchema = z.object({
  label: z.string().min(1).max(25).optional(), // D-07: Capped at 25 characters
  is_archived: z.boolean().optional(),
})

export const branchesRouter = new Hono<{ Variables: AuthVariables }>()

// Enforce authentication on all branch operations
branchesRouter.use('*', requireAuth)

const colors = [
  '#6366f1', // Indigo (Main)
  '#10b981', // Emerald
  '#f43f5e', // Rose
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#0ea5e9', // Sky
  '#64748b', // Slate
  '#14b8a6', // Teal
  '#f97316', // Orange
  '#d946ef', // Fuchsia
]

/**
 * POST /api/sessions/:id/branches/fork
 * Fork a new conversation branch from a human message (BRANCH-01, BRANCH-02).
 */
branchesRouter.post('/fork', async (c) => {
  const sessionId = c.req.param('id')
  const user = c.get('user')
  const supabase = createServiceClient()

  // 1. Parse request body
  let body: z.infer<typeof ForkBodySchema>
  try {
    const raw = await c.req.json()
    body = ForkBodySchema.parse(raw)
  } catch {
    return c.json({ error: 'invalid_request', message: 'forkMessageId must be a valid UUID.' }, 400)
  }

  // 2. Fetch session and verify active status
  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .select('id, status, creator_id')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !session) {
    return c.json({ error: 'not_found', message: 'Session not found.' }, 404)
  }

  if (session.status !== 'active') {
    return c.json({ error: 'session_not_active', message: 'Cannot fork branches in a frozen or closed session.' }, 403)
  }

  // 3. Enforce the 50 active branches soft limit (D-13)
  const { count, error: countErr } = await supabase
    .from('branches')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('is_archived', false)

  if (countErr) {
    console.error('[branches] count error:', countErr.message)
    return c.json({ error: 'server_error' }, 500)
  }

  if (count !== null && count >= MAX_ACTIVE_BRANCHES) {
    return c.json({ error: 'limit_exceeded', message: `Límite de ramas alcanzado (${MAX_ACTIVE_BRANCHES})` }, 400)
  }

  // 4. Fetch the fork source message
  const { data: parentMsg, error: parentMsgErr } = await supabase
    .from('messages')
    .select('*')
    .eq('id', body.forkMessageId)
    .eq('session_id', sessionId)
    .single()

  if (parentMsgErr || !parentMsg) {
    return c.json({ error: 'message_not_found', message: 'Fork source message not found.' }, 404)
  }

  // D-15: Participants can only fork from human messages
  if (parentMsg.role !== 'user') {
    return c.json({ error: 'fork_from_ai_disabled', message: 'Bifurcación solo permitida en mensajes humanos.' }, 400)
  }

  // 5. Get parent branch's path_id
  let parentBranchId = parentMsg.branch_id
  if (!parentBranchId) {
    // Find default 'main' branch
    const { data: mainBranch } = await supabase
      .from('branches')
      .select('id')
      .eq('session_id', sessionId)
      .eq('path_id', 'main')
      .single()
    parentBranchId = mainBranch?.id
  }

  if (!parentBranchId) {
    return c.json({ error: 'parent_branch_not_found', message: 'Parent branch not found.' }, 404)
  }

  const { data: parentBranch } = await supabase
    .from('branches')
    .select('path_id')
    .eq('id', parentBranchId)
    .single()

  const parentPath = parentBranch?.path_id || 'main'

  // 6. Fetch creator API key for auto-labeling (AI-09)
  const { data: creatorSettings, error: settingsErr } = await supabase
    .from('creator_settings')
    .select('anthropic_api_key, openai_api_key, gemini_api_key, active_provider')
    .eq('user_id', session.creator_id)
    .maybeSingle()

  let label = 'Nueva Rama'
  if (!settingsErr && creatorSettings) {
    const providerName = (creatorSettings.active_provider || 'anthropic') as ProviderName
    const encryptedKey = creatorSettings[`${providerName}_api_key` as keyof typeof creatorSettings] as string | null | undefined
    if (encryptedKey) {
      try {
        const plaintextKey = decryptKey(encryptedKey, env.KEY_ENCRYPTION_SECRET)
        label = await generateBranchLabel(parentMsg.content, providerName, plaintextKey)
      } catch (err) {
        console.error('[branches] Failed to generate label, using default:', err)
      }
    }
  }

  // 7. Get total branches count to cycle colors (D-02)
  const { count: totalBranchesCount } = await supabase
    .from('branches')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)

  const colorSequenceIndex = totalBranchesCount !== null ? totalBranchesCount : 0
  const color = colors[colorSequenceIndex % colors.length]

  const newBranchId = crypto.randomUUID()
  const newBranchShortId = newBranchId.slice(0, 8)
  const newPathId = `${parentPath}.${newBranchShortId}`

  // 8. Insert branch
  const { data: branch, error: insertErr } = await supabase
    .from('branches')
    .insert({
      id: newBranchId,
      session_id: sessionId,
      parent_id: parentBranchId,
      path_id: newPathId,
      label,
      color,
      fork_message_id: body.forkMessageId,
      is_archived: false,
    })
    .select()
    .single()

  if (insertErr || !branch) {
    console.error('[branches] insert error:', insertErr?.message)
    return c.json({ error: 'fork_failed', message: insertErr?.message || 'Failed to create branch.' }, 500)
  }

  // 9. Broadcast new branch event to session participants
  supabase
    .channel(`session:${sessionId}`)
    .httpSend('new_branch', branch)
    .catch((err) => console.error('[branches] broadcast error:', err))

  return c.json(branch, 201)
})

/**
 * GET /api/sessions/:id/branches
 * List all branches for a session.
 */
branchesRouter.get('/', async (c) => {
  const sessionId = c.req.param('id')
  const supabase = createServiceClient()

  // Verify session exists
  const { error: sessionError } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .single()

  if (sessionError) {
    return c.json({ error: 'not_found', message: 'Session not found.' }, 404)
  }

  const { data: branches, error: fetchError } = await supabase
    .from('branches')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (fetchError) {
    console.error('[branches] fetch error:', fetchError.message)
    return c.json({ error: 'fetch_failed' }, 500)
  }

  return c.json(branches || [], 200)
})

/**
 * PATCH /api/sessions/:id/branches/:branchId
 * Rename branch (any participant) or Archive/Restore branch (Creator only) (D-06, D-17).
 */
branchesRouter.patch('/:branchId', async (c) => {
  const sessionId = c.req.param('id')
  const branchId = c.req.param('branchId')
  const user = c.get('user')
  const supabase = createServiceClient()

  // Parse + validate body
  let body: z.infer<typeof UpdateBranchBodySchema>
  try {
    const raw = await c.req.json()
    body = UpdateBranchBodySchema.parse(raw)
  } catch (err) {
    return c.json({ error: 'validation_error', issues: (err as z.ZodError).issues }, 400)
  }

  // Fetch session and branch to verify permissions
  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .select('id, creator_id')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !session) {
    return c.json({ error: 'not_found', message: 'Session not found.' }, 404)
  }

  const { data: branch, error: branchErr } = await supabase
    .from('branches')
    .select('*')
    .eq('id', branchId)
    .eq('session_id', sessionId)
    .single()

  if (branchErr || !branch) {
    return c.json({ error: 'branch_not_found', message: 'Branch not found in this session.' }, 404)
  }

  // Security gate for archiving/restoring: Creator only (D-17)
  if (body.is_archived !== undefined && session.creator_id !== user.id) {
    return c.json({ error: 'forbidden', message: 'Only the session creator can archive or restore branches.' }, 403)
  }

  // Prepare updates
  const updates: Record<string, unknown> = {}
  if (body.label !== undefined) {
    updates.label = body.label
  }
  if (body.is_archived !== undefined) {
    updates.is_archived = body.is_archived
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'bad_request', message: 'No fields to update.' }, 400)
  }

  const { data: updatedBranch, error: updateErr } = await supabase
    .from('branches')
    .update(updates)
    .eq('id', branchId)
    .select()
    .single()

  if (updateErr || !updatedBranch) {
    console.error('[branches] update error:', updateErr?.message)
    return c.json({ error: 'update_failed', message: updateErr?.message || 'Failed to update branch.' }, 500)
  }

  // Broadcast branch update to all participants
  supabase
    .channel(`session:${sessionId}`)
    .httpSend('branch_update', updatedBranch)
    .catch((err) => console.error('[branches] broadcast update error:', err))

  return c.json(updatedBranch, 200)
})

export default branchesRouter
