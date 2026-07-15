---
phase: 12-graph-coherence-extended-triggers
plan: 04
subsystem: api
tags: [zod, langgraph, typescript, skills, supabase, cosine-similarity, cost-tiering]

# Dependency graph
requires:
  - phase: 12-graph-coherence-extended-triggers (Plan 01)
    provides: Skill/SkillContext interfaces, SkillDetectionResultSchema, factCheckClassificationTool, GraphState firingSkillId/firingSkillRole/skillMeta fields
  - phase: 12-graph-coherence-extended-triggers (Plan 02)
    provides: embeddings.ts (embed/cosineSimilarity ONNX singleton, GRAPH-03/TRIGGER-03)
provides:
  - orphanEdgeSkill (apps/api/src/lib/skills/orphan-edge.ts) — committed-orphan detection + D-13/D-14 ghost-edge cosine fallback
  - factCheckSkill (apps/api/src/lib/skills/fact-check.ts) — three-tier (heuristic/classification/analysis) fact-check escalation gate
  - looksLikeCheckableClaim() pure tier-1 heuristic, reusable/testable in isolation
affects: [12-05, 12-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Skill Supabase seam: config.configurable.serviceClient (mirrors the classifierAdapter/argGraphAdapter-style test-injection seam, first applied to a DB client instead of an AIProvider)"
    - "Skill AIProvider seam: config.configurable.factCheckClassifierAdapter (same naming convention as analyticsAdapter/facilitationAdapter/argGraphAdapter)"
    - "Local WR-06 escapeUntrustedText() helper duplicated per-Skill-file (bot-context.ts's version is not exported) — kept as a small private helper matching the same regex contract"
    - "Zero-adapter-call tier-1 gate proven via a plain vi.fn() stream spy assertion (not a mock-return-value assertion) — the strongest possible test for a cost-tiering guarantee"

key-files:
  created:
    - apps/api/src/lib/skills/orphan-edge.ts
    - apps/api/src/lib/skills/orphan-edge.test.ts
    - apps/api/src/lib/skills/fact-check.ts
    - apps/api/src/lib/skills/fact-check.test.ts
  modified:
    - .planning/phases/12-graph-coherence-extended-triggers/deferred-items.md

key-decisions:
  - "Supabase client seam named config.configurable.serviceClient (not explicitly specified by the plan) — orphan-edge is the first Skill/graph-node-adjacent module needing DB access from inside detect(); named to mirror createServiceClient() and the existing adapter-injection convention. Falls back to createServiceClient() in production when not injected. Plan 06 (TriggerGateNode) will need to thread this key through config.configurable when wiring orphan-edge into the live graph."
  - "fact-check's meta.claimMessageId sourced from config.configurable.lastMessageId (a new optional config field) rather than ProviderMessage.id — ProviderMessage (packages/types/src/ai.ts) has only { role, content }, no id field, so RESEARCH.md's illustrative `lastMessage.id` pseudocode cannot be implemented literally. Falls back to null when not provided by the caller; documented inline per arg-graph-builder.ts's 'document the source' convention for new config.configurable fields."
  - "orphan detection issues two committed-scoped Supabase queries (canvas_nodes then canvas_edges, both eq('branch_id', ...)) rather than a head:true count query — a single node-rows fetch serves both the >=3 threshold check and the ghost-edge candidate pool, avoiding a third round-trip."
  - "buildPromptGuidance() text is English (matching the dominant language of buildAnalyticsSystemPrompt's Role rules), not Spanish — Spanish is used in this codebase for BAD/GOOD few-shot example lines specifically, not the surrounding guidance prose."

patterns-established:
  - "Ghost-edge cosine ranking (D-13/D-14): embed(orphan.label) once, embed each OTHER committed-status candidate's label, rank by cosineSimilarity, return the top id — fails soft (undefined ghostTargetNodeId, still fires) on any embedding error, never blocks the orphan-fire itself."
  - "Three-tier escalation gate (D-12/COST-02): pure zero-I/O regex pre-filter -> Zod-validated tool-use classifier call (ONE retry, fail-closed) -> explicit non-invocation of tier 3 (D-06), returning only detection metadata for a later node to route on."

requirements-completed: [GRAPH-03, TRIGGER-04, TRIGGER-05, COST-01, COST-02]

# Metrics
duration: ~55min
completed: 2026-07-15
---

# Phase 12 Plan 04: Orphan-Edge + Fact-Check Analyst Skills Summary

**orphan-edge Skill (committed-CanvasNode zero-edge detection + D-13/D-14 cosine ghost-edge fallback via embeddings.ts) and fact-check Skill (D-12 pure heuristic tier-1 -> Zod-validated tier-2 classifier escalation, zero adapter calls on tier-1 non-match, deterministic per-provider TASK_MODELS routing assertion guarding a silent BYOK-billing regression).**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-07-15T15:38:00Z (approx, first file read)
- **Completed:** 2026-07-15T16:35:00Z (approx)
- **Tasks:** 2 completed (both `type="tdd"`, proper RED/GREEN gate sequencing)
- **Files modified:** 5 (4 created, 1 modified — deferred-items.md tracking note)

## Accomplishments
- `orphanEdgeSkill` — fires once >=3 committed `canvas_nodes` exist on a branch and one has zero connecting `canvas_edges`; queries Supabase directly (never `state.argGraph`, per RESEARCH.md Pitfall 1) via the injected `config.configurable.serviceClient` seam
- D-13/D-14 ghost-edge fallback: embeds the orphan node's label and every OTHER `status='committed'` candidate's label, ranks by `cosineSimilarity` (`embeddings.ts`, Plan 02), returns the top match — ghost/silent nodes structurally excluded by the SQL filter, never reachable as a target
- `factCheckSkill` — `looksLikeCheckableClaim()` pure tier-1 regex pre-filter (numbers+units, dates/years, absolute qualifiers, capitalized entity-like phrases); a non-match makes **zero** `adapter.stream()` calls, proven via a raw `vi.fn()` spy assertion (not a mocked-return assertion)
- Tier-2 escalation resolves `TASK_MODELS[provider].classification` exclusively, Zod-validates the `classify_fact_check_need` tool output with ONE retry then fails closed (mirrors `arg-graph-builder.ts`'s proven retry-with-correction idiom, scaled to a single-attempt retry for this cheap binary classifier)
- Deterministic cross-provider routing test (`fact-check.test.ts`) loops `anthropic`/`openai`/`gemini` asserting the tier-2 call always resolves `.classification` — the exact guardrail AI-SPEC.md's Pitfall 7 / Dimension 5 calls for against a silent BYOK-billing regression
- D-06 preserved: neither Skill's `detect()` invokes tier-3/`analyticsAgentNode` directly — both return only detection metadata (`meta.orphanNodeId`/`ghostTargetNodeId` and `meta.claimMessageId`) for Plan 06's `TriggerGateNode` to route on

## Task Commits

Each task followed the plan's `type="tdd"` RED -> GREEN gate sequence (a fresh RED run confirmed via a temporary implementation-file removal, restored on GREEN):

1. **Task 1: orphan-edge Skill**
   - `586d926` — `test(12-04): add failing test for orphan-edge Analyst Skill` (RED, confirmed failing — module does not exist)
   - `a9e2a37` — `feat(12-04): implement orphan-edge Analyst Skill (GRAPH-03/TRIGGER-04, D-13/D-14)` (GREEN, 9/9 passing)
   - `e84186e` — `fix(12-04): remove literal state.argGraph string from orphan-edge.ts docs` (Rule 1 — a doc comment's literal `state.argGraph` substring tripped the plan's own acceptance-criteria grep, which checks the file contains zero occurrences of that string)
2. **Task 2: fact-check Skill**
   - `01bd07d` — `test(12-04): add failing test for fact-check three-tier escalation gate` (RED, confirmed failing — module does not exist)
   - `1568070` — `feat(12-04): implement fact-check three-tier escalation gate (D-12/COST-02)` (GREEN, 16/16 passing — includes 3 Rule-1 fixes made while reaching GREEN, see Deviations)

**Plan metadata:** `9498320` — `docs(12-04): re-confirm silence-scan.test.ts pre-existing failures out of scope` (deferred-items.md tracking update, not a task commit)

## Files Created/Modified
- `apps/api/src/lib/skills/orphan-edge.ts` — orphan-edge Analyst Skill: committed-orphan detection + D-13/D-14 ghost-edge cosine fallback
- `apps/api/src/lib/skills/orphan-edge.test.ts` — 9 tests covering the full `<behavior>` block
- `apps/api/src/lib/skills/fact-check.ts` — fact-check Analyst Skill: three-tier escalation gate (D-12/COST-01/COST-02)
- `apps/api/src/lib/skills/fact-check.test.ts` — 16 tests covering all five plan behavior groups plus the pure-function tier-1 pattern matrix
- `.planning/phases/12-graph-coherence-extended-triggers/deferred-items.md` — re-confirmed the pre-existing `silence-scan.test.ts` failures (already logged under Plan 01) remain unrelated to this plan's changes (zero diff on those files)

## Decisions Made
- **`config.configurable.serviceClient`** as the Supabase-client test-injection seam name for orphan-edge — no existing precedent for DB access from inside a Skill's `detect()`; chosen to mirror the `createServiceClient()` factory name and the established `xAdapter`-style config seam convention. Falls back to `createServiceClient()` in production.
- **`config.configurable.lastMessageId`** as the source for fact-check's `meta.claimMessageId` — `ProviderMessage` has no `id` field, so RESEARCH.md's pseudocode (`lastMessage.id`) could not be implemented literally; documented as a new optional config field, `null` fallback when absent, following `arg-graph-builder.ts`'s precedent of documenting the source of a new `config.configurable` field it introduces (`branchId`).
- Both Skills' `buildPromptGuidance()` output is English prose (matching `buildAnalyticsSystemPrompt`'s dominant language), reserving Spanish for BAD/GOOD few-shot example lines specifically, consistent with the existing Analyst Role prompt.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `state.argGraph` literal string in orphan-edge.ts doc comment tripped its own acceptance-criteria grep**
- **Found during:** Task 1 post-implementation acceptance-criteria verification
- **Issue:** The plan's acceptance criteria requires `grep -Lq "state.argGraph" apps/api/src/lib/skills/orphan-edge.ts` to pass (zero occurrences of that literal substring, proving the committed-orphan query never touches the LangGraph argGraph state field). The file's own doc comment quoted `state.argGraph` verbatim while explaining the Pitfall-1 warning it was itself satisfying in code, tripping the check.
- **Fix:** Reworded the comment to describe the same warning ("the LangGraph argument-graph state field") without the literal substring.
- **Files modified:** `apps/api/src/lib/skills/orphan-edge.ts`
- **Verification:** `grep -q "state.argGraph" apps/api/src/lib/skills/orphan-edge.ts` now fails to match (correct); 9/9 tests still pass.
- **Committed in:** `e84186e`

**2. [Rule 1 - Bug] NUMBER_UNIT_PATTERN's trailing `\b` failed to match after non-word characters like `%`**
- **Found during:** Task 2 GREEN run (`looksLikeCheckableClaim` unit tests failing)
- **Issue:** `\b` requires a transition between a word and non-word character. The pattern's final alternation group included `%` (non-word); when followed by a space (also non-word) there is no boundary at that position, so `/…(%|…)\b/` never matched `"15%"` followed by a space — the intended primary use case.
- **Fix:** Removed the trailing `\b` from `NUMBER_UNIT_PATTERN`; the leading `\d+` anchors the match sufficiently without it.
- **Files modified:** `apps/api/src/lib/skills/fact-check.ts`
- **Verification:** `looksLikeCheckableClaim('El desempleo subió un 15% este año.')` now returns `true`; all 16 fact-check tests pass.
- **Committed in:** `1568070`

**3. [Rule 1 - Bug] Test's cross-provider routing assertion compared model-id string equality, which is false for gemini**
- **Found during:** Task 2 GREEN run
- **Issue:** The initial routing test asserted `TASK_MODELS[provider].classification !== TASK_MODELS[provider].analysis`. `model-config.ts` currently maps ALL of gemini's `TaskType`s to the same model id (`gemini-2.5-flash`) — a legitimate, already-existing registry state, not a bug in `model-config.ts`. The inequality assertion was a flawed test, not a real routing-correctness signal.
- **Fix:** Replaced the value-inequality assertion with an assertion that the tier-2 call resolves exactly `TASK_MODELS[provider].classification` (the real routing-correctness signal — reading the correct *key*, independent of whether that key's value happens to coincide with another key's value for a given provider) plus a structural check that `.analysis` exists and is a string for every provider.
- **Files modified:** `apps/api/src/lib/skills/fact-check.test.ts`
- **Verification:** All three providers (anthropic/openai/gemini) pass the corrected assertion.
- **Committed in:** `1568070`

**4. [Rule 1 - Bug] "detect() never calls tier-3" test matched the term inside this file's own JSDoc**
- **Found during:** Task 2 GREEN run
- **Issue:** `fact-check.ts`'s doc comment legitimately documents the D-06 hand-off to `analyticsAgentNode` (naming it twice, descriptively). A test asserting `fileSource).not.toMatch(/analyticsAgentNode/)` failed on the comment text itself, not on any actual invocation — a test-authoring bug, not a real D-06 violation.
- **Fix:** Narrowed the assertion to check for an actual import (`from '...analytics-agent'`) or direct call (`analyticsAgentNode(`) — neither of which the implementation contains — while allowing the documentation reference to remain.
- **Files modified:** `apps/api/src/lib/skills/fact-check.test.ts`
- **Verification:** Test passes; `apps/api/src/lib/skills/fact-check.ts` genuinely never imports or calls `analyticsAgentNode`.
- **Committed in:** `1568070`

---

**Total deviations:** 4 auto-fixed (all Rule 1 — bugs found and fixed while reaching each task's GREEN state, all within the scope of the two files this plan modifies).
**Impact on plan:** All four fixes were necessary for the implementation/tests to correctly express the plan's own `<behavior>`/acceptance-criteria contracts. No scope creep — no file outside `orphan-edge.ts`/`orphan-edge.test.ts`/`fact-check.ts`/`fact-check.test.ts` was touched to reach GREEN.

## Issues Encountered
- `vitest`/`tsc` are not resolvable from directly inside this worktree (no local `node_modules`) — ran via the main repo's `apps/api/node_modules/.bin/{vitest,tsc}` with `--root` pointed at the worktree, per the worktree-aware `vitest.config.ts` already present in this repo. `tsc --noEmit` against the worktree surfaces pre-existing `Cannot find module '@panelito/types'`/`'vitest'`/etc. resolution noise across the ENTIRE existing test suite (not introduced by this plan — confirmed by grepping the error output for `orphan-edge`/`fact-check`, which only shows the same generic module-resolution class of error, no code-specific type errors in the new files).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both Skills are fully implemented and unit-tested in isolation, ready for Plan 05 (Role-node prompt-guidance splicing) and Plan 06 (`TriggerGateNode` wiring both Skills into `COACH_SKILLS`/`ANALYST_SKILLS` and threading `config.configurable.serviceClient`/`factCheckClassifierAdapter`/`lastMessageId` through the live `/invoke` route).
- Plan 06 must add `config.configurable.serviceClient` (a Supabase service client) and, ideally, `config.configurable.lastMessageId` to the graph invocation config for orphan-edge/fact-check to receive real data in production — both Skills already fall back safely (orphan-edge to `createServiceClient()`, fact-check's `claimMessageId` to `null`) if these are not yet wired, so this plan does not block Plan 05/06 from proceeding, but the live routes should be updated when TriggerGateNode lands.
- No blockers for Plan 05/06.

---
*Phase: 12-graph-coherence-extended-triggers*
*Completed: 2026-07-15*

## Self-Check: PASSED

- All 5 created/modified files confirmed present on disk (`orphan-edge.ts`, `orphan-edge.test.ts`, `fact-check.ts`, `fact-check.test.ts`, this SUMMARY.md).
- All 7 referenced commit hashes confirmed present in `git log` (`586d926`, `a9e2a37`, `e84186e`, `01bd07d`, `1568070`, `9498320`, `dbb4a10`).
- `orphan-edge.test.ts` (9/9) and `fact-check.test.ts` (16/16) re-verified passing at time of self-check.
