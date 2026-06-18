---
phase: 04-multi-ai-providers
plan: "03"
subsystem: database
tags: [supabase, migration, multi-provider, byok, api-keys, encryption, column-security, hono, zod]
dependency_graph:
  requires:
    - packages/types/src/ai.ts (ProviderSchema, ProviderName — imported in api-key.ts)
    - apps/api/src/lib/verify-key.ts (verifyOpenAIKey, verifyGeminiKey — dispatched in keys.ts)
    - apps/api/src/lib/anthropic.ts (verifyApiKey, VerifyResult)
  provides:
    - supabase/migrations/0006_multi_provider_keys.sql (schema: anthropic_api_key, openai_api_key, gemini_api_key, active_provider + REVOKE/GRANT)
    - packages/types/src/api-key.ts (MultiProviderStatusSchema, ProviderKeyStatusSchema, updated ApiKeyVerifyRequestSchema + CreatorSettingsSchema)
    - apps/api/src/routes/keys.ts (multi-provider verify/status/delete/active-provider routes)
    - apps/api/src/routes/settings.ts (active_provider support in GET/PUT)
  affects:
    - apps/web/src/app/settings (settings UI page — Plan 04 will consume MultiProviderStatus)
    - apps/api/src/routes/ai.ts (Plan 04 — reads active_provider to select adapter)
tech-stack:
  added: []
  patterns:
    - Per-provider prefix guard before verify call (sk-ant- / sk- / AI) — T-04-08
    - Computed column name `${provider}_api_key` for provider-specific upsert
    - Cap-preserving upsert extended to multi-provider (insert default cap 150 on new row)
    - Column-level REVOKE/GRANT in migration (authenticated role cannot SELECT any key column)
    - MultiProviderStatus response shape: active_provider + providers[] array per provider
    - All three key columns stripped server-side in settings.ts before responding

key-files:
  created:
    - supabase/migrations/0006_multi_provider_keys.sql
  modified:
    - packages/types/src/api-key.ts (ApiKeyVerifyRequestSchema, MultiProviderStatusSchema, ProviderKeyStatusSchema, CreatorSettingsSchema)
    - packages/types/src/index.ts (added MultiProviderStatus, ProviderKeyStatus, MultiProviderStatusSchema, ProviderKeyStatusSchema exports)
    - apps/api/src/routes/keys.ts (full multi-provider refactor + PUT /active-provider)
    - apps/api/src/routes/settings.ts (active_provider in schema + strip all 3 key columns)

key-decisions:
  - "per-provider prefix validation (sk-ant-/sk-/AI) runs in keys.ts route before verify call — prefix differs per provider so route-level guard is simpler than schema refine"
  - "ApiKeyVerifyRequestSchema.key.min(10) not min(50) — sk-ant- keys are >=50 chars but gemini keys are shorter; prefix guard catches wrong-provider keys before SDK call"
  - "DELETE /api/keys accepts ?provider= query param defaulting to 'anthropic' — preserves D-12 (other providers' keys persist silently)"
  - "migration 0006 applied successfully via supabase db push (non-interactive, no auth gate needed)"

requirements-completed: [AI-01, AI-02, AI-10]

duration: 15min
completed: "2026-06-18"
---

# Phase 04 Plan 03: Multi-Provider Schema + Keys Routes Summary

**Migration 0006 renames encrypted_api_key -> anthropic_api_key and adds openai_api_key, gemini_api_key, active_provider with column-level REVOKE; keys.ts refactored to verify/store per provider with prefix guards; settings.ts exposes active_provider.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-18
- **Completed:** 2026-06-18
- **Tasks:** 3 (Task 1: migration + types, Task 2: db push, Task 3: route refactor)
- **Files modified:** 5

## Accomplishments

- Migration 0006 applied: creator_settings now has anthropic_api_key, openai_api_key, gemini_api_key, active_provider; column-level REVOKE on all three key columns from authenticated role (T-04-07)
- keys.ts fully multi-provider: POST /verify dispatches by provider with prefix guards, GET /status returns MultiProviderStatus, DELETE handles per-provider nulling, PUT /active-provider persists provider selection
- settings.ts extended: UpdateSettingsSchema accepts active_provider, GET/PUT select and strip all three key columns server-side

## Task Commits

Each task was committed atomically:

1. **Task 1: Write migration 0006 + extend api-key types** - `37131ed` (feat)
2. **Task 2: Push migration 0006 to database** - pushed successfully (non-interactive, no separate commit)
3. **Task 3: Refactor keys.ts + settings.ts for multi-provider** - `b0c90d1` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `supabase/migrations/0006_multi_provider_keys.sql` - Rename encrypted_api_key -> anthropic_api_key; add openai_api_key, gemini_api_key, active_provider; REVOKE SELECT on key columns from authenticated; GRANT SELECT on user_id, api_response_cap, active_provider, updated_at
- `packages/types/src/api-key.ts` - ApiKeyVerifyRequestSchema now includes `provider: ProviderSchema`; adds ProviderKeyStatusSchema, MultiProviderStatusSchema, MultiProviderStatus; CreatorSettingsSchema adds active_provider
- `packages/types/src/index.ts` - Re-exports ProviderKeyStatus, MultiProviderStatus, ProviderKeyStatusSchema, MultiProviderStatusSchema
- `apps/api/src/routes/keys.ts` - Full multi-provider refactor: POST /verify with prefix guards + provider dispatch; GET /status returning MultiProviderStatus; DELETE with ?provider= param; PUT /active-provider
- `apps/api/src/routes/settings.ts` - active_provider added to UpdateSettingsSchema; both GET and PUT select anthropic_api_key/openai_api_key/gemini_api_key and strip all three; no encrypted_api_key references

## Decisions Made

- **Per-provider prefix validation in route, not schema** — keys differ (sk-ant- >= 50 chars vs Gemini AI* shorter), so prefix checking stays in the route's switch/dispatch block rather than a single schema refine. Wrong-prefix returns 400 before any SDK call.
- **ApiKeyVerifyRequestSchema.key.min(10) not min(50)** — The original min(50) was Anthropic-specific. Gemini and OpenAI keys may be shorter. The prefix guard does the meaningful validation.
- **Migration pushed without auth gate** — `supabase db push` ran non-interactively with existing auth. No human checkpoint triggered. Documented as successful in situ.
- **DELETE defaults to 'anthropic' without ?provider=** — Preserves backward compatibility with existing clients that call DELETE without a provider query param.

## Deviations from Plan

None — plan executed exactly as written. The db push in Task 2 succeeded without requiring human authentication intervention, so the checkpoint:human-action gate was not triggered.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. Migration was applied automatically.

## Known Stubs

None. All routes are fully implemented. The `active_provider` column is populated in the database with default 'anthropic' for existing rows (migration DEFAULT constraint).

## Threat Flags

All STRIDE threats from the plan's threat model were applied:

| Threat ID | Status | Implementation |
|-----------|--------|----------------|
| T-04-07 | Mitigated | Migration 0006 REVOKEs SELECT on anthropic_api_key, openai_api_key, gemini_api_key from authenticated |
| T-04-08 | Mitigated | validateKeyPrefix() in keys.ts returns 400 if key prefix doesn't match provider |
| T-04-09 | Mitigated | PUT /active-provider uses requireAuth middleware; RLS from migration 0001 enforces auth.uid()=user_id |
| T-04-10 | Mitigated | Existing verifyRateLimit (5/min/user) applies to all provider verify calls — unchanged |
| T-04-11 | Mitigated | GET /status returns last4 only; encrypted blobs never exposed |

## Next Phase Readiness

- Plan 04 (settings UI + ai.ts route refactor) can now read `active_provider` from creator_settings and use `createAdapter(provider, apiKey)` to instantiate the correct adapter
- MultiProviderStatus is the response shape for the settings page provider selector
- All key columns are column-level locked — safe for Supabase client to query creator_settings without leaking keys

## Self-Check

- [x] supabase/migrations/0006_multi_provider_keys.sql exists with RENAME, ADD COLUMN, REVOKE, GRANT
- [x] packages/types/src/api-key.ts contains MultiProviderStatusSchema, ProviderKeyStatusSchema, active_provider in CreatorSettingsSchema
- [x] packages/types/src/index.ts exports MultiProviderStatus, MultiProviderStatusSchema
- [x] apps/api/src/routes/keys.ts contains verifyOpenAIKey, active-provider route, no encrypted_api_key
- [x] apps/api/src/routes/settings.ts contains active_provider in UpdateSettingsSchema, no encrypted_api_key
- [x] npx tsc --noEmit on packages/types: exit 0
- [x] npx tsc --noEmit on apps/api: exit 0
- [x] Commits 37131ed, b0c90d1 confirmed in git log

## Self-Check: PASSED
