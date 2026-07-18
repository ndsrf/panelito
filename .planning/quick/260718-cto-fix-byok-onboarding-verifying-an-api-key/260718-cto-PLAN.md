---
phase: quick-260718-cto
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/routes/keys.ts
  - apps/api/src/routes/keys.test.ts
autonomous: true
requirements: [BYOK-FIX-ACTIVATE]

must_haves:
  truths:
    - "A brand-new creator who verifies an OpenAI (or Gemini) key ends up with active_provider set to that provider, not the 'anthropic' default"
    - "A returning creator who already has one provider keyed keeps their existing active_provider when they add a second provider key"
    - "Provider-key lookups (TriggerEngine, reactive AI turns) find a usable key immediately after first-key onboarding — no manual /settings visit required"
  artifacts:
    - path: "apps/api/src/routes/keys.ts"
      provides: "POST /verify auto-activates the verified provider on the creator's first-ever key"
      contains: "active_provider"
    - path: "apps/api/src/routes/keys.test.ts"
      provides: "Regression tests for first-key auto-activation and no-silent-override"
      contains: "active_provider"
  key_links:
    - from: "apps/api/src/routes/keys.ts POST /verify"
      to: "creator_settings.active_provider"
      via: "insert/update writes active_provider when no other provider key is set"
      pattern: "active_provider"
---

<objective>
Fix the BYOK onboarding gap: verifying an API key never activates it as the active provider. A new creator who enters only an OpenAI or Gemini key is left with `active_provider = 'anthropic'` (the DB default) and an empty `anthropic_api_key`, so every provider-key lookup silently fails until they manually visit `/settings`.

Fix location: `POST /api/keys/verify` (backend-only, approach (a) from the bug report). This is atomic (single round-trip, no client-side existence check), reuses the existing-row fetch already present in the route, and is fully testable at the route level as the constraints require. The onboarding form (`api-key-form.tsx`) is intentionally NOT touched — the backend owns the activation decision.

Purpose: A first-time creator becomes usable immediately after entering their first key, regardless of provider, without silently overriding a returning user's deliberate provider choice.

Output: Updated `keys.ts` route logic + regression tests in `keys.test.ts`.
</objective>

<execution_context>
@/home/jgm/dev/projects/web-projects/panelito/.claude/get-shit-done/workflows/execute-plan.md
@/home/jgm/dev/projects/web-projects/panelito/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@apps/api/src/routes/keys.ts
@apps/api/src/routes/keys.test.ts

<interfaces>
<!-- creator_settings key columns (migration 0006). Service-role read only. -->
<!-- Columns: anthropic_api_key, openai_api_key, gemini_api_key (text, nullable),
     active_provider (text, DEFAULT 'anthropic', CHECK IN anthropic|openai|gemini),
     api_response_cap (default 150), user_id, updated_at. -->

Current POST /verify persistence block (apps/api/src/routes/keys.ts ~lines 130-158):
- Selects only `user_id` from creator_settings to detect an existing row.
- `keyColumn = `${provider}_api_key``.
- If row exists: `.update({ [keyColumn]: encrypted })`.
- If no row: `.insert({ user_id, [keyColumn]: encrypted, api_response_cap: 150 })`.
- active_provider is never written — this is the bug.

verifyOpenAIKey / verifyGeminiKey are imported from '../lib/verify-key'.
verifyApiKey (anthropic) is imported from '../lib/anthropic' and is already vi.mock'd in keys.test.ts.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Auto-activate verified provider on first-ever key in POST /verify</name>
  <files>apps/api/src/routes/keys.ts</files>
  <behavior>
    - Fresh creator (no creator_settings row) verifies provider P → row inserted with active_provider = P.
    - Existing row with NO provider key columns populated (e.g. row created only by a cap change or a bare active-provider PUT) verifies provider P → active_provider updated to P.
    - Existing row where a DIFFERENT provider column is already populated verifies provider P → active_provider is NOT changed (returning user's deliberate choice preserved); only the P key column is written.
    - Re-verifying the same/only-keyed provider → active_provider stays that provider (harmless).
  </behavior>
  <action>
    In the persistence block of `POST /verify` (implements BYOK-FIX-ACTIVATE), widen the existing-row lookup: change the `.select('user_id')` to also fetch the three provider key columns (`anthropic_api_key, openai_api_key, gemini_api_key`). Compute a boolean `hasOtherProviderKey` = any provider column OTHER than the just-verified `provider` is non-null on the existing row.

    Insert path (no row exists): add `active_provider: provider` to the insert object alongside the existing `[keyColumn]` and `api_response_cap: 150`. This is the first-ever key, so the verified provider becomes active.

    Update path (row exists): build the update object as `{ [keyColumn]: encrypted }`, and additionally set `active_provider: provider` ONLY when `hasOtherProviderKey` is false (i.e. this is effectively the creator's first key even though a row already exists). When `hasOtherProviderKey` is true, do NOT include active_provider — never silently override a returning user's deliberate provider choice.

    Do not change the verification/rate-limit/prefix logic, the cap-preserving semantics, error handling, or the 200 `{ success: true }` response shape. Keep the change scoped to the persistence block only.
  </action>
  <verify>
    <automated>cd apps/api && npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <done>POST /verify writes active_provider = verified provider on insert and on an existing keyless row; leaves active_provider untouched when another provider is already keyed. Type-checks clean.</done>
</task>

<task type="auto">
  <name>Task 2: Regression tests for first-key auto-activation and no-silent-override</name>
  <files>apps/api/src/routes/keys.test.ts</files>
  <action>
    Add a new `describe('POST /api/keys/verify — active_provider activation', ...)` block that mocks `'../lib/verify-key'` (add a `vi.mock` for `verifyOpenAIKey`/`verifyGeminiKey` returning `{ ok: true }`, mirroring the existing `'../lib/anthropic'` mock pattern at the top of the file). Reuse the existing test user / JWT helpers.

    Test A (fresh creator, non-default provider — proves the bug fix): delete any existing `creator_settings` row for the test user, mock `verifyOpenAIKey` ok, POST `/api/keys/verify` with `{ provider: 'openai', key: 'sk-' + 'x'.repeat(40) }`. Assert 200. Then read `creator_settings` via the service client and assert `active_provider === 'openai'` AND `openai_api_key` is non-null. (The DB default is 'anthropic', so this fails without the fix.)

    Test B (returning user — proves no silent override): delete then seed a `creator_settings` row directly via the service client with `anthropic_api_key` set to any non-null placeholder, `active_provider: 'anthropic'`, `api_response_cap: 150`. Mock `verifyOpenAIKey` ok, POST `/api/keys/verify` with `{ provider: 'openai', key: 'sk-' + 'y'.repeat(40) }`. Assert 200. Then read the row and assert `active_provider` is STILL `'anthropic'` AND `openai_api_key` is now non-null.

    Clean up the seeded row in the block (or rely on the existing afterAll creator_settings delete). Use the multi-provider request shape (`{ provider, key }`) — do not copy the older single-key `{ key }` request shape used by some existing tests in this file.
  </action>
  <verify>
    <automated>cd apps/api && npx vitest run src/routes/keys.test.ts -t "activation"</automated>
  </verify>
  <done>Both new tests pass: fresh openai verify sets active_provider to 'openai'; verifying openai when anthropic already keyed leaves active_provider as 'anthropic' while persisting the openai key.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → POST /api/keys/verify | Authenticated creator submits a provider key; `requireAuth` + RLS (auth.uid()=user_id) enforce ownership |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-BYOK-01 | Elevation of Privilege | active_provider write in POST /verify | mitigate | active_provider is only ever set to the just-verified `provider` for the authenticated user's own row (service-role write scoped by `.eq('user_id', user.id)`); no cross-user write path introduced |
| T-BYOK-02 | Tampering | Silent override of a returning user's provider choice | mitigate | Update path sets active_provider only when no other provider key is populated; returning users with an existing keyed provider are never overridden |
| T-BYOK-03 | Information Disclosure | Reading provider key columns to compute hasOtherProviderKey | accept | Columns are read server-side via the existing service-role client and used only for a null/non-null check; encrypted blobs are never returned in the response (existing T-04-11 behavior unchanged) |

No package installs in this plan — package legitimacy gate not applicable.
</threat_model>

<verification>
- `cd apps/api && npx tsc --noEmit -p tsconfig.json` passes.
- `cd apps/api && npx vitest run src/routes/keys.test.ts -t "activation"` passes both new tests.
- Manual sanity (optional): a fresh account verifying only an OpenAI key can immediately trigger a reactive AI turn without visiting /settings.
</verification>

<success_criteria>
- POST /api/keys/verify sets `creator_settings.active_provider` to the verified provider on the creator's first-ever key (fresh row OR existing row with no other provider key set).
- POST /api/keys/verify leaves `active_provider` unchanged when another provider is already keyed.
- No Phase 14 files touched; scope limited to `keys.ts` + `keys.test.ts`.
- All new tests pass; existing behavior (verification, rate limit, prefix guard, cap preservation, response shape) unchanged.
</success_criteria>

<output>
Create `.planning/quick/260718-cto-fix-byok-onboarding-verifying-an-api-key/260718-cto-SUMMARY.md` when done.
</output>
