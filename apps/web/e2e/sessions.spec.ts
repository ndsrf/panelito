/**
 * E2E tests for session creation + guest join flow (Plan 03)
 *
 * Test A: Creator creates a session → QR modal renders
 * Test B: Guest joins via /join/[code] → redirected to workspace + localStorage key set
 * Test C: Guest reloads workspace → silent re-entry (SESS-10), no re-prompt at /join
 * Test D: /join/INVALID → "Session not found"
 *
 * Note: These tests require:
 * - Supabase local stack running (supabase start)
 * - apps/api running (pnpm --filter @panelito/api dev)
 * - apps/web running (pnpm --filter @panelito/web dev)
 *
 * For CI, the dev server is started by playwright.config.ts webServer config.
 * Creator auth uses a test fixture user created via the Supabase admin API.
 */

import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// -----------------------------------------------------------------------
// Test helper: create a test creator via Supabase admin API
// -----------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

async function createTestCreator(): Promise<{ email: string; password: string; userId: string }> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const email = `test-creator-${Date.now()}@panelito-test.example`
  const password = 'test-password-123'

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !data.user) {
    throw new Error(`Failed to create test creator: ${error?.message}`)
  }

  return { email, password, userId: data.user.id }
}

async function deleteTestUser(userId: string): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  await supabase.auth.admin.deleteUser(userId)
}

/**
 * Sign in a test user by navigating to the auth sign-in page and calling
 * Supabase signInWithPassword directly from the browser context.
 *
 * This sets the SSR cookies via the browser's Supabase client, which the
 * Next.js middleware can then read on subsequent server-side requests.
 */
async function signInTestUser(page: Page, email: string, password: string): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

  // Navigate to the app first so we can call the Supabase browser client
  await page.goto('/auth/sign-in')

  // Use the in-browser Supabase client to sign in (sets cookies automatically)
  const result = await page.evaluate(
    async ({ url, anonKey, userEmail, userPassword }) => {
      // @ts-ignore — dynamic eval in browser context
      const { createBrowserClient } = await import(
        'https://esm.sh/@supabase/ssr@0.10.3'
      ).catch(() => null) ?? {}

      // Fallback: use fetch directly to call Supabase REST auth API
      const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ email: userEmail, password: userPassword }),
      })
      const authData = await authRes.json()
      return authData
    },
    { url: supabaseUrl, anonKey: supabaseAnonKey, userEmail: email, userPassword: password }
  )

  if (!result?.access_token) {
    throw new Error(`Sign in failed via browser eval: ${JSON.stringify(result)}`)
  }

  // Set the Supabase auth cookies that @supabase/ssr expects
  // The cookie is chunked for large tokens; we use the standard format
  const cookieValue = JSON.stringify({
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    token_type: 'bearer',
    expires_at: result.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    expires_in: result.expires_in ?? 3600,
    user: result.user,
  })

  // @supabase/ssr uses cookie name based on the URL host
  // For localhost dev, the project ref is the host part: "127"
  const projectRef = '127'
  const cookieName = `sb-${projectRef}-auth-token`

  await page.context().addCookies([
    {
      name: cookieName,
      value: cookieValue,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ])

  // Reload to apply the auth cookie
  await page.reload()
}

// -----------------------------------------------------------------------
// Test A: Creator creates a session; Share modal shows QR + copy URL
// -----------------------------------------------------------------------

test('Test A: creator creates a session and share modal renders QR code', async ({ page }) => {
  const creator = await createTestCreator()

  try {
    await signInTestUser(page, creator.email, creator.password)

    // Navigate to session creation form
    await page.goto('/sessions/new')
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible()

    // Fill title
    await page.getByPlaceholder('e.g. Q3 Strategy Review').fill('E2E Test Session A')

    // Select a mode (Strategy is default, but click it for certainty)
    await page.getByRole('button', { name: /Strategy/ }).click()

    // Submit the form
    await page.getByRole('button', { name: 'Create Session' }).click()

    // Should redirect to /sessions/[id]
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+/, { timeout: 10_000 })

    // Open Share modal
    await page.getByRole('button', { name: /Share/ }).click()
    await expect(page.getByText('Share Session')).toBeVisible()

    // QR code SVG should be present
    await expect(page.locator('svg')).toBeVisible()

    // Copy button should be present
    await expect(page.getByRole('button', { name: 'Copy join link' })).toBeVisible()
  } finally {
    await deleteTestUser(creator.userId)
  }
})

// -----------------------------------------------------------------------
// Test B: Guest visits /join/[validCode] → enters name → redirected to workspace
// -----------------------------------------------------------------------

test('Test B: guest joins via /join/[code] and localStorage key is set', async ({ page }) => {
  const creator = await createTestCreator()

  // Create a session via the API directly
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: authData } = await supabase.auth.signInWithPassword({
    email: creator.email,
    password: creator.password,
  })
  const jwt = authData.session?.access_token ?? ''

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787'
  const createRes = await fetch(`${apiUrl}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ title: 'E2E Test Session B', mode: 'debate' }),
  })
  const session = await createRes.json()
  const shortCode: string = session.short_code

  try {
    // Guest visits the join page (no auth)
    await page.goto(`/join/${shortCode}`)

    // Should see session title and Join button
    await expect(page.getByText('E2E Test Session B')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Join Session' })).toBeVisible()

    // Fill display name and submit
    await page.getByPlaceholder('Your display name').fill('E2E Guest')
    await page.getByRole('button', { name: 'Join Session' }).click()

    // Should redirect to workspace /sessions/[id]
    await expect(page).toHaveURL(`/sessions/${session.id}`, { timeout: 10_000 })

    // SESS-10: localStorage should have a guest session key
    const localStorageKey = await page.evaluate((code) => {
      const entries = Object.entries(localStorage)
      const found = entries.find(([k]) => k.startsWith(`panelito:guest:${code}`))
      return found ? found[0] : null
    }, shortCode)

    expect(localStorageKey).not.toBeNull()
  } finally {
    await deleteTestUser(creator.userId)
  }
})

// -----------------------------------------------------------------------
// Test C: Guest reloads workspace → SESS-10 silent re-entry, no re-prompt
// -----------------------------------------------------------------------

test('Test C: guest reloads workspace and does not see /join re-prompt (SESS-10)', async ({ page }) => {
  const creator = await createTestCreator()

  // Create a session
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: authData } = await supabase.auth.signInWithPassword({
    email: creator.email,
    password: creator.password,
  })
  const jwt = authData.session?.access_token ?? ''
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787'

  const createRes = await fetch(`${apiUrl}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ title: 'E2E Test Session C', mode: 'strategy' }),
  })
  const session = await createRes.json()
  const shortCode: string = session.short_code

  // Get a guest token by hitting the API directly
  const guestRes = await fetch(`${apiUrl}/api/sessions/by-code/${shortCode}/guests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: 'E2E Reload Guest' }),
  })
  const guestData = await guestRes.json()

  try {
    // Seed localStorage with the guest session (simulating a prior join)
    await page.addInitScript(
      ({ key, value }: { key: string; value: string }) => {
        localStorage.setItem(key, value)
      },
      {
        key: `panelito:guest:${shortCode}`,
        value: JSON.stringify({
          guest_user_id: guestData.guest_user_id,
          access_token: guestData.access_token,
          refresh_token: guestData.refresh_token,
          display_name: 'E2E Reload Guest',
          session_id: session.id,
          saved_at: new Date().toISOString(),
        }),
      }
    )

    // Guest visits /join/[code] again with saved session
    await page.goto(`/join/${shortCode}`)

    // SESS-10: should silently redirect to workspace without showing the name form
    await expect(page).toHaveURL(`/sessions/${session.id}`, { timeout: 10_000 })

    // Should never have shown the display name input
    const displayNameInput = page.getByPlaceholder('Your display name')
    await expect(displayNameInput).not.toBeVisible()
  } finally {
    await deleteTestUser(creator.userId)
  }
})

// -----------------------------------------------------------------------
// Test D: /join/INVALID → shows "Session not found"
// -----------------------------------------------------------------------

test('Test D: /join/INVALID shows "Session not found"', async ({ page }) => {
  await page.goto('/join/ZZZZZZ')
  await expect(page.getByText('Session not found')).toBeVisible()
})
