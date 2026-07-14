---
phase: 11-personality-basic-triggers
plan: 02
subsystem: database
tags: [supabase, postgres, migration, rls, personality]

# Dependency graph
requires:
  - phase: 11-personality-basic-triggers (plan 01)
    provides: PersonalitySchema/Personality type, Blueprint bot_defaults/role_personalities/bot_cooldowns field shapes
provides:
  - "public.personalities table live in Supabase (id/name/definition jsonb, RLS SELECT-only)"
  - "Three seeded personalities: coach_default, analyst_default, analista_cientifico (D-06 voice migration)"
  - "debate-strategy-v1 Blueprint definition carries bot_defaults/role_personalities/bot_cooldowns (PERSONA-03)"
  - "sessions.bot_overrides jsonb column (per-session bot on/off override, distinct from active_personas)"
affects: [11-03-arg-graph-builder, 11-04-facilitation-agent, 11-05-conditional-start-edge, 11-06, 11-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "personalities table mirrors domain_blueprints shape exactly (id text PK, name text, definition jsonb, service-role-only writes)"
    - "Personality.definition carries voice/tone data ONLY — no behavioral rules (D-02/D-03); behavioral rules stay hardcoded in each Role's system prompt"
    - "Blueprint.definition extended via jsonb || merge (UPDATE ... SET definition = definition || '{...}'::jsonb) rather than a schema migration on domain_blueprints"

key-files:
  created:
    - supabase/migrations/0014_personalities.sql
  modified: []

key-decisions:
  - "analista_cientifico voice_instructions migrated as STYLE-only text (tone, formatting preferences) — the source persona.ts systemPromptAddition's behavioral instructions (detect fallacies, quantify claims) were intentionally left out per D-02/D-03, since those are Role-level behavioral rules, not Personality voice data"
  - "bot_overrides added as its own sessions column (not reusing active_personas) per D-06 — the two systems (old reactive personas vs new bot Role toggles) must stay structurally distinct"

patterns-established:
  - "Personality seed rows: Spanish, informal tú (D-07), no catchphrases required (analista_cientifico ships with an empty array, matching its clinical/neutral voice)"

requirements-completed: [PERSONA-01, PERSONA-02, PERSONA-03]

# Metrics
duration: 20min
completed: 2026-07-14
---

# Phase 11 Plan 02: Personality + Basic Triggers — Personalities Migration Summary

**Migration 0014 creates the personalities table (3 seeded voices incl. the D-06 migrated Analista Científico), extends the debate-strategy-v1 Blueprint with bot_defaults/role_personalities/bot_cooldowns, and adds sessions.bot_overrides — applied to the live Supabase database via `supabase migration up`.**

## Performance

- **Duration:** ~20 min (including a checkpoint pause for live-database push approval)
- **Started:** 2026-07-13T18:05:00+02:00
- **Completed:** 2026-07-14T09:10:00+02:00
- **Tasks:** 2 completed
- **Files modified:** 1

## Accomplishments
- `public.personalities` table live with RLS enabled and a SELECT-only policy — writes require service role, matching the `domain_blueprints` trust-boundary pattern
- Three personalities seeded: `coach_default` (Facilitador — Socratic/empathetic voice), `analyst_default` (Analista/Verificador — neutral/data-driven voice), and `analista_cientifico` (Analista Científico — the D-06 data-only migration of the existing reactive persona's voice from `packages/types/src/persona.ts`)
- `debate-strategy-v1` Blueprint's `definition` jsonb extended with `bot_defaults` (`{coach: true, analyst: true}`), `role_personalities` (`{coach: coach_default, analyst: analyst_default}`), and `bot_cooldowns` (Coach 3/15min, Analyst 2/15min) per PERSONA-03
- `sessions.bot_overrides jsonb` column added — a per-session bot on/off override, structurally distinct from the existing `active_personas` column (D-06)
- Migration applied to the live Supabase database (`supabase migration up`, run by the orchestrator from the main repo checkout since the project is linked there); all 5 verification queries confirmed the applied state

## Task Commits

1. **Task 1: Write migration 0014 — personalities table, seeds, blueprint + session extensions** - `21d61e3` (feat)
2. **Task 2: [BLOCKING] Push schema to the live database** - no code commit (verification-only checkpoint task; the live push was executed by the orchestrator from the main repo, not from this worktree)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `supabase/migrations/0014_personalities.sql` - `personalities` table + RLS + 3 seed rows + `debate-strategy-v1` Blueprint UPDATE + `sessions.bot_overrides` column

## Decisions Made
- `analista_cientifico`'s `voice_instructions` carries only styling/tone text (tono clínico, riguroso, objetivo; preferencia por comparaciones estructuradas) — the source `persona.ts` `systemPromptAddition`'s behavioral instructions (detectar falacias, cuantificar afirmaciones) were deliberately excluded, since Personality data is voice-only per D-02/D-03 and those behaviors belong in the Role's system prompt (Plan 04, not yet built)
- `bot_overrides` is a new, separate `sessions` column rather than repurposing `active_personas` — keeps the old reactive-persona system and the new proactive bot-Role toggle system structurally distinct (D-06)

## Deviations from Plan

None - plan executed exactly as written. Migration numbering was re-verified at execution time (`ls supabase/migrations/ | sort | tail -3` confirmed `0013_revoke_public_execute.sql` as the highest existing file, so `0014` was correct).

**Worktree staleness (pre-existing condition, not a plan deviation):** The worktree branch (`worktree-agent-a9d8748ad5399f62a`) was created before wave 1 (plan 11-01) merged into `main`. Fast-forward merged `main` into the worktree branch before starting Task 1 — a clean, non-destructive fast-forward (11 commits, no conflicts) that brought in the phase plan files and plan 01's shared contracts (`PersonalitySchema`, `Blueprint.bot_defaults`/`role_personalities`/`bot_cooldowns`) that this plan depends on.

## Issues Encountered

**Checkpoint required live-database access outside this worktree.** Task 2 (`checkpoint:human-verify gate="blocking"`) required running `supabase db push` against the shared live Supabase project. Per the plan's explicit blocking-checkpoint contract, execution paused and returned a structured checkpoint to the orchestrator rather than running the push directly from the worktree. The orchestrator ran `supabase migration up` from the main repo checkout (where the Supabase project is linked) and confirmed all 5 verification queries from the plan's `how-to-verify` section passed:
1. `select id, name from public.personalities order by id;` → 3 expected rows
2. Blueprint `bot_defaults`/`role_personalities`/`bot_cooldowns` all non-null
3. `sessions.bot_overrides` column exists
4. Only `personalities_select` RLS policy present
5. `select count(*) from public.personalities;` = 3

## User Setup Required

None - no external service configuration required. The live-database push itself was the human-verification step (already completed and approved).

## Next Phase Readiness

- `personalities` table, its 3 seed rows, the extended `debate-strategy-v1` Blueprint definition, and `sessions.bot_overrides` are all live in the database — Plan 04 (Facilitation/Analytics agents) can now resolve a Role's active Personality by joining `role_personalities` → `personalities.definition`, and Plan 07 can implement the `bot_overrides` write route.
- No blockers for downstream plans in this wave/phase.

---
*Phase: 11-personality-basic-triggers*
*Completed: 2026-07-14*

## Self-Check: PASSED

All created files verified present on disk (`supabase/migrations/0014_personalities.sql`, `11-02-SUMMARY.md`); commit `21d61e3` verified in git log.
