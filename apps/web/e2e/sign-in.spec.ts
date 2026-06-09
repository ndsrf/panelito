import { test, expect } from '@playwright/test'

/**
 * E2E test: Google OAuth sign-in slice (SESS-01)
 *
 * Tests 1 and 2 verify the slice built in Plan 02 Task 2.
 * Test 3 is skipped — completing the full Google OAuth handshake requires
 * real service-account credentials which are out of scope for CI.
 * The human verification checkpoint in Task 3 covers the end-to-end happy path.
 */

test('unauthenticated visitor to / is redirected to /auth/sign-in', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/auth\/sign-in/)
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
})

test('sign-in page shows Continue with Google button', async ({ page }) => {
  await page.goto('/auth/sign-in')
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
})

test('clicking Continue with Google navigates to Google accounts', async ({ page }) => {
  await page.goto('/auth/sign-in')
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await expect(page).toHaveURL(/accounts\.google\.com/, { timeout: 5_000 })
})

// Skipped: completing Google OAuth in CI requires service-account flows out of scope.
// The human verification checkpoint (Task 3) covers the end-to-end happy path manually.
test.skip('authenticated user sees their email on the protected page', async ({ page }) => {
  // When a real Google user completes the OAuth flow, they land on / showing their email.
  // This is verified manually in the Task 3 checkpoint.
  await page.goto('/')
  await expect(page.locator('text=Signed in as')).toBeVisible()
})
