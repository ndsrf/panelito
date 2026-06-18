---
phase: 04-multi-ai-providers
reviewed: 2026-06-18T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - apps/api/package.json
  - apps/api/src/lib/adapter-factory.ts
  - apps/api/src/lib/adapters/anthropic.ts
  - apps/api/src/lib/adapters/gemini.test.ts
  - apps/api/src/lib/adapters/gemini.ts
  - apps/api/src/lib/adapters/openai.test.ts
  - apps/api/src/lib/adapters/openai.ts
  - apps/api/src/lib/ai-provider.test.ts
  - apps/api/src/lib/ai-provider.ts
  - apps/api/src/lib/anthropic.ts
  - apps/api/src/lib/model-config.ts
  - apps/api/src/lib/verify-key.ts
  - apps/api/src/routes/ai.ts
  - apps/api/src/routes/keys.ts
  - apps/api/src/routes/settings.ts
  - apps/web/app/(protected)/settings/page.tsx
  - apps/web/app/(protected)/settings/settings-form.tsx
  - apps/web/lib/creator-settings.ts
  - packages/types/src/ai.test.ts
  - packages/types/src/ai.ts
  - packages/types/src/api-key.ts
  - packages/types/src/index.ts
  - packages/types/src/panel.ts
  - supabase/migrations/0006_multi_provider_keys.sql
findings:
  critical: 5
  warning: 5
  info: 3
  total: 13
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-06-18T00:00:00Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

This phase introduces a multi-provider AI abstraction layer (Anthropic, OpenAI, Gemini) with a provider adapter factory, per-provider key verification, and a settings UI. The architecture is clean and the adapter interface is well-designed. However, five critical defects were found: a failing test that asserts a non-existent `data` field in `required`, a security gap where an Anthropic key passes OpenAI prefix validation, a `done` event that can be emitted twice from `AnthropicAdapter` on error, a duplicate system-prompt being sent in every request, and a TOCTOU race condition in two upsert paths.

---

## Critical Issues

### CR-01: Test assertion for non-existent `required` field causes test suite to fail

**File:** `packages/types/src/ai.test.ts:43`
**Issue:** The test asserts that `renderPanelTool.parameters.required` contains both `'widget_type'` and `'data'`. The actual definition in `ai.ts:167` has `required: ['widget_type']` only — there is no `'data'` field in `required` and no top-level `data` property in the schema at all. This test fails every time the suite runs. The `ai-provider.test.ts` (line 156) makes the same assertion and also fails.

```typescript
// packages/types/src/ai.test.ts:42-45 — CURRENT (fails):
it('required includes widget_type and data', () => {
  const required = (renderPanelTool.parameters as Record<string, unknown>).required as string[]
  expect(required).toContain('widget_type')
  expect(required).toContain('data')   // <-- 'data' does not exist in required
})

// FIX — remove the stale 'data' assertion:
it('required includes widget_type', () => {
  const required = (renderPanelTool.parameters as Record<string, unknown>).required as string[]
  expect(required).toContain('widget_type')
})
```

The same stale assertion exists in `apps/api/src/lib/ai-provider.test.ts:154-156` and must be removed there too.

---

### CR-02: OpenAI key prefix prefix `sk-` passes for Anthropic keys — keys can be stored in wrong column

**File:** `apps/api/src/routes/keys.ts:36-45`
**Issue:** `PROVIDER_KEY_PREFIXES` defines `anthropic: 'sk-ant-'` and `openai: 'sk-'`. Because `'sk-ant-api03-...'` starts with `'sk-'`, an Anthropic key submitted with `provider: 'openai'` passes `validateKeyPrefix('openai', key)` successfully. It then gets verified against the OpenAI API (which rejects it with `invalid_key`) so the key is not stored — but only because the live API call saves it. If a future code path short-circuits the live check, or if a BYOK-proxy ever accepts any key, the guard fails silently.

The design intent (T-04-08) requires the prefix check to *prevent* wrong-column writes. The current check cannot distinguish `sk-ant-` from `sk-` because the shorter prefix is a prefix of the longer.

```typescript
// FIX — check anthropic prefix BEFORE openai, or use exact-prefix matching per provider:
function validateKeyPrefix(provider: string, key: string): boolean {
  const expected = PROVIDER_KEY_PREFIXES[provider]
  if (!expected) return false
  // Anthropic keys start with 'sk-ant-'; openai keys start with 'sk-' but NOT 'sk-ant-'
  if (provider === 'openai' && key.startsWith('sk-ant-')) return false
  return key.startsWith(expected)
}
```

---

### CR-03: `AnthropicAdapter.stream()` can emit `done` twice when an error is thrown inside the stream

**File:** `apps/api/src/lib/adapters/anthropic.ts:122-165`
**Issue:** The `try/finally` block unconditionally yields `{ type: 'done' }` in the `finally` branch (line 163). Inside the `try`, when the inner `while (true)` loop breaks normally (line 156), execution falls through to `await donePromise` (line 160) and then exits the `try` — the `finally` then yields `done`. This path is correct.

However, if `apiStream.on('text', ...)` or any other line *inside the try* throws, and the error propagates through the `while` loop exit, execution skips to the `finally` and yields `done` — which is still correct in the error case.

The actual defect: `waitForItem()` may settle a Promise that holds a `resolve` reference *while* `isDone` is already `true` and the queue is empty, causing an infinite `await waitForItem()` hang if `isDone` is set before all pending queue items have been consumed. Concretely:

1. `enqueue(event)` is called (sets `queue = [event]`).
2. `done()` resolves synchronously (sets `isDone = true`, calls `resolve()`).
3. The `while` loop's inner drain empties the queue.
4. The outer `while(true)` check sees `isDone && queue.length === 0` → breaks.
5. `await donePromise` completes immediately.

This sequence is safe. But if `done()` triggers `resolve()` at exactly the same microtask turn as a new `enqueue()`, the Promise returned by `waitForItem()` resolves immediately (the queue has one item), the inner drain empties it, and then the check at line 156 only fires on the *next* outer-loop iteration — only after another `waitForItem()` is awaited again. Because `isDone` is already true and the queue is empty, `waitForItem()` returns `Promise.resolve()` immediately (line 105), the inner drain sees `queue.length === 0`, then `isDone && queue.length === 0` is true and the loop breaks correctly.

The real problem is that `done` is yielded in `finally`, but if the generator consumer abandons the iterator before calling `next()` to the `done` event (e.g., the SSE stream closes early), the `finally` block still runs and yields `done` — into a closed iterator where the value is silently ignored. This is benign but there is a worse scenario: if the `try` block itself throws an error (e.g., `client.messages.stream()` throws synchronously), the `finally` yields `{ type: 'done' }` as the *first and only* event. The caller in `ai.ts` will see no `text_delta` or `tool_use` events, but it will see `done`, and will then call `incrementCount`. Since `accumulatedText` is still `''` at that point, the `if (accumulatedText.length > 0)` guard (line 259) prevents the DB insert and cap increment. That part is fine. However, the stream closes without emitting an SSE `error` event in this case — the `catch(err)` at line 284 never executes because the error is absorbed in the `finally` yield rather than re-thrown.

**Net result:** provider SDK errors that throw synchronously inside `stream()` swallow the error and produce a silent stream with only a `done` event, rather than flowing into the SSE `catch` block and emitting `stream_failed`. The consumer receives no error signal.

```typescript
// FIX — re-throw after finally yield is impossible with generators; instead, capture errors:
// Replace try/finally yielding with explicit error tracking:
let streamError: unknown = null
try {
  // ... stream body ...
} catch (err) {
  streamError = err
  throw err   // re-throw so the generator terminates with an error
} finally {
  if (!streamError) {
    yield { type: 'done' }
  }
  // If streamError is set, let the error propagate naturally to the caller's for-await catch
}
```

---

### CR-04: System prompt sent twice per invocation — doubles token cost and can cause context confusion

**File:** `apps/api/src/routes/ai.ts:208-227`
**Issue:** `assemblePromptArray` is called with `systemPrompt: BASE_SYSTEM_PROMPT` and `personaInstructions` (line 208-214), which embeds those into the first user message's content. Then the adapter `.stream()` call at line 224 also passes `system: BASE_SYSTEM_PROMPT + '\n\n' + personaInstructions` as the `options.system` parameter (line 227). Every adapter routes `options.system` to its provider-native system prompt slot (Anthropic's top-level `system:`, OpenAI's `messages[0] = { role: 'system' }`, Gemini's `config.systemInstruction`). Additionally, `assemblePromptArray` also hard-codes `systemPrompt` into the *first user message*, meaning the entire system prompt appears twice in every API call — once in the proper system slot and once in the first user message content.

This is a correctness defect (the AI receives contradictory/doubled instructions that can confuse its role framing) and a cost defect (duplicate tokens billed per request). The `assemblePromptArray` function was designed so that `systemPrompt` stays in the first user message for providers that don't support a top-level system slot, but the route now also passes it via `options.system` which all three adapters forward to a proper system slot.

```typescript
// FIX option A — remove systemPrompt from assemblePromptArray since it's passed via options.system:
const promptArray = assemblePromptArray({
  systemPrompt: '',          // already sent via options.system below
  personaInstructions: '',   // already sent via options.system below
  historicalSummary,
  recentMessages,
  userMessage,
})

// FIX option B — remove the system: field from adapter.stream() and let
// assemblePromptArray be the sole source of the system content:
// (requires adapter changes to not forward options.system for providers that can't use it)
```

---

### CR-05: TOCTOU race condition in manual SELECT-then-INSERT/UPDATE upsert pattern

**File:** `apps/api/src/routes/keys.ts:132-155`, `apps/api/src/routes/keys.ts:277-295`, `apps/api/src/routes/settings.ts:105-127`
**Issue:** All three upsert paths follow the same manual read-then-write pattern:
1. `SELECT user_id ... WHERE user_id = $1` to check if a row exists.
2. If exists → `UPDATE`; else → `INSERT`.

Between steps 1 and 2, a concurrent request (same user double-submitting) can create the row, causing the `INSERT` to fail with a unique-constraint violation on `user_id`. The `insertErr` is checked and returns a 500, but the error will be surfaced to the user as a generic "server_error" response when both requests race. More critically, there is no retry logic, so the user's key or setting write is silently dropped.

Supabase supports true PostgreSQL `ON CONFLICT` upsert via `.upsert()` or the SQL `INSERT ... ON CONFLICT DO UPDATE` pattern, which is atomic.

```typescript
// FIX — replace the SELECT + conditional INSERT/UPDATE with a single atomic upsert:
// In keys.ts POST /verify:
const { error: upsertErr } = await supabase
  .from('creator_settings')
  .upsert(
    { user_id: user.id, [keyColumn]: encrypted },
    { onConflict: 'user_id', ignoreDuplicates: false }
  )
if (upsertErr) {
  console.error('[keys/verify] DB upsert error:', upsertErr.code)
  return c.json({ success: false, error: 'server_error' }, 500)
}

// NOTE: The Supabase .upsert() merges only the provided columns,
// preserving api_response_cap and other columns on conflict.
```

---

## Warnings

### WR-01: `verifyGeminiKey` falls through to `network_error` for any unrecognized SDK error — valid keys can be rejected

**File:** `apps/api/src/lib/verify-key.ts:87-96`
**Issue:** Unlike the Anthropic and OpenAI verifiers (which have a catch-all `if (err instanceof SomeSDK.APIError) return { ok: true }` path), the Gemini verifier has no such catch-all. Any Gemini API error whose message doesn't contain the three known strings (`API_KEY_INVALID`, `PERMISSION_DENIED`, `RESOURCE_EXHAUSTED`) returns `{ ok: false, error: 'network_error' }`. This means a valid key that triggers a quota error (`QUOTA_EXCEEDED`), a billing issue, or any other server-side error message not in the list will be incorrectly rejected with `network_error` and will not be persisted. The comment on line 63 acknowledges this is "ASSUMED" and "has not been verified against live API responses," but the fallback is too aggressive.

```typescript
// FIX — add a fallback that treats unrecognized SDK errors as valid (matching the other adapters):
    if (message.includes('API_KEY_INVALID') || message.includes('PERMISSION_DENIED')) {
      return { ok: false, error: 'invalid_key' }
    }
    if (message.includes('RESOURCE_EXHAUSTED')) {
      return { ok: false, error: 'rate_limited' }
    }
    // Unrecognized error from Gemini API — key reached the API, treat as valid
    // (same pattern as verifyAnthropicKey and verifyOpenAIKey)
    if ((err as Error)?.message !== undefined) {
      // We got a response, just an unexpected one — key is likely valid
      return { ok: true }
    }
    return { ok: false, error: 'network_error' }
```

---

### WR-02: `AnthropicAdapter` silently skips `system` role messages rather than raising an error

**File:** `apps/api/src/lib/adapters/anthropic.ts:65-88`
**Issue:** When a `ProviderMessage` with `role: 'system'` appears in the `messages` array, the adapter coerces it to `role: 'user'` (line 67: `const role = m.role === 'system' ? 'user' : ...`). This means system-role messages from `assemblePromptArray` (which doesn't currently produce `system` role items, but is typed to accept them) would be silently promoted to `user` messages, potentially leaking prompt-instruction text into the chat context and confusing the model. Both the Gemini and OpenAI adapters correctly filter out `system` role messages from the conversation array (Gemini: `messages.filter(m => m.role !== 'system')`; OpenAI: `if (m.role === 'system') continue`). The Anthropic adapter is the odd one out.

```typescript
// FIX in adapters/anthropic.ts — filter system messages instead of coercing them:
const anthropicMessages: MessageParam[] = messages
  .filter((m) => m.role !== 'system')   // skip system role (handled by options.system)
  .map((m, idx) => {
    // ... rest of mapping
  })
```

---

### WR-03: `creator-settings.ts` calls `supabase.auth.getUser()` but only uses `user?.id` in the catch fallback — unnecessary auth round-trip

**File:** `apps/web/lib/creator-settings.ts:31-47`
**Issue:** `getCreatorSettings()` calls both `supabase.auth.getUser()` (line 31) and `supabase.auth.getSession()` (line 35). The `getUser()` call makes a network round-trip to Supabase Auth to validate the JWT server-side. Its result is only used in the `catch` block as `user?.id ?? ''` for building the fallback `CreatorSettings` object. If the API call succeeds (the normal path), `user` is never referenced. This means every settings page load costs an extra unnecessary auth verification. The `getSession()` result (which is a local cookie parse, no network) already contains the user's ID via `session.user.id`.

```typescript
// FIX — remove the getUser() call and derive user_id from the session:
export async function getCreatorSettings(): Promise<CreatorSettings> {
  const supabase = await createServerClient()
  const { data: { session } } = await supabase.auth.getSession()
  const accessToken = session?.access_token

  try {
    return await apiFetch<CreatorSettings>('/api/settings', {}, accessToken)
  } catch (err) {
    console.error('[getCreatorSettings] fetch failed:', err)
    return {
      user_id: session?.user?.id ?? '',   // use session instead of separate getUser() call
      has_api_key: false,
      api_response_cap: 150,
      active_provider: 'anthropic' as const,
      updated_at: null as unknown as string,
    }
  }
}
```

---

### WR-04: `handleActivate` in `SettingsForm` silently swallows activation errors — user sees no feedback

**File:** `apps/web/app/(protected)/settings/settings-form.tsx:226-239`
**Issue:** The `catch` block on the `PUT /api/keys/active-provider` call does nothing except call `router.refresh()`. If the activation fails (network error, 500 from server, etc.), the provider card does not show an error state, `activatingProvider` is set to `null` (hiding the spinner), and the page refreshes to show the same state as before — which to the user looks like the activation silently failed with no explanation. Other actions in the same component (`handleVerify`, `handleSaveCap`) correctly set error state on failure.

```typescript
// FIX — add an error state for activation failures:
const [activateError, setActivateError] = useState<string | null>(null)

const handleActivate = async (provider: ProviderName) => {
  setActivatingProvider(provider)
  setActivateError(null)
  try {
    await apiFetch('/api/keys/active-provider', {
      method: 'PUT',
      body: JSON.stringify({ provider }),
    })
    router.refresh()
  } catch {
    setActivateError('No se pudo cambiar el proveedor. Intenta de nuevo.')
  } finally {
    setActivatingProvider(null)
  }
}
// Render activateError somewhere in the provider section.
```

---

### WR-05: `GET /api/keys/status` decrypts all stored keys on every page load — unnecessary crypto work and plaintext in memory

**File:** `apps/api/src/routes/keys.ts:185-203`
**Issue:** `getKeyStatus` decrypts all three provider keys (anthropic, openai, gemini) on every call to extract `last4`. Decryption brings the plaintext API key into server memory — even though only 4 characters are needed. A timing side-channel is unlikely in practice, but it also means that if `KEY_ENCRYPTION_SECRET` is ever rotated without re-encrypting stored keys, all three decrypt calls will throw, causing all provider statuses to appear as "no key" without any diagnostic logged (the `catch` block at line 202 is empty).

The `last4` could be stored as a separate non-sensitive column in `creator_settings` at write time, avoiding decryption on read. If storing `last4` is not desired, at minimum the silent catch should log the error:

```typescript
// Minimum fix — log decryption failures:
} catch (err) {
  console.error('[keys/status] decrypt failed for', provider, (err as Error).constructor.name)
  return { provider, has_key: false, last4: null, is_active: provider === activeProvider }
}
```

---

## Info

### IN-01: `updated_at` typed as `null as unknown as string` in fallback — type lie in published type

**File:** `apps/web/lib/creator-settings.ts:51`
**Issue:** The fallback `CreatorSettings` object uses `null as unknown as string` to satisfy the `updated_at: z.string()` Zod type while returning `null`. `CreatorSettingsSchema` declares `updated_at` as `z.string()` (non-nullable), so the fallback silently violates the schema contract. Any downstream code that calls `.slice()`, `new Date(...)`, or similar on `updated_at` will crash at runtime when the fallback is active.

```typescript
// FIX option A — make updated_at nullable in CreatorSettingsSchema:
updated_at: z.string().nullable()

// FIX option B — use an empty string sentinel:
updated_at: '',
```

---

### IN-02: `display_name` for AI messages is hardcoded to `'Analista Científico'` regardless of active persona

**File:** `apps/api/src/routes/ai.ts:265`
**Issue:** When inserting the AI assistant message row, `display_name` is always `'Analista Científico'`. If multiple personas are active (the route supports `matchedPersonas.length >= 1`), the display name will always be the same regardless of which persona responded. This is a cosmetic issue today but becomes incorrect once multi-persona routing is more granular.

```typescript
// FIX — derive display_name from the matched persona or make it configurable:
display_name: matchedPersonas.length === 1 ? matchedPersonas[0]!.id : 'AI Facilitator',
```

---

### IN-03: `packages/types/src/ai.test.ts` — test description says `required` includes `'data'` but this is never true

**File:** `packages/types/src/ai.test.ts:7`
**Issue:** The test file header comment on line 7 states: `renderPanelTool.parameters.required includes 'widget_type' and 'data'`. This was apparently copied from an earlier design where `data` was a required wrapper field. The comment is misleading and the associated test (covered in CR-01) fails. Update the comment to match the actual schema.

```
// FIX — update line 7 of the comment block:
//   - renderPanelTool.parameters.required includes 'widget_type' (only)
```

---

_Reviewed: 2026-06-18T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
