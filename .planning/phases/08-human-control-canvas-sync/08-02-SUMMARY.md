---
phase: 08-human-control-canvas-sync
plan: 02
subsystem: database
tags: [postgres, supabase, migration, rpc, mic-lock, plpgsql, atomic-cas]

# Dependency graph
requires:
  - phase: 08-human-control-canvas-sync
    provides: "branches table from migration 0007; local Supabase instance with migrations 0001–0009 applied"
provides:
  - "branches.mic_holder_id (text, nullable) — mic lock owner identity string"
  - "branches.mic_acquired_at (timestamptz, nullable) — lock acquisition timestamp for expiry calculation"
  - "try_acquire_mic(branch_id, holder_id, expiry_seconds) RPC — atomic CAS lock acquisition returning TABLE(acquired boolean, held_since timestamptz)"
  - "release_mic(branch_id) RPC — unconditional mic lock release returning void"
  - "GRANT EXECUTE on both RPCs to service_role only"
affects:
  - 08-04-invoke-route-mic-lock
  - apps/api/src/routes/ai.ts (Plan 04 will add supabase.rpc('try_acquire_mic', ...) and supabase.rpc('release_mic', ...) calls)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic CAS via UPDATE...WHERE...IF FOUND (plpgsql): same pattern as increment_ai_count in 0003 — no lock row is created if WHERE matches nothing, preventing concurrent acquisition"
    - "Expiry interval via (p_expiry_seconds || ' seconds')::interval — avoid make_interval() for Postgres version portability"
    - "release_mic uses sql language (no conditional needed); try_acquire_mic uses plpgsql (needs IF FOUND)"
    - "Both RPCs: SECURITY DEFINER + SET search_path = public + GRANT EXECUTE to service_role"

key-files:
  created:
    - supabase/migrations/0010_mic_lock.sql
  modified: []

key-decisions:
  - "Column-based mic lock on branches table (not separate mic_tokens table) — branch-scoped, matches PLAN.md D-03"
  - "30-second default expiry prevents permanent lock from Vercel function crash (T-08-02-C / D-07)"
  - "p_holder_id is sessionId set server-side by the route, not user-controlled input — T-08-02-B accepted per threat model"

patterns-established:
  - "Mic lock CAS pattern: UPDATE branches WHERE mic_holder_id IS NULL OR expired; IF FOUND return true; ELSE SELECT current holder"

requirements-completed:
  - HUMAN-01

# Metrics
duration: 15min
completed: 2026-07-03
---

# Phase 8 Plan 02: Mic Lock DB Foundation Summary

**Postgres atomic mic lock via two nullable columns on branches + try_acquire_mic/release_mic RPCs with SECURITY DEFINER and service_role-only execute grant**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-03T12:10:00Z
- **Completed:** 2026-07-03T12:26:31Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Created migration 0010_mic_lock.sql with ALTER TABLE (2 nullable columns) + 2 RPCs following the 0003 canonical pattern
- Applied migration to local Supabase and verified both columns exist on branches table
- Verified try_acquire_mic CAS semantics: first call returns acquired=true; second call on same branch within expiry returns acquired=false
- Verified release_mic clears both columns; subsequent try_acquire_mic returns acquired=true again

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migration 0010_mic_lock.sql** - `625a1e3` (feat)
2. **Task 2: Verify mic lock RPCs via supabase CLI** - verification only, no new source files (DB state updated in-place)

**Plan metadata:** (committed with SUMMARY.md)

## Files Created/Modified
- `supabase/migrations/0010_mic_lock.sql` - Adds mic_holder_id + mic_acquired_at to branches table; creates try_acquire_mic (plpgsql, CAS) and release_mic (sql, unconditional clear) RPCs; grants execute to service_role

## Decisions Made
- Column-based mic lock on the branches table (not a separate mic_tokens table) — branch-scoped, atomic, avoids join overhead
- 30-second default expiry in try_acquire_mic signature to mitigate T-08-02-C (crash without release)
- Used `(p_expiry_seconds || ' seconds')::interval` per RESEARCH.md A2 guidance, not `make_interval()`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **Supabase CLI multi-statement limitation:** `supabase db query --local -f <file>` rejects files with multiple SQL statements ("cannot insert multiple commands into a prepared statement"). Applied migration in individual statement batches as workaround. This is a CLI limitation, not a DB problem — the migration file is correct for `supabase migration up` (which uses libpq directly).
- **void return type in supabase db query:** `SELECT release_mic(...)` causes "unknown oid 2278 cannot be scanned" in the CLI JSON output. Used `DO $$ BEGIN PERFORM release_mic(...); END $$` for testing. Verified release by checking columns are NULL post-call.
- **Worktree migration file visibility:** `supabase migration list` scans the main project directory, not the worktree — so 0010 shows as not-local in CLI output until worktree is merged. DB schema is applied and verified. Registered version 0010 in supabase_migrations.schema_migrations tracking table.

## User Setup Required

None - migration applies to local Supabase dev instance automatically. Production deployment requires `supabase migration up` (or `db push`) after merge to main.

## Next Phase Readiness

- branches table has mic_holder_id and mic_acquired_at columns — ready for Plan 04 `/invoke` route integration
- try_acquire_mic and release_mic RPCs are callable by service_role — Plan 04 uses `supabase.rpc('try_acquire_mic', ...)` and `supabase.rpc('release_mic', ...)` directly
- No blockers

---
*Phase: 08-human-control-canvas-sync*
*Completed: 2026-07-03*

## Self-Check: PASSED
- `supabase/migrations/0010_mic_lock.sql` exists in worktree
- Commit `625a1e3` verified in git log
- branches.mic_holder_id and mic_acquired_at columns confirmed via information_schema query
- try_acquire_mic and release_mic functions confirmed in pg_proc with prosecdef=true
- RPC behavioral tests all passed (acquired=true, acquired=false, release clears columns, re-acquire=true)
