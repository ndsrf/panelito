---
phase: quick-260703-lmx
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/lib/langfuse-otel.ts
  - apps/api/src/routes/ai.ts
  - apps/web/hooks/use-ai-stream.ts
autonomous: true
requirements: [OBS-02, CHAT-01]

must_haves:
  truths:
    - "No runtime error in the AI stream path for Langfuse forceFlush"
    - "AI calls produce traces visible in Langfuse when keys are configured"
    - "When keys are absent, the code path is a safe no-op (no throw)"
    - "After an AI response completes, the new message appears in chat without manual refresh in WSL"
  artifacts:
    - path: "apps/api/src/lib/langfuse-otel.ts"
      provides: "flushLangfuse() helper — calls forceFlush on span processor directly"
    - path: "apps/api/src/routes/ai.ts"
      provides: "Uses flushLangfuse() instead of casting getLangfuseTracerProvider() as any"
    - path: "apps/web/hooks/use-ai-stream.ts"
      provides: "Reloads messages from API on SSE 'done' event as WSL fallback"
  key_links:
    - from: "apps/api/src/routes/ai.ts"
      to: "apps/api/src/lib/langfuse-otel.ts"
      via: "flushLangfuse() import"
      pattern: "flushLangfuse"
    - from: "apps/web/hooks/use-ai-stream.ts"
      to: "apps/web/components/workspace/MessageList.tsx"
      via: "onDone callback → setMessages"
      pattern: "onDone|setMessages"
---

<objective>
Fix two runtime bugs in the AI streaming path:

1. **Langfuse forceFlush crash**: `getLangfuseTracerProvider()` from `@langfuse/tracing` falls back to
   the OTel no-op global provider when `setupLangfuseOtel()` did not run (e.g. keys absent). The
   global provider has no `forceFlush()` method, so `(provider as any).forceFlush()` throws
   `_langfuse_tracing forceFlush is not a function`. The fix: expose `flushLangfuse()` from
   `langfuse-otel.ts` that calls `forceFlush()` on the module-held `LangfuseSpanProcessor` directly
   (null-safe), and replace the cast in `ai.ts`.

2. **WSL chat no-refresh**: Supabase Realtime LongPoll is configured for localhost, but there are
   known timing gaps in local dev where `httpSend` broadcasts do not arrive via LongPoll before the
   user sees the blank state. Fix: when the SSE `done` event fires in `use-ai-stream.ts`, call the
   `onMessagesRefresh` callback to fetch the latest messages from the API. This is targeted (fires
   once per AI call, not on a timer) and is a no-op in production where Realtime is reliable.

Purpose: Unblock Langfuse tracing visibility and fix the WSL dev experience for chat.
Output: Two targeted bug fixes, no new dependencies.
</objective>

<execution_context>
@/home/jgm/dev/projects/web-projects/panelito/.claude/get-shit-done/workflows/execute-plan.md
@/home/jgm/dev/projects/web-projects/panelito/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/home/jgm/dev/projects/web-projects/panelito/.planning/STATE.md
@/home/jgm/dev/projects/web-projects/panelito/.planning/ROADMAP.md

Key files to read before touching anything:
- apps/api/src/lib/langfuse-otel.ts        — holds _langfuseSpanProcessor module ref
- apps/api/src/routes/ai.ts                — line 449: the bad forceFlush call
- apps/web/hooks/use-ai-stream.ts          — SSE event handler where 'done' fires
- apps/web/components/workspace/MessageList.tsx — where setMessages lives (prop drilling path)
- apps/web/components/workspace/ChatStream.tsx  — wires MessageList + use-ai-stream together
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix Langfuse forceFlush — expose null-safe flushLangfuse() and update call site</name>
  <files>apps/api/src/lib/langfuse-otel.ts, apps/api/src/routes/ai.ts</files>
  <action>
**Root cause recap:** `getLangfuseTracerProvider()` (from `@langfuse/tracing`) returns the OTel
global no-op `TracerProvider` when `setupLangfuseOtel()` never initialized (e.g., Langfuse keys
absent from `.env`). That global provider does NOT have `forceFlush()`. The `(provider as any).forceFlush()` cast in `ai.ts` line 449 throws at runtime.

**Fix in `langfuse-otel.ts`:** Add and export a `flushLangfuse()` function. It checks if
`_langfuseSpanProcessor` is non-null, then calls `_langfuseSpanProcessor.forceFlush()` (which IS
defined on `LangfuseSpanProcessor` per `@langfuse/otel` type defs). Returns a resolved Promise if
the processor is null (keys absent → tracing disabled → nothing to flush). Catches and warns on
flush errors, never throws. Signature:

```
export async function flushLangfuse(): Promise<void>
```

Also: add a JSDoc comment explaining that this replaces the `(getLangfuseTracerProvider() as any).forceFlush()` anti-pattern and why the processor-direct approach is safe.

**Fix in `ai.ts`:** Replace the import of `getLangfuseTracerProvider` from `@langfuse/tracing` with
`flushLangfuse` from `../lib/langfuse-otel`. Remove the cast block at line 449:
```
await (getLangfuseTracerProvider() as any).forceFlush().catch(...)
```
Replace it with:
```
await flushLangfuse()
```
No try/catch needed here — `flushLangfuse()` is already null-safe and non-throwing internally.

Verify the `getLangfuseTracerProvider` import from `@langfuse/tracing` is fully removed from
`ai.ts` since it's no longer used there.
  </action>
  <verify>
    <automated>cd /home/jgm/dev/projects/web-projects/panelito && grep -n "forceFlush" apps/api/src/routes/ai.ts && grep -n "flushLangfuse" apps/api/src/lib/langfuse-otel.ts && pnpm --filter @panelito/api tsc --noEmit 2>&1 | tail -5</automated>
  </verify>
  <done>
    - `apps/api/src/routes/ai.ts` contains zero references to `getLangfuseTracerProvider` and zero `as any` forceFlush casts
    - `apps/api/src/lib/langfuse-otel.ts` exports `flushLangfuse(): Promise<void>`
    - `apps/api/src/routes/ai.ts` calls `await flushLangfuse()` at the OBS-02 flush point
    - `pnpm --filter @panelito/api tsc --noEmit` exits 0
    - When LANGFUSE keys are absent, the server starts without error and AI calls complete without throwing
  </done>
</task>

<task type="auto">
  <name>Task 2: WSL chat refresh — reload messages on SSE 'done' from use-ai-stream</name>
  <files>apps/web/hooks/use-ai-stream.ts, apps/web/components/workspace/ChatStream.tsx</files>
  <action>
**Root cause recap:** Supabase Realtime LongPoll (already configured in `client.ts`) should deliver
`new_message` broadcasts after the API's `httpSend`. In practice, local Supabase dev sometimes has
a gap where the LongPoll poll cycle hasn't completed yet when the user looks at the chat. The 2s
polling fallback was removed in task 260624-2c7. The targeted fix: after the SSE stream sends
`done`, fetch fresh messages once.

**In `use-ai-stream.ts`:** Read the current hook signature and all existing props/callbacks. Find
the `done` event handler — the case where `event.type === 'done'` (or similar). After resetting
streaming state at `done`, call an optional `onMessagesRefresh` callback if provided. Add
`onMessagesRefresh?: () => void` to the hook's options/params type (wherever the existing options
type is defined in the file). Call it synchronously after stream cleanup at the `done` branch.

Do NOT add a timer or setInterval — just call it once at `done`. Do NOT call it on `error` events
(the message may not have been persisted).

**In `ChatStream.tsx`:** Read how `use-ai-stream` is wired and how `MessageList` receives messages.
Find where `useSessionStore.getState().setMessages` or the history refetch lives. Pass a
`onMessagesRefresh` callback into `use-ai-stream` that calls:
```
apiFetch<Message[]>(`/api/sessions/${sessionId}/messages?branchId=${activeBranchId}`)
  .then(setMessages)
  .catch(() => {})  // non-fatal — Realtime may have already delivered
```

Import `apiFetch` if not already imported, and `Message` from `@panelito/types` if needed.

This is intentionally a WSL-resilient fallback — in production, Realtime delivers the message
before `done` fires so `setMessages` just re-applies the same data (idempotent via addMessage
dedup logic if that exists, or simply overwrites — either is safe).
  </action>
  <verify>
    <automated>cd /home/jgm/dev/projects/web-projects/panelito && grep -n "onMessagesRefresh\|onDone" apps/web/hooks/use-ai-stream.ts && pnpm --filter @panelito/web tsc --noEmit 2>&1 | tail -5</automated>
  </verify>
  <done>
    - `use-ai-stream.ts` accepts and calls `onMessagesRefresh` callback at the `done` event branch
    - `ChatStream.tsx` passes an `onMessagesRefresh` that calls the messages API and updates session store
    - `pnpm --filter @panelito/web tsc --noEmit` exits 0
    - In WSL dev: after an AI response, the message appears without requiring manual page refresh
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| SSE stream → client callback | `done` event triggers a re-fetch; the fetch target is the same authenticated API, no new trust boundary |
| Langfuse flush | Flush only sends already-captured telemetry data to Langfuse; no user data in scope |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-lmx-01 | Information Disclosure | flushLangfuse | accept | Flush sends spans to Langfuse (user's own account); no PII in span data per existing T-06-05 |
| T-lmx-02 | Denial of Service | onMessagesRefresh re-fetch | accept | One fetch per AI call, same auth gate as initial load; no amplification risk |
| T-lmx-SC | Tampering | npm installs | N/A | No new packages installed in this plan |
</threat_model>

<verification>
After both tasks:

```bash
# API compiles clean
pnpm --filter @panelito/api tsc --noEmit

# Web compiles clean
pnpm --filter @panelito/web tsc --noEmit

# No more getLangfuseTracerProvider cast in ai.ts
grep "getLangfuseTracerProvider" apps/api/src/routes/ai.ts  # should return nothing

# flushLangfuse is exported
grep "export.*flushLangfuse" apps/api/src/lib/langfuse-otel.ts

# onMessagesRefresh wired in hook
grep "onMessagesRefresh" apps/web/hooks/use-ai-stream.ts
```

Manual check: start both apps locally, make an AI call, verify no console error about `forceFlush`.
In WSL, verify the AI message appears in chat after the stream without refreshing.
</verification>

<success_criteria>
- Zero TypeScript errors in both `@panelito/api` and `@panelito/web`
- `flushLangfuse()` exported from `langfuse-otel.ts` and called in `ai.ts` at the OBS-02 flush point
- No `(getLangfuseTracerProvider() as any)` in `ai.ts`
- `use-ai-stream.ts` calls `onMessagesRefresh` on SSE `done`
- `ChatStream.tsx` passes a refresh callback that re-fetches messages
</success_criteria>

<output>
Create `.planning/quick/260703-lmx-ai-stream-error-langfuse-tracing-forcefl/260703-lmx-SUMMARY.md` when done.
</output>
