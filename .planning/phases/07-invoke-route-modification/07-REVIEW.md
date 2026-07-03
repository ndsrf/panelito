---
phase: 07-invoke-route-modification
reviewed: 2026-07-03T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - apps/api/src/graph/state.ts
  - apps/api/src/graph/nodes/agent.ts
  - apps/api/src/graph/nodes/drift-reply.ts
  - apps/api/src/graph/nodes/orchestrator.ts
  - apps/api/src/lib/env.ts
  - apps/api/src/routes/ai.ts
  - apps/api/src/routes/ai.test.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-07-03
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed the Phase 7 LangGraph-backed AI invoke route and associated graph nodes. The code is generally well-structured with thoughtful comments mapping implementation decisions to spec identifiers. Several critical and warning-level issues were found.

The most severe finding is a missing session ownership gate: the route fetches the authenticated user but never compares `user.id` to `session.creator_id`, allowing any authenticated user to invoke AI against any session they do not own. This directly contradicts the stated security requirement T-02-05.

Secondary concerns include: a silent incorrect-state report in `driftReplyNode` on adapter failure, a missing runtime validation for `providerName` from the database, a context-stripping design in drift replies, and a test mock that uses the wrong LangGraph chunk shape — which means the `canvasOps` accumulation path tested by the mock does not reflect the real graph's output shape.

---

## Critical Issues

### CR-01: Session ownership gate (T-02-05) is not enforced

**File:** `apps/api/src/routes/ai.ts:65`

**Issue:** The route retrieves the authenticated user on line 65 (`const user = c.get('user')`) but the variable is never used again. The comment at line 20 and the section header at line 70 both claim that T-02-05 ("creator_id === user.id → else 403") is implemented, but there is no comparison and no 403 response. The route queries sessions by `session_id` only (line 75), then proceeds without verifying that `session.creator_id` matches `user.id`. Any authenticated user who knows or guesses a session UUID can invoke the AI using that session's creator's API key, burn through that creator's cap, and receive a full AI response — including a DB-stored message attributed to the session creator.

The service-role Supabase client (`createServiceClient()`) bypasses RLS, so no database-level protection substitutes for the missing check.

**Fix:**
```typescript
// After line 81 (after !session check), add:
if (session.creator_id !== user.id) {
  return c.json({ error: 'forbidden' }, 403)
}
```

---

## Warnings

### WR-01: `driftReplyNode` returns `driftAction: 'replied'` on adapter error

**File:** `apps/api/src/graph/nodes/drift-reply.ts:63-68`

**Issue:** The `catch` block at line 63 logs the error but does not return early. Execution falls through to line 68 (`return { driftAction: 'replied' }`), which reports that a drift reply was sent even when `adapter.stream()` threw and no tokens were ever written to the SSE stream. This produces a false observability signal: Langfuse traces will record `driftAction: 'replied'` for failed drift attempts.

While this does not corrupt the DB (the route's `accumulatedText.length === 0` guard prevents an empty INSERT), it makes post-hoc debugging of failed drift replies impossible from trace data alone.

**Fix:**
```typescript
  } catch (err) {
    console.error('[drift-reply] adapter.stream error', err)
    return { driftAction: 'ignored' }  // stream failed — no reply was actually sent
  }

  return { driftAction: 'replied' }
```

### WR-02: `driftReplyNode` strips conversation context from the LLM call

**File:** `apps/api/src/graph/nodes/drift-reply.ts:52`

**Issue:** The drift-reply LLM call passes only `[lastMessage]` (a single-element array) to `adapter.stream()`. The full `state.messages` conversation history is available but is not passed. This means the drift reply is generated without any context from prior exchanges — the LLM sees only the triggering message. For a drift reply to be genuinely helpful and coherent in a group conversation, it needs the full history.

**Fix:**
```typescript
// Replace [lastMessage] with state.messages for full context
for await (const event of adapter.stream(state.messages, [], {
  model: 'claude-sonnet-4-6',
  maxTokens: 512,
  system: systemPrompt,
})) {
```

### WR-03: `providerName` from database is cast without runtime validation

**File:** `apps/api/src/routes/ai.ts:169`

**Issue:** `creatorSettings?.active_provider` is a raw database string cast directly to `ProviderName` with `as ProviderName` without any Zod or runtime validation. If the database contains an unexpected value (e.g., due to a bug in the settings write path, a migration, or direct DB manipulation), `providerName` will be an invalid value at runtime. The template literal on line 172 (`${providerName}_api_key`) would access a key that doesn't exist in `creatorSettings`, returning `undefined` and falling into the `no_api_key` 400 path — so there is no crash risk. However, downstream calls to `createAdapter(providerName, ...)` and `TASK_MODELS[providerName]` would fail silently or throw with misleading errors.

**Fix:**
```typescript
import { ProviderSchema } from '@panelito/types'

const rawProvider = creatorSettings?.active_provider ?? 'anthropic'
const providerParseResult = ProviderSchema.safeParse(rawProvider)
if (!providerParseResult.success) {
  console.error('[ai] invalid active_provider in DB:', rawProvider)
  return c.json({ error: 'server_error' }, 500)
}
const providerName = providerParseResult.data
```

### WR-04: Test mock yields "updates"-mode chunks; real LangGraph graph uses "values" mode

**File:** `apps/api/src/routes/ai.test.ts:94`

**Issue:** The `createGraph` mock at line 94 yields `{ agent: { canvasOps: [] } }` — a node-keyed partial state object, which is the shape LangGraph emits in `"updates"` stream mode. However, the production `graph.stream()` call (without an explicit `streamMode` option) defaults to `"values"` mode, which emits the **full** state object (with top-level keys) after every node completes. The production code reads `(finalState as any)?.canvasOps?.length` (line 356), which works correctly with "values"-mode output because `canvasOps` is at the top level. However, the test mock chunk `{ agent: { canvasOps: [] } }` means `Object.assign(finalState, chunk)` produces `finalState = { agent: { canvasOps: [] } }`, causing `finalState.canvasOps` to be `undefined` — which evaluates the `canvasOps.length > 0` branch as `false`. The `[canvas updated]` fallback path (lines 356-357) is therefore **never tested** by SC-2 or SC-3. Any regression in the fallback logic would not be caught.

**Fix:** Update the mock to emit a "values"-mode state chunk:
```typescript
async function* generateChunks() {
  // Match "values" mode: emit the full state object, not node-keyed updates
  yield {
    blueprintId: 'debate-strategy-v1',
    currentPhaseId: 'opening',
    messages: [],
    canvasOps: [],
    guardrailResult: 'DOMAIN_MATCH',
    agentConfidence: 0.9,
    driftAction: null,
    agentOutput: null,
    steeringTextEnabled: null,
  }
}
```

---

## Info

### IN-01: No test coverage for session ownership (T-02-05)

**File:** `apps/api/src/routes/ai.test.ts`

**Issue:** None of the three test cases (SC-1, SC-2, SC-3) verify that a request from a user who does not own the session is rejected with 403. This gap allowed the CR-01 bug to survive undetected. A test that provides a session owned by a different `creator_id` than the authenticated user would catch this class of regression.

**Fix:** Add a test case:
```typescript
it('returns 403 when authenticated user does not own the session', async () => {
  const sessionOwnedByOtherUser = {
    id: TEST_SESSION_ID,
    creator_id: 'other-user-00000000-0000-0000-0000-000000000002',  // != TEST_USER_ID
    active_personas: ['analista_cientifico'],
    blueprint_id: 'debate-strategy-v1',
    current_phase: 'opening',
  }
  // ...
  expect(res.status).toBe(403)
  expect(body.error).toBe('forbidden')
})
```

### IN-02: No test coverage for branch isolation (T-02-08)

**File:** `apps/api/src/routes/ai.test.ts`

**Issue:** No test case provides a `branchId` in the request body. The branch lookup path (lines 122-136 of `ai.ts`) and the `ancestorPaths` construction are never exercised. T-02-08 (cross-branch context leakage prevention) is a security-relevant behavior with zero test coverage.

**Fix:** Add a test that provides a valid `branchId` UUID, mocks the `branches` table to return a branch with a specific `path_id`, and asserts that subsequent messages queries are filtered by `in('path_id', ancestorPaths)`.

### IN-03: `orchestratorNode` wraps `lastMessage` in `role: 'user'` without checking the message role

**File:** `apps/api/src/graph/nodes/orchestrator.ts:103`

**Issue:** The classifier call on line 103 builds `[{ role: 'user', content: lastMessage.content }]` regardless of `lastMessage.role`. If the last message in `state.messages` is an assistant message (which is possible in future graph invocation patterns), the classifier receives its content attributed to the user. In the current route flow this cannot happen — `assemblePromptArray` always appends `userMessage` as the final element — but the defensive assumption is fragile.

**Fix:**
```typescript
// Use lastMessage directly; it's already a ProviderMessage with the correct role
[lastMessage],
```

---

_Reviewed: 2026-07-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
