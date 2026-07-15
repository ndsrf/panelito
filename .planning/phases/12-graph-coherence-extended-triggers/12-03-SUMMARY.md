---
phase: 12-graph-coherence-extended-triggers
plan: 03
subsystem: api
tags: [langgraph, onnx, embeddings, moderation, prompt-injection, coach-skills, typescript, vitest]

# Dependency graph
requires:
  - phase: 12-graph-coherence-extended-triggers
    provides: "Skill/SkillContext interfaces + SkillDetectionResult schema (Plan 01), embeddings.ts embed/cosineSimilarity/getDomainCentroid + moderation-count.ts getModerationCount (Plan 02)"
provides:
  - "silenceBreakSkill — Coach Skill retrofitting checkSilenceGate() onto the Skill contract (D-03), delivery mechanism unchanged"
  - "driftRedirectSkill — Coach Skill firing on sustained sub-threshold cosine drift vs the Blueprint domain centroid (D-08/D-09, TRIGGER-03)"
  - "moderationSkill + checkModerationHeuristic() — Coach Skill firing from a zero-cost Spanish heuristic pre-filter with moderation_count-keyed de-escalating tone (D-11/D-16, TRIGGER-06)"
  - "CONTEXT_WINDOWS.driftCheck = 3 constant (bot-context.ts)"
  - "escapeUntrustedText() exported from bot-context.ts for reuse by any Skill's buildPromptGuidance()"
affects: [12-04, 12-05, 12-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Skill detect()/buildPromptGuidance() config.configurable test-injection seam (supabase/branchId/participantId/silenceThresholdMs), mirrors orchestrator.ts/facilitation-agent.ts"
    - "Deterministic tone-tier lookup keyed by state.skillMeta (set by detect()'s meta, read later by buildPromptGuidance() after TriggerGateNode routes) — not an LLM-decided tone choice"
    - "Sustained-window gate: require the full CONTEXT_WINDOWS.driftCheck message count before evaluating drift, not just whatever is available"

key-files:
  created:
    - apps/api/src/lib/skills/silence-break.ts
    - apps/api/src/lib/skills/silence-break.test.ts
    - apps/api/src/lib/skills/drift-redirect.ts
    - apps/api/src/lib/skills/drift-redirect.test.ts
    - apps/api/src/lib/skills/moderation.ts
    - apps/api/src/lib/skills/moderation.test.ts
  modified:
    - apps/api/src/lib/bot-context.ts

key-decisions:
  - "escapeUntrustedText() promoted from a private bot-context.ts helper to an exported function — drift-redirect.ts and moderation.ts both needed the exact same WR-06 escaping logic; duplicating it would have violated the plan's own 'use escapeUntrustedText()' instruction"
  - "drift-redirect requires the FULL 3-message CONTEXT_WINDOWS.driftCheck window before evaluating (not just whatever is available) — this is what makes 'does not fire on a single tangential message' true by construction, not just by embedding-averaging luck"
  - "moderation's escalation tier flows through state.skillMeta (set by TriggerGateNode from detect()'s meta, read by buildPromptGuidance() after routing) rather than buildPromptGuidance() re-querying moderation-count.ts itself — keeps the tone lookup a pure, deterministic function of already-computed state, per D-16's 'not LLM-decided' requirement"
  - "ESCALATION_THRESHOLD_N = 3 chosen for moderation's gentle→direct tone shift (Claude's Discretion per 12-CONTEXT.md) — first 3 occurrences (count 0, 1, 2) get the gentle tier, the 4th+ (count >= 3) gets the direct tier"
  - "drift-redirect's cosine threshold defaults to 0.6 (Claude's Discretion, matches 12-PATTERNS.md's stated default) and is overridable via an optional (currently unused) blueprint.drift_threshold field — no such field exists in the Blueprint schema yet, so this is forward-compatible plumbing, not a live override path today"

patterns-established:
  - "Coach Skills reuse the exact config.configurable seam names (supabase, branchId, participantId, silenceThresholdMs, getPresenceTyping) that TriggerGateNode (Plan 06) and silence-scan.ts already thread through — no Skill reaches into a module-level global"

requirements-completed: [TRIGGER-03, TRIGGER-06]

# Metrics
duration: ~50min
completed: 2026-07-15
---

# Phase 12 Plan 03: Coach Skills (silence-break, drift-redirect, moderation) Summary

**Three Coach Skills built to the Skill contract — silence-break retrofits Phase 11's checkSilenceGate() unchanged, drift-redirect fires only on a sustained 3-message sub-threshold cosine drift against the static Blueprint domain centroid, and moderation fires from a zero-LLM-cost Spanish heuristic pre-filter with a deterministic gentle→direct tone escalation keyed by moderation_count — all detection is $0.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 3/3 completed (all TDD, RED→GREEN per task)
- **Files modified:** 7 (6 created, 1 modified)

## Accomplishments
- `silenceBreakSkill` (`id: 'silence-break'`, `role: 'coach'`) wraps `checkSilenceGate()` verbatim via the `config.configurable` seam; delivery mechanism (silence-scan.ts's `setInterval` loop + direct-DB-insert) is untouched, per D-03
- `driftRedirectSkill` (`id: 'drift-redirect'`, `role: 'coach'`) checks `blueprint.drift_detection_enabled` FIRST with zero embed() calls when disabled (D-09), requires the full 3-message trailing window before evaluating (so a single tangential message never fires it), fires when concatenated-window cosine similarity to `getDomainCentroid()` drops below 0.6, and frames its redirect as an invitation with WR-06-escaped interpolated content
- `moderationSkill` (`id: 'moderation'`, `role: 'coach'`) plus the pure `checkModerationHeuristic()` (curated Spanish insult keywords + ALL-CAPS ratio + repeated-punctuation structural signals, zero I/O) — `detect()` never touches the DB unless the heuristic flags; `buildPromptGuidance()` is a deterministic gentle/direct lookup keyed by `state.skillMeta.escalationTier`, never LLM-decided
- `CONTEXT_WINDOWS.driftCheck = 3` added to `bot-context.ts`; `escapeUntrustedText()` promoted from private to exported so both new Skills reuse the exact WR-06 escaping helper instead of reimplementing it
- 24 new unit tests across the three Skills, all passing; zero new `tsc --noEmit` errors introduced; zero new pre-existing test-suite regressions (confirmed against the same 6 pre-existing failures already logged in `deferred-items.md`)

## Task Commits

Each task followed the TDD RED→GREEN cycle:

1. **Task 1 RED: failing test for silence-break Skill** - `ec1cb25` (test)
2. **Task 1 GREEN: implement silence-break Skill (D-03 retrofit)** - `d022c4c` (feat)
3. **Task 2 RED: failing test for drift-redirect Skill + bot-context prep** - `59d1c7f` (test)
4. **Task 2 GREEN: implement drift-redirect Skill (D-08/D-09)** - `0004038` (feat)
5. **Task 3 RED: failing test for moderation Skill** - `8409595` (test)
6. **Task 3 GREEN: implement moderation Skill (D-11/D-16)** - `3c2bd9d` (feat)

**Plan metadata:** committed as part of this SUMMARY commit.

## Files Created/Modified
- `apps/api/src/lib/skills/silence-break.ts` - `silenceBreakSkill`: `detect()` wraps `checkSilenceGate()`, `buildPromptGuidance()` returns a short trigger-specific blurb (no few-shot duplication)
- `apps/api/src/lib/skills/silence-break.test.ts` - 5 tests: id/role, fires-on-passed, no-fire on typing/too_soon, guidance content
- `apps/api/src/lib/skills/drift-redirect.ts` - `driftRedirectSkill`: opt-out short-circuit, sustained-window gate, cosine-threshold fire logic, fail-silent on embed error, WR-06-escaped invitation-framed guidance
- `apps/api/src/lib/skills/drift-redirect.test.ts` - 7 tests: id/role, opt-out zero-embed, below/above-threshold fire logic, single-message no-fire, invitation framing, WR-06 delimiter
- `apps/api/src/lib/skills/moderation.ts` - `checkModerationHeuristic()` pure function + `moderationSkill`: zero-DB-call no-fire path, escalation-tier detect(), deterministic tone-tier `buildPromptGuidance()`
- `apps/api/src/lib/skills/moderation.test.ts` - 12 tests: heuristic flag/no-flag cases (keyword, ALL-CAPS, punctuation, innocent-emphatic, calm-disagreement), detect() zero-DB/escalation-tier cases, gentle/direct tone lookup, WR-06 delimiter
- `apps/api/src/lib/bot-context.ts` - added `CONTEXT_WINDOWS.driftCheck = 3`; exported `escapeUntrustedText()` (was private)

## Decisions Made
- `escapeUntrustedText()` exported rather than duplicated — both new Skills' `buildPromptGuidance()` needed the exact WR-06 escaping/delimiter logic already proven in `bot-context.ts`'s `summarizeArgGraph()`
- drift-redirect requires the FULL `CONTEXT_WINDOWS.driftCheck` (3) message window before evaluating at all — makes "single tangential message never fires" true by construction rather than relying on embedding-averaging behavior alone
- moderation's escalation tier flows through `state.skillMeta` (populated by TriggerGateNode from `detect()`'s `meta` before routing to the Role node) rather than `buildPromptGuidance()` re-querying `moderation-count.ts` — keeps the tone lookup a pure function of already-resolved state, structurally guaranteeing D-16's "not LLM-decided" tone lock
- `ESCALATION_THRESHOLD_N = 3` chosen for moderation (Claude's Discretion) — `moderation_count` 0, 1, 2 render the gentle tier; 3+ renders the direct tier
- drift-redirect's default cosine threshold is 0.6 (Claude's Discretion, matches 12-PATTERNS.md), with an as-yet-unused `blueprint.drift_threshold` override read path left in place for forward compatibility (no such Blueprint field exists yet — this is dead code today, not a live override)

## Deviations from Plan

None — plan executed exactly as written. `escapeUntrustedText()`'s export was an explicit consequence of the plan's own instruction ("wraps it via escapeUntrustedText()") rather than an unplanned fix; the function existed but was unexported, so making it importable was necessary groundwork, not a deviation.

## Issues Encountered
- `pnpm --filter api test -- <pattern>` (the plan's literal `<verify>` command) runs the ENTIRE `apps/api` test suite rather than filtering to the named pattern — same pre-existing tooling gap already documented in 12-02-SUMMARY.md. Worked around by invoking `./node_modules/.bin/vitest run <path>` directly, which correctly filters. `pnpm install` also had to be re-run in this worktree first (`node_modules` was missing, unrelated to this plan's changes — likely worktree-creation-time state).
- Confirmed the full `apps/api` suite shows the same 6 pre-existing failures already logged in `deferred-items.md` (silence-scan.test.ts Behaviors 2/3/4a/4b/5, blueprint-loader.test.ts) both before and after this plan's changes — no new regressions introduced. Not fixed (SCOPE BOUNDARY — unrelated to this plan's files).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Three of Coach's four planned Skills (`silence-break`, `drift-redirect`, `moderation`) now exist, are independently unit-tested, and export everything `apps/api/src/lib/skills.ts`'s `COACH_SKILLS` array (Plan 05) needs to reference
- `driftRedirectSkill`/`moderationSkill` both consume `config.configurable.supabase`/`branchId`/`participantId` — Plan 06's `TriggerGateNode` must thread these through exactly as named here when constructing each Skill's `SkillContext`
- `moderationSkill.buildPromptGuidance()` depends on `state.skillMeta.escalationTier` being populated from this same Skill's own `detect()` meta output before the Role node runs — Plan 06's `TriggerGateNode` → Role-node routing (D-06) must preserve `skillMeta` across that hand-off (it already does, per Plan 01's `skillMeta: Annotation<Record<string, unknown> | null>` overwrite-reducer)
- No blockers. The 6 pre-existing test failures (silence-scan.test.ts, blueprint-loader.test.ts) remain untouched and unrelated to this plan, as in Plans 01/02

---
*Phase: 12-graph-coherence-extended-triggers*
*Completed: 2026-07-15*

## Self-Check: PASSED

All 7 created/modified files verified present on disk (silence-break.ts/.test.ts,
drift-redirect.ts/.test.ts, moderation.ts/.test.ts, bot-context.ts). All 7 commit
hashes (ec1cb25, d022c4c, 59d1c7f, 0004038, 8409595, 3c2bd9d, a509bcb) verified
present in `git log`.
