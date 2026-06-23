/**
 * Integration tests for branches routes (Phase 3 - Multiverse).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { Hono } from 'hono'
import { createServiceClient } from '../lib/supabase'
import branchesRouter from './branches'
import messagesRouter from './messages'
import sessionsRouter from './sessions'

// Mount routers
const app = new Hono()
app.route('/api/sessions', sessionsRouter)
app.route('/api/sessions/:id/messages', messagesRouter)
app.route('/api/sessions/:id/branches', branchesRouter)

let testCreator: User
let testOtherUser: User
let testSessionId: string
let testCreatorJwt: string
let testOtherUserJwt: string
let userMessageId: string
let assistantMessageId: string

const adminSupabase = createServiceClient()

async function mintTestUser(email: string): Promise<User> {
  const client = createServiceClient()
  const { data, error } = await client.auth.admin.createUser({
    email,
    password: 'test-password-123',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`)
  return data.user
}

async function getJwtForUser(email: string): Promise<string> {
  const client = createServiceClient()
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: 'test-password-123',
  })
  if (error || !data.session) throw new Error(`Failed to sign in: ${error?.message}`)
  return data.session.access_token
}

beforeAll(async () => {
  // Create creator and another user
  const time = Date.now()
  testCreator = await mintTestUser(`branch-creator-${time}@panelito-test.example`)
  testOtherUser = await mintTestUser(`branch-other-${time}@panelito-test.example`)

  testCreatorJwt = await getJwtForUser(testCreator.email!)
  testOtherUserJwt = await getJwtForUser(testOtherUser.email!)

  // Create session
  const createReq = new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${testCreatorJwt}`,
    },
    body: JSON.stringify({ title: 'Branches Test Session', mode: 'strategy' }),
  })
  const createRes = await app.fetch(createReq)
  const session = (await createRes.json()) as any
  testSessionId = session.id

  // Post a human message
  const msgReq = new Request(`http://localhost/api/sessions/${testSessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${testCreatorJwt}`,
    },
    body: JSON.stringify({ content: 'Hello this is a human message' }),
  })
  const msgRes = await app.fetch(msgReq)
  const msgBody = (await msgRes.json()) as any
  userMessageId = msgBody.id

  // Manually insert an assistant message for testing fork restriction
  const { data: assistantMsg, error: assistantErr } = await adminSupabase
    .from('messages')
    .insert({
      session_id: testSessionId,
      author_id: testCreator.id,
      role: 'assistant',
      display_name: 'AI Assistant',
      content: 'Hello this is an AI message',
      path_id: 'main',
    })
    .select()
    .single()

  if (assistantErr || !assistantMsg) {
    throw new Error(`Failed to insert test assistant message: ${assistantErr?.message}`)
  }
  assistantMessageId = assistantMsg.id
})

afterAll(async () => {
  if (testCreator?.id) {
    const client = createServiceClient()
    await client.auth.admin.deleteUser(testCreator.id)
  }
  if (testOtherUser?.id) {
    const client = createServiceClient()
    await client.auth.admin.deleteUser(testOtherUser.id)
  }
})

describe('GET /api/sessions/:id/branches', () => {
  it('should return a list of branches with default Principal branch', async () => {
    const req = new Request(`http://localhost/api/sessions/${testSessionId}/branches`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${testCreatorJwt}`,
      },
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(200)
    const branches = (await res.json()) as any[]
    expect(branches.length).toBeGreaterThanOrEqual(1)
    
    // Default branch should have path_id='main' and label='Principal' or similar
    const mainBranch = branches.find((b) => b.path_id === 'main')
    expect(mainBranch).toBeDefined()
    expect(mainBranch.label).toBe('Principal')
  })
})

describe('POST /api/sessions/:id/branches/fork', () => {
  it('should successfully fork a branch from a human message', async () => {
    const req = new Request(`http://localhost/api/sessions/${testSessionId}/branches/fork`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testCreatorJwt}`,
      },
      body: JSON.stringify({ forkMessageId: userMessageId }),
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(201)
    const branch = (await res.json()) as any
    expect(branch.session_id).toBe(testSessionId)
    expect(branch.fork_message_id).toBe(userMessageId)
    expect(branch.color).toBeDefined()
    expect(branch.label).toBeDefined()
    expect(branch.is_archived).toBe(false)
  })

  it('should reject forking from an assistant message with 400', async () => {
    const req = new Request(`http://localhost/api/sessions/${testSessionId}/branches/fork`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testCreatorJwt}`,
      },
      body: JSON.stringify({ forkMessageId: assistantMessageId }),
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toBe('fork_from_ai_disabled')
  })
})

describe('PATCH /api/sessions/:id/branches/:branchId', () => {
  it('should allow any participant to rename a branch (label <= 25 chars)', async () => {
    // 1. Fork another branch first
    const forkReq = new Request(`http://localhost/api/sessions/${testSessionId}/branches/fork`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testCreatorJwt}`,
      },
      body: JSON.stringify({ forkMessageId: userMessageId }),
    })
    const forkRes = await app.fetch(forkReq)
    const branch = (await forkRes.json()) as any

    // 2. Rename as other user (should succeed)
    const renameReq = new Request(`http://localhost/api/sessions/${testSessionId}/branches/${branch.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testOtherUserJwt}`,
      },
      body: JSON.stringify({ label: 'Rama Renombrada' }),
    })
    const renameRes = await app.fetch(renameReq)
    expect(renameRes.status).toBe(200)
    const updated = (await renameRes.json()) as any
    expect(updated.label).toBe('Rama Renombrada')
  })

  it('should reject renaming if label exceeds 25 characters', async () => {
    // 1. Fork a branch
    const forkReq = new Request(`http://localhost/api/sessions/${testSessionId}/branches/fork`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testCreatorJwt}`,
      },
      body: JSON.stringify({ forkMessageId: userMessageId }),
    })
    const forkRes = await app.fetch(forkReq)
    const branch = (await forkRes.json()) as any

    // 2. Attempt rename with long label
    const renameReq = new Request(`http://localhost/api/sessions/${testSessionId}/branches/${branch.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testCreatorJwt}`,
      },
      body: JSON.stringify({ label: 'Esta es una etiqueta extremadamente larga que supera 25 caracteres' }),
    })
    const renameRes = await app.fetch(renameReq)
    expect(renameRes.status).toBe(400)
  })

  it('should allow only creator to archive or restore a branch', async () => {
    // 1. Fork a branch
    const forkReq = new Request(`http://localhost/api/sessions/${testSessionId}/branches/fork`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testCreatorJwt}`,
      },
      body: JSON.stringify({ forkMessageId: userMessageId }),
    })
    const forkRes = await app.fetch(forkReq)
    const branch = (await forkRes.json()) as any

    // 2. Try to archive as other user (forbidden 403)
    const archiveReqOther = new Request(`http://localhost/api/sessions/${testSessionId}/branches/${branch.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testOtherUserJwt}`,
      },
      body: JSON.stringify({ is_archived: true }),
    })
    const archiveResOther = await app.fetch(archiveReqOther)
    expect(archiveResOther.status).toBe(403)

    // 3. Archive as creator (success 200)
    const archiveReqCreator = new Request(`http://localhost/api/sessions/${testSessionId}/branches/${branch.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testCreatorJwt}`,
      },
      body: JSON.stringify({ is_archived: true }),
    })
    const archiveResCreator = await app.fetch(archiveReqCreator)
    expect(archiveResCreator.status).toBe(200)
    const archivedBranch = (await archiveResCreator.json()) as any
    expect(archivedBranch.is_archived).toBe(true)

    // 4. Restore as creator (success 200)
    const restoreReqCreator = new Request(`http://localhost/api/sessions/${testSessionId}/branches/${branch.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testCreatorJwt}`,
      },
      body: JSON.stringify({ is_archived: false }),
    })
    const restoreResCreator = await app.fetch(restoreReqCreator)
    expect(restoreResCreator.status).toBe(200)
    const restoredBranch = (await restoreResCreator.json()) as any
    expect(restoredBranch.is_archived).toBe(false)
  })
})
