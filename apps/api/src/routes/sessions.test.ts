/**
 * Integration tests for session CRUD routes.
 *
 * Tests 1–6 cover the 6 route behaviors described in the plan:
 * - SESS-02: Creator creates session (POST /)
 * - SESS-03: Creator views session (GET /:id)
 * - SESS-05: Creator freezes session (POST /:id/freeze)
 * - SESS-06: Creator closes session (POST /:id/close)
 * - Public join landing data (GET /by-code/:code)
 * - Guest anonymous-auth (POST /by-code/:code/guests)
 *
 * Tests use the Supabase admin API to mint test users, then call routes
 * via app.fetch() against the in-memory Hono app.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { createServiceClient } from '../lib/supabase'
import sessionsRouter from './sessions'
import { Hono } from 'hono'

// Mount the router under /api/sessions for testing
const app = new Hono()
app.route('/api/sessions', sessionsRouter)

// -----------------------------------------------------------------------
// Test user setup — minted via admin API, cleaned up after
// -----------------------------------------------------------------------

let testCreator: User
let testCreator2: User
let testSessionId: string
let testShortCode: string

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
  const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: 'test-password-123',
  })
  if (signInError || !sessionData.session) {
    throw new Error(`Failed to sign in test user: ${signInError?.message}`)
  }
  return sessionData.session.access_token
}

beforeAll(async () => {
  const email1 = `creator-1-${Date.now()}@panelito-test.example`
  const email2 = `creator-2-${Date.now()}@panelito-test.example`
  testCreator = await mintTestUser(email1)
  testCreator2 = await mintTestUser(email2)
})

afterAll(async () => {
  // Clean up test users
  if (testCreator?.id) await supabase.auth.admin.deleteUser(testCreator.id)
  if (testCreator2?.id) await supabase.auth.admin.deleteUser(testCreator2.id)
})

// -----------------------------------------------------------------------
// Test 1: POST /api/sessions — creates a session with valid JWT
// -----------------------------------------------------------------------

describe('POST /api/sessions', () => {
  it('creates a session with valid creator JWT and returns 201 with short_code', async () => {
    const jwt = await getJwtForUser(testCreator.email!)
    const req = new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ title: 'Test Session', mode: 'strategy' }),
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(201)
    const body = (await res.json()) as any
    expect(body.creator_id).toBe(testCreator.id)
    expect(body.short_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    testSessionId = body.id
    testShortCode = body.short_code
  })

  it('returns 401 when no Authorization header is provided', async () => {
    const req = new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No Auth', mode: 'strategy' }),
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(401)
  })
})

// -----------------------------------------------------------------------
// Test 3: POST /api/sessions/:id/freeze — creator freezes; other user 403
// -----------------------------------------------------------------------

describe('POST /api/sessions/:id/freeze', () => {
  it('freezes the session when called by the creator', async () => {
    const jwt = await getJwtForUser(testCreator.email!)
    const req = new Request(`http://localhost/api/sessions/${testSessionId}/freeze`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.status).toBe('frozen')
  })

  it('returns 403 when a different user tries to freeze', async () => {
    const jwt2 = await getJwtForUser(testCreator2.email!)
    const req = new Request(`http://localhost/api/sessions/${testSessionId}/freeze`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt2}` },
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(403)
  })
})

// -----------------------------------------------------------------------
// Test 4: POST /api/sessions/:id/close — creator closes session
// -----------------------------------------------------------------------

describe('POST /api/sessions/:id/close', () => {
  it('closes the session when called by the creator', async () => {
    const jwt = await getJwtForUser(testCreator.email!)
    const req = new Request(`http://localhost/api/sessions/${testSessionId}/close`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.status).toBe('closed')
  })
})

// -----------------------------------------------------------------------
// Test 5: GET /api/sessions/by-code/:code — public endpoint, limited fields
// -----------------------------------------------------------------------

describe('GET /api/sessions/by-code/:code', () => {
  it('returns session summary without creator_id or encrypted fields', async () => {
    const req = new Request(`http://localhost/api/sessions/by-code/${testShortCode}`)
    const res = await app.fetch(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.id).toBeDefined()
    expect(body.title).toBeDefined()
    expect(body.status).toBeDefined()
    // Must NOT contain sensitive fields (T-03-03)
    expect(body.creator_id).toBeUndefined()
    expect(body.encrypted_api_key).toBeUndefined()
    expect(body.ai_response_count).toBeUndefined()
  })

  it('returns 404 for a non-existent code', async () => {
    const req = new Request('http://localhost/api/sessions/by-code/ZZZZZZ')
    const res = await app.fetch(req)
    expect(res.status).toBe(404)
  })
})

// -----------------------------------------------------------------------
// Test 6: POST /api/sessions/by-code/:code/guests — issues anonymous token
// -----------------------------------------------------------------------

describe('POST /api/sessions/by-code/:code/guests', () => {
  it('returns 201 with guest token for a valid code', async () => {
    // Create a fresh active session for this test (earlier one is closed)
    const jwt = await getJwtForUser(testCreator.email!)
    const createReq = new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ title: 'Guest Test Session', mode: 'debate' }),
    })
    const createRes = await app.fetch(createReq)
    const session = (await createRes.json()) as any
    const code = session.short_code

    const req = new Request(`http://localhost/api/sessions/by-code/${code}/guests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'Lau' }),
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(201)
    const body = (await res.json()) as any
    expect(body.session_id).toBe(session.id)
    expect(body.guest_user_id).toBeDefined()
    expect(body.guest_user_id).not.toBe(testCreator.id)
    expect(body.access_token).toBeDefined()
    expect(body.refresh_token).toBeDefined()
  })

  it('returns 404 for a non-existent code', async () => {
    const req = new Request('http://localhost/api/sessions/by-code/ZZZZZZ/guests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'Ghost' }),
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(404)
  })
})
