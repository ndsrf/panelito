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
  - "Migration 0016 applied and verified against the local Supabase dev instance (supabase db reset / db push equivalent) since this worktree lacked a live-DB SUPABASE_ACCESS_TOKEN; the checkpoint task still requires the live cloud push"

patterns-established:
  - "Always test new SECURITY DEFINER RPCs whose RETURNS TABLE OUT-param names equal real target-table column names — PL/pgSQL treats bare references as ambiguous by default; add #variable_conflict use_column"

requirements-completed: [PROFILE-01, TRIGGER-02]

# Metrics
duration: 55min
completed: 2026-07-16
---

# Phase 13 Plan 02: Persistence Layer + Blueprint Ajv Fix Summary

**participant_profiles table (RLS-protected, uuid-keyed) built via migration 0016 with a moderation_counts fold-in and two new SECURITY DEFINER RPCs; the live Ajv/Zod schema-drift bug blocking every `/invoke` (RESEARCH Finding 4) is fixed. Live-DB push to the cloud Supabase project is a pending checkpoint — see below.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-07-16T14:14:00Z (approx, worktree base checkout)
- **Completed (through Task 2):** 2026-07-16T14:05:06Z
- **Tasks:** 2 of 3 complete (Task 3 is a blocking checkpoint, not yet resolved)
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
3. **Task 3: [BLOCKING] Push migration 0016 to live Supabase** - NOT STARTED (checkpoint reached, see below)

**Plan metadata:** not yet created — plan is not complete (blocked at Task 3 checkpoint).

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
- Verified migration 0016 against the **local** Supabase dev instance (`supabase db reset`, then targeted REST/RPC probes) since no `SUPABASE_ACCESS_TOKEN` was available in this worktree for a live cloud push — this satisfies "does the SQL actually execute correctly" but does NOT satisfy the plan's Task 3 requirement that the schema be applied to the **live/cloud** project. Task 3 remains a blocking checkpoint for that reason.

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

---

**Total deviations:** 2 auto-fixed (1 bug fix, 1 blocking/environment setup)
**Impact on plan:** The RPC bug fix is essential — the plan's own acceptance criteria ("upsert_participant_profile RPC exists... does not touch the moderation_count column") would have been technically true but functionally broken (every real call failing) without it. No scope creep; both fixes stayed within Task 1/Task 2's own files.

## Issues Encountered

None beyond the auto-fixed items above.

## User Setup Required

**External service requires manual configuration before this plan can be marked complete.** Task 3 (checkpoint) requires pushing migration 0016 to the **live/cloud** Supabase project (`panelito@junk.ndsrf.com's Project`, ref `ktcsbevsdgbmtwdasrcl`) — this worktree has no `SUPABASE_ACCESS_TOKEN` and the project is not linked here (`supabase projects list` shows the project but `LINKED` is empty). See "CHECKPOINT REACHED" details in the executor's final report for exact steps.

## Next Phase Readiness

- Task 1 and Task 2 are fully verified against a real Postgres instance (local Supabase) — the migration SQL is proven correct, not just "builds/typechecks."
- Task 3 (live-DB push) is a hard blocker: subsequent plans (13-03 ProfileBuilderNode, etc.) that read/write `participant_profiles` on the live database cannot function until this push happens. Build/type checks alone will falsely appear green without it (as explicitly flagged in the plan's own `<what-built>` note).
- No code in this plan reads/writes `participant_profiles` from the live cloud project yet — Task 1/2's changes are inert in production until Task 3 completes.

## Known Stubs

None — no stub/placeholder data introduced by this plan.

## Threat Flags

None — all new surface (participant_profiles RLS, two new RPCs) was already anticipated and dispositioned in this plan's own `<threat_model>` (T-13-03, T-13-04, T-13-05).

---
*Phase: 13-user-profiles-phase-signal*
*Completed: IN PROGRESS — blocked at Task 3 checkpoint (2026-07-16)*

## Self-Check: PASSED

All created files verified present; all task commits verified present in `git log`.
