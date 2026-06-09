---
phase: 01-live-session-shell
plan: 02
subsystem: auth
tags: [supabase, oauth, google, nextjs, playwright, middleware, server-components, ssr, protected-routes]

# Dependency graph
requires:
  - phase: 01-live-session-shell
    plan: 01
    provides: "@supabase/ssr + @supabase/supabase-js installed, createBrowserClient/createServerClient factories, middleware skeleton, Supabase local stack running"
provides:
  - "Google OAuth sign-in page at /auth/sign-in (UI-SPEC Screen 1)"
  - "apps/web/lib/auth.ts with getUser, requireUser, signOut server-only helpers"
  - "apps/web/middleware.ts extended: auth gate redirects unauthenticated users to /auth/sign-in"
  - "apps/web/app/auth/callback/route.ts: OAuth code exchange via exchangeCodeForSession"
  - "apps/web/app/(protected)/layout.tsx: requireUser() server-side gate for protected routes"
  - "apps/web/app/(protected)/page.tsx: placeholder protected page showing user email"
  - "apps/web/components/auth/google-sign-in-button.tsx: client component with signInWithOAuth"
  - "apps/web/playwright.config.ts + e2e/sign-in.spec.ts: E2E test suite for OAuth slice"
  - "SESS-01: Creator can sign in via Google OAuth"
affects:
  - "01-03 (protected workspace shell — uses requireUser and (protected) layout)"
  - "01-04 (BYOK onboarding — middleware will add onboarding gate after this pattern)"
  - "all subsequent plans that use requireUser() or the (protected) route group"

# Tech tracking
tech-stack:
  added:
    - "@playwright/test@1.51.1 (E2E test runner — upgraded from plan's 1.49.x to satisfy Next.js 15.5.19 peer dep)"
  patterns:
    - "server-only guard: import 'server-only' on line 1 of lib/auth.ts prevents client-bundle imports"
    - "requireUser() gate pattern: call at top of protected layout — throws via redirect() if unauthenticated"
    - "OAuth callback flow: exchangeCodeForSession in route handler, redirect to clean URL (no ?code in Referer)"
    - "Fail-closed middleware: try/catch around auth check; on error treats user as unauthenticated"
    - "Route groups: (protected) group applies requireUser without affecting URL paths; auth/ is plain path for /auth/sign-in"

key-files:
  created:
    - "apps/web/lib/auth.ts — server-only getUser/requireUser/signOut helpers"
    - "apps/web/app/auth/sign-in/page.tsx — Sign-in page (Display 28px wordmark, tagline, Google CTA)"
    - "apps/web/app/auth/callback/route.ts — OAuth code→session exchange route handler"
    - "apps/web/app/(protected)/layout.tsx — Protected layout with requireUser() server gate"
    - "apps/web/app/(protected)/page.tsx — Placeholder authenticated home showing user email"
    - "apps/web/components/auth/google-sign-in-button.tsx — Client component with signInWithOAuth"
    - "apps/web/playwright.config.ts — Playwright config (mobile-first Pixel 5, baseURL localhost:3000)"
    - "apps/web/e2e/sign-in.spec.ts — 3 E2E tests (redirect, button, Google handoff; 1 skipped)"
  modified:
    - "apps/web/middleware.ts — Added auth gate: unauthenticated → /auth/sign-in; fail-closed try/catch"
    - "apps/web/package.json — Added @playwright/test@1.51.1, test:e2e + test:e2e:install scripts"
  deleted:
    - "apps/web/app/page.tsx — Replaced by (protected)/page.tsx under auth gate"

key-decisions:
  - "@playwright/test 1.51.1 instead of 1.49.x: Next.js 15.5.19 requires ^1.51.1 as peer dependency"
  - "Route structure: app/auth/sign-in/page.tsx (not (auth)/sign-in) — route groups strip path segments, so (auth) would map to /sign-in not /auth/sign-in"
  - "Deleted .next cache before tsc --noEmit to clear stale typedRoutes types from old app/page.tsx"

patterns-established:
  - "getUser() and requireUser() from lib/auth.ts are the canonical server-side auth gates for all pages"
  - "Protected pages use app/(protected)/ route group — layout calls requireUser() once, all pages in group are gated"
  - "OAuth callback handler: always redirect to clean URL after exchange to prevent ?code Referer leak"

requirements-completed:
  - SESS-01

# Metrics
duration: 47min
completed: 2026-06-09
---

# Phase 1 Plan 02: Google OAuth Sign-In Slice Summary

**Supabase Google OAuth slice with Next.js middleware auth gate, server-only requireUser() helper, and Playwright E2E test suite — SESS-01 complete pending human OAuth verification**

## Performance

- **Duration:** ~47 min
- **Started:** 2026-06-09T19:57:38Z
- **Completed:** 2026-06-09T20:45:00Z
- **Tasks:** 2/3 complete (Task 3 is a human checkpoint — pending)
- **Files modified:** 9 (including 1 deleted)

## Accomplishments

- Full Google OAuth sign-in slice: sign-in page, callback route, protected layout, server auth helpers
- Middleware updated with auth gate: unauthenticated requests → /auth/sign-in (fail-closed, T-02-05)
- `lib/auth.ts` with `getUser()`, `requireUser()`, `signOut()` — server-only, `import 'server-only'` enforced
- Playwright E2E test suite added: redirect test and button visibility test pass GREEN; OAuth handoff test awaits Google credentials
- `app/(protected)/layout.tsx` established as the canonical protected route group for all future plans

## Task Commits

1. **Task 1: Failing E2E test (RED)** — `044f1a8` (test)
2. **Task 2: Google OAuth slice implementation (GREEN)** — `0d30369` (feat)
3. **Task 3: Human verification checkpoint** — PENDING (awaiting developer verification)

## Files Created/Modified

- `apps/web/lib/auth.ts` — Server-only auth helpers (getUser, requireUser, signOut)
- `apps/web/middleware.ts` — Auth gate added (unauthenticated → /auth/sign-in, fail-closed)
- `apps/web/app/auth/sign-in/page.tsx` — Sign-in page with Panelito wordmark and Google CTA
- `apps/web/app/auth/callback/route.ts` — OAuth callback: exchangeCodeForSession, clean redirect
- `apps/web/app/(protected)/layout.tsx` — Server-side requireUser() gate for protected routes
- `apps/web/app/(protected)/page.tsx` — Placeholder: "Signed in as <email>"
- `apps/web/components/auth/google-sign-in-button.tsx` — Client: signInWithOAuth(google)
- `apps/web/playwright.config.ts` — Playwright: mobile-first Pixel 5, baseURL localhost:3000
- `apps/web/e2e/sign-in.spec.ts` — E2E: redirect, button, Google handoff (1 skipped for CI)
- `apps/web/package.json` — @playwright/test@1.51.1, test:e2e scripts

## Decisions Made

- **@playwright/test 1.51.1**: Plan specified 1.49.x but Next.js 15.5.19 requires `^1.51.1` as peer dep. Upgraded to satisfy peer constraint.
- **Route structure fix**: Plan specified `app/(auth)/sign-in/page.tsx` but Next.js route groups `(group)` strip the segment from the URL path — this would have mapped to `/sign-in` not `/auth/sign-in`. Fixed to `app/auth/sign-in/page.tsx` for correct `/auth/sign-in` URL.
- **Deleted .next cache**: stale typedRoutes types from deleted `app/page.tsx` caused false TypeScript errors until cache was cleared.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] @playwright/test version mismatch with Next.js 15.5.19**
- **Found during:** Task 1 (pnpm install)
- **Issue:** Plan specified `@playwright/test@1.49.x` but Next.js 15.5.19 declares `peerDependencies: { "@playwright/test": "^1.51.1" }` — 1.49.x fails the peer check
- **Fix:** Installed `@playwright/test@1.51.1` (minimum satisfying version for the peer constraint)
- **Files modified:** `apps/web/package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm install` exits 0 with no peer warnings
- **Committed in:** `044f1a8`

**2. [Rule 1 - Bug] Next.js route group (auth) strips path segment — /sign-in not /auth/sign-in**
- **Found during:** Task 2 (build verification)
- **Issue:** `app/(auth)/sign-in/page.tsx` with route group `(auth)` maps to `/sign-in` not `/auth/sign-in`. Next.js generated route type `/sign-in` in .next/types, causing `redirect('/auth/sign-in')` to fail type checking and the E2E test to fail (redirect went to wrong path)
- **Fix:** Moved `sign-in/page.tsx` from `app/(auth)/sign-in/` to `app/auth/sign-in/` — a plain path segment produces the correct `/auth/sign-in` URL
- **Files modified:** Renamed directory structure in `apps/web/app/`
- **Verification:** `next build` shows `/auth/sign-in` as a static route; E2E test 1 passes
- **Committed in:** `0d30369`

**3. [Rule 1 - Bug] Stale .next typedRoutes cache from deleted app/page.tsx**
- **Found during:** Task 2 (tsc --noEmit after build)
- **Issue:** Deleted `app/page.tsx` but `.next/types/app/page.ts` still referenced the old file, causing TypeScript errors on clean tsc run
- **Fix:** Deleted `.next` directory to force full regeneration of type cache
- **Files modified:** `.next/` (deleted, then rebuilt by Next.js)
- **Verification:** `pnpm --filter @panelito/web exec tsc --noEmit` exits 0
- **Committed in:** `0d30369`

---

**Total deviations:** 3 auto-fixed (3 Rule 1 bugs)
**Impact on plan:** All three fixes required for correct URL routing and TypeScript compliance. No scope creep.

## Issues Encountered

- Dev server needed multiple restarts during development due to port 3000 conflicts from background pnpm processes. No file changes required.
- Sign-in page returned 404 from a running dev server that was started before the route files were created — fixed by restarting the dev server.

## Known Stubs

- `apps/web/app/(protected)/page.tsx` — "Signed in as {email}. Workspace coming in Plan 03." Intentional stub: this plan's goal is the auth slice, not the workspace. Plan 03 replaces this page.

## Threat Flags

No new threat surface beyond the plan's threat model (T-02-01 through T-02-SC). All mitigations applied:
- `import 'server-only'` (T-02-06) ✓
- `exchangeCodeForSession` not hand-rolled (T-02-01) ✓
- Callback redirects to clean URL (T-02-03) ✓
- Middleware fail-closed try/catch (T-02-05) ✓

## Human Checkpoint Status

**Task 3 PENDING — Developer must verify Google OAuth round trip manually.**

Prerequisites:
1. Google Cloud Console OAuth client configured with `http://127.0.0.1:54321/auth/v1/callback` as authorized redirect URI
2. `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID` and `GOTRUE_EXTERNAL_GOOGLE_SECRET` set in `supabase/config.toml`
3. Supabase restarted with `supabase stop && supabase start`

Verification steps (from plan):
1. `pnpm dev` running
2. Open http://localhost:3000 in private/incognito window
3. Confirm redirect to /auth/sign-in
4. Confirm "Continue with Google" button visible (48px, outlined)
5. Click → Google account picker appears
6. Pick account → redirected to http://localhost:3000/
7. Page shows "Signed in as <your email>"
8. Hard-reload → still signed in
9. Supabase Studio http://localhost:54323 → Auth → Users → account listed

Resume: type "approved" on success, or paste failure notes.

## Next Phase Readiness

- `/auth/sign-in`, OAuth callback, and `requireUser()` gate: ready
- `app/(protected)/` route group: ready for Plan 03 workspace shell
- `lib/auth.ts` helpers: ready for all subsequent plans
- E2E test suite: tests 1+2 pass; test 3 passes once Google OAuth configured

---
*Phase: 01-live-session-shell*
*Completed: 2026-06-09 (checkpoint pending)*
