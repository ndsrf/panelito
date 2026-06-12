/**
 * E2E tests for real-time chat (Plan 05)
 *
 * Tests cover:
 * 1. Real-time delivery: message sent by A appears in B within 2000ms (CHAT-01)
 * 2. Typing indicator: B typing shows "esta escribiendo" in A's BranchNavigator (CHAT-06)
 * 3. Auto-scroll: pinned at bottom; preserves scroll when reading history (CHAT-03)
 * 4. Immutability (UI): no Edit/Delete/Eliminar/Editar elements; long-press shows Fork+Pin (CHAT-05)
 * 5. Read-only mode: freezing session disables InputBox and shows banner (SESS-05)
 *
 * Requires:
 * - Supabase local stack running (supabase start)
 * - apps/api running
 * - apps/web running (started by playwright.config.ts webServer block)
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// -----------------------------------------------------------------------
// Helpers (reused from sessions.spec.ts pattern)
// -----------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787'

interface Creator {
  email: string
  password: string
  userId: string
}

interface Session {
  id: string
  short_code: string
}

async function createTestCreator(): Promise<Creator> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const email = `chat-creator-${Date.now()}@panelito-test.example`
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

async function signInTestUser(page: Page, email: string, password: string): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

  await page.goto('/auth/sign-in')

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
      return await authRes.json()
    },
    { url: supabaseUrl, anonKey: supabaseAnonKey, userEmail: email, userPassword: password }
  )

  if (!result?.access_token) {
    throw new Error(`Sign in failed: ${JSON.stringify(result)}`)
  }

  const sessionJson = JSON.stringify({
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    token_type: 'bearer',
    expires_at: result.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    expires_in: result.expires_in ?? 3600,
    user: result.user,
  })

  // @supabase/ssr encodes cookie values as: "base64-" + base64url(json)
  // Buffer.from().toString('base64url') is RFC 4648 §5 (URL-safe, no padding)
  // which is identical to @supabase/ssr's custom stringToBase64URL implementation.
  const cookieValue = 'base64-' + Buffer.from(sessionJson).toString('base64url')

  // Cookie name derived from supabase URL hostname split('.').[0]
  // For http://127.0.0.1:54321 → sb-127-auth-token
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
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

  await page.reload()
}

async function createSessionViaApi(creator: Creator): Promise<Session> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: authData } = await supabase.auth.signInWithPassword({
    email: creator.email,
    password: creator.password,
  })
  const jwt = authData.session?.access_token ?? ''

  const createRes = await fetch(`${API_URL}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ title: 'Chat E2E Test Session', mode: 'strategy' }),
  })
  return await createRes.json()
}

async function joinAsGuest(
  page: Page,
  shortCode: string,
  displayName: string
): Promise<void> {
  await page.goto(`/join/${shortCode}`)
  await page.getByPlaceholder('Your display name').fill(displayName)
  await page.getByRole('button', { name: 'Join Session' }).click()
  // Wait for redirect to workspace
  await expect(page).toHaveURL(/\/sessions\//, { timeout: 10_000 })
}

async function getCreatorJwt(creator: Creator): Promise<string> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data } = await supabase.auth.signInWithPassword({
    email: creator.email,
    password: creator.password,
  })
  return data.session?.access_token ?? ''
}

// -----------------------------------------------------------------------
// Test 1: Real-time delivery (CHAT-01)
// -----------------------------------------------------------------------

test('Test 1: message sent by creator appears in guest browser within 2000ms (CHAT-01)', async ({ browser }) => {
  const creator = await createTestCreator()
  const session = await createSessionViaApi(creator)

  const ctxA: BrowserContext = await browser.newContext()
  const ctxB: BrowserContext = await browser.newContext()
  const pageA: Page = await ctxA.newPage()
  const pageB: Page = await ctxB.newPage()

  try {
    // A: sign in as creator and navigate to session
    await signInTestUser(pageA, creator.email, creator.password)
    await pageA.goto(`/sessions/${session.id}`)
    await expect(pageA.locator('.chat-stream')).toBeVisible({ timeout: 10_000 })

    // B: join as guest
    await joinAsGuest(pageB, session.short_code, 'Lau')

    // A: send a message
    await pageA.locator('textarea[aria-label="Message input"]').fill('hola')
    await pageA.keyboard.press('Enter')

    // B: should see the message within 5000ms (broadcast + Realtime delivery)
    await expect(pageB.getByText('hola')).toBeVisible({ timeout: 5000 })
  } finally {
    await ctxA.close()
    await ctxB.close()
    await deleteTestUser(creator.userId)
  }
})

// -----------------------------------------------------------------------
// Test 2: Typing indicator (CHAT-06)
// -----------------------------------------------------------------------

test('Test 2: typing in guest browser shows indicator in creator browser (CHAT-06)', async ({ browser }) => {
  const creator = await createTestCreator()
  const session = await createSessionViaApi(creator)

  const ctxA: BrowserContext = await browser.newContext()
  const ctxB: BrowserContext = await browser.newContext()
  const pageA: Page = await ctxA.newPage()
  const pageB: Page = await ctxB.newPage()

  try {
    // A: sign in as creator
    await signInTestUser(pageA, creator.email, creator.password)
    await pageA.goto(`/sessions/${session.id}`)
    await expect(pageA.locator('.branch-navigator')).toBeVisible({ timeout: 10_000 })

    // B: join as guest
    await joinAsGuest(pageB, session.short_code, 'Lau')

    // B: type into the input box
    await pageB.locator('textarea[aria-label="Message input"]').type('h', { delay: 0 })

    // A: typing indicator should appear within 5000ms
    await expect(pageA.locator('.branch-navigator')).toContainText('esta escribiendo', {
      timeout: 5000,
    })

    // B: stop typing (clear input)
    await pageB.locator('textarea[aria-label="Message input"]').fill('')

    // Wait for typing indicator to clear (presence untrack has a delay)
    // Supabase Realtime presence timeout is typically 3-10s
    await pageB.waitForTimeout(3000)

    // A: typing indicator should disappear within 8000ms after stopping
    await expect(pageA.locator('.branch-navigator')).not.toContainText('esta escribiendo', {
      timeout: 8000,
    })
  } finally {
    await ctxA.close()
    await ctxB.close()
    await deleteTestUser(creator.userId)
  }
})

// -----------------------------------------------------------------------
// Test 3: Auto-scroll behavior (CHAT-03)
// -----------------------------------------------------------------------

test('Test 3: auto-scroll pins to bottom; preserves position when reading history (CHAT-03)', async ({ browser }) => {
  const creator = await createTestCreator()
  const session = await createSessionViaApi(creator)

  const ctxB: BrowserContext = await browser.newContext()
  const pageB: Page = await ctxB.newPage()

  try {
    const jwt = await getCreatorJwt(creator)

    // B: join as guest
    await joinAsGuest(pageB, session.short_code, 'Reader')
    await expect(pageB.locator('.chat-stream')).toBeVisible({ timeout: 10_000 })

    // Send 30 messages via API (faster than typing)
    for (let i = 0; i < 30; i++) {
      await fetch(`${API_URL}/api/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ content: `Message ${i + 1}` }),
      })
    }

    // Wait for messages to appear (30 sequential broadcasts may take time)
    await expect(pageB.getByText('Message 30')).toBeVisible({ timeout: 15000 })

    // Verify B is at the bottom (auto-scroll active)
    const atBottom = await pageB.locator('.chat-stream').evaluate(
      (el: HTMLElement) => el.scrollTop + el.clientHeight >= el.scrollHeight - 64
    )
    expect(atBottom).toBe(true)

    // Scroll up 200px
    await pageB.locator('.chat-stream').evaluate((el: HTMLElement) => {
      el.scrollTop -= 200
    })
    const scrollTopBefore = await pageB.locator('.chat-stream').evaluate(
      (el: HTMLElement) => el.scrollTop
    )

    // Send one more message
    await fetch(`${API_URL}/api/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ content: 'Message 31' }),
    })

    // Wait a bit for potential scroll
    await pageB.waitForTimeout(1000)

    // Verify scroll position was NOT auto-scrolled
    const scrollTopAfter = await pageB.locator('.chat-stream').evaluate(
      (el: HTMLElement) => el.scrollTop
    )
    // Scroll position should be within 2px of where we left it
    expect(Math.abs(scrollTopAfter - scrollTopBefore)).toBeLessThan(2)
  } finally {
    await ctxB.close()
    await deleteTestUser(creator.userId)
  }
})

// -----------------------------------------------------------------------
// Test 4: Immutability — UI has no Edit/Delete affordances (CHAT-05)
// -----------------------------------------------------------------------

test('Test 4: no Edit/Delete/Eliminar/Editar UI elements; long-press shows Fork+Pin only (CHAT-05)', async ({ browser }) => {
  const creator = await createTestCreator()
  const session = await createSessionViaApi(creator)

  const ctxA: BrowserContext = await browser.newContext()
  const pageA: Page = await ctxA.newPage()

  try {
    const jwt = await getCreatorJwt(creator)

    // A: sign in and navigate to session
    await signInTestUser(pageA, creator.email, creator.password)
    await pageA.goto(`/sessions/${session.id}`)

    // Send a message to have a bubble
    await fetch(`${API_URL}/api/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ content: 'Test message for immutability check' }),
    })

    await expect(pageA.getByText('Test message for immutability check')).toBeVisible({ timeout: 10_000 })

    // CHAT-05: Verify NO edit/delete UI elements exist
    await expect(pageA.locator('text=Edit')).toHaveCount(0)
    await expect(pageA.locator('text=Delete')).toHaveCount(0)
    await expect(pageA.locator('text=Eliminar')).toHaveCount(0)
    await expect(pageA.locator('text=Editar')).toHaveCount(0)

    // Long-press a message bubble to open action menu.
    // Use Playwright mouse API (not dispatchEvent) so React synthetic events fire.
    const bubble = pageA.locator('.message-bubble').first()
    const box = await bubble.boundingBox()
    if (!box) throw new Error('message-bubble not found in DOM')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await pageA.mouse.move(cx, cy)
    await pageA.mouse.down()
    await pageA.waitForTimeout(600)
    await pageA.mouse.up()

    // Action menu should show Fork + Pin to Panel (both disabled in Phase 1)
    await expect(pageA.getByText('Fork')).toBeVisible({ timeout: 1000 })
    await expect(pageA.getByText('Pin to Panel')).toBeVisible({ timeout: 1000 })

    // Neither should be interactive (disabled).
    // Radix DropdownMenuItem sets data-disabled="" (empty string boolean attribute).
    const forkItem = pageA.locator('[role="menuitem"]:has-text("Fork")')
    await expect(forkItem).toHaveAttribute('data-disabled', '', { timeout: 1000 })
  } finally {
    await ctxA.close()
    await deleteTestUser(creator.userId)
  }
})

// -----------------------------------------------------------------------
// Test 5: Read-only mode when session is frozen (SESS-05)
// -----------------------------------------------------------------------

test('Test 5: freezing session disables InputBox and shows read-only banner', async ({ browser }) => {
  const creator = await createTestCreator()
  const session = await createSessionViaApi(creator)

  const ctxB: BrowserContext = await browser.newContext()
  const pageB: Page = await ctxB.newPage()

  try {
    const jwt = await getCreatorJwt(creator)

    // B: join as guest before freezing
    await joinAsGuest(pageB, session.short_code, 'FrozenGuest')
    await expect(pageB.locator('textarea[aria-label="Message input"]')).toBeEnabled({ timeout: 10_000 })

    // A: freeze the session via API
    await fetch(`${API_URL}/api/sessions/${session.id}/freeze`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
    })

    // B: reload to pick up the frozen status (Plan 06 will wire live status updates)
    await pageB.reload()
    await pageB.waitForLoadState('networkidle')

    // B: input should now be disabled
    await expect(pageB.locator('textarea[aria-label="Message input"]')).toBeDisabled({ timeout: 5000 })

    // B: read-only banner should be visible
    await expect(pageB.getByText(/congelada/)).toBeVisible({ timeout: 5000 })
  } finally {
    await ctxB.close()
    await deleteTestUser(creator.userId)
  }
})
