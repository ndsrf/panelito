---
phase: 12-graph-coherence-extended-triggers
plan: 02
subsystem: api
tags: [onnx, embeddings, huggingface-transformers, cosine-similarity, supabase, rls, moderation, postgres, migration]

# Dependency graph
requires:
  - phase: 11-personality-basic-triggers
    provides: bot_defaults/bot_overrides Role-activation gate pattern, silence-scan.ts singleton-consumer precedent, bot-budget.ts FAIL_CLOSED convention
provides:
  - "@huggingface/transformers ONNX feature-extraction pipeline singleton (embeddings.ts) — embed(), cosineSimilarity(), getDomainCentroid() cached by blueprint.id"
  - "Postgres-backed moderation_count read/increment (moderation-count.ts), fail-closed to 0"
  - "Migration 0015: drift_detection_enabled Blueprint field + moderation_counts table (RLS row-ownership) + atomic increment_moderation_count RPC — pushed to live database"
affects: [12-03, 12-04, 12-05, drift-redirect Skill, orphan-edge Skill, moderation Skill]

# Tech tracking
tech-stack:
  added: ["@huggingface/transformers@4.2.0"]
  patterns:
    - "Lazy-singleton-Promise idiom (assign Promise synchronously before any await) reused a second time for ONNX pipeline load, after langgraph-checkpointer.ts's PostgresSaver"
    - "In-memory Map cache keyed by a stable id (blueprint.id) as the one explicit exception to 'all bot state in Postgres' — deterministic/cheap to recompute"
    - "Atomic INSERT...ON CONFLICT DO UPDATE SET x = x + 1 RETURNING for race-safe counters (mirrors try_acquire_bot_lock's compare-and-set shape)"
    - "RLS row-ownership policy (auth.uid()::text = participant_id) as the tightest expressible policy in a schema with no participant-membership table"

key-files:
  created:
    - apps/api/src/lib/embeddings.ts
    - apps/api/src/lib/embeddings.test.ts
    - apps/api/src/lib/moderation-count.ts
    - apps/api/src/lib/moderation-count.test.ts
    - supabase/migrations/0015_graph_coherence_triggers.sql
  modified:
    - apps/api/package.json
    - pnpm-lock.yaml

key-decisions:
  - "Used `pnpm --filter @panelito/api add` instead of the plan's `npm install --workspace apps/api` — repo is a pnpm workspace (pnpm-lock.yaml is the lockfile of record, no package-lock.json exists); npm install would have created a conflicting lockfile"
  - "moderation_counts RLS SELECT policy scoped to row-ownership (auth.uid()::text = participant_id) rather than session/branch participant-membership, because this codebase has no participant-membership table anywhere (sessions_select and canvas_nodes_select both resolve to 'any authenticated user who knows the row exists') — row-ownership is the tightest policy this schema can express and is strictly tighter than every existing RLS precedent (personalities, domain_blueprints, canvas_nodes)"
  - "incrementModerationCount uses a new atomic increment_moderation_count RPC (INSERT...ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count) rather than a plain upsert, mirroring try_acquire_bot_lock's compare-and-set shape — protects against two concurrent moderation triggers on the same participant/branch racing and losing an increment"
  - "Discovered during Task 3 that migration 0014_personalities.sql had NOT actually been pushed to the live database despite STATE.md's 2026-07-15 decision log claiming Phase 11 completion — `supabase db push` applied both 0014 and 0015 in this session (worktree required `supabase link --project-ref ktcsbevsdgbmtwdasrcl` first, since supabase/.temp linking state is gitignored and not shared across worktrees)"

requirements-completed: [TRIGGER-03, GRAPH-03, TRIGGER-06, COST-01]

# Metrics
duration: ~45min (session included one usage-limit interruption/resume; work was preserved uncommitted and resumed cleanly)
completed: 2026-07-15
---

# Phase 12 Plan 02: Zero-Cost Local Infrastructure (Embeddings + Moderation Counter + Schema Push) Summary

**ONNX `all-MiniLM-L6-v2` embedding singleton (embed/cosineSimilarity/getDomainCentroid), a fail-closed Postgres moderation escalation counter, and migration 0015 (drift_detection_enabled + moderation_counts with row-ownership RLS) — all pushed live, discovering along the way that migration 0014 had never actually reached the live database.**

## Performance

- **Duration:** ~45 min (one usage-limit interruption mid-session; resumed from uncommitted worktree state with no lost work)
- **Tasks:** 3/3 completed
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments
- `@huggingface/transformers` 4.2.0 installed (npm registry verified, slopcheck [OK], official Hugging Face repo — Approved per RESEARCH.md audit, no human legitimacy checkpoint needed)
- `embeddings.ts`: race-safe `_extractorPromise` singleton (Promise assigned synchronously before any `await`, preventing the double-model-load race when `drift-redirect` and `orphan-edge` both call it inside the same `Promise.allSettled` fan-out), `embed()`/`cosineSimilarity()` (plain dot product over unit-normalized vectors), `getDomainCentroid()` cached by `blueprint.id`
- `moderation-count.ts`: `getModerationCount`/`incrementModerationCount`, fail-closed to count 0 on any Supabase error (never throws) — mirrors `bot-budget.ts`'s `FAIL_CLOSED` posture
- Migration `0015_graph_coherence_triggers.sql`: jsonb-additive `drift_detection_enabled: true` on `debate-strategy-v1` (D-09); new `moderation_counts` table with RLS scoped to row-ownership; atomic `increment_moderation_count` RPC granted to `service_role` only
- Migration pushed to the live database — verified live: `moderation_counts` table is queryable, `debate-strategy-v1`'s `definition` contains `drift_detection_enabled: true`, `supabase migration list` shows `0015` applied

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @huggingface/transformers + build embeddings.ts ONNX singleton** - `da9f317` (feat)
2. **Task 2: Migration 0015 (drift_detection_enabled + moderation_counts) and moderation-count.ts** - `2b7c5de` (feat)
3. **Task 3: [BLOCKING] Push schema to the live database** - no file changes (live infrastructure action only; the migration file itself was committed in Task 2)

**Plan metadata:** committed separately as part of this SUMMARY commit.

## Files Created/Modified
- `apps/api/src/lib/embeddings.ts` - ONNX pipeline singleton, `embed()`, `cosineSimilarity()`, `getDomainCentroid()` cached by blueprint.id
- `apps/api/src/lib/embeddings.test.ts` - mocks `@huggingface/transformers` pipeline (no real ONNX download); asserts single-load under concurrency, cosine similarity bounds, centroid caching
- `apps/api/src/lib/moderation-count.ts` - `getModerationCount`/`incrementModerationCount`, fail-closed to 0
- `apps/api/src/lib/moderation-count.test.ts` - happy-path read, no-row-yet, query-error, RPC happy-path, RPC error, empty-row RPC response
- `supabase/migrations/0015_graph_coherence_triggers.sql` - `drift_detection_enabled` jsonb field, `moderation_counts` table + RLS, `increment_moderation_count` RPC
- `apps/api/package.json` - adds `@huggingface/transformers` dependency
- `pnpm-lock.yaml` - lockfile update for the new dependency

## Decisions Made
- pnpm (not npm) used to install the new dependency — the plan's literal instruction (`npm install --workspace apps/api`) would have created a conflicting `package-lock.json` in a pnpm-managed monorepo; this is a plan-typo auto-fix (Rule 1), not a scope change
- `moderation_counts` RLS SELECT policy uses row-ownership (`auth.uid()::text = participant_id`) rather than a session/branch-membership check, because no participant-membership table exists anywhere in this schema to scope against — this is documented at length in the migration's header comment and is strictly tighter than every other RLS policy in the codebase (personalities, domain_blueprints, canvas_nodes all resolve to "any authenticated user")
- `incrementModerationCount` uses a dedicated atomic RPC (not a plain `.upsert()` call) for race-safety, following the `try_acquire_bot_lock` compare-and-set precedent

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan specified `npm install --workspace apps/api`, but this is a pnpm workspace**
- **Found during:** Task 1
- **Issue:** The plan's install command (`npm install --workspace apps/api @huggingface/transformers`) would create a `package-lock.json` in a repo whose lockfile of record is `pnpm-lock.yaml` (confirmed via `packageManager: "pnpm@10.18.3"` in the root package.json and no existing `package-lock.json`)
- **Fix:** Ran `pnpm --filter @panelito/api add @huggingface/transformers` instead — installs the same package/version, updates `pnpm-lock.yaml` correctly
- **Files modified:** `apps/api/package.json`, `pnpm-lock.yaml`
- **Verification:** `grep -q "@huggingface/transformers" apps/api/package.json` passes; no stray `package-lock.json` created
- **Committed in:** `da9f317` (Task 1 commit)

**2. [Rule 1 - Bug] `cosineSimilarity()`/`getDomainCentroid()` failed `tsc --noEmit` under `noUncheckedIndexedAccess`**
- **Found during:** Task 1 (post-implementation typecheck)
- **Issue:** `a[i] * b[i]` in the dot-product loop and the bare `.map((n) => ...)` callbacks triggered `noUncheckedIndexedAccess`/`noImplicitAny` errors (this tsconfig option is enabled at the monorepo root)
- **Fix:** Added `?? 0` fallback for the indexed reads and explicit `NodeTypeConfig`/`EdgeTypeConfig` parameter types on the map callbacks
- **Files modified:** `apps/api/src/lib/embeddings.ts`
- **Verification:** `tsc --noEmit` shows zero errors attributable to `embeddings.ts` (the file is clean; unrelated pre-existing errors elsewhere in the repo remain — see Issues Encountered)
- **Committed in:** `da9f317` (Task 1 commit)

**3. [Rule 3 - Blocking, discovered during BLOCKING Task 3] Migration 0014 had not actually reached the live database**
- **Found during:** Task 3
- **Issue:** `supabase migration list` (run from the worktree after linking to the project) showed 0014 as present locally and remotely-timestamped, but `supabase db push` still queued and applied `0014_personalities.sql` alongside `0015` — meaning 0014 was not actually live prior to this session, despite STATE.md's 2026-07-15 decision log entry implying Phase 11 (which depends on 0014's `personalities`/`bot_defaults`/`bot_overrides` schema) was fully complete
- **Fix:** No code change needed — `supabase db push` applied both migrations in one pass; both are now confirmed live (`supabase migration list` shows 0014 and 0015 applied)
- **Files modified:** none (infrastructure-only; the 0015 SQL file itself was already committed in Task 2)
- **Verification:** `supabase migration list` output now shows `0014 | 0014 | 0014` and `0015 | 0015 | 0015` (both Local/Remote columns populated); live query confirms `debate-strategy-v1.definition.drift_detection_enabled = true` and `moderation_counts` table exists
- **Committed in:** n/a (no repo file change — flagging here for STATE.md/orchestrator awareness, since Phase 11's "Complete" status implicitly assumed 0014 was live)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bug fixes, 1 Rule 3 blocking discovery with no code change required)
**Impact on plan:** All auto-fixes necessary for correctness (working install, clean typecheck) or safety (confirming 0014's actual live state before layering 0015 on top). No scope creep — no new files beyond the plan's stated `files_modified` list.

## Issues Encountered
- `pnpm --filter @panelito/api test` runs the ENTIRE `apps/api` test suite (not just files matching a name filter) when invoked through the `pnpm --filter ... test -- <pattern>` form documented in the plan — this surfaced 6 pre-existing test failures in `blueprint-loader.test.ts` and `silence-scan.test.ts` that are unrelated to this plan's changes (confirmed via `git stash` + re-run on a clean tree — identical 6 failures present before any of this plan's work). Used `npx vitest run <pattern>` directly instead, which correctly filters to `embeddings.test.ts`/`moderation-count.test.ts` only. These 6 pre-existing failures are out of scope per the executor's SCOPE BOUNDARY rule and were not touched.
- `pnpm --filter api exec tsc --noEmit` (the plan's phase-level `<verification>` command) is NOT clean at the whole-repo level — there are numerous pre-existing errors in `orchestrator.ts`, `mutation-gate.ts`, `routes/keys.ts`, `routes/settings.ts`, `routes/ai.ts`, `services/labeler.ts`, and a `Cannot find module 'zod'` resolution failure across every `packages/types/src/*.ts` file (worktree-specific module resolution issue, likely related to the worktree's `tsc` not sharing the same `node_modules`/path-mapping setup as `vitest.config.ts`'s custom worktree-aliasing logic). None of these errors are in files this plan created or modified — `embeddings.ts` and `moderation-count.ts` are both individually clean under `tsc --noEmit`. Flagging this gap for the phase orchestrator/next plan rather than attempting to fix files outside this plan's scope.

## User Setup Required
None - no external service configuration required. (The `supabase link`/`db push` steps in Task 3 were performed by the executor using already-authenticated CLI credentials; no manual dashboard action was needed.)

## Next Phase Readiness
- `embeddings.ts` and `moderation-count.ts` are ready to be consumed by Wave 2's Skills (`drift-redirect.ts`, `orphan-edge.ts`, `moderation.ts`) per the phase's dependency map
- `drift_detection_enabled` is live on `debate-strategy-v1` and `moderation_counts` is live and queryable — the next plan's Skills can read/write against real schema, not mocks
- **Known gap carried forward:** the whole-repo `tsc --noEmit` failure (pre-existing, not caused by this plan) should be investigated before the phase's final verification gate — it may indicate the worktree's `tsc` invocation needs the same custom module-resolution treatment `vitest.config.ts` already has, or it may be a genuine unresolved regression from a prior phase
- **Known gap carried forward:** migration 0014 was silently un-pushed until this session — worth a brief STATE.md note (owned by the orchestrator, not this plan) that Phase 11's "Complete" status should be understood as "code complete, schema now confirmed live as of this plan" rather than "schema was live throughout Phase 11 testing"

---
*Phase: 12-graph-coherence-extended-triggers*
*Completed: 2026-07-15*
