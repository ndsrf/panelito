---
phase: 01-live-session-shell
plan: 06
subsystem: api
tags: [byok, encryption, aes-256-gcm, anthropic-sdk, hono, next-js, onboarding, settings]

# Dependency graph
requires:
  - phase: 01-live-session-shell
    plan: 01
    provides: "creator_settings table, KEY_ENCRYPTION_SECRET env var"
  - phase: 01-live-session-shell
    plan: 02
    provides: "Google OAuth sign-in, Supabase session cookies"
  - phase: 01-live-session-shell
    plan: 03
    provides: "requireAuth middleware, session CRUD routes, requireUser"
  - phase: 01-live-session-shell
    plan: 04
    provides: "AnalyticsPanel with hasApiKey prop, workspace layout"
provides:
  - "AES-256-GCM encryptKey/decryptKey (apps/api/src/lib/crypto.ts)"
  - "verifyApiKey + assemblePromptArray with cache_control (apps/api/src/lib/anthropic.ts)"
  - "POST /api/keys/verify, GET /api/keys/status, DELETE /api/keys"
  - "GET/PUT /api/settings"
  - "POST /api/sessions/:id/invoke (Phase 1 scaffold — returns 501)"
  - "Migration 0002: encrypted_api_key column revoked from authenticated role"
  - "/onboarding/api-key focused gate (D-04)"
  - "/settings page with key management + cap config (D-05, D-06)"
  - "AnalyticsPanel wired to real has_api_key (D-07)"
affects: [phase-2, ai-streaming, prompt-caching, settings-management]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AES-256-GCM with random IV and auth tag — dot-separated base64 payload (iv.authTag.ciphertext)"
    - "Anthropic SDK verifyApiKey: maps AuthenticationError/RateLimitError to structured error codes"
    - "assemblePromptArray: MessageParam[] with cache_control ephemeral on last static prefix block (AI-11)"
    - "Column-level REVOKE in Postgres migration — service-role only reads encrypted_api_key"
    - "Cap-preserving upsert: key rotation only updates encrypted_api_key, never overwrites api_response_cap"
    - "middleware.ts sets x-pathname header → (protected)/layout.tsx reads it for /settings exception"
    - "server-only directive on creator-settings.ts prevents browser bundle import"

key-files:
  created:
    - apps/api/src/lib/crypto.ts
    - apps/api/src/lib/anthropic.ts
    - apps/api/src/lib/crypto.test.ts
    - apps/api/src/routes/keys.ts
    - apps/api/src/routes/settings.ts
    - apps/api/src/routes/ai.ts
    - apps/api/src/routes/keys.test.ts
    - supabase/migrations/0002_creator_settings_grants.sql
    - apps/web/app/(onboarding)/layout.tsx
    - apps/web/app/(onboarding)/onboarding/api-key/page.tsx
    - apps/web/app/(onboarding)/onboarding/api-key/api-key-form.tsx
    - apps/web/components/byok/api-key-form.tsx
    - apps/web/app/(protected)/settings/page.tsx
    - apps/web/app/(protected)/settings/settings-form.tsx
    - apps/web/lib/creator-settings.ts
  modified:
    - apps/api/src/index.ts
    - apps/web/app/(protected)/layout.tsx
    - apps/web/app/(protected)/sessions/[id]/page.tsx
    - apps/web/middleware.ts

key-decisions:
  - "ApiKeyForm extracted to @/components/byok/api-key-form so both onboarding gate and /settings modal share the same component without cross-route-group imports"
  - "Cap-preserving upsert: on key rotation, only encrypted_api_key is updated; api_response_cap is never overwritten"
  - "getKeyStatus() is a separate helper from getCreatorSettings() so /settings page can fetch last4 for masked display without adding it to the shared CreatorSettings type"
  - "assemblePromptArray returns a MessageParam[] with a single static prefix message (role: user, multiple content blocks) where the last block carries cache_control — this matches Anthropic's requirements for cache breakpoints at the end of the static prefix"
  - "Rate limit POST /api/keys/verify to 5/min/user in-memory (T-06-07)"

patterns-established:
  - "Worktree TypeScript checks: symlink main repo node_modules to worktree for tsc and vitest access"
  - "Integration tests: use supabase.auth.admin.createUser + signInWithPassword, clean up in afterAll"
  - "Server-only imports: server-only directive on line 1 of any file that must not ship to the browser"
  - "x-pathname header pattern: middleware sets it, Server Components read it via next/headers"

requirements-completed: [AI-01, AI-02, AI-10, AI-11]

# Metrics
duration: 23min
completed: 2026-06-12
---

# Phase 01 Plan 06: BYOK End-to-End Summary

**AES-256-GCM encrypted API key storage with Anthropic pre-verification, onboarding gate, /settings management, and prompt-caching scaffold ready for Phase 2 AI streaming**

## Performance

- **Duration:** 23 min
- **Started:** 2026-06-12T10:44:26Z
- **Completed:** 2026-06-12T11:07:30Z
- **Tasks:** 3 of 4 (Task 4 is a human verification checkpoint)
- **Files modified:** 20

## Accomplishments

- AES-256-GCM crypto module with random IV, auth tag detection, and 6 passing unit tests
- Hono API routes for BYOK key management: verify (AI-10 handshake before persist), status (last4 only, never the key), delete (cap-preserving); 9 integration tests passing
- Supabase migration revokes `encrypted_api_key` column from `authenticated` role (column-level lockdown, T-06-01)
- `/onboarding/api-key` post-OAuth gate: centered layout, masked input with eye toggle, Spanish inline error copy for invalid/rate-limited/network errors
- `/settings` page: masked key display, Actualizar / Desconectar actions, AI response cap numeric input (1–10000)
- `(protected)/layout.tsx` BYOK gate with `/settings` exception via `x-pathname` middleware header
- `assemblePromptArray` builds MessageParam[] with `cache_control: { type: 'ephemeral' }` at the static prefix end (AI-11 — Phase 2 plugs streaming invocation into this contract)
- AnalyticsPanel now receives real `has_api_key` from creator_settings (removes hardcoded `false`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Crypto helpers + Anthropic verify/prompt-caching scaffold + DB column grant migration** - `a824c87` (feat)
2. **Task 2: Hono /api/keys + /api/settings + /api/sessions/:id/invoke routes** - `5da177d` (feat)
3. **Task 3: Web — onboarding gate, settings page, layout redirect logic, AnalyticsPanel real key-state** - `638f526` (feat)

Task 4 (human verification checkpoint) is pending — see Checkpoint section below.

## Files Created/Modified

- `apps/api/src/lib/crypto.ts` - AES-256-GCM encryptKey/decryptKey, random IV, auth tag
- `apps/api/src/lib/anthropic.ts` - verifyApiKey (error class mapping) + assemblePromptArray (AI-11 cache breakpoint)
- `apps/api/src/lib/crypto.test.ts` - 6 crypto unit tests (round-trip, tamper, wrong key, random IV)
- `apps/api/src/routes/keys.ts` - POST /verify, GET /status, DELETE /; rate-limited 5/min/user
- `apps/api/src/routes/settings.ts` - GET/PUT /api/settings; has_api_key computed server-side
- `apps/api/src/routes/ai.ts` - POST /api/sessions/:id/invoke scaffold (501 + cache_breakpoint_position)
- `apps/api/src/routes/keys.test.ts` - 9 integration tests (5 keys + 3 settings + 1 AI scaffold)
- `apps/api/src/index.ts` - Mount keysRouter, settingsRouter, aiRouter
- `supabase/migrations/0002_creator_settings_grants.sql` - REVOKE encrypted_api_key from authenticated
- `apps/web/app/(onboarding)/layout.tsx` - Minimal centered layout for onboarding gate
- `apps/web/app/(onboarding)/onboarding/api-key/page.tsx` - D-04 gate page
- `apps/web/components/byok/api-key-form.tsx` - Shared masked input form (onboarding + settings modal)
- `apps/web/app/(protected)/settings/page.tsx` - D-05 dedicated settings route
- `apps/web/app/(protected)/settings/settings-form.tsx` - Key mgmt + cap config client component
- `apps/web/lib/creator-settings.ts` - server-only; getCreatorSettings + getKeyStatus helpers
- `apps/web/app/(protected)/layout.tsx` - Added BYOK gate with /settings exception
- `apps/web/app/(protected)/sessions/[id]/page.tsx` - Real hasApiKey from creator_settings
- `apps/web/middleware.ts` - Sets x-pathname header for layout route detection

## Decisions Made

- `ApiKeyForm` moved to `@/components/byok/api-key-form` to avoid cross-route-group imports between `(onboarding)` and `(protected)` layout groups
- `getKeyStatus()` is a separate server helper from `getCreatorSettings()` so the `last4` field is fetched for /settings display without modifying the `CreatorSettings` shared type
- Cap-preserving upsert: key rotation only updates `encrypted_api_key`, never overwrites `api_response_cap`
- `assemblePromptArray` uses a single "user" message with multiple content blocks for the static prefix — the last block carries `cache_control: { type: 'ephemeral' }`, which is the standard Anthropic pattern for prompt caching
- Rate limit POST /api/keys/verify to 5/min/user using in-memory token buckets (T-06-07)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `noUncheckedIndexedAccess` TypeScript errors in crypto.test.ts and crypto.ts**
- **Found during:** Task 1 (TypeScript check)
- **Issue:** `parts[2]` and array destructuring produced `string | undefined` in strict TS; `Buffer.from(parts[2], ...)` failed to type check
- **Fix:** Added explicit null-guard checks before Buffer.from calls; used `?? ''` in test file
- **Files modified:** apps/api/src/lib/crypto.ts, apps/api/src/lib/crypto.test.ts
- **Verification:** tsc --noEmit passes with zero errors
- **Committed in:** a824c87

**2. [Rule 1 - Bug] Fixed session creation in keys.test.ts (short_code not-null constraint)**
- **Found during:** Task 2 (integration test RED run)
- **Issue:** Test setup inserted session without `short_code` — Postgres constraint violation
- **Fix:** Generated a valid 6-char Crockford base32 short_code in beforeAll
- **Files modified:** apps/api/src/routes/keys.test.ts
- **Verification:** All 9 tests pass
- **Committed in:** 5da177d

**3. [Rule 1 - Bug] Fixed `res.json()` typed as `unknown` in strict TypeScript test file**
- **Found during:** Task 2 (TypeScript check after writing tests)
- **Issue:** Strict TS doesn't allow property access on `unknown`; `body.has_api_key` etc. failed
- **Fix:** Added `jsonAs<T>(res)` helper to cast json responses; added explicit type parameters
- **Files modified:** apps/api/src/routes/keys.test.ts
- **Verification:** tsc --noEmit passes with zero errors for route files
- **Committed in:** 5da177d

**4. [Rule 2 - Missing Critical] Added getKeyStatus() server helper**
- **Found during:** Task 3 (implementing settings-form with last4 display)
- **Issue:** `CreatorSettings` type intentionally omits `last4` (it's from /api/keys/status, not /api/settings). The settings page needs `last4` for masked key display.
- **Fix:** Added `getKeyStatus()` to `creator-settings.ts` that calls `/api/keys/status`; settings page fetches both in parallel
- **Files modified:** apps/web/lib/creator-settings.ts, apps/web/app/(protected)/settings/page.tsx
- **Verification:** TypeScript clean; next build passes
- **Committed in:** 638f526

**5. [Rule 3 - Blocking] Moved ApiKeyForm to shared @/components/byok/ to resolve cross-route-group import error**
- **Found during:** Task 3 (TypeScript build check)
- **Issue:** `settings-form.tsx` importing from `app/(onboarding)/...` path fails — Next.js route groups cannot be cross-imported by sibling groups
- **Fix:** Moved canonical implementation to `apps/web/components/byok/api-key-form.tsx`; onboarding re-exports it
- **Files modified:** apps/web/components/byok/api-key-form.tsx (new), apps/web/app/(onboarding)/onboarding/api-key/api-key-form.tsx (re-export), apps/web/app/(protected)/settings/settings-form.tsx (updated import)
- **Verification:** tsc --noEmit and next build both pass
- **Committed in:** 638f526

---

**Total deviations:** 5 auto-fixed (2 Rule 1 bugs, 1 Rule 2 missing critical, 2 Rule 3 blocking)
**Impact on plan:** All auto-fixes necessary for correctness and TypeScript strict-mode compliance. No scope creep.

## Issues Encountered

- **Worktree node_modules**: The worktree has no `node_modules` by default. Resolved by symlinking the main repo's `node_modules` into the worktree directories (api, web, packages/types) for TypeScript and vitest to work. This is a worktree execution environment concern, not a code issue.

## Checkpoint: Task 4 — Human Verification Required

**Status:** PENDING — checkpoint reached after Tasks 1-3 complete.

**What was built:** Full BYOK end-to-end flow including encryption, API routes, onboarding gate, settings page. All automated tests pass. Next.js build is clean.

**Human verification required for:**
- Real Anthropic API key verification (AI-10 — cannot fake api.anthropic.com responses in CI)
- Visual verification of the onboarding gate layout (D-04)
- Column-level RLS check via Supabase Studio (T-06-01)
- Cap update persistence (D-06)

See the checkpoint details in the plan's Task 4 `<how-to-verify>` section for the full 17-step verification walkthrough.

## Known Stubs

- `POST /api/sessions/:id/invoke` returns `501 Not Implemented` with a scaffolded shape. This is intentional per plan — Phase 2 replaces the body with the actual Claude streaming call. The contract (prompt_array_length, cache_breakpoint_position) is locked in place.

## Threat Flags

None — all threat mitigations from the plan's `<threat_model>` are implemented:
- T-06-01: Migration 0002 revokes `encrypted_api_key` from `authenticated` role ✓
- T-06-02: No route returns the encrypted blob — only `has_api_key` + `last4` ✓
- T-06-03: verifyApiKey logs only `error.constructor.name`, never the key ✓
- T-06-04: AES-256-GCM auth tag — any tamper causes decryptKey to throw ✓
- T-06-06: All routes filter by `c.get('user').id` ✓
- T-06-07: POST /verify rate-limited 5/min/user ✓
- T-06-08: `import 'server-only'` on creator-settings.ts ✓
- T-06-09: AI-11 comment in assemblePromptArray warns against non-deterministic cache prefix ✓

## Next Phase Readiness

- Phase 2 can plug into `assemblePromptArray` — the MessageParam[] with cache_control breakpoint is ready
- `POST /api/sessions/:id/invoke` body is marked for Phase 2 replacement with SSE streaming
- All BYOK infrastructure is complete — Phase 2 only needs to decrypt the key and call Anthropic

## Self-Check: PASSED

Files exist:
- apps/api/src/lib/crypto.ts ✓
- apps/api/src/lib/anthropic.ts ✓
- apps/api/src/routes/keys.ts ✓
- apps/api/src/routes/settings.ts ✓
- apps/api/src/routes/ai.ts ✓
- supabase/migrations/0002_creator_settings_grants.sql ✓
- apps/web/components/byok/api-key-form.tsx ✓
- apps/web/lib/creator-settings.ts ✓
- apps/web/app/(protected)/settings/page.tsx ✓
- apps/web/app/(onboarding)/onboarding/api-key/page.tsx ✓

Commits exist:
- a824c87 (Task 1) ✓
- 5da177d (Task 2) ✓
- 638f526 (Task 3) ✓

---
*Phase: 01-live-session-shell*
*Completed: 2026-06-12*
