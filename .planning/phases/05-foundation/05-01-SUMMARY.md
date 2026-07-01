---
phase: 05-foundation
plan: 01
subsystem: infra
tags: [langgraph, langfuse, ajv, xyflow, pnpm, vercel, supabase, env-validation]

# Dependency graph
requires: []
provides:
  - "@langchain/langgraph@1.4.7, @langchain/langgraph-checkpoint-postgres@1.0.4, @langfuse/langchain@5.9.1, ajv@8.20.0 installed in apps/api"
  - "@xyflow/react@12.11.1 installed in apps/web"
  - "vercel.json at monorepo root with maxDuration:60 for Hono bridge route"
  - "SUPABASE_DIRECT_URL validated in apps/api/src/lib/env.ts with postgresql:// refine guard"
affects: [05-02, 05-03, 05-04, phase-06, phase-07, phase-08, phase-09]

# Tech tracking
tech-stack:
  added:
    - "@langchain/langgraph@1.4.7 (apps/api)"
    - "@langchain/langgraph-checkpoint-postgres@1.0.4 (apps/api)"
    - "@langfuse/langchain@5.9.1 (apps/api)"
    - "ajv@8.20.0 (apps/api)"
    - "@xyflow/react@12.11.1 (apps/web)"
  patterns:
    - "SUPABASE_DIRECT_URL validated once at startup in env.ts — same pattern as SUPABASE_SERVICE_ROLE_KEY (T-01-08 / T-05-01)"
    - "vercel.json maxDuration per-function config for Hono bridge — route.ts already has runtime=nodejs"

key-files:
  created:
    - "vercel.json — Vercel build config: buildCommand turbo run build, maxDuration 60 for apps/web/app/api/[[...route]]/route.ts"
  modified:
    - "apps/api/package.json — added @langchain/langgraph, @langchain/langgraph-checkpoint-postgres, @langfuse/langchain, ajv"
    - "apps/web/package.json — added @xyflow/react"
    - "pnpm-lock.yaml — updated with all new package resolutions"
    - "apps/api/src/lib/env.ts — added SUPABASE_DIRECT_URL field with postgresql:// refine guard"

key-decisions:
  - "Used @langfuse/langchain (not langfuse-langchain) — avoids langchain@0.3.x peer dep conflict with LangGraph 1.x"
  - "Single @langchain/core@1.2.1 resolved across all LangGraph packages — no dual-install"
  - "vercel.json functions glob: apps/web/app/api/[[...route]]/route.ts (relative to monorepo root, D-13)"
  - "SUPABASE_DIRECT_URL uses .url() + .refine() pattern — validates postgresql:// prefix, not just any URL"

patterns-established:
  - "Pattern: env.ts follows T-01-08 — new secret SUPABASE_DIRECT_URL read once, never logged, never returned in responses"
  - "Pattern: vercel.json maxDuration 60 (conservative; Hobby allows 300) — D-12"

requirements-completed: [INFRA-01]

# Metrics
duration: 5min
completed: 2026-07-01
---

# Phase 5 Plan 01: Package Installs + Infrastructure Config Summary

**Five NSAI packages installed at exact pinned versions, vercel.json created with maxDuration:60, and SUPABASE_DIRECT_URL postgresql:// validation added to env.ts — all downstream Phase 5 plans unblocked**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-01T18:54:57Z
- **Completed:** 2026-07-01T18:59:38Z
- **Tasks:** 2
- **Files modified:** 5 (apps/api/package.json, apps/web/package.json, pnpm-lock.yaml, vercel.json, apps/api/src/lib/env.ts)

## Accomplishments

- All 5 NSAI packages installed at exact pinned versions with single `@langchain/core@1.2.1` (no dual-install)
- `vercel.json` created at monorepo root configuring `maxDuration: 60` for the Hono bridge route (D-11, D-12, D-13)
- `SUPABASE_DIRECT_URL` added to `EnvSchema` with `postgresql://` prefix refine guard (T-05-01) and build-phase fallback

## Task Commits

Each task was committed atomically:

1. **Task 1: Install NSAI packages** - `d6dca58` (chore)
2. **Task 2: Create vercel.json + add SUPABASE_DIRECT_URL to env.ts** - `b592c9a` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `vercel.json` — New Vercel project config: buildCommand turbo run build, maxDuration 60 for `apps/web/app/api/[[...route]]/route.ts`
- `apps/api/package.json` — Added @langchain/langgraph@1.4.7, @langchain/langgraph-checkpoint-postgres@1.0.4, @langfuse/langchain@5.9.1, ajv@8.20.0
- `apps/web/package.json` — Added @xyflow/react@12.11.1
- `pnpm-lock.yaml` — Updated with all new package resolutions; single @langchain/core@1.2.1
- `apps/api/src/lib/env.ts` — SUPABASE_DIRECT_URL field with .url() + .refine(postgresql://) guard; build-phase fallback added

## Decisions Made

- `@langfuse/langchain` (scoped) instead of `langfuse-langchain` (unscoped legacy) — the legacy package requires `langchain@0.3.x` which conflicts with `@langchain/langgraph@1.4.7`'s requirement of `@langchain/core@^1.1.48`; the scoped package peer dep is `@langchain/core>=0.3.8`, satisfied by `@langchain/core@1.2.1`
- SUPABASE_DIRECT_URL validated with both `.url()` (Zod built-in) and `.refine()` (custom postgresql:// prefix check) — two-layer defense matching RESEARCH.md §SUPABASE_DIRECT_URL Format

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pnpm install needed at worktree root before typecheck**

- **Found during:** Task 2 (vercel.json + env.ts typecheck verification)
- **Issue:** The worktree was missing `packages/types/node_modules` (zod not installed for the types package), causing `pnpm --filter @panelito/api typecheck` to fail with "Cannot find module 'zod'" across all type files
- **Fix:** Ran `pnpm install` from the worktree root; pnpm resolved from lockfile in 1.1s (already locked), populating `packages/types/node_modules`
- **Files modified:** none (install only, no lockfile changes)
- **Verification:** `pnpm --filter @panelito/api typecheck` exits 0 after install
- **Committed in:** part of Task 2 verification (no extra commit needed)

**2. [Rule 3 - Blocking] Task 1 pnpm install ran in main repo instead of worktree (cwd drift #3097)**

- **Found during:** Task 1 commit verification
- **Issue:** `cd /home/jgm/dev/projects/web-projects/panelito` in Bash operated on the main repo checkout (`main` branch), not the worktree. The `git commit` ran on `main`, creating commit `7b43b5e` on the protected branch.
- **Fix:** Re-ran pnpm installs from the worktree path `$WT_ROOT`; re-committed from the worktree branch. The errant `7b43b5e` commit on `main` will need to be removed by the orchestrator after merge (it contains the same changes as `d6dca58`).
- **Files modified:** apps/api/package.json, apps/web/package.json, pnpm-lock.yaml (same files, correct content)
- **Verification:** worktree branch `worktree-agent-a6c7c3fe5b8daf1da` has the correct commit `d6dca58`; all package list commands verified from worktree
- **Committed in:** d6dca58 (Task 1 correct commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both blocking issues resolved without scope change. Errant commit on main is a worktree housekeeping item for the orchestrator — it contains no unintended changes, only the same Task 1 package installs.

## Issues Encountered

- **cwd drift (#3097):** First bash session defaulted to main repo path instead of worktree path. Resolved by using explicit `$WT_ROOT` variable for all subsequent commands. All file operations and commits verified from worktree root.
- **Peer dep warnings (non-blocking):** `react-simple-maps` (pre-existing) and `@xyflow/system` d3-selection internal warning — both pre-existing or internal to the package itself, not caused by this plan's installs.

## User Setup Required

**SUPABASE_DIRECT_URL must be added to environment before Phase 6 can run.**

1. Go to Supabase Dashboard → your project → Connect button → Direct Connection tab
2. Copy the connection string (format: `postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres`)
3. Add to `apps/api/.env`: `SUPABASE_DIRECT_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres`
4. Add to Vercel environment variables for production deploys

Note: Use the direct connection string (port 5432), NOT the transaction pooler (port 6543) — the latter is incompatible with PostgresSaver prepared statements.

## Next Phase Readiness

- Wave 2 plans (05-02, 05-03, 05-04) are unblocked — all packages resolvable, SUPABASE_DIRECT_URL validated
- Phase 6 (Graph Construction + Checkpointer) can reference `env.SUPABASE_DIRECT_URL` for `PostgresSaver.fromConnString()`
- `vercel.json` maxDuration 60 is in place for the Hono SSE streaming route before Phase 7 modifies it

---
*Phase: 05-foundation*
*Completed: 2026-07-01*
