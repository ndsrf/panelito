---
phase: 11-personality-basic-triggers
plan: 07
subsystem: web+api
tags: [ui, chat-bubbles, creator-controls, bot-toggle, hono, react]

# Dependency graph
requires:
  - phase: 11-personality-basic-triggers
    plan: 02
    provides: personalities table, debate-strategy-v1 bot_defaults/role_personalities/bot_cooldowns, sessions.bot_overrides column
provides:
  - "POST /api/sessions/:id/bots — creator-only toggle writing sessions.bot_overrides (botsRouter)"
  - "BOT_PERSONA_DISPLAY — persona-keyed MessageBubble lookup (Analista Científico / Facilitador / Analista-Verificador)"
  - "Facilitador + Analista/Verificador toggle cards + read-only cooldown caption in CreatorControls (Analistas activos drawer, desktop + mobile)"
affects: [11-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Creator-only mutation route: copy the session.creator_id !== user.id 403 guard verbatim from the existing personas.ts pattern rather than re-deriving it"
    - "Persona-keyed display lookup with a never-crash fallback (Bot icon + truncated label) instead of a hardcoded conditional per persona"

key-files:
  created:
    - apps/api/src/routes/bots.ts
  modified:
    - apps/api/src/index.ts
    - packages/types/src/session.ts
    - apps/web/components/workspace/MessageBubble.tsx
    - apps/web/components/workspace/CreatorControls.tsx
    - "apps/web/app/(protected)/sessions/[id]/workspace.tsx"

key-decisions:
  - "Mounted botsRouter in apps/api/src/index.ts, not apps/api/src/app.ts as the plan's files_modified listed — this repo's actual Hono entry file is index.ts (app.ts does not exist); a plan-vs-repo naming mismatch, not a design change."
  - "Added bot_overrides to packages/types SessionSchema (undeclared in the plan's files_modified) — required so the frontend toggle cards can read the per-session override map; the column has existed since migration 0014 (Plan 02) but was never surfaced in the shared type."
  - "Task 4 (live browser verification of bubbles/toggles/cooldown text) was accepted via code-level review instead of an actual browser session: this execution environment has no browser automation tool available. Verified instead: (1) exact Spanish copy strings (cooldown caption, both toast error variants) match the plan's must-haves character-for-character via grep; (2) the creator-only 403 guard in bots.ts is byte-identical to the existing, already-shipped personas.ts guard; (3) tsc --noEmit clean on both apps/api and apps/web; (4) full test suites green apart from pre-existing unrelated failures. The user explicitly chose this acceptance path over pausing for a manual check. Visual rendering (bubble icons/colors, toggle interaction, mobile Sheet layout) has NOT been eyeballed in a running browser — flag for a spot-check next time the workspace UI is open."

requirements-completed: [PERSONA-01, PERSONA-02, PERSONA-03]

# Metrics
duration: ~25min (agent execution to Task 4 checkpoint) + orchestrator cherry-pick/merge + code-review acceptance
completed: 2026-07-15
---

# Phase 11 Plan 07: Bot UI Surface Summary

**Added distinct chat bubbles and creator-only toggle cards for the two new bot Roles (Facilitador/Coach, Analista/Verificador/Analyst), plus a read-only cooldown caption — the only user-visible surface of Phase 11 — backed by a creator-only `/api/sessions/:id/bots` route that writes `sessions.bot_overrides`.**

## Accomplishments

- **Task 1:** `apps/api/src/routes/bots.ts` — `botsRouter`, `POST /api/sessions/:id/bots` toggling `{ botId: 'coach'|'analyst', active }` into `sessions.bot_overrides`, preserving other keys. Creator-only 403 guard copied verbatim from `personas.ts`. Mounted in `index.ts`. Added `bot_overrides` to `packages/types` `SessionSchema`.
- **Task 2:** `MessageBubble.tsx` generalized from a hardcoded Analista Científico conditional to a `BOT_PERSONA_DISPLAY` lookup keyed by `message.display_name`, covering all three personas plus a never-crash fallback (generic Bot icon + truncated label).
- **Task 3:** `CreatorControls.tsx` — two new toggle cards (Facilitador/MessageCircleQuestion, Analista-Verificador/SearchCheck) in the "Analistas activos" Sheet (desktop + mobile), a generalized `handleBotToggle` (optimistic update, POST, revert + Spanish toast on failure), and a read-only cooldown caption with the plan's exact copy.
- **Task 4 (checkpoint):** Live visual verification was not performed (no browser tool in this session). Accepted on code review per explicit user decision — see key-decisions above for exactly what was and wasn't verified.

## Task Commits

1. **Task 1:** `a5fb83f` (feat) — creator-only per-session bot toggle route (cherry-picked from `e455bf0`)
2. **Task 2:** `838fe26` (feat) — persona-keyed MessageBubble lookup (cherry-picked from `43c593e`)
3. **Task 3:** `62abe9b` (feat) — bot toggle cards + read-only cooldown display (cherry-picked from `d5c4a1f`)

**Note on commit hashes:** the executor agent's worktree branch was accidentally fast-forwarded onto `origin/main` (which contains an unrelated, unmerged PR — a Vercel `env.ts` refactor) before the agent's own fix-up merge. The orchestrator did not merge that branch directly; instead it cherry-picked the three plan commits (`e455bf0`, `43c593e`, `d5c4a1f` — each independently verified via `git show --stat` to touch only plan-declared files) onto a clean branch off local `main`, producing new hashes (`a5fb83f`/`838fe26`/`62abe9b`) with identical diffs. No `env.ts` or other unrelated content reached `main`.

## Files Created/Modified
- `apps/api/src/routes/bots.ts` (new) — `botsRouter`
- `apps/api/src/index.ts` — mount `botsRouter`
- `packages/types/src/session.ts` — `bot_overrides` field on `SessionSchema`
- `apps/web/components/workspace/MessageBubble.tsx` — `BOT_PERSONA_DISPLAY` lookup
- `apps/web/components/workspace/CreatorControls.tsx` — bot toggle cards, cooldown caption, `handleBotToggle`
- `apps/web/app/(protected)/sessions/[id]/workspace.tsx` — wire existing `blueprint` prop into `CreatorControls`

## Deviations from Plan
- Router mounted in `index.ts` instead of the plan's declared `app.ts` (file doesn't exist in this repo; `index.ts` is the actual entry point).
- `packages/types/src/session.ts` modified though not in the plan's `files_modified` — necessary for the frontend to read `bot_overrides`; the column existed since Plan 02 but was never typed.
- Task 4's live-browser check was replaced with a code-review acceptance path (see key-decisions) — an explicit, user-approved deviation from the plan's `<how-to-verify>` steps 1-2-3-4-5-6, of which only steps matching static/API-level evidence (copy text, 403 guard) were actually confirmed.

## Issues Encountered

**Worktree branch contamination (resolved):** the spawned executor's worktree had fast-forwarded onto `origin/main` mid-execution, pulling in an unrelated, not-yet-locally-merged PR (`#17`, Vercel `env.ts` deployment fix). The orchestrator caught this before merging by diffing `main...worktree-branch` and finding `apps/api/src/lib/env.ts` in the changed-files list despite it not appearing in any of the plan's three commits' own diffs. Resolved by cherry-picking the three clean commits onto local `main` directly rather than merging the polluted branch. `origin/main`'s PR #17 was left untouched — it is unrelated to this phase and will be reconciled separately (local `main` is currently ahead of `origin/main`, not behind, apart from that one PR).

## Known Issues (pre-existing, out of scope)
- `apps/api/src/lib/bot-arbitrator.test.ts:136` — pre-existing `TS2532`, Phase 10, unrelated.
- 2 `apps/api/src/routes/ai.test.ts` tests fail (`expected 404 to be 200`) — verified pre-existing at the pre-Phase-11 commit (`8572745`), unrelated to any Phase 11 plan.

## User Setup Required
- **Recommended, not blocking:** open a session as creator and spot-check the "Analistas activos" drawer (desktop + mobile) to visually confirm bubble colors/icons and toggle interaction match expectations — this was not done via browser in this execution.

## Next Phase Readiness
- Plan 06 (silence-scan trigger loop) can now rely on `sessions.bot_overrides` being both migrated (Plan 02) and readable/writable end-to-end (this plan) when deciding whether the Coach bot is enabled for a given session.

---
*Phase: 11-personality-basic-triggers*
*Completed: 2026-07-15*

## Self-Check: PASSED

All modified files verified present on disk; all 3 commits (a5fb83f, 838fe26, 62abe9b) verified in git log on `main`.
