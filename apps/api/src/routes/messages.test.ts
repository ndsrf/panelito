/**
 * Integration tests for messages routes (Plan 05).
 *
 * Tests cover the 7 behaviors described in the plan:
 * 1. POST with valid creator JWT returns 201 + correct Message row fields
 * 2. POST with anonymous JWT + display_name returns 201
 * 3. POST with no Authorization header returns 401
 * 4. POST when session.status = 'frozen' returns 403 with 'session_not_active'
 * 5. POST with content of 4001 chars returns 400 (Zod max length)
 * 6. After successful POST, subscriber on channel session:${id} receives broadcast
 * 7. GET returns messages ordered created_at ASC, filtered to path_id='main'
 *
 * CHAT-05: No PUT/PATCH/DELETE endpoints exist — this router is INSERT + SELECT only.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { Hono } from 'hono'
import { createServiceClient } from '../lib/supabase'
import messagesRouter from './messages'
import sessionsRouter from './sessions'

// Mount both routers for testing
const app = new Hono()
app.route('/api/sessions', sessionsRouter)
app.route('/api/sessions/:id/messages', messagesRouter)

// -----------------------------------------------------------------------
// Test user + session setup
// -----------------------------------------------------------------------

let testCreator: User
let testAnonUser: User
let testSessionId: string
let testAnonToken: string

const supabase = createServiceClient()

async function mintTestUser(email: string): Promise<User> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: 'test-password-123',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`)
  return data.user
}

async function getJwtForUser(email: string): Promise<string> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: 'test-password-123',
  })
  if (error || !data.session) throw new Error(`Failed to sign in: ${error?.message}`)
  return data.session.access_token
}

beforeAll(async () => {
  // Create test creator
  const email = `msg-creator-${Date.now()}@panelito-test.example`
  testCreator = await mintTestUser(email)

  // Create a session for the creator
  const jwt = await getJwtForUser(email)
  const req = new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ title: 'Messages Test Session', mode: 'strategy' }),
  })
  const res = await app.fetch(req)
  const session = await res.json()
  testSessionId = session.id

  // Create an anonymous guest user for Test 2
  const { data: anonData, error: anonError } = await supabase.auth.admin.createUser({
    email: `msg-guest-${Date.now()}@panelito-test.example`,
    password: 'test-password-123',
    email_confirm: true,
    app_metadata: { is_anonymous: true },
  })
  if (anonError || !anonData.user) throw new Error(`Failed to create anon user: ${anonError?.message}`)
  testAnonUser = anonData.user
  const { data: anonSession } = await supabase.auth.signInWithPassword({
    email: anonData.user.email!,
    password: 'test-password-123',
  })
  testAnonToken = anonSession.session?.access_token ?? ''
})

afterAll(async () => {
  if (testCreator?.id) await supabase.auth.admin.deleteUser(testCreator.id)
  if (testAnonUser?.id) await supabase.auth.admin.deleteUser(testAnonUser.id)
})

// -----------------------------------------------------------------------
// Test 1: POST with valid creator JWT returns 201 + correct fields
// -----------------------------------------------------------------------

describe('POST /api/sessions/:id/messages', () => {
  it('Test 1: returns 201 with correct Message row for authenticated creator', async () => {
    const jwt = await getJwtForUser(testCreator.email!)
    const req = new Request(`http://localhost/api/sessions/${testSessionId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ content: 'hello' }),
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.session_id).toBe(testSessionId)
    expect(body.author_id).toBe(testCreator.id)
    expect(body.display_name).toBeDefined()
    expect(body.parent_id).toBeNull()
    expect(body.path_id).toBe('main')
    expect(body.content).toBe('hello')
    expect(body.canvas_snapshot_state).toBeNull()
  })

  it('Test 2: anonymous guest with display_name returns 201 and stores display_name', async () => {
    const req = new Request(`http://localhost/api/sessions/${testSessionId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testAnonToken}`,
      },
      body: JSON.stringify({ content: 'hi', display_name: 'Lau' }),
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.display_name).toBe('Lau')
  })

  it('Test 3: returns 401 when no Authorization header', async () => {
    const req = new Request(`http://localhost/api/sessions/${testSessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'no auth' }),
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(401)
  })

  it('Test 4: returns 403 with session_not_active when session is frozen', async () => {
    // Create a new session and freeze it
    const jwt = await getJwtForUser(testCreator.email!)
    const createReq = new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ title: 'Frozen Session Test', mode: 'debate' }),
    })
    const createRes = await app.fetch(createReq)
    const frozenSession = await createRes.json()

    // Freeze it
    const freezeReq = new Request(`http://localhost/api/sessions/${frozenSession.id}/freeze`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
    })
    await app.fetch(freezeReq)

    // Try to post a message to the frozen session
    const msgReq = new Request(`http://localhost/api/sessions/${frozenSession.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ content: 'should fail' }),
    })
    const msgRes = await app.fetch(msgReq)
    expect(msgRes.status).toBe(403)
    const body = await msgRes.json()
    expect(body.error).toBe('session_not_active')
  })

  it('Test 5: returns 400 when content exceeds 4000 chars (Zod validation)', async () => {
    const jwt = await getJwtForUser(testCreator.email!)
    const req = new Request(`http://localhost/api/sessions/${testSessionId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ content: 'a'.repeat(4001) }),
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(400)
  })
})

// -----------------------------------------------------------------------
// Test 6: Broadcast on new_message event
// -----------------------------------------------------------------------

describe('Broadcast test', () => {
  it('Test 6: subscriber receives broadcast payload on new_message event within 2s', async () => {
    // Subscribe to the channel before posting
    const broadcastPayload = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Broadcast timed out after 2s')), 2000)

      const subscriber = supabase
        .channel(`session:${testSessionId}`)
        .on('broadcast', { event: 'new_message' }, ({ payload }) => {
          clearTimeout(timeout)
          resolve(payload)
          // Cleanup after receiving
          supabase.removeChannel(subscriber).catch(() => {})
        })
        .subscribe()

      // Post a message after subscribing
      setTimeout(async () => {
        try {
          const jwt = await getJwtForUser(testCreator.email!)
          const req = new Request(`http://localhost/api/sessions/${testSessionId}/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify({ content: 'broadcast test message' }),
          })
          await app.fetch(req)
        } catch (err) {
          reject(err)
        }
      }, 100)
    })

    expect(broadcastPayload).toBeDefined()
    expect((broadcastPayload as { content: string }).content).toBe('broadcast test message')
  }, 10_000)
})

// -----------------------------------------------------------------------
// Test 7: GET returns messages ordered ASC, filtered to path_id='main'
// -----------------------------------------------------------------------

describe('GET /api/sessions/:id/messages', () => {
  it('Test 7: returns messages for the session ordered by created_at ASC, path_id=main only', async () => {
    const jwt = await getJwtForUser(testCreator.email!)
    const req = new Request(`http://localhost/api/sessions/${testSessionId}/messages`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    // Verify ordering
    for (let i = 1; i < body.length; i++) {
      expect(new Date(body[i].created_at).getTime()).toBeGreaterThanOrEqual(
        new Date(body[i - 1].created_at).getTime()
      )
    }
    // Verify path_id filter
    for (const msg of body) {
      expect(msg.path_id).toBe('main')
    }
  })
})
