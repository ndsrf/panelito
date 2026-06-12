import { defineConfig } from 'vitest/config'
import path from 'path'
import { readFileSync } from 'fs'

/**
 * Load .env from the canonical location (main repo, gitignored).
 * The worktree shares the pnpm-lock.yaml but not .env files.
 */
function loadDotEnv(): Record<string, string> {
  // Try the worktree location first, then fall back to main repo
  const candidates = [
    path.resolve(__dirname, '.env'),
    path.resolve(__dirname, '../../../apps/api/.env'),
    path.resolve(__dirname, '/home/jgm/dev/projects/web-projects/panelito/apps/api/.env'),
  ]
  for (const candidate of candidates) {
    try {
      const content = readFileSync(candidate, 'utf-8')
      const env: Record<string, string> = {}
      for (const line of content.split('\n')) {
        const match = line.match(/^([^#=]+)=(.*)$/)
        if (match && match[1] && match[2] !== undefined) {
          env[match[1].trim()] = match[2].trim()
        }
      }
      return env
    } catch {
      // Try next candidate
    }
  }
  return {}
}

const dotEnv = loadDotEnv()

// When running from a worktree, node_modules lives in the main repo.
// Resolve package IDs against the main project's node_modules.
const MAIN_NODE_MODULES = '/home/jgm/dev/projects/web-projects/panelito/apps/api/node_modules'

export default defineConfig({
  resolve: {
    alias: [
      // Route bare specifiers through the main project's node_modules
      {
        find: /^([^./].*)$/,
        replacement: path.join(MAIN_NODE_MODULES, '$1'),
      },
    ],
  },
  test: {
    env: dotEnv,
    environment: 'node',
    // Increase timeout for integration tests that call Supabase
    testTimeout: 30_000,
  },
})
