---
phase: 14-polish-triggerengine-wiring
plan: 01
subsystem: types
tags: [zod, vitest, typescript, ai-adapter-contract, speech-filter, blueprint-schema]

# Dependency graph
requires:
  - phase: 11-personality-basic-triggers
    provides: "drift_detection_enabled precedent on BlueprintSchema (optional-in-DB, Zod-default pattern)"
  - phase: 04-multi-ai-providers
    provides: "AIStreamEvent union and AIProvider.stream() adapter contract in packages/types/src/ai.ts"
provides:
  - "AIStreamEvent.usage member (inputTokens/outputTokens) for COST-03 token accounting"
  - "SPEECH_ARTIFACT_BLOCKLIST + containsSpeechArtifact() shared substring matcher (SPEECH-01/02/03)"
  - "BlueprintSchema.silence_phase_readiness_coupling_enabled opt-in toggle, default false (TRIGGER-07/D-04)"
affects: [14-03-adapter-wiring, 14-04-triggerengine, 14-05-frontend-speech-filter, 14-06-nodes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Provider-neutral AIStreamEvent variants: adapter boundary never leaks provider-specific field names (input_tokens, usageMetadata) past packages/types/src/ai.ts"
    - "Curated exact-string blocklist + .includes() substring matcher (no regex, no ReDoS surface) for LLM-output filtering"
    - "Blueprint opt-in toggle pattern: z.boolean().default(false) sibling field, optional in DB, Zod supplies default so existing seeded Blueprints parse without migration"

key-files:
  created:
    - packages/types/src/speech-artifacts.ts
    - packages/types/src/speech-artifacts.test.ts
    - packages/types/src/blueprint.test.ts
  modified:
    - packages/types/src/ai.ts
    - packages/types/src/blueprint.ts
    - packages/types/src/index.ts

key-decisions:
  - "usage variant appended as 4th AIStreamEvent union member (not inserted mid-union) to preserve existing text_delta | tool_use | done ordering for downstream exhaustiveness checks"
  - "Added packages/types/src/blueprint.test.ts (not explicitly listed in plan frontmatter files_modified) to satisfy Task 3's acceptance criteria requiring proof the new field defaults correctly on parse; mirrors the existing drift_reply_probability fixture in apps/api/src/lib/blueprint-loader.test.ts"

patterns-established:
  - "SPEECH_ARTIFACT_BLOCKLIST as the single source of truth for artifact strings — downstream consumers (frontend filter, backend prompt reference) import from @panelito/types rather than duplicating the list"

requirements-completed: [COST-03, SPEECH-01, SPEECH-02, SPEECH-03, TRIGGER-07]

# Metrics
duration: 20min
completed: 2026-07-17
---

# Phase 14 Plan 01: Shared Type/Contract Foundations Summary

**Extended AIStreamEvent with a provider-neutral `usage` variant, shipped a shared speech-artifact blocklist + substring matcher module, and added the D-04 Blueprint opt-in toggle for silence↔phase-readiness coupling — all three barrel-exported from `@panelito/types`.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-17T15:52:00Z
- **Completed:** 2026-07-17T15:55:37Z
- **Tasks:** 3 completed
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- `AIStreamEvent` union now has a `usage` member (`inputTokens`/`outputTokens`) — the contract Plan 03's three adapters emit and Plan 03's Generation helper / Plan 06's Role nodes consume for COST-03 token accounting.
- New `packages/types/src/speech-artifacts.ts` module: `SPEECH_ARTIFACT_BLOCKLIST` (D-08 curated exact-string list) + `containsSpeechArtifact()` substring matcher, TDD'd (RED then GREEN), barrel-exported.
- `BlueprintSchema` gained `silence_phase_readiness_coupling_enabled: z.boolean().default(false)` — Blueprint-global (not phase-nested), opt-in per D-04, backward-compatible with existing seeded Blueprints.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add `usage` member to the AIStreamEvent union** - `089b8dd` (feat)
2. **Task 2: Create shared speech-artifact blocklist + substring matcher** - `ffddbe3` (test, RED) + `0c54889` (feat, GREEN)
3. **Task 3: Add D-04 silence↔phase-readiness Blueprint toggle** - `5b27074` (feat)

_Note: Task 2 was TDD (`tdd="true"`) — test-first RED commit followed by GREEN implementation commit, no refactor needed._

## Files Created/Modified
- `packages/types/src/ai.ts` - Added `usage` member to `AIStreamEvent` union; updated doc-comment enumerating union members
- `packages/types/src/speech-artifacts.ts` - New module: `SPEECH_ARTIFACT_BLOCKLIST` + `containsSpeechArtifact()`
- `packages/types/src/speech-artifacts.test.ts` - 5 behavior tests (substring mid-message, whole-string match, negative cases, empty string)
- `packages/types/src/blueprint.ts` - Added `silence_phase_readiness_coupling_enabled: z.boolean().default(false)` sibling to `drift_detection_enabled`
- `packages/types/src/blueprint.test.ts` - New (not in plan's `files_modified` list; see Deviations) — 2 tests asserting default `false` and explicit `true` opt-in
- `packages/types/src/index.ts` - Barrel re-export of `SPEECH_ARTIFACT_BLOCKLIST` and `containsSpeechArtifact`

## Decisions Made
- Kept `usage` as the fourth (appended) union member rather than reordering, to avoid disturbing any downstream exhaustive `switch` statements that may already exist on the three original members.
- `silence_phase_readiness_coupling_enabled` placed at Blueprint top level (not inside `PhaseSequenceSchema`), matching D-04's Blueprint-global scope, distinct from the phase-nested `phase_readiness_gate` added in Phase 13.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `packages/types/src/blueprint.test.ts` to prove the new default**
- **Found during:** Task 3 (D-04 Blueprint toggle)
- **Issue:** Plan's `files_modified` list only named `packages/types/src/blueprint.ts` for this task, but the acceptance criteria explicitly required "a `BlueprintSchema.parse(...)` call on a blueprint object that omits the field yields `silence_phase_readiness_coupling_enabled === false`... (add or extend a blueprint test asserting the default, or confirm via existing blueprint-loader test path)." No `blueprint.test.ts` existed yet in `packages/types`, and the existing `apps/api/src/lib/blueprint-loader.test.ts` integration test requires a live Supabase connection (fails locally with missing env vars — pre-existing, unrelated to this change, confirmed by running it: 6/7 tests pass, the 1 failure is an env-var gate on `loadBlueprint`'s DB round-trip, not a schema issue).
- **Fix:** Created `packages/types/src/blueprint.test.ts` mirroring the `MINIMAL_VALID_BLUEPRINT_DEF` fixture pattern from `blueprint-loader.test.ts`, asserting both the default-false and explicit-true opt-in behavior.
- **Files modified:** `packages/types/src/blueprint.test.ts` (new)
- **Verification:** `cd packages/types && npx vitest run` — 8 test files, 56 tests, all passing
- **Committed in:** `5b27074` (part of Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical — test coverage for acceptance criteria)
**Impact on plan:** Necessary to satisfy the plan's own acceptance criteria for Task 3; no scope creep beyond what the plan already required.

## Issues Encountered
- Worktree had no `node_modules` installed (git worktrees don't carry ignored directories). Ran `pnpm install --frozen-lockfile` at the repo root — resolved instantly against the shared pnpm content-addressable store (no downloads), so `tsc`/`vitest` became available. This is an environment-setup step, not a plan deviation.
- `apps/api/src/lib/blueprint-loader.test.ts`'s integration test (`resolves for debate-strategy-v1`) fails locally due to missing Supabase env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.). This is pre-existing and out of scope (not touched by this plan's files) — logged here for visibility, not fixed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 03 (adapters) can now import and emit the `usage` AIStreamEvent variant with `inputTokens`/`outputTokens`.
- Plan 05 (frontend) and any backend prompt reference (SPEECH-01/03) can import `containsSpeechArtifact`/`SPEECH_ARTIFACT_BLOCKLIST` from `@panelito/types`.
- Plan 04 (TriggerEngine) can read `blueprint.silence_phase_readiness_coupling_enabled` to gate silence↔phase-readiness coupling per Blueprint.
- No blockers for downstream Phase 14 plans.

---
*Phase: 14-polish-triggerengine-wiring*
*Completed: 2026-07-17*
