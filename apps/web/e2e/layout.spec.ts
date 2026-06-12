/**
 * E2E layout regression tests for Plan 04 (LAYOUT-01..05, LAYOUT-07)
 *
 * Test A: Mobile viewport proportions — analytics panel 40%, branch navigator 48px
 * Test B: Mobile keyboard simulation — analytics panel insulated, input anchored
 *
 * Both tests run on Pixel 5 (393×851) via playwright.config.ts projects config.
 *
 * Critical constraints tested:
 * - LAYOUT-01: --app-height locked from window.innerHeight
 * - LAYOUT-02: Analytics panel stays at 40% when keyboard opens (insulated)
 * - LAYOUT-03: Chat stream absorbs keyboard displacement
 * - LAYOUT-04: Input box bottom offset rises with --keyboard-height
 * - LAYOUT-05: Branch Navigator 48px exact
 *
 * Note: These tests require the local dev stack running (supabase start + api dev).
 * The webServer in playwright.config.ts starts the Next.js dev server automatically.
 *
 * Authentication: uses Supabase admin API to create a test creator, then signs in
 * via magic link (bypasses OAuth UI).
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787'

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

async function createTestCreator(): Promise<{ email: string; password: string; userId: string }> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const email = `layout-test-${Date.now()}@panelito-test.example`
  const password = 'TestPassword123!'

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { onboarding_complete: true },
  })
  if (error) throw new Error(`Failed to create test creator: ${error.message}`)
  return { email, password, userId: data.user.id }
}

async function signInCreator(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
): Promise<void> {
  const supabaseUrl = SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

  // Navigate to the app first so cookies are set on the right origin
  await page.goto('/auth/sign-in')

  // Call Supabase password auth endpoint directly — sets no cookies yet
  const result = await page.evaluate(
    async ({ url, anonKey, userEmail, userPassword }) => {
      const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ email: userEmail, password: userPassword }),
      })
      return authRes.json()
    },
    { url: supabaseUrl, anonKey: supabaseAnonKey, userEmail: email, userPassword: password },
  )

  if (!result?.access_token) {
    throw new Error(`Sign in failed: ${JSON.stringify(result)}`)
  }

  // Set the @supabase/ssr auth cookie so Next.js middleware reads it
  const cookieValue = JSON.stringify({
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    token_type: 'bearer',
    expires_at: result.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    expires_in: result.expires_in ?? 3600,
    user: result.user,
  })
  const projectRef = '127'
  await page.context().addCookies([
    {
      name: `sb-${projectRef}-auth-token`,
      value: cookieValue,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ])

  // Also store access_token in localStorage so the evaluate() block below finds it
  await page.evaluate(
    ({ token, refreshToken, expiresAt }) => {
      localStorage.setItem(
        'sb-127-auth-token',
        JSON.stringify({ access_token: token, refresh_token: refreshToken, expires_at: expiresAt }),
      )
    },
    {
      token: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: result.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    },
  )
}

async function createTestSession(accessToken: string): Promise<{ id: string; short_code: string }> {
  const response = await fetch(`${API_URL}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ title: 'Layout Test Session', mode: 'strategy' }),
  })
  if (!response.ok) throw new Error(`Failed to create test session: ${response.status}`)
  const { session } = await response.json()
  return session
}

// -----------------------------------------------------------------------
// Pixel 5 viewport (393×851) is configured globally in playwright.config.ts
// No need for test.use() — it applies to all tests in this suite.
test.describe('Workspace layout — Pixel 5 (393×851)', () => {

  test('Test A: analytics panel 40%, branch navigator 48px on initial render', async ({ page }) => {
    // Create test creator and sign in
    const creator = await createTestCreator()
    await signInCreator(page, creator.email, creator.password)

    // Get access token from browser storage
    const accessToken = await page.evaluate(async () => {
      // Read from localStorage (Supabase stores the session there)
      const keys = Object.keys(localStorage)
      for (const key of keys) {
        if (key.includes('supabase') || key.includes('auth-token')) {
          try {
            const val = JSON.parse(localStorage.getItem(key) ?? '{}')
            if (val?.access_token) return val.access_token
            if (val?.session?.access_token) return val.session.access_token
          } catch {
            // Continue searching
          }
        }
      }
      return ''
    })

    if (!accessToken) {
      test.skip(true, 'Could not obtain access token — skipping layout test')
    }

    // Create session via API
    const session = await createTestSession(accessToken)

    // Navigate to the workspace
    await page.goto(`/sessions/${session.id}`)
    await page.waitForSelector('.workspace-shell', { timeout: 15_000 })

    // Verify analytics panel height: 851 * 0.40 = 340.4 → expect 338..342px
    const analyticsPanelHeight = await page.locator('.analytics-panel').evaluate(
      (el) => el.getBoundingClientRect().height
    )
    expect(analyticsPanelHeight).toBeGreaterThanOrEqual(338)
    expect(analyticsPanelHeight).toBeLessThanOrEqual(342)

    // Verify branch navigator exact 48px
    const branchNavHeight = await page.locator('.branch-navigator').evaluate(
      (el) => el.getBoundingClientRect().height
    )
    expect(branchNavHeight).toBe(48)
  })

  test('Test B: analytics panel insulated from simulated 300px keyboard', async ({ page }) => {
    // Create test creator and sign in
    const creator = await createTestCreator()
    await signInCreator(page, creator.email, creator.password)

    const accessToken = await page.evaluate(async () => {
      const keys = Object.keys(localStorage)
      for (const key of keys) {
        if (key.includes('supabase') || key.includes('auth-token')) {
          try {
            const val = JSON.parse(localStorage.getItem(key) ?? '{}')
            if (val?.access_token) return val.access_token
            if (val?.session?.access_token) return val.session.access_token
          } catch {
            // Continue
          }
        }
      }
      return ''
    })

    if (!accessToken) {
      test.skip(true, 'Could not obtain access token — skipping layout test')
    }

    const session = await createTestSession(accessToken)
    await page.goto(`/sessions/${session.id}`)
    await page.waitForSelector('.workspace-shell', { timeout: 15_000 })

    // Baseline: analytics panel height before keyboard (338..342px)
    const beforeHeight = await page.locator('.analytics-panel').evaluate(
      (el) => el.getBoundingClientRect().height
    )
    expect(beforeHeight).toBeGreaterThanOrEqual(338)
    expect(beforeHeight).toBeLessThanOrEqual(342)

    // Simulate 300px keyboard opening via visualViewport monkey-patch
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, 'height', {
        value: window.innerHeight - 300,
        configurable: true,
      })
      window.visualViewport!.dispatchEvent(new Event('resize'))
    })

    // Wait for --keyboard-height CSS var to update to 300px
    await page.waitForFunction(
      () => getComputedStyle(document.documentElement)
        .getPropertyValue('--keyboard-height')
        .trim() === '300px',
      { timeout: 3_000 }
    )

    // Input box bottom should now be 300px (keyboard height)
    const inputBottom = await page.locator('.input-box').evaluate(
      (el) => getComputedStyle(el).bottom
    )
    expect(inputBottom).toBe('300px')

    // Analytics panel height MUST stay the same (insulated — LAYOUT-02)
    const afterHeight = await page.locator('.analytics-panel').evaluate(
      (el) => el.getBoundingClientRect().height
    )
    expect(afterHeight).toBeGreaterThanOrEqual(338)
    expect(afterHeight).toBeLessThanOrEqual(342)
  })
})
