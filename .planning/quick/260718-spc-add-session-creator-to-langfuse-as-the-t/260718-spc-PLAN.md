---
phase: quick-260718-spc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/lib/langfuse-user.ts
  - apps/api/src/lib/langfuse-user.test.ts
  - apps/api/src/routes/ai.ts
  - apps/api/src/lib/trigger-engine.ts
autonomous: true
requirements: [OBS-USER-01]

must_haves:
  truths:
    - "Every Langfuse trace for an AI call carries the session creator's identity as userId, so Langfuse user-tracking groups all of a session's generations under that person."
    - "userId is the creator's auth email when present, otherwise their username/display name, otherwise the creator_id UUID as a stable last-resort (never null/empty)."
    - "A Langfuse-identity lookup failure never aborts or degrades the AI turn."
  artifacts:
    - path: apps/api/src/lib/langfuse-user.ts
      provides: "resolveCreatorLangfuseUserId(supabase, creatorId) — email-first identity resolver, never-throw"
      exports: ["resolveCreatorLangfuseUserId"]
    - path: apps/api/src/lib/langfuse-user.test.ts
      provides: "Unit tests for email-first priority, username fallback, UUID last-resort, and error safety"
  key_links:
    - from: apps/api/src/routes/ai.ts
      to: "new CallbackHandler({ userId })"
      via: "resolveCreatorLangfuseUserId(supabase, session.creator_id)"
      pattern: "userId"
    - from: apps/api/src/lib/trigger-engine.ts
      to: "new CallbackHandler({ userId })"
      via: "resolveCreatorLangfuseUserId(supabase, session.creator_id) resolved once per session"
      pattern: "userId"
---

<objective>
Attach the session creator's identity to every Langfuse trace as `userId` so the
Langfuse Users feature (https://langfuse.com/docs/observability/features/users) can
track and group all AI generations belonging to a session under the person who created it.

Identity resolution, per the user's explicit instruction: use the creator's auth **email**
when available; otherwise the **username / display name**; otherwise fall back to the
`creator_id` UUID so `userId` is always a stable, non-empty value.

Purpose: enable per-user cost/usage attribution in Langfuse across both AI paths.
Output: one shared resolver + wiring into the two CallbackHandler trace-creation sites.
</objective>

<execution_context>
@/home/jgm/dev/projects/web-projects/panelito/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md

<interfaces>
<!-- Confirmed against the installed @langfuse/langchain@5.9.1 .d.ts. The CallbackHandler
     constructor already accepts a first-class userId. No metadata hack needed. -->

From @langfuse/langchain (CallbackHandler constructor params):
```typescript
type ConstructorParams = {
  userId?: string;
  sessionId?: string;
  tags?: string[];
  // ...
};
```

Existing creator-identity precedent — apps/api/src/routes/sessions.ts (GET /by-code/:code),
uses the Supabase service client admin API:
```typescript
const { data: adminUser } = await supabase.auth.admin.getUserById(session.creator_id)
// adminUser?.user?.email
// adminUser?.user?.user_metadata?.full_name
```
NOTE: sessions.ts orders full_name BEFORE email. This task deliberately REVERSES that
order (email first) per the user's explicit instruction for Langfuse user tracking.

Supabase client type import used in both target files:
```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
```

Trace site 1 — apps/api/src/routes/ai.ts ~line 367 (human-reactive path):
`session` already selects `creator_id` (line 78). Ownership gate guarantees the invoker
is the creator. CallbackHandler currently: `new CallbackHandler({ tags: [...] })`.

Trace site 2 — apps/api/src/lib/trigger-engine.ts ~line 300 (proactive silence-gate path):
`session.creator_id` is already loaded (select at line 189, used at line 229). The
CallbackHandler is constructed inside the per-branch loop within `scanSession`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create email-first Langfuse userId resolver with tests</name>
  <files>apps/api/src/lib/langfuse-user.ts, apps/api/src/lib/langfuse-user.test.ts</files>
  <behavior>
    resolveCreatorLangfuseUserId(supabase, creatorId): Promise&lt;string&gt;
    - Test 1: getUserById returns a user with an email → resolves to that email (email wins even when full_name is also present).
    - Test 2: user has no email but user_metadata.full_name present → resolves to full_name.
    - Test 3: user has no email and no full_name → resolves to the creatorId UUID (stable last-resort, never empty/null).
    - Test 4: supabase.auth.admin.getUserById throws OR returns { data: null } → resolves to the creatorId UUID (never-throw contract; the AI turn must not be affected).
  </behavior>
  <action>
    Create apps/api/src/lib/langfuse-user.ts exporting async
    `resolveCreatorLangfuseUserId(supabase: SupabaseClient, creatorId: string): Promise&lt;string&gt;`.
    Call `supabase.auth.admin.getUserById(creatorId)`. Resolution priority is strictly:
    (1) `data?.user?.email`, (2) `data?.user?.user_metadata?.full_name`, (3) `creatorId`.
    This email-first order is intentional and REVERSES the sessions.ts precedent — document
    that in a header comment referencing the user's Langfuse user-tracking requirement.
    Wrap the entire admin call in try/catch; on any thrown error OR missing data, return
    `creatorId` (never-throw, mirroring the never-throw contract already used by
    langfuse-generation.ts / langfuse-otel.ts). Treat empty-string / whitespace-only email
    and full_name as absent (trim before accepting). Write the four unit tests in
    langfuse-user.test.ts using vitest with a mocked supabase whose `auth.admin.getUserById`
    is a vi.fn() returning the shaped fixtures above.
  </action>
  <verify>
    <automated>cd apps/api && npx vitest run src/lib/langfuse-user.test.ts</automated>
  </verify>
  <done>All four tests pass; helper is exported and returns a non-empty string for every branch including the error path.</done>
</task>

<task type="auto">
  <name>Task 2: Wire creator userId into both CallbackHandler trace sites</name>
  <files>apps/api/src/routes/ai.ts, apps/api/src/lib/trigger-engine.ts</files>
  <action>
    Import `resolveCreatorLangfuseUserId` from '../lib/langfuse-user' (ai.ts) and
    './langfuse-user' (trigger-engine.ts).

    ai.ts (~line 367, human-reactive path): before constructing the CallbackHandler,
    `const langfuseUserId = await resolveCreatorLangfuseUserId(supabase, session.creator_id)`.
    Add `userId: langfuseUserId` to the existing `new CallbackHandler({ ... })` options
    alongside the current `tags`. Keep the existing tags unchanged.

    trigger-engine.ts (proactive silence-gate path): resolve identity ONCE per session, NOT
    per branch — `runSilenceScan` iterates many sessions/branches per tick, so a per-branch
    admin lookup would multiply auth calls. In `scanSession`, after the `providerCtx` guard
    (~line 230), add
    `const langfuseUserId = await resolveCreatorLangfuseUserId(supabase, session.creator_id)`.
    Then add `userId: langfuseUserId` to the per-branch `new CallbackHandler({ ... })`
    (~line 300) alongside its existing tags, reusing the single resolved value for every
    branch of that session.

    Do not change trace tags, thread_id, or any other CallbackHandler/graph config.
  </action>
  <verify>
    <automated>cd apps/api && npx tsc --noEmit && npx vitest run src/routes/ai.test.ts src/lib/trigger-engine.test.ts</automated>
  </verify>
  <done>Both CallbackHandler instances receive a `userId` sourced from the session creator (email-first); typecheck passes; existing ai.ts and trigger-engine test suites remain green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| server → Langfuse cloud | Trace payload now carries creator identity (email/username) as userId |
| server → Supabase auth admin API | Reads creator email/metadata via service-role getUserById |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-spc-01 | Information Disclosure | Creator email sent to Langfuse as userId | accept | userId to a first-party observability backend is the documented, intended Langfuse Users feature; no new external surface beyond the already-configured Langfuse project. Email is the creator's own identity, not third-party PII. |
| T-spc-02 | Denial of Service | auth.admin.getUserById failure/latency on the AI hot path | mitigate | Resolver is never-throw and returns creator_id UUID on any error; trigger-engine resolves once per session (not per branch) to bound auth-call volume. |
| T-spc-SC | Tampering | npm/pip/cargo installs | mitigate | No new dependencies added — reuses installed @langfuse/langchain@5.9.1 (userId is a first-class constructor param) and existing supabase-js admin API. |
</threat_model>

<verification>
- `npx vitest run src/lib/langfuse-user.test.ts` — all four resolver tests pass.
- `npx tsc --noEmit` in apps/api — clean.
- `grep -n "userId" apps/api/src/routes/ai.ts apps/api/src/lib/trigger-engine.ts` — both CallbackHandler sites pass userId.
- Existing ai.ts and trigger-engine test suites remain green.
</verification>

<success_criteria>
Both AI trace-creation paths (human-reactive /invoke and proactive silence-gate) attach the
session creator's identity to Langfuse as `userId`, preferring email, then username, then the
creator_id UUID — with a lookup failure never affecting the AI turn.
</success_criteria>

<output>
Create `.planning/quick/260718-spc-add-session-creator-to-langfuse-as-the-t/260718-spc-SUMMARY.md` when done.
</output>
