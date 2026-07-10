---
phase: 10-infrastructure-foundation
plan: 02
subsystem: database
tags: [supabase, postgres, sql, rls, rpc, migrations]

requires:
  - phase: []
    provides: []
provides:
  - "bot_arbitration table with atomic INSERT...ON CONFLICT...WHERE-expired compare-and-set lock"
  - "bot_budget_ledger table (append-only) with (branch_id, invoked_at) index for windowed SUM"
  - "bot_circuit_state table (one row per branch) with circuit-trip upsert"
  - "sessions.bot_budget_threshold column (default 1000 tokens / 5-minute window)"
  - "try_acquire_bot_lock(uuid, text, timestamptz) RPC — service_role only"
  - "release_bot_lock(uuid) RPC — service_role only"
  - "check_and_record_bot_budget(uuid, int) RPC — circuit check + ledger insert + windowed SUM in one round-trip"
affects: [10-03, 11-personality-basic-triggers, 12-graph-coherence]

tech-stack:
  added: []
  patterns:
    - "Atomic compare-and-set lock via INSERT...ON CONFLICT...WHERE (mirrors try_acquire_mic)"
    - "Append-only ledger table with windowed SUM for rate limiting"
    - "Circuit breaker state as a single-row-per-branch upsert table"
    - "RLS enabled with no permissive policy — server-side only via security-definer RPCs"

key-files:
  created:
    - supabase/migrations/0012_bot_infrastructure.sql
  modified: []

key-decisions:
  - "All three concurrency/safety primitives in a single migration so they can be pushed together and are always in sync"
  - "check_and_record_bot_budget performs circuit-check + ledger-insert + windowed-SUM + circuit-trip in one PL/pgSQL function to eliminate race conditions between separate calls"
  - "No permissive RLS policy for authenticated users — participants cannot read or write bot state directly; access only through security-definer RPCs granted to service_role"
  - "bot_circuit_state uses upsert pattern (INSERT ... ON CONFLICT DO UPDATE) to handle first-invocation case without a prior row"

patterns-established:
  - "service_role-only RPC pattern: security definer + set search_path = public + grant execute to service_role (no anon/authenticated grant)"
  - "Atomic bot lock follows same compare-and-set proof as mic lock (0010_mic_lock.sql)"

requirements-completed: [BOT-01, BOT-02, BOT-03]

duration: 45min
completed: 2026-07-10
---

# Phase 10-02: Bot Infrastructure SQL Migration Summary

**3 RLS-hardened tables + sessions budget column + 3 atomic security-definer RPCs pushed and verified in local Supabase**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-07-10T08:25:00Z
- **Completed:** 2026-07-10T09:10:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Wrote `0012_bot_infrastructure.sql` with 3 tables, 1 sessions column, and 3 atomic RPCs following the `0010_mic_lock.sql` header/section style
- Pushed migration to local Supabase (`supabase db push --local`) — 0012 applied without errors
- Verified all 4 acceptance checks: 3 tables in information_schema, sessions.bot_budget_threshold column, 3 RPCs in pg_proc, smoke test returning `{ allowed: true, circuit_open: false, tokens_used_window: 10 }`

## Task Commits

1. **Task 1: Write migration 0012_bot_infrastructure.sql** — `0b7657d` (feat)
2. **Task 2: Push schema and verify** — human-verified by orchestrator using `supabase db push --local` + `supabase db query`

## Files Created/Modified
- `supabase/migrations/0012_bot_infrastructure.sql` — 3 bot-infrastructure tables, sessions.bot_budget_threshold column, 3 atomic security-definer RPCs with RLS and service_role grants

## Decisions Made
- Used `INSERT ... ON CONFLICT (branch_id) DO UPDATE SET ... WHERE bot_arbitration.locked_until IS NULL OR bot_arbitration.locked_until < now()` for `try_acquire_bot_lock` — same compare-and-set atomicity proof as `try_acquire_mic`
- `check_and_record_bot_budget` performs all 5 steps (circuit check, threshold read, ledger insert, windowed sum, circuit trip) in a single PL/pgSQL function call to eliminate TOCTOU races between separate app-layer calls
- RLS enabled on all 3 new tables with no permissive policy — authenticated users cannot access bot state; only service_role can via security-definer RPCs

## Deviations from Plan
None — plan executed exactly as written.

## Issues Encountered
None — migration applied cleanly on first push.

## Next Phase Readiness
- All Plan 03 RPCs (`try_acquire_bot_lock`, `check_and_record_bot_budget`) are live and callable by service_role
- Plan 03 can import from `@panelito/types` (Plan 01) and call Supabase RPCs against these live tables
- No blockers for Wave 2

---
*Phase: 10-infrastructure-foundation*
*Completed: 2026-07-10*
