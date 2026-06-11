import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for apps/web E2E tests.
 *
 * Mobile-first per CLAUDE.md hard constraint: tests run on Pixel 5 (Chromium).
 * baseURL targets local dev server on port 4000 (worktree uses 4000 to avoid
 * conflicts with the main repo dev server on port 3000).
 *
 * WebServer block starts pnpm dev automatically in non-CI environments,
 * or reuses an existing server if already running.
 */
const PORT = process.env.E2E_PORT ? parseInt(process.env.E2E_PORT) : 4000

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `pnpm dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],
})
