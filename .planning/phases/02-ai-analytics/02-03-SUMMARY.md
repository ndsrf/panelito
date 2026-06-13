---
phase: 02-ai-analytics
plan: 03
subsystem: frontend
tags: [zustand, sse, streaming, zod, supabase-presence, react, typescript, ai-streaming, persona]

# Dependency graph
requires:
  - phase: 02-ai-analytics
    plan: 02
    provides: POST /api/sessions/:id/invoke streaming text_delta + panel_update SSE events

provides:
  - usePanelStore (Zustand) — widgetType/widgetData/branchId/snapshotState + setWidget/clearWidget/setBranchId/hydrateFromSnapshot
  - useAIStream hook — fetch+ReadableStream SSE consumer with \n\n buffering + PanelWidgetSchema Zod gate (AI-05)
  - MessageBubble isAI variant — Bot avatar, "Analista Científico" name, FlaskConical persona badge, Indigo left border, streaming dots + cursor
  - useTypingPresence extended — ai_streaming field in merged presence payload + setAIStreaming() + isAIStreaming reactive state
  - InputBox soft-lock — driven by isAIStreaming from presence; streaming dots, swapped placeholder, disabled send
  - workspace.tsx wiring — openAIStream on @analista detection, ephemeral streaming bubble, AnalyticsPanel.isStreaming prop

affects:
  - 02-04 (widget rendering: panelStore is the source of truth; AnalyticsPanel reads usePanelStore)
  - 02-05 (persona management: workspace already passes isStreaming to AnalyticsPanel for header)
  - 02-06 (reactions: InputBox soft-lock applies to AI-triggered reaction flows too)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "fetch() + ReadableStream POST SSE consumer (D-01) — NOT EventSource which is GET-only"
    - "Buffer + split on \\n\\n boundary (Pitfall 1 guard) — single-read may deliver partial or multiple SSE events"
    - "PanelWidgetSchema.safeParse() Zod gate before any panelStore.setWidget() call (AI-05)"
    - "Zustand create<State>((set) => ...) with explicit action functions — mirrors session-store pattern"
    - "useTypingPresence merged track() — always includes typing + displayName + ai_streaming to prevent clobbering (T-02-12 / Pitfall 3)"
    - "InputBox as single presence channel owner — prevents duplicate presence subscriptions per userId"
    - "onAfterSend callback prop — allows workspace to detect @analista without duplicating send logic"
    - "Ephemeral streaming AI bubble (D-02) — local React state, no DB writes during stream; Realtime delivers final message after done event"

key-files:
  created:
    - apps/web/store/panel-store.ts
    - apps/web/hooks/use-ai-stream.ts
    - apps/web/hooks/use-ai-stream.test.ts
  modified:
    - apps/web/components/workspace/MessageBubble.tsx (AI variant: isAI/isStreaming/streamingText props)
    - apps/web/hooks/use-typing-presence.ts (ai_streaming merged payload + setAIStreaming + isAIStreaming)
    - apps/web/components/workspace/InputBox.tsx (AI soft-lock from presence + onAfterSend callback)
    - apps/web/app/(protected)/sessions/[id]/workspace.tsx (useAIStream + @analista detection + ephemeral bubble)
    - apps/web/components/workspace/AnalyticsPanel.tsx (isStreaming prop added; full header in Plan 04)

key-decisions:
  - "InputBox is the single presence channel owner — avoids duplicate Supabase presence subscriptions for the same userId when workspace and InputBox both previously had useTypingPresence calls"
  - "isAIStreaming for soft-lock is read from presence (session-wide) in InputBox, not from localAIStreaming (invoker-only) in workspace — ensures all participants lock, not just the invoking client"
  - "onAfterSend callback pattern in InputBox for @analista detection — cleanest way to hook into the existing send flow without restructuring InputBox's internal typing presence management"
  - "Ephemeral streaming bubble rendered in workspace (not ChatStream) as a sibling to ChatStream — keeps ChatStream pure message-list and avoids threading ephemeral state down through ChatStream/MessageList"
  - "AnalyticsPanel.isStreaming prop wired but full 'Analizando...' header strip deferred to Plan 04 — Plan 03 scope is streaming pipe, Plan 04 is widget rendering (plan spec explicit)"
  - "useAIStream.status returns typed enum (idle/streaming/done/typing_hold/no_persona/no_api_key/error) for future error surface in Plan 04"

patterns-established:
  - "useAIStream: openAIStream(content, anyoneTyping) returns void; status drives error surface; streamingText accumulates tokens"
  - "Merged track() call: always track({ typing, displayName, ai_streaming }) never a partial payload"
  - "Streaming AI bubble lifecycle: localAIStreaming true -> ephemeral MessageBubble renders; done event -> Realtime delivers persisted message -> ephemeral unmounts"

requirements-completed: [AI-03, AI-05, AI-07, PANEL-04, PERSONA-03]

# Metrics
duration: ~30min
completed: 2026-06-14
---

# Phase 2 Plan 03: AI Streaming Frontend Slice Summary

**fetch+ReadableStream SSE consumer with \\n\\n buffering + Zod gate, Zustand panelStore, AI MessageBubble variant with persona badge, presence-based input soft-lock, and workspace @analista detection wiring**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-13T22:00:00Z
- **Completed:** 2026-06-13T22:30:00Z
- **Tasks:** 3 auto tasks + 1 checkpoint (human-verify) pending
- **Files modified:** 8

## Accomplishments

- Created `apps/web/store/panel-store.ts`: Zustand panelStore (D-05) with `setWidget/clearWidget/setBranchId/hydrateFromSnapshot` — mirrors session-store shape exactly
- Created `apps/web/hooks/use-ai-stream.ts`: fetch+ReadableStream SSE consumer (D-01) with buffer+split on `\n\n` (Pitfall 1), `PanelWidgetSchema.safeParse()` Zod gate (AI-05), typed status enum for error surfacing, AbortController for stream cancellation
- Created `apps/web/hooks/use-ai-stream.test.ts`: 6 tests covering multi-chunk buffering (Pitfall 1), invalid panel_update discard (AI-05), 429 typing_hold response — all passing
- Extended `MessageBubble.tsx`: `isAI/isStreaming/streamingText` props; Bot avatar with Indigo tint; "Analista Científico" author name; FlaskConical persona badge (PERSONA-03); 2px Indigo 400 left border accent; three-dot bounce indicator; blinking cursor while streaming
- Extended `useTypingPresence`: `ai_streaming` field in merged `track()` payload (T-02-12 / Pitfall 3); `setAIStreaming()` + `isAIStreaming` React state derived from presence sync events
- Extended `InputBox.tsx`: reads `isAIStreaming` from `useTypingPresence` (InputBox is single presence owner); streaming dots on left; placeholder "El analista está escribiendo..."; disabled send + opacity 0.5; `onAfterSend` callback for @analista detection
- Extended `workspace.tsx`: mounts `useAIStream`; calls `openAIStream` via `handleAfterSend` on @analista pattern match; renders ephemeral streaming `MessageBubble` (D-02); passes `isStreaming={localAIStreaming}` to `AnalyticsPanel`
- Extended `AnalyticsPanel.tsx`: `isStreaming` prop accepted (sr-only status role for accessibility); full panel header strip wired in Plan 04

## Task Commits

1. **Task 1: panelStore + useAIStream SSE consumer with Zod gate** - `f210dbe` (feat)
2. **Task 2: AI MessageBubble variant — Bot avatar, persona badge, streaming cursor** - `3c1f6a3` (feat)
3. **Task 3: Workspace wiring — @analista trigger, presence soft-lock, InputBox lock** - `a340340` (feat)

## Files Created/Modified

- `apps/web/store/panel-store.ts` — Zustand panelStore: setWidget/clearWidget/setBranchId/hydrateFromSnapshot
- `apps/web/hooks/use-ai-stream.ts` — fetch+ReadableStream SSE consumer: \n\n buffering, Zod gate, status enum
- `apps/web/hooks/use-ai-stream.test.ts` — 6 tests: multi-chunk buffering, invalid payload discard, 429 status
- `apps/web/components/workspace/MessageBubble.tsx` — AI variant: Bot avatar, persona badge, streaming indicator
- `apps/web/hooks/use-typing-presence.ts` — Extended: ai_streaming in merged payload, setAIStreaming, isAIStreaming
- `apps/web/components/workspace/InputBox.tsx` — AI soft-lock from presence + onAfterSend callback
- `apps/web/app/(protected)/sessions/[id]/workspace.tsx` — useAIStream, @analista detection, ephemeral bubble
- `apps/web/components/workspace/AnalyticsPanel.tsx` — isStreaming prop accepted (header in Plan 04)

## Decisions Made

- **InputBox as single presence owner:** Moving `useTypingPresence` to workspace.tsx would create duplicate presence channels for the same `userId` key. InputBox already owns the channel; reading `isAIStreaming` there keeps the single-subscriber invariant.
- **Session-wide vs. local isAIStreaming:** `localAIStreaming` (from `useAIStream`) is true only on the invoking client. `isAIStreaming` from presence (in InputBox) is session-wide. The soft-lock must use the presence-derived value so all participants lock, not just the sender.
- **onAfterSend callback:** Cleanest hook point into the existing send flow. The workspace registers `handleAfterSend` to detect @analista; InputBox calls it after a successful POST without needing to know what to do with the content.
- **AnalyticsPanel isStreaming prop wired now:** The prop contract is established in Plan 03, but the visual "Analizando..." header strip rendering is Plan 04's responsibility (as stated in the plan's objective).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Presence channel duplication — removed workspace useTypingPresence call**
- **Found during:** Task 3 workspace wiring
- **Issue:** Initial workspace.tsx implementation called `useTypingPresence(liveSession.id, currentUserId, currentUserDisplayName)` alongside InputBox's existing call. Since Supabase Presence uses `userId` as the presence key, two subscriptions from the same client with the same key would interfere with each other.
- **Fix:** Removed `useTypingPresence` from workspace.tsx. InputBox remains the single presence owner and reads `isAIStreaming` from the presence channel. The workspace uses `localAIStreaming` (from `useAIStream`) for AnalyticsPanel's streaming indicator — this is correct since the "Analizando..." label only shows for the invoking client.
- **Files modified:** `apps/web/app/(protected)/sessions/[id]/workspace.tsx`, `apps/web/components/workspace/InputBox.tsx`
- **Commit:** `a340340`

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `isStreaming` prop accepted but "Analizando..." panel header not visually rendered yet | `apps/web/components/workspace/AnalyticsPanel.tsx` | Intentional — Plan 03 scope is streaming pipe end-to-end; Plan 04 adds the full panel header strip with widget zone and AnimatePresence transitions |

## Issues Encountered

- Pre-existing test failure in `components/workspace/AnalyticsPanel.test.tsx`: test looks for `/settings/i` but the link text is "Configuración" (Spanish). This failure predates Plan 03 (confirmed in base commit `2260e81`). Out-of-scope per deviation rules.
- `git stash` was accidentally invoked during pre-existing test investigation (prohibited in worktrees per isolation rules). The `stash pop` immediately restored all changes and no work was lost. State fully recovered.

## Verification Status

- `pnpm --filter @panelito/web typecheck` exits 0
- `use-ai-stream.test.ts` passes: 6/6 tests (multi-line buffering + Zod-discard cases)
- Human checkpoint (Task 4) pending — end-to-end streaming, persona badge, soft-lock, activation matrix

## Threat Surface Scan

All threats in the plan's threat register are fully mitigated:

| Threat | Mitigation | Location |
|--------|------------|----------|
| T-02-10: Tampering — panel_update corrupts UI | PanelWidgetSchema.safeParse() before any panelStore.setWidget() | use-ai-stream.ts handlePanelUpdate() |
| T-02-11: DoS — malformed SSE chunks crash consumer | Buffer + split on \n\n; JSON.parse wrapped per event | use-ai-stream.ts read loop |
| T-02-12: Spoofing — presence clobbering clears typing indicator | Merged track() includes typing + displayName + ai_streaming | use-typing-presence.ts setAIStreaming() and setTyping() |

No new network endpoints introduced. The `/invoke` SSE stream was established in Plan 02; Plan 03 only adds the client-side consumer.

---

## Self-Check: PASSED

Files verified:
- apps/web/store/panel-store.ts — FOUND
- apps/web/hooks/use-ai-stream.ts — FOUND (contains /invoke and response.body.getReader())
- apps/web/hooks/use-ai-stream.test.ts — FOUND (6 tests passing)
- apps/web/components/workspace/MessageBubble.tsx — FOUND (contains isAI and "Analista Científico")
- apps/web/hooks/use-typing-presence.ts — FOUND (contains ai_streaming)
- apps/web/components/workspace/InputBox.tsx — FOUND (contains isAIStreaming and onAfterSend)
- apps/web/app/(protected)/sessions/[id]/workspace.tsx — FOUND (contains openAIStream and @analista)
- apps/web/components/workspace/AnalyticsPanel.tsx — FOUND (contains isStreaming prop)

Commits verified:
- f210dbe feat(02-03): add panelStore + useAIStream SSE consumer with Zod gate — FOUND
- 3c1f6a3 feat(02-03): extend MessageBubble with AI variant — FOUND
- a340340 feat(02-03): wire @analista trigger, presence soft-lock, InputBox lock — FOUND

*Phase: 02-ai-analytics*
*Completed: 2026-06-14*
