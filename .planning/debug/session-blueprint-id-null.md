---
status: diagnosed
trigger: "After migration 0008_nsai_foundation.sql was applied, sessions now require a NOT NULL blueprint_id FK column. The session creation endpoint still submits null for blueprint_id, causing a DB constraint violation and breaking session creation."
created: 2026-07-01T00:00:00Z
updated: 2026-07-01T00:00:00Z
symptoms_prefilled: true
goal: find_root_cause_only
---

## Current Focus

hypothesis: CONFIRMED — API INSERT omits blueprint_id entirely, and SessionCreateInputSchema has no blueprint_id field, so neither the frontend nor the backend ever submits it
test: Read sessions.ts route, SessionCreateInputSchema, new-session-form.tsx
expecting: blueprint_id absent from INSERT object in sessions.ts
next_action: ROOT CAUSE FOUND — returning diagnosis

## Symptoms

expected: Sessions created successfully with blueprint_id populated
actual: DB constraint violation — NOT NULL constraint on blueprint_id FK column violated during session creation
errors: NOT NULL constraint violation on sessions.blueprint_id
reproduction: Call session creation endpoint without blueprint_id in payload
started: After migration 0008_nsai_foundation.sql was applied

## Eliminated

## Evidence

- timestamp: 2026-07-01T00:01:00Z
  checked: supabase/migrations/0008_nsai_foundation.sql Section 6
  found: "ALTER TABLE public.sessions ADD COLUMN blueprint_id text NOT NULL REFERENCES public.domain_blueprints(id) ON DELETE RESTRICT"
  implication: blueprint_id is strictly NOT NULL with FK to domain_blueprints; only valid value in seeded data is 'debate-strategy-v1'

- timestamp: 2026-07-01T00:02:00Z
  checked: apps/api/src/routes/sessions.ts lines 76-84 (POST / handler INSERT object)
  found: INSERT includes {creator_id, title, mode, active_personas, short_code} — blueprint_id is completely absent
  implication: Every session creation call will violate the NOT NULL constraint immediately

- timestamp: 2026-07-01T00:03:00Z
  checked: packages/types/src/session.ts — SessionCreateInputSchema
  found: Schema has {title, mode, active_personas} only — no blueprint_id field
  implication: Validation layer strips blueprint_id even if the frontend were to send it; no way for caller to supply it

- timestamp: 2026-07-01T00:04:00Z
  checked: apps/web/app/(protected)/sessions/new/new-session-form.tsx onSubmit
  found: Sends JSON.stringify(data) where data is typed as SessionCreateInput — no blueprint_id field exists in the form or the type
  implication: Frontend also has no mechanism to send blueprint_id

- timestamp: 2026-07-01T00:05:00Z
  checked: packages/types/src/session.ts — SessionSchema (the full response type)
  found: SessionSchema does not include blueprint_id field either
  implication: The shared type package is entirely unaware of the new column; response parsing would also silently strip it

## Resolution

root_cause: The POST /api/sessions INSERT statement in apps/api/src/routes/sessions.ts omits blueprint_id entirely. Migration 0008 added blueprint_id as NOT NULL with a single valid seed value ('debate-strategy-v1'), but neither SessionCreateInputSchema, the INSERT object in the route handler, nor the frontend form were updated to include it.
fix:
verification:
files_changed: []
