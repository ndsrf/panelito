---
phase: 11-personality-basic-triggers
plan: 03
subsystem: api
tags: [langgraph, zod, typescript, argGraph, extraction]

# Dependency graph
requires:
  - phase: 11-personality-basic-triggers (Plan 01)
    provides: ArgNodeSchema (message_id/speaker citation fields), ArgGraphSchema, argGraphExtractionTool, TASK_MODELS.classification, CONTEXT_WINDOWS.argBuild
provides:
  - "argGraphBuilderNode(state, config?) — extraction + UUID substitution + merge into state.argGraph"
  - "Two-schema split pattern (RawArgGraphSchema relaxed refs vs. ArgGraphSchema strict .uuid()) as a reusable template for future extraction nodes"
affects: [11-04-facilitation-analytics-agents, 11-05-conditional-start-edge, 11-06, 11-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-schema split: relaxed raw tool-input Zod schema validated first, then server-side crypto.randomUUID() ref substitution, then strict domain Zod schema validation"
    - "Recursive retry-with-correction-message loop (MAX_RETRIES=2) shared shape for any future LLM structured-extraction node"

key-files:
  created:
    - apps/api/src/graph/nodes/arg-graph-builder.ts
    - apps/api/src/graph/nodes/arg-graph-builder.test.ts
  modified: []

key-decisions:
  - "branchId introduced as a new config.configurable field (naming matches silence-gate.ts/bot-arbitrator.ts/bot-budget.ts precedent) — no existing GraphState/config field carried a branch id into node config prior to this plan; ArgNode.branch_id is populated from it"
  - "message_id is passed through as emitted by the model, NOT substituted — only node id / edge source_ref / target_ref get UUID substitution per the plan's explicit scope; a non-UUID message_id legitimately fails ArgNodeSchema's .uuid() check via the same retry/fail-silent path"
  - "Dedicated per-node unit test file (arg-graph-builder.test.ts) written despite 11-PATTERNS.md's 'no per-node unit tests' convention, because this task is tdd=true with an explicit <behavior> block — mirrors graph.test.ts's mock-adapter pattern but isolates extraction/substitution/merge logic without the full conditional-START graph topology (which lands in Plan 05)"

patterns-established:
  - "Two-schema split (raw relaxed tool-input schema → server-side ID substitution → strict domain schema) as the template for any future LLM extraction node in this codebase"

requirements-completed: [GRAPH-01, GRAPH-02]

# Metrics
duration: 15min
completed: 2026-07-14
---

# Phase 11 Plan 03: ArgGraphBuilderNode Summary

**ArgGraphBuilderNode extracts claims/edges from recent conversation via `extract_arg_graph` tool use, substitutes model-supplied short refs for real `crypto.randomUUID()`s before strict Zod validation, and merges the result into `state.argGraph` by id-union — fail-silent throughout, cheapest model tier, no direct DB writes.**

## Performance

- **Duration:** ~15 min (including a stale-worktree fast-forward merge before starting)
- **Started:** 2026-07-14T16:36:27+02:00 (RED commit)
- **Completed:** 2026-07-14T16:38:09+02:00 (GREEN commit)
- **Tasks:** 1 completed (RED → GREEN, no REFACTOR needed)
- **Files modified:** 2 (both created)

## Accomplishments
- `argGraphBuilderNode(state, config?)` implements the four-step node skeleton (config-seam adapter read, pure system-prompt builder, try/catch stream, partial-state return) with an `[arg-graph-builder]` log prefix
- Two-schema split implemented exactly per Finding 2 (11-RESEARCH.md): `RawArgGraphSchema` (relaxed string refs, local/unexported) validates the raw `tool_use` output; `substituteRefs()` maps each distinct ref to a `crypto.randomUUID()` (reused within a single call when the same ref string recurs); `ArgGraphSchema` (bot.ts, strict `.uuid()`) validates the substituted result
- Retry loop (`MAX_RETRIES = 2`) with a correction user-message on either raw-shape or post-substitution domain-schema validation failure; fails silent (`return {}`) on exhaustion, logged via `console.error`
- Merges extracted nodes/edges into `state.argGraph` by id-union (`mergeById`) — prior content is never lost, only same-id entries are replaced
- Routes through `TASK_MODELS[providerName ?? 'anthropic'].classification` (cheapest tier, no hardcoded model string) and `CONTEXT_WINDOWS.argBuild` (100-message slice)
- 5 unit tests cover all 4 `<behavior>` scenarios from the plan plus a bonus adapter-unavailable never-throws case; all pass, `tsc --noEmit` clean (aside from the pre-existing, documented `bot-arbitrator.test.ts:136` error)

## Task Commits

Task 1 followed the TDD RED → GREEN cycle (no REFACTOR needed — implementation matched the planned shape on first pass):

1. **Task 1: ArgGraphBuilderNode — extraction, UUID substitution, merge**
   - `edaedbe` (test) — 5 failing tests covering ref substitution, no-tool-use warn path, MAX_RETRIES exhaustion, non-empty-prior merge
   - `ac55277` (feat) — implementation: `argGraphBuilderNode`, `RawArgGraphSchema`, `substituteRefs`, `attemptExtraction` retry loop, `mergeById`; also fixed 2 strict-mode `possibly undefined` TS errors introduced by my own new test file

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/api/src/graph/nodes/arg-graph-builder.ts` — `argGraphBuilderNode` export + extraction/substitution/merge internals
- `apps/api/src/graph/nodes/arg-graph-builder.test.ts` — 5 unit tests using a mock `AIProvider` (graph.test.ts's `createMockAdapter` pattern)

## Decisions Made
- `branchId` read from `config.configurable.branchId` — a new field (no prior GraphState/config field carried a branch id into node config); documented in the file header as the source, matching the naming already used by `silence-gate.ts`/`bot-arbitrator.ts`/`bot-budget.ts`. Missing `branchId` fails silent (`return {}`, `console.error`) since `ArgNodeSchema.branch_id` requires a real UUID.
- `message_id` is passed through unsubstituted — only `id`/`source_ref`/`target_ref` get UUID substitution per the plan's explicit scope. A model-emitted `message_id` that isn't a real UUID legitimately fails `ArgNodeSchema.message_id.uuid()` and is handled by the same retry/fail-silent path as any other validation failure (this is a known interface gap for later plans: `ProviderMessage` currently carries no `id` field, so the model has no way to cite a real message UUID — out of scope for this Task 1, which only implements extraction/substitution/merge mechanics; a future plan wiring the silence-scan/analysis invocation path will need to decide how message identity reaches the model).
- Wrote a dedicated per-node unit test file despite the codebase's established "test at the graph level only" convention (11-PATTERNS.md Pattern 3), because this task is `tdd="true"` with an explicit `<behavior>` block — the 4 listed behaviors map cleanly to isolated unit tests and Plan 05 (conditional START edge) is the natural place for graph-level integration coverage of this node instead.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed strict-mode `possibly undefined` TS errors in own new test file**
- **Found during:** Task 1 verification (`pnpm exec tsc --noEmit`)
- **Issue:** `eventsPerCall[Math.min(call, eventsPerCall.length - 1)]` and `result.argGraph!.edges[0]` are typed `T | undefined` under this project's strict TS config (`noUncheckedIndexedAccess`), causing 5 compile errors in the newly-added test file.
- **Fix:** Added `?? []` fallback for the array-access default and a non-null assertion (`!`) on the single-element edge access (test-only code, safe given the preceding `toHaveLength(1)` assertion).
- **Files modified:** `apps/api/src/graph/nodes/arg-graph-builder.test.ts`
- **Verification:** `pnpm exec tsc --noEmit` in `apps/api` passes except the pre-existing, unrelated `bot-arbitrator.test.ts:136` error (documented in Plan 01's SUMMARY/deferred-items.md).
- **Committed in:** `ac55277` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug, self-contained to the new test file)
**Impact on plan:** No scope creep — fix was entirely within the file this task created.

## Issues Encountered

**Worktree was stale at spawn time (same pattern as Plan 01).** The worktree branch (`worktree-agent-a2d4abc2e782b92de`) was forked from `main` before Phase 11's planning commits (`11-01` through `11-07` PLAN.md, `11-PATTERNS.md`, wave-1 execution/merge) landed. Confirmed via `git merge-base --is-ancestor HEAD main` that the worktree HEAD was a strict ancestor of `main` (pure fast-forward situation, no divergent commits) before merging — `git merge --ff-only main` brought in the missing `11-03-PLAN.md` plus all Plan 01 shared-contract files (`bot.ts`, `arg-graph-tool.ts`, `bot-context.ts`, `model-config.ts`, `state.ts`) safely, with no history rewrite.

`node_modules` were not present in the worktree (fresh checkout) — ran `pnpm install --frozen-lockfile` (lockfile-pinned, not a new-package install; no Rule 3 package-legitimacy gate applies) before running any tests.

## Known Issues (pre-existing, out of scope)

- `apps/api/src/lib/bot-arbitrator.test.ts:136` — pre-existing `TS2532` strict-mode array-index issue from Phase 10 (documented in Plan 01's SUMMARY and `deferred-items.md`). Unrelated to this plan's changes.
- 7 `apps/api` test files fail with "Missing or invalid environment variables" (no `.env` in this worktree) — pre-existing, unrelated to this plan.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `argGraphBuilderNode` is ready for the conditional START edge wiring (Plan 05: `analysis` route → `argGraphBuilder` → `analysis`) and for `AnalyticsAgentNode` (Plan 04) to read the populated `state.argGraph`.
- Open item for a downstream plan: `ProviderMessage` carries no message `id`, so `ArgNode.message_id` currently depends entirely on the model's (unverifiable) self-reported value — the invocation path that builds `state.messages` for this node (silence-scan / analysis trigger, Plan 04–07) will need to decide how real message identity reaches the extraction prompt for citations to reliably validate in production.
- No blockers for downstream plans in this wave.

---
*Phase: 11-personality-basic-triggers*
*Completed: 2026-07-14*
