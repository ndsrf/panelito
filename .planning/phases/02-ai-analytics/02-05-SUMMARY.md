---
phase: 02-ai-analytics
plan: 05
subsystem: frontend
tags: [react, typescript, zustand, supabase-realtime, optimistic-ui, reactions, ai-trigger]

# Dependency graph
requires:
  - phase: 02-ai-analytics
    plan: 02
    provides: POST /api/sessions/:id/reactions route returning triggersAI, reactions Realtime publication
  - phase: 02-ai-analytics
    plan: 03
    provides: useAIStream (openAIStream), MessageBubble isAI/isStreaming/streamingText props

provides:
  - useReactions(sessionId, currentUserId) hook — optimistic state + Realtime sync + AI trigger relay
  - QuickReactionPopover extended with POST delegation and AI trigger signal
  - MessageBubble with Surface 3 reaction badge row (24px pills, own-reaction highlighted)
  - MessageList wired to useReactions with per-message callbacks and AI stream trigger

affects:
  - 02-06 (persona management: reaction trigger already plumbed; onTriggerAIStream in MessageList)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useReactions snapshot-based revert: snapshotRef.current captures pre-apply state before setReactionsMap; revert() restores snapshot — enables silent rollback (Pitfall 6)"
    - "Own-echo deduplication: ownPendingRef Set tracks 'messageId:emoji' strings applied optimistically; ingest() skips increment when own + pending = true, then clears the key"
    - "Callback delegation pattern: QuickReactionPopover receives onPostReaction as async callback from MessageList; popover fires gesture, hook owns state"
    - "Per-message callbacks via makeReactionCallbacks(messageId): useCallback closure returning bound applyOptimistic/revert/postReaction — avoids function-per-render in message map"

key-files:
  created:
    - apps/web/hooks/use-reactions.ts
    - apps/web/hooks/use-reactions.test.ts
  modified:
    - apps/web/components/workspace/QuickReactionPopover.tsx
    - apps/web/components/workspace/MessageBubble.tsx
    - apps/web/components/workspace/MessageList.tsx

key-decisions:
  - "Callback delegation instead of direct apiFetch in popover: useReactions hook owns all optimistic state. QuickReactionPopover receives onPostReaction async callback from MessageList — keeps deduplication logic co-located with state"
  - "Per-message callback factory (makeReactionCallbacks): useCallback closure binding messageId once, returning stable callback object to prevent unnecessary re-renders"
  - "ingest() deduplication by ownPendingRef key: tracks 'messageId:emoji' pairs applied optimistically to skip the Realtime echo of own reaction"
  - "Supabase Realtime subscription filter: postgres_changes INSERT filtered by session_id=eq.${sessionId}; ingest() further deduplicates per-message echoes"

requirements-completed: [REACT-01, REACT-02, REACT-03, REACT-04, REACT-05]

# Metrics
duration: ~6min
completed: 2026-06-18
---

# Phase 2 Plan 05: Power Reactions System Summary

**Optimistic reaction system with snapshot-based revert, Realtime INSERT deduplication, reaction badges per Surface 3, and AI follow-up trigger for fire/pin/target reactions**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-18T10:26:09Z
- **Completed:** 2026-06-18T10:32:00Z
- **Tasks:** 2 auto tasks complete (TDD RED + GREEN + Task 2) + 1 checkpoint (human-verify) pending
- **Files modified:** 5

## Accomplishments

- Created `use-reactions.ts`: useReactions hook with applyOptimistic/revert (snapshot-based), getReactionCounts (zero-count hidden), ingest (Realtime + own-echo deduplication), postReaction (optimistic then POST then silent revert on ApiError), and Supabase Realtime postgres_changes INSERT subscription
- Extended `QuickReactionPopover.tsx`: replaced console.log with callback delegation — closes popover, calls onOptimisticReaction, awaits onPostReaction, calls onTriggerAI when triggersAI is true (D-09)
- Extended `MessageBubble.tsx`: added reactions?: ReactionCount[] prop with Surface 3 badge row (24px pills, isOwn highlighted with Indigo 500 border/bg, muted otherwise, English aria-label)
- Extended `MessageList.tsx`: instantiates useReactions(sessionId, currentUserId), makeReactionCallbacks factory per message, passes reactions + callbacks to MessageBubble, threads onTriggerAIStream for AI invoke on fire/pin/target

## Task Commits

1. **Task 1 RED: Failing tests for useReactions** - `a314628` (test)
2. **Task 1 GREEN: useReactions hook implementation** - `5e63bc5` (feat)
3. **Task 2: QuickReactionPopover + MessageBubble + MessageList wiring** - `da5309b` (feat)

## Files Created/Modified

- `apps/web/hooks/use-reactions.ts` — Core reactions hook: optimistic state, Realtime sync, AI trigger relay
- `apps/web/hooks/use-reactions.test.ts` — 14 tests covering all behavior (TDD RED/GREEN)
- `apps/web/components/workspace/QuickReactionPopover.tsx` — Extended with POST delegation callbacks
- `apps/web/components/workspace/MessageBubble.tsx` — Surface 3 reaction badges + reaction callback props
- `apps/web/components/workspace/MessageList.tsx` — useReactions wired, per-message callbacks factory

## Decisions Made

- **Callback delegation (not direct apiFetch in popover):** The hook owns all reaction state. QuickReactionPopover receives `onPostReaction` as an async callback from MessageList. This keeps deduplication (ownPendingRef) and snapshot management (snapshotRef) co-located in the hook rather than split across components.
- **makeReactionCallbacks factory with useCallback:** Avoids creating new function references on every render inside the message map. The factory binds messageId once and returns stable callbacks.
- **Own-echo dedup via ownPendingRef Set:** A `Set<"messageId:emoji">` tracks optimistic applies. When the Realtime INSERT echoes back, `ingest()` checks this set and skips the increment. Clears on first match so future reactions on the same emoji still work.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript TS2532 — possibly undefined array index in test**
- **Found during:** Task 1 GREEN phase typecheck
- **Issue:** `counts[0].emoji` flagged as "Object is possibly 'undefined'" (TS strict)
- **Fix:** Changed to optional chaining `counts[0]?.emoji`
- **Files modified:** `apps/web/hooks/use-reactions.test.ts`
- **Committed in:** `5e63bc5` (Task 1 GREEN commit)

**2. [Rule 3 - Blocking] node_modules symlink missing in worktree**
- **Found during:** Task 1 RED phase setup
- **Issue:** The worktree's apps/web had no node_modules; vitest.config.ts comment references "The worktree symlinks node_modules -> main project's node_modules" but symlink absent
- **Fix:** `ln -s panelito/apps/web/node_modules worktree-apps/web/node_modules` (same fix as plan 02-04)
- **Files modified:** symlink only, no source files

---

**Total deviations:** 2 auto-fixed (1 type bug, 1 blocking)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered

None beyond the deviations documented above.

## Verification Status

- `use-reactions.test.ts` passes: 14/14 tests
- `tsc --noEmit` on web app files: 0 errors in Plan 05 files (pre-existing errors in `apps/api/src` are out of scope — same as plan 02-04)
- Grep checks pass:
  - `/reactions` in QuickReactionPopover.tsx (comment documents POST route delegation)
  - `ReactionCount` in MessageBubble.tsx
  - `useReactions` in MessageList.tsx
- Human checkpoint (Task 3) pending — end-to-end reaction flow + sync + silent revert verification

## Known Stubs

None — all four reaction behaviors are fully implemented:
- Brain Insight: records without AI trigger (triggersAI: false from server)
- Fire Intensify: triggers AI (triggersAI: true, onTriggerAIStream called)
- Pin: triggers AI (same)
- Target Simplify: triggers AI (same)

Note: `onTriggerAIStream` prop must be passed to MessageList by the parent workspace.tsx (which owns useAIStream). The wiring from workspace to MessageList is the caller's responsibility.

## Threat Surface Scan

No new network endpoints or auth paths introduced. The useReactions hook uses the existing POST /api/sessions/:id/reactions route (Plan 02) and the existing Supabase Realtime channel pattern.

T-02-15 (reaction spam): mitigated by server rate limit 60/min/user (Plan 02 route).
T-02-16 (reaction spoofing): RLS enforces author_id from authed user — client cannot override.
T-02-17 (optimistic drift): revert() restores snapshot on POST failure; ingest() dedupes own-echo.

---

## Self-Check

Files verified:
- apps/web/hooks/use-reactions.ts — FOUND
- apps/web/hooks/use-reactions.test.ts — FOUND
- apps/web/components/workspace/QuickReactionPopover.tsx — FOUND
- apps/web/components/workspace/MessageBubble.tsx — FOUND
- apps/web/components/workspace/MessageList.tsx — FOUND

Commits verified:
- a314628 test(02-05): add failing tests — FOUND
- 5e63bc5 feat(02-05): implement useReactions hook — FOUND
- da5309b feat(02-05): wire reactions to QuickReactionPopover — FOUND

## Self-Check: PASSED

*Phase: 02-ai-analytics*
*Completed: 2026-06-18*
