---
phase: quick-260703-lmx
plan: "01"
subsystem: api, web
tags: [bugfix, langfuse, otel, streaming, wsl]
dependency_graph:
  requires: []
  provides: [OBS-02, CHAT-01]
  affects: [apps/api/src/lib/langfuse-otel.ts, apps/api/src/routes/ai.ts, apps/web/hooks/use-ai-stream.ts, apps/web/app/(protected)/sessions/[id]/workspace.tsx]
tech_stack:
  added: []
  patterns: [null-safe flush via module-level ref, stable ref pattern for hook callbacks]
key_files:
  created: []
  modified:
    - apps/api/src/lib/langfuse-otel.ts
    - apps/api/src/routes/ai.ts
    - apps/web/hooks/use-ai-stream.ts
    - apps/web/app/(protected)/sessions/[id]/workspace.tsx
decisions:
  - "Direct processor flush (LangfuseSpanProcessor.forceFlush()) instead of TracerProvider cast — avoids no-op global provider throw"
  - "Stable ref pattern for onMessagesRefresh to avoid stale closure without deps churn"
  - "Wire onMessagesRefresh in workspace.tsx (actual useAIStream call site), not ChatStream.tsx (thin passthrough) — see deviation"
metrics:
  duration: ~15 minutes
  completed: "2026-07-03T18:09:00Z"
  tasks_completed: 2
  files_modified: 4
  commits: 2
---

# Quick Task 260703-lmx: Fix Langfuse forceFlush crash and WSL chat no-refresh

**One-liner:** Null-safe flushLangfuse() via direct LangfuseSpanProcessor ref (not no-op TracerProvider cast) + onMessagesRefresh callback on SSE done for WSL Supabase LongPoll timing gap.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Fix Langfuse forceFlush crash | 06ba5f2 | langfuse-otel.ts, ai.ts |
| 2 | WSL chat refresh on SSE done | 359fda0 | use-ai-stream.ts, workspace.tsx |

## What Was Done

### Task 1: Langfuse forceFlush fix

**Root cause:** `getLangfuseTracerProvider()` returns the OTel global no-op `TracerProvider` when Langfuse keys are absent. The global provider has no `forceFlush()` method, so the `(provider as any).forceFlush()` cast in `ai.ts` line 449 threw at runtime.

**Fix:** Added `flushLangfuse(): Promise<void>` to `langfuse-otel.ts`. The function calls `forceFlush()` on `_langfuseSpanProcessor` (the module-held `LangfuseSpanProcessor` instance) directly. Returns immediately when the processor is null (keys absent). Catches and warns on flush errors, never throws.

Replaced the import of `getLangfuseTracerProvider` from `@langfuse/tracing` in `ai.ts` with `flushLangfuse` from `../lib/langfuse-otel`. Replaced the cast block with `await flushLangfuse()` — no try/catch needed at the call site.

### Task 2: WSL chat message refresh

**Root cause:** Supabase Realtime LongPoll has a timing gap in local WSL dev where the poll cycle hasn't completed before the user looks at the chat after an AI response.

**Fix:** Added `UseAIStreamOptions` interface with `onMessagesRefresh?: () => void` to `use-ai-stream.ts`. Hook now accepts `useAIStream(sessionId, options?)`. The callback is stored in a stable ref (`onMessagesRefreshRef`) to avoid stale closures without adding `options` to `openAIStream`'s deps array.

At the SSE `done` event branch, `onMessagesRefreshRef.current?.()` is called synchronously after setting `isAIStreaming(false)`. NOT called on `error` (message may not be persisted).

In `workspace.tsx`, passed `onMessagesRefresh` that calls `apiFetch<Message[]>(/api/sessions/:id/messages?branchId=...)` and updates `useSessionStore.getState().setMessages(msgs)`. Errors are swallowed — non-fatal fallback only.

## Deviations from Plan

### Plan Adjustment — Task 2 wired in workspace.tsx not ChatStream.tsx

**Found during:** Task 2 implementation
**Issue:** The plan specified wiring `onMessagesRefresh` in `ChatStream.tsx`. However, `ChatStream.tsx` is a thin passthrough component that does not own `useAIStream` — the hook is called in `workspace.tsx`. `ChatStream.tsx` has no access to `apiFetch`, `setMessages`, or `activeBranchId`.
**Fix:** Wired the `onMessagesRefresh` callback in `workspace.tsx` where `useAIStream` is actually invoked. All required imports (`apiFetch`, `useSessionStore`, `Message`) were already present.
**Files modified:** `apps/web/app/(protected)/sessions/[id]/workspace.tsx` instead of `ChatStream.tsx`
**Impact:** Same functional outcome — callback fires once per AI call at SSE `done` and re-fetches messages. No behavior difference.

## Known Stubs

None — both fixes wire directly to real data sources.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. The `onMessagesRefresh` re-fetch targets the same already-authenticated API endpoint that `MessageList` uses on mount. The `flushLangfuse()` path sends telemetry to Langfuse (user's own account) as covered by T-lmx-01.

## Self-Check: PASSED

- [x] `apps/api/src/lib/langfuse-otel.ts` — exports `flushLangfuse(): Promise<void>`
- [x] `apps/api/src/routes/ai.ts` — no `getLangfuseTracerProvider`, no `as any` forceFlush cast, calls `await flushLangfuse()`
- [x] `apps/web/hooks/use-ai-stream.ts` — `onMessagesRefresh` accepted, stored in ref, called at `done`
- [x] `apps/web/app/(protected)/sessions/[id]/workspace.tsx` — passes `onMessagesRefresh` callback with API re-fetch
- [x] Commits 06ba5f2 and 359fda0 exist in git log
