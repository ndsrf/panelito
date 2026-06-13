---
phase: 02-ai-analytics
plan: 01
subsystem: database, api, types
tags: [zod, anthropic-sdk, supabase, vitest, typescript, discriminated-union, streaming, tool-use]

# Dependency graph
requires:
  - phase: 01-live-session-shell
    provides: sessions/messages tables, RLS patterns, anthropic.ts assemblePromptArray, cap-guard.ts

provides:
  - PanelWidgetSchema discriminated union (bento/radar/scatter/pie) — AI-05 validation foundation
  - ReactionSchema + ReactionCountSchema — REACT-01..04 type contracts
  - PersonaConfig + PERSONA_LIBRARY (Analista Científico) — PERSONA-01 config
  - AIProvider interface + AnthropicAdapter + renderPanelTool — D-03 streaming abstraction
  - compressHistory() helper using claude-haiku-4-5-20251001 — AI-08 sliding window
  - Migration 0005: reactions table, sessions.active_personas, messages.role

affects:
  - 02-02 (ai-streaming-route: imports AIProvider, AnthropicAdapter, renderPanelTool)
  - 02-03 (panel-widgets: imports PanelWidgetSchema, PanelWidget types)
  - 02-04 (reactions-route: imports ReactionSchema, reactions table)
  - 02-05 (personas-route: imports PersonaConfig, PERSONA_LIBRARY, active_personas column)

# Tech tracking
tech-stack:
  added: [vitest (packages/types devDep)]
  patterns:
    - z.discriminatedUnion('widget_type', [...]) for 4 widget variants
    - AsyncIterable generator bridging SDK event callbacks with internal queue+resolver
    - on('contentBlock') for fully-accumulated tool_use JSON (never parse input_json_delta)
    - Supabase Realtime: alter publication supabase_realtime add table reactions

key-files:
  created:
    - packages/types/src/panel.ts
    - packages/types/src/reaction.ts
    - packages/types/src/persona.ts
    - packages/types/src/panel.test.ts
    - packages/types/vitest.config.ts
    - apps/api/src/lib/ai-provider.ts
    - apps/api/src/lib/ai-provider.test.ts
    - supabase/migrations/0005_reactions_personas.sql
  modified:
    - packages/types/src/index.ts (barrel exports for panel/reaction/persona)
    - packages/types/package.json (added vitest devDep + test script)
    - apps/api/src/lib/anthropic.ts (added compressHistory export)

key-decisions:
  - "Migration renumbered 0004 -> 0005: existing 0004_auto_freeze_pg_cron.sql occupied version 0004"
  - "AnthropicAdapter uses internal queue + resolver pattern to bridge callback API to AsyncIterable cleanly"
  - "compressHistory short-circuits on empty input to avoid unnecessary API calls"
  - "vitest added to @panelito/types as devDependency for co-located schema tests"

patterns-established:
  - "PanelWidgetSchema.safeParse() validation gate before any panelStore update (AI-05)"
  - "renderPanelTool: on('contentBlock') only emits after full JSON accumulation — never raw input_json_delta"
  - "Test mock pattern for Anthropic SDK streaming: createMockController with textCallbacks/blockCallbacks arrays + resolveDone"

requirements-completed: [AI-04, AI-05, AI-08, PANEL-01, PANEL-04, REACT-01, REACT-02, REACT-03, REACT-04, PERSONA-01]

# Metrics
duration: 25min
completed: 2026-06-14
---

# Phase 2 Plan 01: Contracts-First Foundation Summary

**Zod schemas for all 4 PanelWidget variants + AIProvider/AnthropicAdapter streaming abstraction (D-03) + reactions/personas DB schema applied to live local Supabase**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-14T00:00:00Z
- **Completed:** 2026-06-14T00:25:00Z
- **Tasks:** 4 (3 auto + 1 checkpoint/verify executed automatically)
- **Files modified:** 10

## Accomplishments

- Created PanelWidgetSchema as z.discriminatedUnion with min/max constraints on all 4 widget variants; 8 test cases all green
- Created AIProvider interface + AnthropicAdapter using on('contentBlock') pattern for fully-accumulated tool_use JSON; 4 test cases all green
- Added compressHistory() to anthropic.ts using claude-haiku-4-5-20251001 for AI-08 sliding window compression
- Created migration 0005_reactions_personas.sql and applied it to live local Supabase; reactions table, sessions.active_personas, messages.role all confirmed present

## Task Commits

1. **Task 1: Shared Zod types — panel, reaction, persona** - `68294d5` (feat)
2. **Task 2: AIProvider interface + AnthropicAdapter + compressHistory** - `92b35c9` (feat)
3. **Task 3: Migration file creation** - `1ce52fb` (feat)
4. **Task 3 deviation: Migration rename fix** - `df63c6a` (fix)

## Files Created/Modified

- `packages/types/src/panel.ts` — PanelWidgetSchema discriminated union, PanelWidget type, AIStreamEvent type
- `packages/types/src/reaction.ts` — ReactionSchema, ReactionCountSchema with 4-emoji enum
- `packages/types/src/persona.ts` — PERSONA_IDS, PersonaConfigSchema, PERSONA_LIBRARY (Analista Científico)
- `packages/types/src/index.ts` — Extended barrel exports for panel/reaction/persona modules
- `packages/types/src/panel.test.ts` — 8 tests covering all discriminated union behavior cases
- `packages/types/package.json` — Added vitest devDep + test script
- `packages/types/vitest.config.ts` — Vitest config for types package
- `apps/api/src/lib/ai-provider.ts` — AIProvider interface, AnthropicAdapter, renderPanelTool definition
- `apps/api/src/lib/ai-provider.test.ts` — 4 tests: streaming order, block filtering, tool schema, compressHistory empty
- `apps/api/src/lib/anthropic.ts` — Extended with compressHistory() function
- `supabase/migrations/0005_reactions_personas.sql` — Reactions table, RLS, Realtime, active_personas, messages.role

## Decisions Made

- Migration renumbered 0004 → 0005: `0004_auto_freeze_pg_cron.sql` already occupied version 0004 in the migrations folder, causing a duplicate key conflict on `supabase migration up`.
- AnthropicAdapter uses an internal queue + resolver pattern to bridge the SDK's callback-based events to an AsyncIterable, yielding events in arrival order without busy-waiting.
- vitest added to `@panelito/types` (previously only had typescript devDep) to enable co-located schema tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Migration version conflict — renamed 0004 to 0005**
- **Found during:** Task 4 (checkpoint: pushing migration to local Supabase)
- **Issue:** `supabase migration up` failed with `duplicate key value violates unique constraint "schema_migrations_pkey"` because `0004_auto_freeze_pg_cron.sql` already uses version 0004
- **Fix:** Renamed `0004_reactions_personas.sql` → `0005_reactions_personas.sql`; re-ran `supabase migration up` successfully
- **Files modified:** `supabase/migrations/0005_reactions_personas.sql` (renamed)
- **Verification:** `supabase migration up` applied cleanly; `supabase db query` confirmed all 3 schema items present
- **Committed in:** `df63c6a`

---

**Total deviations:** 1 auto-fixed (Rule 1 bug fix)
**Impact on plan:** Version conflict is a blocking issue resolved in-place; no scope changes.

## Issues Encountered

- The `@panelito/types` package had no test infrastructure; vitest was added as a devDependency and a vitest.config.ts created. This is expected infra setup, not a complication.
- The pre-existing `messages.test.ts` and `sessions.test.ts` files in `apps/api` have TypeScript errors (`TS18046: of type 'unknown'`) that are not related to this plan's changes — verified by checking base HEAD typecheck output. Out of scope per deviation rules.

## User Setup Required

None — migration was applied automatically to the running local Supabase instance.

## Next Phase Readiness

- All downstream plans (02-02 through 02-06) can now import from `@panelito/types`: PanelWidgetSchema, ReactionSchema, PersonaConfig, PERSONA_LIBRARY
- AIProvider interface + AnthropicAdapter ready for 02-02 (Hono streaming route)
- renderPanelTool definition ready for 02-02 route integration
- compressHistory() ready for 02-02 context assembly
- Live DB has reactions table, sessions.active_personas, messages.role — 02-04/05 can write Hono routes immediately

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced by this plan.
The migration's threat mitigations (T-02-01 through T-02-04) are fully implemented:
- T-02-01: RLS INSERT WITH CHECK (auth.uid() = author_id) on reactions
- T-02-02: CHECK emoji IN ('🧠','🔥','📌','🎯') at DB level
- T-02-03: UNIQUE(message_id, author_id, emoji) constraint
- T-02-04: PanelWidgetSchema.safeParse() implemented and tested (8 cases)

---

## Self-Check: PASSED

Files verified:
- packages/types/src/panel.ts — FOUND
- packages/types/src/reaction.ts — FOUND
- packages/types/src/persona.ts — FOUND
- packages/types/src/panel.test.ts — FOUND
- apps/api/src/lib/ai-provider.ts — FOUND
- apps/api/src/lib/ai-provider.test.ts — FOUND
- apps/api/src/lib/anthropic.ts (extended) — FOUND
- supabase/migrations/0005_reactions_personas.sql — FOUND

Commits verified:
- 68294d5 feat(02-01): add shared Zod types — FOUND
- 92b35c9 feat(02-01): add AIProvider interface — FOUND
- 1ce52fb feat(02-01): add migration — FOUND
- df63c6a fix(02-01): rename migration — FOUND

*Phase: 02-ai-analytics*
*Completed: 2026-06-14*
