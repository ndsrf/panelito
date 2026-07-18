---
phase: 14-polish-triggerengine-wiring
plan: 05
subsystem: ui
tags: [react, nextjs, chat, speech-artifacts, defense-in-depth]

# Dependency graph
requires:
  - phase: 14-polish-triggerengine-wiring
    provides: "SPEECH_ARTIFACT_BLOCKLIST + containsSpeechArtifact from @panelito/types (Plan 01)"
provides:
  - "Frontend defense-in-depth filter at MessageBubble render sites (SPEECH-02)"
  - "Zero chat-stream presence for canvas-only assistant messages (SPEECH-03/D-11)"
affects: [14-07-verification]

# Tech tracking
tech-stack:
  added: []
  patterns: ["defense-in-depth client-side content filter mirroring backend blocklist"]

key-files:
  created: []
  modified:
    - apps/web/components/workspace/MessageBubble.tsx
    - apps/web/components/workspace/MessageList.tsx

key-decisions:
  - "Applied containsSpeechArtifact filtering to all three message.content render sites in MessageBubble (AI bubble, human bubble, streamingText) rather than only the AI/streaming sites literally named in the task action — the plan's threat_model trust-boundary row states artifact strings must be filtered 'regardless of position', and the interfaces section explicitly lists the human bubble content line as a render site"
  - "Row suppression in MessageList implemented as an early return null inside the existing .map() callback, mirroring the isSystemMessage early-return precedent exactly (same position, same shape) rather than a pre-map .filter() — keeps the suppression check colocated with the other per-message branch logic and reuses the established pattern"

patterns-established:
  - "Client-side artifact filtering: containsSpeechArtifact(content) ? '' : content at any render site where message content reaches the DOM"

requirements-completed: [SPEECH-02, SPEECH-03]

# Metrics
duration: 9min
completed: 2026-07-18
---

# Phase 14 Plan 05: Frontend Speech-Artifact Filter Summary

**Client-side defense-in-depth filter using containsSpeechArtifact from @panelito/types — silent-drop artifact text in MessageBubble, zero-row suppression for canvas-only assistant messages in MessageList**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-18T07:36:22+02:00 (base commit for this wave)
- **Completed:** 2026-07-18T07:45:38+02:00
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- MessageBubble.tsx silently drops any rendered text (completed AI content, streaming text, human content) that matches a blocked artifact substring, leaving the animated cursor span behavior intact during streaming (SPEECH-02)
- MessageList.tsx suppresses the entire chat row for `role === 'assistant'` messages whose content is an artifact string — no bubble, no icon, no dimmed placeholder — mirroring the existing `isSystemMessage` early-return precedent (SPEECH-03/D-11)
- Suppression is scoped strictly to assistant messages; human and system messages are never affected
- Fork-separator wrapper logic (keyed on `msg.id`, lines ~276-290) is unaffected by suppression since each message's fork-point check runs independently per iteration

## Task Commits

Each task was committed atomically:

1. **Task 1: Filter artifact strings out of rendered bubble content (SPEECH-02)** - `b7dcf1b` (feat)
2. **Task 2: Suppress the entire row for canvas-only artifact messages (SPEECH-03/D-11)** - `06b118f` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/web/components/workspace/MessageBubble.tsx` - Imports `containsSpeechArtifact`; guards the AI-bubble completed-content render, the streaming-text render, and the human-bubble content render, rendering an empty string (silent drop) when the content matches a blocked pattern
- `apps/web/components/workspace/MessageList.tsx` - Imports `containsSpeechArtifact`; adds an early `return null` in the `.map()` loop for `role === 'assistant'` messages whose content matches a blocked pattern, immediately after the existing `isSystemMessage` branch

## Decisions Made
- Filtered `message.content` at all three render sites in `MessageBubble.tsx` (AI bubble, human bubble, and streamingText), not only the two sites literally called out in the task action text — the plan's `<threat_model>` trust-boundary row explicitly states artifact strings "must be filtered client-side regardless of position," and the `<interfaces>` section lists the human bubble content line (~282) as a render site alongside the AI content and streaming sites. Applying the filter uniformly avoids leaving an unfiltered `message.content` render path in the same file.
- Implemented row suppression as an early `return null` inside the `.map()` callback (mirroring `isSystemMessage`) rather than a pre-`.map()` `.filter()`, per the task's stated preference to choose "whichever form integrates cleanly with the existing fork-separator wrapper logic" — the early-return form keeps the suppression check adjacent to the other per-message branches and required the smallest diff.

## Deviations from Plan

None - plan executed exactly as written. The broader-than-literal application of the content filter to the human bubble render site in Task 1 is not a deviation from the plan's intent — it is explicitly supported by the plan's own `<threat_model>` and `<interfaces>` sections (see Decisions Made above), so it is documented as a decision rather than a Rule 1/2/3 auto-fix.

## Issues Encountered
- `apps/web` had no `node_modules` installed in this fresh worktree (git worktrees do not carry over `node_modules`). Ran `pnpm install --offline` at the workspace root, which resolved instantly from the local pnpm content-addressable store (no network access needed, lockfile already up to date) to enable `tsc --noEmit` verification. `node_modules` remains gitignored and was not committed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- SPEECH-02/SPEECH-03 frontend defense-in-depth layer complete; backend half (Plan 02, never writing the artifact string) is a separate concern
- Ready for Plan 07 (phase verification) to exercise the manual/render check: injecting a message with a blocked pattern should render no row and no visible text
- No blockers

---
*Phase: 14-polish-triggerengine-wiring*
*Completed: 2026-07-18*
