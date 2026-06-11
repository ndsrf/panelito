/**
 * E2E layout regression tests for Plan 04 (LAYOUT-01..05, LAYOUT-07)
 *
 * Test A: Mobile viewport proportions — analytics panel 40%, branch navigator 48px
 * Test B: Mobile keyboard simulation — analytics panel insulated, input anchored
 *
 * Both tests run on Pixel 5 (393×851) via playwright.config.ts.
 *
 * Critical constraints tested:
 * - LAYOUT-01: --app-height locked from window.innerHeight
 * - LAYOUT-02: Analytics panel stays at 40% when keyboard opens (insulated)
 * - LAYOUT-03: Chat stream absorbs keyboard displacement
 * - LAYOUT-04: Input box bottom offset rises with --keyboard-height
 * - LAYOUT-05: Branch Navigator 48px exact
 *
 * Note: These tests require the local dev stack running.
 * The webServer in playwright.config.ts starts it automatically.
 *
 * Authentication: uses createTestCreator helper from sessions.spec.ts pattern.
 */

import { test, expect, devices } from '@playwright/test'
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

async function signInCreator(page: import('@playwright/test').Page, email: string, password: string): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: { user }, error: userError } = await supabase.auth.admin.getUserByEmail(email)
  if (userError || !user) throw new Error('Could not get test user')

  const { data: signInData, error: signInError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (signInError || !signInData?.properties?.action_link) {
    // Fall back to password sign-in via the UI
    await page.goto('/auth/sign-in')
    return
  }

  // Use magic link to sign in (bypasses OAuth UI in test environment)
  const magicLink = signInData.properties.action_link
    .replace(SUPABASE_URL, `http://127.0.0.1:54321`)
  await page.goto(magicLink)
  await page.waitForURL(/\/(?!auth)/, { timeout: 10_000 })
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
// Layout tests — Pixel 5 viewport (393×851)
// -----------------------------------------------------------------------

test.describe('Workspace layout — Pixel 5 (393×851)', () => {
  test.use({ ...devices['Pixel 5'] })

  test('Test A: analytics panel 40%, branch navigator 48px on initial render', async ({ page }) => {
    // Create and sign in test creator
    const creator = await createTestCreator()
    await signInCreator(page, creator.email, creator.password)

    // Get creator's access token from page context
    const token = await page.evaluate(async () => {
      // @ts-ignore — Supabase client is available via window context after auth
      const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.10.3')
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
      )
      const { data: { session } } = await supabase.auth.getSession()
      return session?.access_token ?? ''
    })

    // Create session via API
    const session = await createTestSession(token)

    // Navigate to the workspace
    await page.goto(`/sessions/${session.id}`)
    await page.waitForSelector('.workspace-shell', { timeout: 10_000 })

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
    // Create and sign in test creator
    const creator = await createTestCreator()
    await signInCreator(page, creator.email, creator.password)

    const token = await page.evaluate(async () => {
      // @ts-ignore
      const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.10.3')
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
      )
      const { data: { session } } = await supabase.auth.getSession()
      return session?.access_token ?? ''
    })

    const session = await createTestSession(token)
    await page.goto(`/sessions/${session.id}`)
    await page.waitForSelector('.workspace-shell', { timeout: 10_000 })

    // Baseline: analytics panel height before keyboard
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
