import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'fs'
import path from 'path'

/**
 * Playwright configuration for apps/web E2E tests.
 *
 * Mobile-first per CLAUDE.md hard constraint: tests run on Pixel 5 (Chromium).
 * baseURL targets local dev server on port 4000 (worktree uses 4000 to avoid
 * conflicts with the main repo dev server on port 3000).
 *
 * WebServer block starts pnpm dev automatically in non-CI environments,
 * or reuses an existing server if already running.
 *
 * SUPABASE_SERVICE_ROLE_KEY is loaded from apps/api/.env when not present in
 * the environment — needed by E2E test helpers that use the admin Supabase client.
 */

/**
 * Load env vars from candidate .env files.
 * The worktree does not have .env files — they live in the main project.
 * This function loads ALL keys from the candidates unless already set,
 * to provide NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, etc.
 */
function loadEnvFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8')
    for (const line of content.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/)
      if (match && match[1] && match[2] !== undefined) {
        const key = match[1].trim()
        if (!process.env[key]) {
          process.env[key] = match[2].trim()
        }
      }
    }
  } catch {
    // File not found — ignore
  }
}

// Load .env.local from the main project's apps/web (Next.js public env vars)
loadEnvFile(path.resolve(__dirname, '/home/jgm/dev/projects/web-projects/panelito/apps/web/.env.local'))
loadEnvFile(path.resolve(__dirname, '../../apps/web/.env.local'))

// Load SUPABASE_SERVICE_ROLE_KEY from api .env (backend-only secrets)
loadEnvFile(path.resolve(__dirname, '/home/jgm/dev/projects/web-projects/panelito/apps/api/.env'))
loadEnvFile(path.resolve(__dirname, '../../apps/api/.env'))

const PORT = process.env.E2E_PORT ? parseInt(process.env.E2E_PORT) : 4000
process.env.NEXT_PUBLIC_API_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NEXT_PUBLIC_API_URL: `http://localhost:${PORT}`,
      // Auto-freeze timing overrides for E2E tests (SESS-07 fast-forward).
      // grace: 200ms (default: 30s), freeze delay: 500ms (default: 15min).
      AUTO_FREEZE_GRACE_MS: '200',
      AUTO_FREEZE_AFTER_MS: '500',
      // Lifecycle tests API port (worktree API with new lifecycle middleware)
      LIFECYCLE_API_URL: 'http://localhost:8788',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],
})
