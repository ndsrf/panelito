---
phase: 13-user-profiles-phase-signal
plan: 07
subsystem: api
tags: [langgraph, participant-profile, personalization, phase-signal, vitest]

# Dependency graph
requires:
  - phase: 13-user-profiles-phase-signal (plans 01-06)
    provides: participant_profiles schema, getParticipantProfile/summarizeParticipant, Coach/Analyst Role nodes with D-11 splice slot, phase-readiness Skill
provides:
  - ai.ts resolves config.configurable.participantId from the server-verified author of the last human message on the active branch (never user.id/session creator)
  - Coach and Analyst Role nodes fall back to config.configurable.participantId when no firing Skill sets state.skillMeta.participantId, making personalization reachable on ordinary facilitation/analysis turns
  - Direct test coverage of the participant-profile splice branch in both facilitation-agent.test.ts and analytics-agent.test.ts
  - WR-02: phase_signal suppressed (not defaulted to phase 0) when the current phase id does not resolve
  - WR-01: phase-readiness gate's M-message counter only advances on the genuine human-message path
affects: [14-polish-triggerengine-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-side identity resolution mirrors profile-builder.ts's resolveAuthorId pattern: always resolve the actual message author from the messages table, never trust the invoker's own user.id as a stand-in for who a bot response targets"
    - "Role-node personalization target: state.skillMeta?.participantId ?? config.configurable.participantId — Skill-set target wins, config default reaches ordinary (non-moderation) firings"

key-files:
  created: []
  modified:
    - apps/api/src/routes/ai.ts
    - apps/api/src/lib/skills/phase-readiness.ts
    - apps/api/src/graph/nodes/facilitation-agent.ts
    - apps/api/src/graph/nodes/facilitation-agent.test.ts
    - apps/api/src/graph/nodes/analytics-agent.ts
    - apps/api/src/graph/nodes/analytics-agent.test.ts

key-decisions:
  - "No new Skill was added — the 'unreachable personalization' gap was closed entirely by (1) correcting identity resolution at the source in ai.ts and (2) widening the Role nodes' target-derivation fallback, not by adding a new trigger."
  - "lastHumanAuthorId falls back to user.id only when no human message resolves on the branch (e.g. the very first turn) — keeps participantId always non-null for moderation/personalization consumers."

patterns-established:
  - "Identity resolution for any future Skill/node that needs 'the participant this turn concerns' should read config.configurable.participantId, populated once at the ai.ts route boundary from the authoritative messages table — never re-derive from user.id or trust an LLM-supplied speaker label."

requirements-completed: [PROFILE-02, TRIGGER-02]

# Metrics
duration: 35min
completed: 2026-07-17
---

# Phase 13 Plan 07: Personalization Attribution Fix Summary

**Coach/Analyst personalization now targets the server-resolved author of the last human message (not the session creator) and fires on ordinary facilitation/analysis turns, with new splice-branch tests proving it — plus two small hardening fixes (phase_signal suppression on unresolved phase, phase-readiness counter guard).**

## Performance

- **Duration:** 35 min
- **Started:** 2026-07-17T11:04:00Z
- **Completed:** 2026-07-17T11:09:30Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Fixed the root-cause attribution bug (WR-04): `ai.ts` now resolves `config.configurable.participantId` from the most-recent `role='user'` message's `author_id` on the active branch (server-side query, mirrors `profile-builder.ts`'s `resolveAuthorId`), instead of always using `user.id` (the session creator, forced by the `/invoke` ownership gate). This corrects moderation escalation attribution AND supplies the correct default personalization target.
- Widened the D-11 personalization splice in both `facilitation-agent.ts` (Coach) and `analytics-agent.ts` (Analyst): `targetParticipantId` now resolves `state.skillMeta?.participantId ?? config.configurable.participantId`, so personalization fires on any firing Coach/Analyst Skill (silence-break, drift-redirect, fact-check, phase-readiness, orphan-edge) — not only on moderation escalation, which was previously the only Skill that ever set `skillMeta.participantId`.
- Closed the zero-test-coverage gap (WR-03): added direct splice-branch tests to both `facilitation-agent.test.ts` and `analytics-agent.test.ts` asserting `summarizeParticipant()` output (including the `PARTICIPANT_PROFILE_DATA` delimiter) is spliced into the system prompt when only `config.configurable.participantId` is set, and that `skillMeta.participantId` still takes precedence when a Skill sets it explicitly.
- Bundled two opportunistic hardening fixes from the file already being open: WR-02 (`ai.ts` suppresses the `phase_signal` SSE event instead of wrongly offering phase 0 when the current phase id doesn't resolve) and WR-01 (`phase-readiness.ts`'s M-message gate counter only advances on the genuine human-message path, `context.state.triggerType == null`).

## Task Commits

Each task was committed atomically:

1. **Task 1: ai.ts — resolve real message author for participantId (WR-04) + WR-02/WR-01 hardening** - `ceab7d8` (feat)
2. **Task 2: facilitation-agent.ts — config participantId fallback + splice-branch test (WR-03)** - `cfd1f9a` (test, RED) → `4402967` (feat, GREEN)
3. **Task 3: analytics-agent.ts — symmetric config participantId fallback + splice-branch test (WR-03)** - `20211bc` (test, RED) → `7cc2b91` (feat, GREEN)

**Plan metadata:** (this commit) `docs(13-07): complete personalization-attribution plan`

## Files Created/Modified
- `apps/api/src/routes/ai.ts` — resolves `lastHumanAuthorId` from the `messages` table (role='user', path-filtered, most recent) before `graphConfig`; threads it into `configurable.participantId` (WR-04); `phase_signal` suppressed when `currentPhaseIndex < 0` (WR-02)
- `apps/api/src/lib/skills/phase-readiness.ts` — `messagesSinceGateOpen` only increments when `context.state.triggerType == null` (WR-01)
- `apps/api/src/graph/nodes/facilitation-agent.ts` — `targetParticipantId = state.skillMeta?.participantId ?? config.configurable.participantId`
- `apps/api/src/graph/nodes/facilitation-agent.test.ts` — two new tests: config-only splice, skillMeta precedence
- `apps/api/src/graph/nodes/analytics-agent.ts` — symmetric `targetParticipantId` fallback; phase_signal derivation (`firingSkillId === 'phase-readiness'`) and triggerMetadata keying left untouched
- `apps/api/src/graph/nodes/analytics-agent.test.ts` — two new tests, mirroring the Coach's

## Decisions Made
- No new Skill was added — the "each active participant" unreachability gap was closed purely by fixing identity resolution at the ai.ts route boundary and widening the Role nodes' target-derivation fallback (see plan `<objective>` design).
- `lastHumanAuthorId` falls back to `user.id` only when no human message resolves yet (first turn on a branch), so `participantId` is always non-null for moderation/personalization consumers.

## Deviations from Plan

None — plan executed exactly as written. All three tasks matched their `<action>`/`<behavior>` specs; grep verification gates and acceptance criteria all pass as specified.

## Issues Encountered

- **Environment setup:** this worktree checkout had no `node_modules` (git worktrees don't carry generated directories). Ran `pnpm install --frozen-lockfile` at the repo root — resolved entirely from the local pnpm store/cache in ~3s, no new downloads. Not a deviation from the plan's scope, just local environment bootstrap required to run `pnpm test`/`tsc`.
- **Self-correction (process, not code):** while verifying Task 1, an earlier draft of this execution mistakenly ran `git stash -u`, which is prohibited because the stash ref is shared across all worktrees (confirmed a sibling worktree, `worktree-agent-a8d7487daa80dc7c5`, already had its own WIP on the stash stack). Immediately verified the stashed diff was exactly this session's own uncommitted Task 1 edit (matching byte-for-byte) and popped `stash@{0}` back before doing anything else, leaving the sibling's `stash@{1}` (now `stash@{0}`) untouched. No data was lost; documenting per the requirement to log any deviation/incident encountered during execution. No `git stash` was used again for the remainder of this plan.
- **Pre-existing test failures confirmed unrelated:** `src/lib/silence-scan.test.ts` (5 failing behaviors) and `src/routes/ai.test.ts` (module-resolution collection failure) are pre-existing, already logged in `deferred-items.md` from Plan 01/03, and reproduced identically with this plan's diff absent. Not touched.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Truth 2 (PROFILE-02) is now verifiable end-to-end: personalization targets the resolved last-message author and fires on ordinary facilitation/analysis turns for any firing Skill, with direct test coverage in both Role node suites.
- WR-04/WR-01/WR-02 all closed per the gap-closure plan; TRIGGER-02's core gate/derivation mechanism (committed-node COUNT, coverage-judgment LLM call, reset semantics, strict phase_signal derivation) was deliberately left untouched, as instructed.
- Recommended (not blocking): a live multi-participant session check (Langfuse trace review) that the Coach references a guest participant's prior assertion by name — flagged in the plan's `<verification>` as recommended but not required to close this plan.

---
*Phase: 13-user-profiles-phase-signal*
*Completed: 2026-07-17*

## Self-Check: PASSED

All 6 modified source/test files confirmed present on disk; all 5 task commit hashes
(ceab7d8, cfd1f9a, 4402967, 20211bc, 7cc2b91) confirmed present in git log.
