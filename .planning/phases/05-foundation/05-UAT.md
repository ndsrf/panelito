---
status: diagnosed
phase: 05-foundation
source: [05-01-SUMMARY.md, 05-02-SUMMARY.md, 05-03-SUMMARY.md, 05-04-SUMMARY.md]
started: 2026-07-01T00:00:00Z
updated: 2026-07-01T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, the migration (0008_nsai_foundation.sql) is already applied (or applies cleanly), and a basic API call (e.g. health check or GET /api/sessions) returns live data without SUPABASE_DIRECT_URL env errors or missing-table errors.
result: issue
reported: "the server starts, but if I try to create a session I get an error because the blueprint_id is null"
severity: major

### 2. NSAI Database Tables Exist
expected: In Supabase dashboard (or via psql/Supabase Studio), confirm three new tables exist: domain_blueprints, canvas_nodes, and canvas_edges. The langgraph schema should also exist.
result: pass

### 3. Blueprint Seed Data
expected: Query SELECT id, canvas_view_mode FROM domain_blueprints returns at least one row with id = 'debate-strategy-v1' and canvas_view_mode = 'graph'. The definition jsonb column should contain 4 node_types, 4 edge_types, and 3 phase_sequence entries.
result: pass

### 4. Blueprint Loader — All Tests Pass
expected: Running the verify-blueprint-loader.ts script prints "ALL TESTS PASSED". Test A loads 'debate-strategy-v1', Test B throws "Blueprint not found:" for nonexistent id, Test C succeeds as a cache hit.
result: pass

### 5. TypeScript Build — All Packages
expected: pnpm --filter @panelito/types build, pnpm --filter @panelito/api typecheck, and pnpm --filter @panelito/web typecheck each exit 0 with no TypeScript errors.
result: pass

## Summary

total: 5
passed: 4
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Existing session creation continues to work after blueprint_id NOT NULL FK is added"
  status: resolved
  reason: "User reported: the server starts, but if I try to create a session I get an error because the blueprint_id is null"
  severity: major
  test: 1
  root_cause: "INSERT in apps/api/src/routes/sessions.ts (lines 78-84) omits blueprint_id entirely; SessionCreateInputSchema in packages/types/src/session.ts also lacks the field so it would be stripped by Zod even if sent"
  artifacts:
    - path: "apps/api/src/routes/sessions.ts"
      issue: "INSERT object omits blueprint_id — direct cause of NOT NULL constraint violation"
    - path: "packages/types/src/session.ts"
      issue: "SessionCreateInputSchema and SessionSchema both missing blueprint_id field"
    - path: "apps/web/app/(protected)/sessions/new/new-session-form.tsx"
      issue: "No blueprint_id in form or its type — downstream of type package gap"
  missing:
    - "Hard-code blueprint_id: 'debate-strategy-v1' in the sessions.ts INSERT (v1 minimal fix — only one seeded blueprint)"
    - "Add blueprint_id: z.string() to SessionSchema in packages/types/src/session.ts for type accuracy"
  debug_session: ".planning/debug/session-blueprint-id-null.md"
