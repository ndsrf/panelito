---
phase: 13-user-profiles-phase-signal
plan: 02
subsystem: database
tags: [supabase, postgres, rls, ajv, zod, plpgsql]

# Dependency graph
requires:
  - phase: 13-01
    provides: ParticipantProfileSchema/ParticipantProfile (@panelito/types), PhaseSequenceSchema.phase_readiness_gate (Zod)
provides:
  - "participant_profiles table (Supabase) with row-ownership RLS, folding in Phase 12's moderation_counts"
  - "getParticipantProfile / upsertParticipantProfile fail-closed repository helpers"
  - "increment_moderation_count RPC repointed to participant_profiles.moderation_count"
  - "upsert_participant_profile SECURITY DEFINER RPC (positions/assertions/messages_sent/reactions_used)"
  - "Fix for live Ajv/Zod schema-drift bug (RESEARCH CRITICAL Finding 4) — loadBlueprint('debate-strategy-v1') no longer throws"
affects: [13-03, 13-04, 13-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PL/pgSQL RETURNS TABLE OUT-parameter/column-name collision fix: #variable_conflict use_column pragma when OUT param names mirror the target table's real columns"
    - "Migration data fold-in ordering: INSERT...SELECT from old table BEFORE DROP TABLE, in the same migration file"

key-files:
  created:
    - supabase/migrations/0016_participant_profiles.sql
    - apps/api/src/lib/participant-profile.ts
    - apps/api/src/lib/participant-profile.test.ts
  modified:
    - apps/api/src/lib/moderation-count.ts
    - apps/api/src/lib/moderation-count.test.ts
    - apps/api/src/lib/blueprint-loader.ts

key-decisions:
  - "participant_id is uuid (not text like the old moderation_counts) per D-04/A2 — author_id is always a real auth.uid()"
  - "phase_readiness_gate handled via Zod .default() only, no DB jsonb rewrite — declared in Ajv as optional per phase_sequence entry"
  - "Migration 0016 applied and verified against the local Supabase dev instance per explicit user redirection at the Task 3 checkpoint (project uses a local-first Supabase dev workflow — see CLAUDE.md Supabase-first constraint); the plan's original Task 3 action (live cloud push via SUPABASE_ACCESS_TOKEN) was superseded by this redirection and not performed"

patterns-established:
  - "Always test new SECURITY DEFINER RPCs whose RETURNS TABLE OUT-param names equal real target-table column names — PL/pgSQL treats bare references as ambiguous by default; add #variable_conflict use_column"

requirements-completed: [PROFILE-01, TRIGGER-02]

# Metrics
duration: 55min
completed: 2026-07-16
---

# Phase 13 Plan 02: Persistence Layer + Blueprint Ajv Fix Summary

**participant_profiles table (RLS-protected, uuid-keyed) built via migration 0016 with a moderation_counts fold-in and two new SECURITY DEFINER RPCs; the live Ajv/Zod schema-drift bug blocking every `/invoke` (RESEARCH Finding 4) is fixed. Migration verified applied and correct against the local Supabase dev instance per explicit user redirection at the Task 3 checkpoint.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-07-16T14:14:00Z (approx, worktree base checkout)
- **Completed:** 2026-07-16T14:05:06Z
- **Tasks:** 3 of 3 complete
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- Migration 0016 authored, applied, and verified against a local Supabase instance: `participant_profiles` table (row-ownership RLS), `moderation_counts` data folded in and dropped, `increment_moderation_count` repointed, new `upsert_participant_profile` RPC added.
- `apps/api/src/lib/participant-profile.ts` — fail-closed `getParticipantProfile`/`upsertParticipantProfile` repository helpers, TDD RED→GREEN.
- `moderation-count.ts` repointed to read `participant_profiles.moderation_count`.
- Fixed the live `loadBlueprint()` Ajv-validation bug (RESEARCH CRITICAL Finding 4) that has thrown on every `/invoke` for the only seeded Blueprint since migration 0015 — `blueprint-loader.test.ts`'s previously-failing integration test now passes, as does the previously-failing `graph.integration.test.ts` Test B (same root cause).
- Discovered and fixed a real PL/pgSQL bug in the new `upsert_participant_profile` RPC during local verification (ambiguous column reference from OUT-param/column-name collision) — not caught by TypeScript or static review, only by actually executing the RPC against a live Postgres instance.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 0016 — participant_profiles, fold-in, RPCs, gate default** - `cfd2808` (feat)
   - Follow-up bug fix (found during local verification, Rule 1) - `bd28173` (fix)
2. **Task 2: participant-profile.ts + moderation-count.ts repoint + blueprint-loader.ts Ajv fix (F4)** - TDD:
   - RED - `a64eec5` (test)
   - GREEN - `24a9802` (feat)
3. **Task 3: [BLOCKING] Verify migration 0016 against Supabase** - COMPLETE (checkpoint resolved via user scope redirection to local dev instance; see Deviations below) - no code commit, verification-only

**Plan metadata:** plan is complete.

## Files Created/Modified

- `supabase/migrations/0016_participant_profiles.sql` — participant_profiles table, RLS, moderation_counts fold-in + drop, repointed `increment_moderation_count`, new `upsert_participant_profile` RPC
- `apps/api/src/lib/participant-profile.ts` — `getParticipantProfile`/`upsertParticipantProfile`, fail-closed, never throw
- `apps/api/src/lib/participant-profile.test.ts` — 5 unit tests (happy path, no-row, query-error, RPC happy path, RPC error)
- `apps/api/src/lib/moderation-count.ts` — `getModerationCount` now reads `participant_profiles.moderation_count`
- `apps/api/src/lib/moderation-count.test.ts` — happy-path mock updated to `participant_profiles`/`moderation_count`
- `apps/api/src/lib/blueprint-loader.ts` — `BLUEPRINT_JSON_SCHEMA` now declares `drift_detection_enabled` (top-level) and `phase_readiness_gate` (per phase_sequence entry)

## Decisions Made

- `participant_id uuid` (not `text`) — matches `messages.author_id`/`reactions.author_id`, the always-real-`auth.uid()` invariant (D-04/A2).
- `phase_readiness_gate` handled entirely via Zod `.default()` — no jsonb array-element rewrite of the live Blueprint row; Ajv declares the field optional so entries that omit it still validate.
- Verified migration 0016 against the **local** Supabase dev instance (`supabase db reset`, then targeted REST/RPC probes, then `supabase db query --local` checks at Task 3 resolution) since no `SUPABASE_ACCESS_TOKEN` was available in this worktree for a live cloud push, and — more importantly — the human user explicitly redirected Task 3's scope at the checkpoint: "we have a local supabase instance I want to use for local development, you can use supabase commands, and pgcli is also available." This matches the project's actual local-first dev workflow (CLAUDE.md Supabase-first constraint) and this project's known WSL2 pattern (see user memory: WSL2 Realtime fix) of developing against local Supabase rather than the live cloud project. The plan's original Task 3 wording (push to the live/cloud project) is superseded by this redirection for this project's dev workflow going forward.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Ambiguous column reference in `upsert_participant_profile` RPC**
- **Found during:** Task 1 (local-verifying the migration ahead of Task 2's code that calls it)
- **Issue:** `upsert_participant_profile`'s `RETURNS TABLE(branch_id uuid, participant_id uuid, positions jsonb, ...)` OUT parameters share names with `participant_profiles`' real columns. PL/pgSQL's default `#variable_conflict error` setting made every bare column reference in the `INSERT` column list / `ON CONFLICT` target / `SET` clause throw `"column reference \"branch_id\" is ambiguous"` on every call.
- **Fix:** Added `#variable_conflict use_column` pragma at the top of the function body, resolving bare identifiers to the table column (the intended behavior — the function's SQL never intentionally references the OUT vars by bare name; `RETURN QUERY` explicitly qualifies with `pp.*`).
- **Files modified:** `supabase/migrations/0016_participant_profiles.sql`
- **Verification:** Applied the fix via `supabase db reset` against the local Supabase instance, then called the RPC via `curl` against the local REST endpoint — the response changed from the semantic ambiguity error to the expected FK-constraint violation (`23503`, branch not found), confirming the SQL now parses and executes correctly.
- **Committed in:** `bd28173`

**2. [Rule 3 - Blocking] Ran `pnpm install --frozen-lockfile` and applied migrations to the local Supabase dev instance**
- **Found during:** Task 2 (attempting to run `pnpm test`)
- **Issue:** This worktree checkout had no `node_modules` (fresh worktree) and the local Supabase Postgres instance (already running in this environment) had migrations only through 0014 fully verified / 0015-0016 not yet applied to its schema cache.
- **Fix:** `pnpm install --frozen-lockfile` (restores from the existing committed lockfile — no new/unpinned packages introduced, so this is not a package-legitimacy concern under Rule 3's exclusion). Copied `apps/api/.env` from the main repo checkout (points to `localhost:54321`, the already-running local dev Supabase — no secrets beyond local dev keys). Ran `supabase migration up` / `supabase db reset` against the local instance only.
- **Files modified:** none tracked (`apps/api/.env` is gitignored; `node_modules` is gitignored)
- **Verification:** `pnpm test` and `pnpm exec tsc --noEmit` run successfully in apps/api afterward.
- **Committed in:** N/A (no tracked file changes — local dev environment setup only)

**3. [Checkpoint scope redirection] Task 3 verified against local Supabase, not live cloud project**
- **Found during:** Task 3 checkpoint (`checkpoint:human-verify`, `gate="blocking-human"`)
- **Issue:** The plan's original Task 3 `<action>` specified pushing migration 0016 to the live/cloud Supabase project via `supabase db push` with `SUPABASE_ACCESS_TOKEN`. This worktree had no such token and the project was not linked.
- **Redirection:** The human user explicitly redirected scope at the checkpoint: "we have a local supabase instance I want to use for local development, you can use supabase commands, and pgcli is also available." This is a deliberate project-workflow decision, not a workaround.
- **Resolution:** Re-verified (in the continuation session that resolved this checkpoint) via `supabase migration list --local` (0016 recorded as applied) and two `supabase db query --local` checks: (a) `participant_profiles` exists with `rowsecurity = true` and `moderation_counts` no longer exists (single-row result confirmed both facts); (b) both `increment_moderation_count` and `upsert_participant_profile` functions exist in `pg_proc`. All three checks passed.
- **Files modified:** none (verification-only; no code or migration changes)
- **Committed in:** this SUMMARY.md update commit (docs-only, no schema change)

---

**Total deviations:** 3 (2 auto-fixed during Tasks 1-2: 1 bug fix, 1 blocking/environment setup; 1 checkpoint scope redirection at Task 3 per explicit user instruction)
**Impact on plan:** The RPC bug fix is essential — the plan's own acceptance criteria ("upsert_participant_profile RPC exists... does not touch the moderation_count column") would have been technically true but functionally broken (every real call failing) without it. No scope creep; both fixes stayed within Task 1/Task 2's own files. The Task 3 scope redirection changes *where* verification happened (local vs. live cloud) but not *what* was verified — all three acceptance checks from the plan's `<how-to-verify>` were performed, just against the local instance per the user's explicit dev-workflow preference.

## Issues Encountered

None beyond the auto-fixed items and the checkpoint scope redirection above.

## User Setup Required

None. The plan's original Task 3 wording anticipated a live/cloud Supabase push, but the user redirected this project's verification workflow to the local Supabase dev instance (already running, shared across worktrees). No external service configuration remains outstanding for this plan.

## Next Phase Readiness

- All three tasks are fully verified against a real Postgres instance (local Supabase) — the migration SQL is proven correct, not just "builds/typechecks."
- Subsequent plans (13-03 ProfileBuilderNode, etc.) that read/write `participant_profiles` can rely on the schema existing and being correct in the local dev environment used by this project. If/when a live cloud deployment is required, migration 0016 will need to be pushed there separately (out of scope for this plan per user redirection).
- `participant_profiles`, `increment_moderation_count`, and `upsert_participant_profile` are confirmed present and correctly shaped in the local Supabase instance that this project develops against.

## Known Stubs

None — no stub/placeholder data introduced by this plan.

## Threat Flags

None — all new surface (participant_profiles RLS, two new RPCs) was already anticipated and dispositioned in this plan's own `<threat_model>` (T-13-03, T-13-04, T-13-05).

---
*Phase: 13-user-profiles-phase-signal*
*Completed: 2026-07-16*

## Self-Check: PASSED

All created files verified present; all task commits verified present in `git log`. Task 3 re-verified independently in the continuation session: `supabase migration list --local` shows 0016 applied; `supabase db query --local` confirms `participant_profiles` exists with `rowsecurity = true` and `moderation_counts` is gone; both `increment_moderation_count` and `upsert_participant_profile` functions exist in `pg_proc`.
