import { defineConfig } from 'vitest/config'
import path from 'path'
import { readFileSync, statSync } from 'fs'

/**
 * Load .env from the canonical location (main repo, gitignored).
 * The worktree shares the pnpm-lock.yaml but not .env files.
 */
function loadDotEnv(): Record<string, string> {
  // Try the worktree location first, then fall back to main repo
  const candidates = [
    path.resolve(__dirname, '.env'),
    path.resolve(__dirname, '../../../apps/api/.env'),
  ]
  for (const candidate of candidates) {
    try {
      const content = readFileSync(candidate, 'utf-8')
      const env: Record<string, string> = {}
      for (const line of content.split('\n')) {
        const match = line.match(/^([^#=]+)=(.*)$/)
        if (match && match[1] && match[2] !== undefined) {
          // Strip surrounding quotes (dotenv behaviour): "value" or 'value' → value
          const raw = match[2].trim()
          env[match[1].trim()] = raw.replace(/^(['"])(.*)\1$/, '$2')
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

/**
 * Detect if running in a worktree (git worktrees have .git as a file, not a directory).
 * Returns path info for worktree-specific resolution.
 */
function detectWorktree(): { typesPath: string | undefined; mainRepoNodeModules: string | undefined } {
  // Check for worktree: .git is a file (not a dir) in linked worktrees
  let isWorktree = false
  try {
    const gitStat = statSync(path.resolve(__dirname, '../../.git'))
    isWorktree = gitStat.isFile()
  } catch {
    // not a git repo at expected path
  }

  if (!isWorktree) {
    return { typesPath: undefined, mainRepoNodeModules: undefined }
  }

  // Worktree: point @panelito/types to the local packages/types/src
  let typesPath: string | undefined
  const worktreeTypesPath = path.resolve(__dirname, '../../packages/types/src/index.ts')
  try {
    readFileSync(worktreeTypesPath)
    typesPath = path.resolve(__dirname, '../../packages/types/src')
  } catch {
    // types not available in worktree
  }

  // Worktree: find main repo's apps/api/node_modules for module resolution.
  // The worktree does not have its own node_modules — modules are installed in the
  // main repo. The worktree's vitest.config.ts adds the main repo's node_modules
  // to the vite resolve.modules list so imports like @langchain/langgraph-checkpoint-postgres
  // can be found when running vitest with --root pointing to the worktree.
  let mainRepoNodeModules: string | undefined
  const candidates = [
    path.resolve(__dirname, '../../../apps/api/node_modules'),
  ]
  for (const candidate of candidates) {
    try {
      statSync(candidate)
      mainRepoNodeModules = candidate
      break
    } catch {
      // try next
    }
  }

  return { typesPath, mainRepoNodeModules }
}

const { typesPath: worktreeTypesPath, mainRepoNodeModules } = detectWorktree()

const aliases: Record<string, string> = {}
if (worktreeTypesPath) {
  // Resolve @panelito/types to worktree's local packages/types/src
  aliases['@panelito/types'] = worktreeTypesPath
}

// In worktree mode: scan the main repo's apps/api/node_modules and add aliases
// for every package found there. Vite's module resolver looks for node_modules
// relative to the root (worktree dir) and traverses up — it will find the
// workspace root node_modules but NOT apps/api/node_modules (because the worktree
// is a sibling, not a parent). By aliasing all packages, vite can resolve them.
if (mainRepoNodeModules) {
  const { readdirSync } = require('fs') as typeof import('fs')
  const mainModules = mainRepoNodeModules

  function addPackageAlias(pkgName: string) {
    const pkgPath = path.join(mainModules, pkgName)
    try {
      statSync(pkgPath)
      aliases[pkgName] = pkgPath
    } catch {
      // package not found, skip
    }
  }

  // Scan top-level packages
  try {
    const topLevel = readdirSync(mainModules)
    for (const name of topLevel) {
      if (name.startsWith('@')) {
        // Scoped package — scan sub-directory
        const scopedDir = path.join(mainModules, name)
        try {
          const scoped = readdirSync(scopedDir)
          for (const sub of scoped) {
            addPackageAlias(`${name}/${sub}`)
          }
        } catch { /* skip */ }
      } else if (!name.startsWith('.')) {
        addPackageAlias(name)
      }
    }
  } catch { /* skip if mainModules not readable */ }
}

export default defineConfig({
  resolve: {
    alias: Object.keys(aliases).length > 0 ? aliases : undefined,
  },
  test: {
    env: dotEnv,
    environment: 'node',
    // Increase timeout for integration tests that call Supabase
    testTimeout: 30_000,
  },
})
