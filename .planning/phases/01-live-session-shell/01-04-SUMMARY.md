---
phase: 01-live-session-shell
plan: 04
subsystem: ui
tags: [viewport-api, css-custom-properties, react, error-boundary, playwright, vitest]

requires:
  - phase: 01-live-session-shell/01-03
    provides: session data at /sessions/[id] — workspace page reads it to render

provides:
  - useViewport() hook — sets --app-height and --keyboard-height CSS vars via visualViewport API
  - workspace CSS layout primitives in globals.css (.workspace-shell, .analytics-panel, .branch-navigator, .chat-stream, .input-box)
  - Five workspace components: AnalyticsPanel (with Error Boundary), BranchNavigator, ChatStream shell, InputBox shell, CreatorControls
  - Workspace composition root (workspace.tsx) at /sessions/[id]
  - Mobile Playwright regression test for keyboard-resilient layout
  - AnalyticsPanel Error Boundary unit test (vitest + jsdom)

affects: [01-05, 01-06, 01-07]

tech-stack:
  added: [@testing-library/react, jsdom (vitest unit tests for Error Boundary)]
  patterns:
    - CSS custom property layout pattern (--app-height, --keyboard-height via visualViewport)
    - React Error Boundary wrapping analytics panel for Phase 2 widget safety
    - Workspace composition root pattern (workspace.tsx as client component, page.tsx as server component)

key-files:
  created:
    - apps/web/hooks/use-viewport.ts
    - apps/web/components/workspace/AnalyticsPanel.tsx
    - apps/web/components/workspace/BranchNavigator.tsx
    - apps/web/components/workspace/ChatStream.tsx
    - apps/web/components/workspace/InputBox.tsx
    - apps/web/components/workspace/CreatorControls.tsx
    - apps/web/components/workspace/AnalyticsPanel.test.tsx
    - apps/web/app/(protected)/sessions/[id]/workspace.tsx
    - apps/web/e2e/layout.spec.ts
  modified:
    - apps/web/app/globals.css
    - apps/web/app/(protected)/sessions/[id]/page.tsx
    - apps/web/tsconfig.json

key-decisions:
  - "useViewport attaches both 'resize' AND 'scroll' to visualViewport — iOS Safari requires the scroll listener for keyboard-height detection"
  - "hasApiKey hardcoded false in Plan 04 — Plan 06 wires real creator_settings value"
  - "e2e directory excluded from tsconfig.json — Playwright tests use browser-context dynamic imports that tsc cannot resolve"
  - "Workspace splits into server component (page.tsx) + client composition root (workspace.tsx) to keep data fetching server-side"

patterns-established:
  - "useViewport() hook pattern — call once in InputBox, sets --keyboard-height globally for the whole workspace"
  - "workspace-shell / analytics-panel / chat-stream / input-box CSS class contract — all workspace plans build inside these"
  - "Error Boundary wraps AnalyticsPanel — Phase 2 widgets throw safely without crashing chat"

requirements-completed: [LAYOUT-01, LAYOUT-02, LAYOUT-03, LAYOUT-04, LAYOUT-05, LAYOUT-07]

duration: ~50min (including recovery from session limit)
completed: 2026-06-12
---

# Plan 01-04: Workspace Layout Slice Summary

**Visual Viewport API hook + CSS custom-property layout system + mobile-safe 40/60 workspace shell with Error Boundary and Playwright keyboard regression test**

## Performance

- **Duration:** ~50 min (recovered from session-limit interruption)
- **Completed:** 2026-06-12
- **Tasks:** 3 (TDD: each with RED then GREEN commit)
- **Files modified:** 13

## Accomplishments
- `useViewport()` hook listens to `window.visualViewport` `resize` + `scroll` events (iOS Safari requires both) and writes `--keyboard-height` to `:root`
- CSS layout primitives in `globals.css` — workspace geometry expressed entirely in CSS custom properties; zero `100vh` usage
- Five workspace components with branded empty states (AnalyticsPanel, BranchNavigator, ChatStream, InputBox, CreatorControls)
- AnalyticsPanel wrapped in an Error Boundary that catches Phase 2 widget crashes and renders a fallback card
- `workspace.tsx` composition root assembled and wired to real session data; Plan 03 placeholder removed
- Playwright layout regression test: simulates 300px keyboard via `visualViewport` monkey-patch, asserts analytics panel height stays constant and input-box bottom updates to `300px`

## Task Commits

1. **Task 1 RED: useViewport hook failing tests** - `cc0a398`
2. **Task 1 GREEN: viewport hook + workspace CSS primitives** - `3c10f57`
3. **Task 2 RED: workspace components failing tests** - `9a68012`
4. **Task 2 GREEN: five workspace components** - `4b05df3`
5. **Task 3 RED: E2E layout test (failing)** - `ff059d4`
6. **Task 3 GREEN: workspace shell wired, tsconfig fix** - `612eb0b`

## Files Created/Modified
- `apps/web/hooks/use-viewport.ts` — Visual Viewport API hook
- `apps/web/app/globals.css` — workspace layout CSS primitives
- `apps/web/components/workspace/` — five workspace components + test
- `apps/web/app/(protected)/sessions/[id]/workspace.tsx` — composition root
- `apps/web/app/(protected)/sessions/[id]/page.tsx` — rewired to use workspace.tsx
- `apps/web/tsconfig.json` — excludes e2e/ from Next.js tsc

## Decisions Made
- `useViewport` attaches `scroll` listener in addition to `resize` on `visualViewport` — iOS Safari fires `scroll` when the keyboard opens, not `resize`
- e2e tests excluded from Next.js tsconfig — they use browser-context dynamic `import()` with CDN URLs that tsc can't resolve

## Deviations from Plan
None — all tasks executed as specified. Added tsconfig e2e exclusion as an auto-fix for the pre-existing CDN import TypeScript error introduced in Plan 03.

## Issues Encountered
Session limit interruption mid-Task 3; resumed inline. TypeScript error in `e2e/sessions.spec.ts` (CDN dynamic import in `page.evaluate`) resolved by excluding `e2e/` from `tsconfig.json`.

## Next Phase Readiness
- Workspace CSS contract established — Plan 05 (chat) adds messages inside `.chat-stream` without touching layout geometry
- `InputBox` shell is ready for chat wiring in Plan 05 (submit handler placeholder in place)
- `AnalyticsPanel` Error Boundary in place — Plan 06 and Phase 2 widgets render safely inside it
- `hasApiKey` prop flows to `AnalyticsPanel` — Plan 06 wires the real value from `creator_settings`

---
*Phase: 01-live-session-shell*
*Completed: 2026-06-12*
