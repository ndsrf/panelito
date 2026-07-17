---
phase: 13-user-profiles-phase-signal
plan: 05
subsystem: api
tags: [langgraph, supabase, phase-signal, participant-profile, hono, vitest]

# Dependency graph
requires:
  - phase: 13-user-profiles-phase-signal
    provides: "Plan 02 participant-profile.ts (getParticipantProfile), Plan 03 profileBuilderNode + graph wiring, Plan 04 phase-readiness Skill + phaseGateProgress state field"
provides:
  - "ai.ts graphConfig.configurable now supplies supabase/serviceClient/branchId/participantId/botOverrides on the human /invoke path — profileBuilder, phase-readiness, and moderation are reachable in production for the first time"
  - "analyticsAgentNode derives phase_signal strictly from state.firingSkillId === 'phase-readiness', reusing the existing SSE -> CreatorControls -> PATCH plumbing unchanged"
  - "Both Role nodes (analyticsAgentNode, facilitationAgentNode) splice a firing Skill's target participant profile summary into their system prompt guidance when state.skillMeta.participantId is present (D-11)"
  - "Integration test proving phase_signal emission, misattribution guard, cost-tier guard, and profile reachability end-to-end with fully injected adapters/DB client"
affects: [14-polish-triggerengine-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "graphConfig.configurable dual-keys the same Supabase service client under both `supabase` and `serviceClient` to satisfy every existing consumer's seam name without changing any consumer"
    - "Role node D-11 personalization slot: participant profile summary is concatenated into the existing skillGuidance string (step 3.5) rather than adding a new prompt-builder parameter, preserving the existing buildXSystemPrompt() signatures and their tests"

key-files:
  created: []
  modified:
    - apps/api/src/routes/ai.ts
    - apps/api/src/graph/nodes/analytics-agent.ts
    - apps/api/src/graph/nodes/facilitation-agent.ts
    - apps/api/src/graph/graph.integration.test.ts

key-decisions:
  - "botOverrides is read from sessions.bot_overrides (the same column POST /api/sessions/:id/bots writes) — sessions SELECT expanded to include it, no new table/route"
  - "phase_signal derivation uses strict === 'phase-readiness' equality (never a broader 'any Analyst Skill fired' check) to prevent fact-check/orphan-edge firings from spoofing the Advance-Phase affordance (T-13-12)"
  - "D-11 personalization implemented symmetrically in both Role nodes even though no current Analyst Skill sets skillMeta.participantId (only moderation, a Coach Skill, does) — future-proofs the seam per the plan's literal instruction"

patterns-established:
  - "Integration tests exercising real (unmocked) lib/skills Analyst Skills end-to-end via fully injected adapters/serviceClient, distinct from graph.test.ts's mocked-skills unit-level topology tests"

requirements-completed: [PROFILE-02, TRIGGER-02]

# Metrics
duration: ~35min
completed: 2026-07-16
---

# Phase 13 Plan 05: Reachability Fix + Phase-Signal Emission + Coach/Analyst Personalization Summary

**Threaded supabase/branchId/participantId/botOverrides into ai.ts's graphConfig.configurable (closing the production-reachability gap for profileBuilder/phase-readiness/moderation), derived phase_signal strictly from a firing phase-readiness Skill, and wired D-11 participant-profile personalization into both Role nodes — proven end-to-end by a new integration test using real (unmocked) Analyst Skills.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-16
- **Tasks:** 3/3 completed
- **Files modified:** 4

## Accomplishments
- `ai.ts`'s human `/invoke` path now supplies `supabase`, `serviceClient` (alias), `branchId`, `participantId`, and `botOverrides` in `graphConfig.configurable` — previously these were only ever supplied by test harnesses, so `profileBuilderNode`, the `phase-readiness` Skill, and `moderationSkill` were silent no-ops in production. This also retroactively fixes Phase 12's silently-broken moderation escalation and the dead "Analistas activos" toggle (D-12/D-13).
- `analyticsAgentNode` now sets `phase_signal: true` strictly when `state.firingSkillId === 'phase-readiness'`, and `null` otherwise — the existing SSE → `CreatorControls` → `PATCH /:id/phase` plumbing (unchanged) now has a live, correctly-gated signal to consume in production.
- Both `analyticsAgentNode` and `facilitationAgentNode` splice `summarizeParticipant()` output into their system prompt's step-3.5 guidance slot when the firing Skill's `skillMeta.participantId` is resolvable, fetching the profile via the same `config.configurable.supabase`/`branchId` seam other nodes already use. Fails open (no throw, safe placeholder text) on missing context or fetch error.
- A new integration test (`graph.integration.test.ts`) exercises the **real** `fact-check` and `phase-readiness` Analyst Skills end-to-end (no `lib/skills` mock, unlike `graph.test.ts`) with fully injected adapters and a mock Supabase service client — proving phase_signal emission, the misattribution guard (a firing `fact-check` Skill never sets `phase_signal`), the `.analysis` cost-tier resolution for the coverage-judgment call, and profile-upsert reachability on the human path.

## Task Commits

Each task was committed atomically:

1. **Task 1: ai.ts — thread supabase/branchId/participantId/botOverrides into graphConfig.configurable** - `53e719a` (feat)
2. **Task 2: analyticsAgentNode phase_signal derivation + D-11 personalization in both Role nodes** - `6e6003a` (feat)
3. **Task 3: End-to-end integration test — phase_signal emission + profile population + misattribution guard** - `63477c3` (test)

_This plan has no `docs: complete plan` metadata commit in worktree mode — SUMMARY.md is committed separately per the worktree executor protocol._

## Files Created/Modified
- `apps/api/src/routes/ai.ts` - Sessions SELECT expanded to include `bot_overrides`; `graphConfig.configurable` now supplies `supabase`/`serviceClient`/`branchId`/`participantId`/`botOverrides`
- `apps/api/src/graph/nodes/analytics-agent.ts` - `phase_signal` derivation (strict `firingSkillId === 'phase-readiness'`); D-11 participant-profile splice into skill guidance
- `apps/api/src/graph/nodes/facilitation-agent.ts` - D-11 participant-profile splice into skill guidance (symmetric with analytics-agent.ts)
- `apps/api/src/graph/graph.integration.test.ts` - New describe block: 3 tests proving phase_signal emission, misattribution guard, cost-tier guard, and profile reachability using real (unmocked) Analyst Skills

## Decisions Made
- **botOverrides source:** read from `sessions.bot_overrides` — the exact column `POST /api/sessions/:id/bots` (`routes/bots.ts`) already writes for the "Analistas activos" toggle. No new table, no new route; the existing `sessions` SELECT in `ai.ts` was simply expanded to include this column.
- **Dual-key Supabase client:** the same service-role client instance is threaded under both `configurable.supabase` (read by `moderation.ts`) and `configurable.serviceClient` (read by `profileBuilderNode`, `orphan-edge.ts`, `phase-readiness.ts`) — avoids touching any consumer's existing seam name.
- **phase_signal strict equality:** `state.firingSkillId === 'phase-readiness'` only — never a broader "any Analyst Skill fired" check. This directly closes threat T-13-12 (a non-phase-readiness Skill firing must never spoof the user-facing "Advance Phase" affordance); proven by integration Test (2).
- **D-11 personalization splice point:** rather than adding a new parameter to `buildAnalyticsSystemPrompt`/`buildCoachSystemPrompt`, the participant profile summary is concatenated onto the existing `skillGuidance` string before it's passed in — this keeps the builder function signatures and their existing unit tests (`analytics-agent.test.ts`, `facilitation-agent.test.ts`) unchanged while still landing in the correct step-3.5 slot (after argGraph context, before Personality voice).

## Deviations from Plan

None - plan executed exactly as written. All three tasks' acceptance criteria were met without requiring architectural changes, additional bug fixes, or scope additions beyond what the plan specified.

## Issues Encountered

**Environment: worktree lacked `node_modules`.** This worktree had no installed dependencies at session start (`pnpm exec tsc` initially failed with "tsc not found"). Ran `pnpm install --offline` (resolved entirely from the existing local pnpm content-addressable store — no network access, no version changes, `pnpm-lock.yaml` unmodified) to populate `node_modules` for verification. This is a one-time local dev-environment setup step, not a code change; `node_modules` remains gitignored and was not committed.

**Pre-existing test-infrastructure gap (documented, not fixed):** `apps/api/src/routes/ai.test.ts` (and every other `src/routes/*.test.ts` file, none of which this plan touches) fails to even collect in this worktree with `Error: Cannot find module 'hono/streaming' imported from '.../src/routes/ai.ts'`. This is `.planning/phases/13-user-profiles-phase-signal/deferred-items.md` item #2, already logged by Plan 01 as pre-existing and out of scope — reproduced here with a completely unmodified `keys.test.ts` (which only transitively imports `ai.ts` via the shared router and which this plan never touches), confirming it is a `vitest.config.ts` worktree-alias resolution bug (the config's `mainRepoNodeModules` fallback-alias logic prefix-matches `hono` and rewrites `hono/streaming` to a literal filesystem path that doesn't exist, since `hono/streaming` only resolves via the package's `exports` map), not a regression introduced by this plan's `ai.ts` edit. Verified Task 1's `ai.ts` changes instead via: (a) `pnpm exec tsc --noEmit` (clean pass), (b) targeted grep assertions confirming all four required `configurable` keys are present and existing keys/SSE block are unchanged, (c) manual code review against `moderation.ts`/`profile-builder.ts`/`phase-readiness.ts`'s own documented `config.configurable` seam names, and (d) the new `graph.integration.test.ts` tests, which exercise the exact same `config.configurable` keys `ai.ts` now supplies (`supabase`/`serviceClient`/`branchId`/`participantId`) end-to-end through the real graph and real Skills — the only thing not exercised by that substitute path is `ai.ts`'s own HTTP route handler wiring (session SELECT, botOverrides extraction, SSE plumbing), which was reviewed by hand instead.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 13's reachability gap (RESEARCH.md Finding 2) is closed: `profileBuilderNode`, the `phase-readiness` Skill, and `moderationSkill` all receive live `supabase`/`branchId`/`participantId`/`botOverrides` on every real human `/invoke` call.
- `phase_signal` now flows end-to-end from a real `phase-readiness` Skill firing through to the existing SSE → `CreatorControls` → `PATCH /:id/phase` UI flow (human still clicks to advance — HUMAN-02 unchanged).
- Coach/Analyst prompts include a targeted participant's profile summary whenever a firing Skill names one (currently only `moderationSkill` does; the seam is ready for any future Skill that sets `skillMeta.participantId`).
- Known pre-existing gap (not introduced by this plan, not blocking): `src/routes/ai.test.ts` and its sibling route test files cannot be executed in this worktree due to a `vitest.config.ts` alias-resolution bug (`deferred-items.md` item #2) — recommend fixing that config before treating any `apps/api/src/routes/*.test.ts` suite as verified in worktree-executed plans going forward.

---
*Phase: 13-user-profiles-phase-signal*
*Completed: 2026-07-16*

## Self-Check: PASSED

All modified files and all three task commit hashes verified present on disk / in git log.
