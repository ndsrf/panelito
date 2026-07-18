/**
 * Integration tests for /api/keys, /api/settings, and /api/sessions/:id/invoke routes.
 *
 * Keys tests (5):
 * - Test 1: POST /verify valid key -> 200 { success: true }, row persisted
 * - Test 2: POST /verify invalid key -> 400 { success: false, error: 'invalid_key' }, no row
 * - Test 3: POST /verify no auth -> 401
 * - Test 4: GET /status after verify -> { has_api_key: true, last4 } never returns the full key
 * - Test 5: DELETE /api/keys nulls column; GET /status -> { has_api_key: false, last4: null }
 *
 * Settings tests (3):
 * - Test 6: GET /api/settings after verify -> { user_id, has_api_key: true, api_response_cap: 150 }
 * - Test 7: PUT { api_response_cap: 500 } -> 200; GET shows 500
 * - Test 8: PUT { api_response_cap: -1 } -> 400
 *
 * AI scaffold test (1):
 * - Test 9: POST /api/sessions/:id/invoke -> 501 { status: 'scaffolded', prompt_array_length, cache_breakpoint_position }
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import type { User } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonAs<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>
}
import { createServiceClient } from '../lib/supabase'
import keysRouter from './keys'
import settingsRouter from './settings'
import aiRouter from './ai'
import { Hono } from 'hono'
import type { AuthVariables } from '../middleware/auth'

// ---------------------------------------------------------------------------
// Mock verifyApiKey so tests don't hit the real Anthropic API
// ---------------------------------------------------------------------------

vi.mock('../lib/anthropic', async () => {
  const actual = await vi.importActual<typeof import('../lib/anthropic')>('../lib/anthropic')
  return {
    ...actual,
    verifyApiKey: vi.fn(),
  }
})

vi.mock('../lib/verify-key', async () => {
  const actual = await vi.importActual<typeof import('../lib/verify-key')>('../lib/verify-key')
  return {
    ...actual,
    verifyOpenAIKey: vi.fn(),
    verifyGeminiKey: vi.fn(),
  }
})

import { verifyApiKey } from '../lib/anthropic'
import { verifyOpenAIKey } from '../lib/verify-key'
const mockVerify = vi.mocked(verifyApiKey)
const mockVerifyOpenAI = vi.mocked(verifyOpenAIKey)

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = new Hono<{ Variables: AuthVariables }>()
app.route('/api/keys', keysRouter)
app.route('/api/settings', settingsRouter)
app.route('/api/sessions', aiRouter)

// ---------------------------------------------------------------------------
// Test user + helpers
// ---------------------------------------------------------------------------

let testUser: User
let testSessionId: string
const supabase = createServiceClient()

async function mintTestUser(email: string): Promise<User> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: 'test-password-byok-123',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`)
  return data.user
}

async function getJwtForUser(email: string): Promise<string> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: 'test-password-byok-123',
  })
  if (error || !data.session) throw new Error(`Failed to sign in: ${error?.message}`)
  return data.session.access_token
}

async function deleteTestUser(userId: string): Promise<void> {
  await supabase.auth.admin.deleteUser(userId)
}

beforeAll(async () => {
  testUser = await mintTestUser('byok-test-user@example.com')

  // Create a test session for the AI scaffold test
  // short_code: 6 chars from Crockford base32 alphabet (A-HJ-NP-Z2-9)
  const shortCode = 'BYOK' + Math.floor(Math.random() * 89 + 10).toString().replace('0', '2')
  const validCode = shortCode.replace(/[^A-HJ-NP-Z2-9]/g, 'B').slice(0, 6)
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      creator_id: testUser.id,
      title: 'BYOK Test Session',
      status: 'active',
      short_code: validCode,
      // blueprint_id is NOT NULL (FK -> domain_blueprints) as of migration 0008 —
      // pre-existing test-infra drift (Rule 3 blocking fix, unrelated to BYOK-FIX-ACTIVATE).
      blueprint_id: 'debate-strategy-v1',
    })
    .select('id')
    .single()
  if (error) throw new Error(`Failed to create session: ${error.message}`)
  testSessionId = data.id
})

afterAll(async () => {
  if (testUser) {
    // Clean up session
    if (testSessionId) {
      await supabase.from('sessions').delete().eq('id', testSessionId)
    }
    // Clean up creator_settings
    await supabase.from('creator_settings').delete().eq('user_id', testUser.id)
    await deleteTestUser(testUser.id)
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Keys tests
// ---------------------------------------------------------------------------

describe('POST /api/keys/verify', () => {
  it('Test 1: valid key -> 200 { success: true }, DB row persisted', async () => {
    mockVerify.mockResolvedValueOnce({ ok: true })
    const jwt = await getJwtForUser('byok-test-user@example.com')

    // Ensure no pre-existing row
    await supabase.from('creator_settings').delete().eq('user_id', testUser.id)

    const validKey = 'sk-ant-api03-' + 'x'.repeat(40)
    const res = await app.fetch(
      new Request('http://localhost/api/keys/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ key: validKey }),
      })
    )

    expect(res.status).toBe(200)
    const body = await jsonAs<{ success: boolean }>(res)
    expect(body).toEqual({ success: true })

    // Verify DB row was created
    const { data } = await supabase
      .from('creator_settings')
      .select('encrypted_api_key, api_response_cap')
      .eq('user_id', testUser.id)
      .single()
    expect(data?.encrypted_api_key).not.toBeNull()
    expect(data?.api_response_cap).toBe(150)
  })

  it('Test 2: invalid key -> 400 { success: false, error: "invalid_key" }, no row written', async () => {
    mockVerify.mockResolvedValueOnce({ ok: false, error: 'invalid_key' })
    const jwt = await getJwtForUser('byok-test-user@example.com')

    // Ensure no pre-existing row for a fresh user (or clean up first)
    const { data: existingData } = await supabase
      .from('creator_settings')
      .select('encrypted_api_key')
      .eq('user_id', testUser.id)
      .single()
    const hadKeyBefore = existingData?.encrypted_api_key !== null && existingData !== null

    const invalidKey = 'sk-ant-api03-' + 'z'.repeat(40)
    const res = await app.fetch(
      new Request('http://localhost/api/keys/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ key: invalidKey }),
      })
    )

    expect(res.status).toBe(400)
    const body = await jsonAs<{ success: boolean; error: string }>(res)
    expect(body).toMatchObject({ success: false, error: 'invalid_key' })

    // If row didn't exist before, it should still not exist (or key unchanged)
    if (!hadKeyBefore) {
      const { data } = await supabase
        .from('creator_settings')
        .select('encrypted_api_key')
        .eq('user_id', testUser.id)
        .maybeSingle()
      expect(data?.encrypted_api_key ?? null).toBeNull()
    }
  })

  it('Test 3: no Authorization header -> 401', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/keys/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'sk-ant-api03-' + 'x'.repeat(40) }),
      })
    )
    expect(res.status).toBe(401)
  })
})

describe('GET /api/keys/status', () => {
  it('Test 4: returns { has_api_key: true, last4 } after verify; never the full key', async () => {
    // Ensure key is set (from Test 1)
    mockVerify.mockResolvedValueOnce({ ok: true })
    const jwt = await getJwtForUser('byok-test-user@example.com')
    const realKey = 'sk-ant-api03-' + 'abcd12345678901234567890123456789012345678'

    // Ensure key set
    await app.fetch(
      new Request('http://localhost/api/keys/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ key: realKey }),
      })
    )

    const res = await app.fetch(
      new Request('http://localhost/api/keys/status', {
        headers: { Authorization: `Bearer ${jwt}` },
      })
    )

    expect(res.status).toBe(200)
    const body = await jsonAs<{ has_api_key: boolean; last4: string | null }>(res)
    expect(body.has_api_key).toBe(true)
    expect(body.last4).toBe(realKey.slice(-4))
    expect(body).not.toHaveProperty('encrypted_api_key')
    expect(body).not.toHaveProperty('key')
    // The response body must not contain the full key
    expect(JSON.stringify(body)).not.toContain(realKey)
  })
})

describe('DELETE /api/keys', () => {
  it('Test 5: nulls column; subsequent GET /status returns { has_api_key: false, last4: null }', async () => {
    const jwt = await getJwtForUser('byok-test-user@example.com')

    const deleteRes = await app.fetch(
      new Request('http://localhost/api/keys', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${jwt}` },
      })
    )
    expect(deleteRes.status).toBe(204)

    const statusRes = await app.fetch(
      new Request('http://localhost/api/keys/status', {
        headers: { Authorization: `Bearer ${jwt}` },
      })
    )
    expect(statusRes.status).toBe(200)
    const statusBody = await jsonAs<{ has_api_key: boolean; last4: string | null }>(statusRes)
    expect(statusBody).toEqual({ has_api_key: false, last4: null })
  })
})

// ---------------------------------------------------------------------------
// BYOK-FIX-ACTIVATE regression tests (260718-cto)
// ---------------------------------------------------------------------------

// NOTE 1: creator_settings has no DELETE RLS policy (DELETE is intentionally
// denied — migration 0001, "Owner can create/read/update their own settings;
// DELETE denied"). Rows can only be removed via the ON DELETE CASCADE from
// auth.users. So these tests each mint their own dedicated test user (via the
// existing mintTestUser/getJwtForUser/deleteTestUser helpers) instead of
// trying to delete/reset the shared `testUser`'s creator_settings row —
// mirrors the cleanup pattern already used in the outer beforeAll/afterAll.
//
// NOTE 2: the module-level `supabase` const is mutated by any call to
// `getJwtForUser` — supabase-js's `signInWithPassword` on a shared client
// instance swaps its PostgREST Authorization header from the service-role
// key to that user's session token, so subsequent `supabase.from(...)` calls
// on the SAME instance run as that authenticated user (subject to RLS), not
// as service-role. To seed/read rows for a DIFFERENT user reliably regardless
// of test order, use a fresh `createServiceClient()` instance (exactly what
// the route itself does per-request) instead of the shared `supabase` const.
describe('POST /api/keys/verify — active_provider activation', () => {
  it('Test A: fresh creator verifying openai sets active_provider to openai', async () => {
    const email = `byok-activate-a-${Date.now()}@example.com`
    const user = await mintTestUser(email)
    try {
      mockVerifyOpenAI.mockResolvedValueOnce({ ok: true })
      const jwt = await getJwtForUser(email)

      // No creator_settings row exists yet for this brand-new user.
      const res = await app.fetch(
        new Request('http://localhost/api/keys/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({ provider: 'openai', key: 'sk-' + 'x'.repeat(40) }),
        })
      )

      expect(res.status).toBe(200)
      const body = await jsonAs<{ success: boolean }>(res)
      expect(body).toEqual({ success: true })

      const { data } = await createServiceClient()
        .from('creator_settings')
        .select('active_provider, openai_api_key')
        .eq('user_id', user.id)
        .single()
      expect(data?.active_provider).toBe('openai')
      expect(data?.openai_api_key).not.toBeNull()
    } finally {
      await deleteTestUser(user.id)
    }
  })

  it('Test B: returning user with anthropic already keyed keeps active_provider on openai verify', async () => {
    const email = `byok-activate-b-${Date.now()}@example.com`
    const user = await mintTestUser(email)
    try {
      // Seed a row with anthropic already keyed and active — the "returning user" case.
      const { error: seedErr } = await createServiceClient().from('creator_settings').insert({
        user_id: user.id,
        anthropic_api_key: 'placeholder-encrypted-blob',
        active_provider: 'anthropic',
        api_response_cap: 150,
      })
      expect(seedErr).toBeNull()

      mockVerifyOpenAI.mockResolvedValueOnce({ ok: true })
      const jwt = await getJwtForUser(email)

      const res = await app.fetch(
        new Request('http://localhost/api/keys/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({ provider: 'openai', key: 'sk-' + 'y'.repeat(40) }),
        })
      )

      expect(res.status).toBe(200)
      const body = await jsonAs<{ success: boolean }>(res)
      expect(body).toEqual({ success: true })

      const { data } = await createServiceClient()
        .from('creator_settings')
        .select('active_provider, openai_api_key')
        .eq('user_id', user.id)
        .single()
      expect(data?.active_provider).toBe('anthropic')
      expect(data?.openai_api_key).not.toBeNull()
    } finally {
      await deleteTestUser(user.id)
    }
  })
})

// ---------------------------------------------------------------------------
// Settings tests
// ---------------------------------------------------------------------------

describe('GET /api/settings', () => {
  it('Test 6: returns { user_id, has_api_key: true, api_response_cap: 150, updated_at } after verify', async () => {
    // Set key first
    mockVerify.mockResolvedValueOnce({ ok: true })
    const jwt = await getJwtForUser('byok-test-user@example.com')
    await app.fetch(
      new Request('http://localhost/api/keys/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ key: 'sk-ant-api03-' + 'x'.repeat(40) }),
      })
    )

    const res = await app.fetch(
      new Request('http://localhost/api/settings', {
        headers: { Authorization: `Bearer ${jwt}` },
      })
    )

    expect(res.status).toBe(200)
    const body = await jsonAs<{ user_id: string; has_api_key: boolean; api_response_cap: number; updated_at: string | null }>(res)
    expect(body.user_id).toBe(testUser.id)
    expect(body.has_api_key).toBe(true)
    expect(body.api_response_cap).toBe(150)
    expect(body).toHaveProperty('updated_at')
    expect(body).not.toHaveProperty('encrypted_api_key')
  })
})

describe('PUT /api/settings', () => {
  it('Test 7: PUT { api_response_cap: 500 } -> 200; subsequent GET shows 500', async () => {
    const jwt = await getJwtForUser('byok-test-user@example.com')

    const putRes = await app.fetch(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ api_response_cap: 500 }),
      })
    )
    expect(putRes.status).toBe(200)

    const getRes = await app.fetch(
      new Request('http://localhost/api/settings', {
        headers: { Authorization: `Bearer ${jwt}` },
      })
    )
    const getBody = await jsonAs<{ api_response_cap: number }>(getRes)
    expect(getBody.api_response_cap).toBe(500)
  })

  it('Test 8: PUT { api_response_cap: -1 } -> 400', async () => {
    const jwt = await getJwtForUser('byok-test-user@example.com')

    const res = await app.fetch(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ api_response_cap: -1 }),
      })
    )
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// AI scaffold test
// ---------------------------------------------------------------------------

describe('POST /api/sessions/:id/invoke', () => {
  it('Test 9: returns 501 { status: "scaffolded", prompt_array_length, cache_breakpoint_position }', async () => {
    const jwt = await getJwtForUser('byok-test-user@example.com')

    const res = await app.fetch(
      new Request(`http://localhost/api/sessions/${testSessionId}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ userMessage: 'hello' }),
      })
    )

    expect(res.status).toBe(501)
    const body = await jsonAs<{ status: string; prompt_array_length: number; cache_breakpoint_position: number }>(res)
    expect(body.status).toBe('scaffolded')
    expect(typeof body.prompt_array_length).toBe('number')
    expect(body.prompt_array_length).toBeGreaterThan(0)
    expect(typeof body.cache_breakpoint_position).toBe('number')
    expect(body.cache_breakpoint_position).toBeGreaterThanOrEqual(0)
  })
})
