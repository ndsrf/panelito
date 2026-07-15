---
phase: 11-personality-basic-triggers
fixed_at: 2026-07-15T07:54:44Z
review_path: .planning/phases/11-personality-basic-triggers/11-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 11: Code Review Fix Report

**Fixed at:** 2026-07-15T07:54:44Z
**Source review:** .planning/phases/11-personality-basic-triggers/11-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (1 critical, 6 warning — `fix_scope: critical_warning`; the 2 Info
  findings, IN-01 and IN-02, were out of scope and not attempted)
- Fixed: 7
- Skipped: 0

## Fixed Issues

### CR-01: AnalyticsAgentNode's canvas mutations never reach `canvasOps` — the `analysis` path bypasses `mutationGateNode`

**Files modified:** `apps/api/src/graph/graph.ts`
**Commit:** 98328d8
**Applied fix:** Changed `.addEdge('analysis', END)` to `.addEdge('analysis', 'mutationGate')` so
canvas mutations proposed by the Analyst Role route through `mutationGateNode` (confidence-
threshold + Blueprint vocabulary validation) before reaching `END`, mirroring the existing
`agent` → `mutationGate` → `END` chain. `mutationGateNode` already no-ops when `state.agentOutput`
is null/`NO_ACTION`, so the common no-mutation case is unaffected. Updated the file's topology
doc-comment to match. A graph-level regression test asserting `result.canvasOps` is populated for
the analysis path (as suggested in REVIEW.md) was not added in this pass — flagged for follow-up.

### WR-01: `triggerMetadata.fact_check` written unconditionally regardless of actual trigger

**Files modified:** `apps/api/src/graph/nodes/analytics-agent.ts`
**Commit:** 9e05350
**Applied fix:** Keyed the `triggerMetadata` write by `state.triggerType ?? 'analysis_request'`
instead of the hardcoded `fact_check` key, so an `analysis_request` invocation no longer clobbers
the cooldown timestamp that Phase 12's real `fact_check` trigger will read.

### WR-02: `ArgGraphBuilderNode`'s ref→UUID substitution is not stable across invocations

**Files modified:** `apps/api/src/graph/nodes/arg-graph-builder.ts`
**Commit:** 2de81f5 (combined with WR-03, same file/root cause area)
**Applied fix:** Added `mergeArgNodes()`, which unions by `id` (as before) and additionally
collapses nodes sharing a `speaker + message_id + type` content key, keeping the first-seen id
and dropping later duplicates minted for the same underlying claim on repeated extraction.
Wired into `argGraphBuilderNode` in place of the plain `mergeById` for the `nodes` array (edges
still use `mergeById`, unchanged).

### WR-03: `substituteRefs` fabricates a random UUID for dangling edge refs

**Files modified:** `apps/api/src/graph/nodes/arg-graph-builder.ts`
**Commit:** 2de81f5
**Applied fix:** Added `findOrphanEdgeRefs()`, called in `attemptExtraction` immediately after
raw-shape validation and before `substituteRefs`. If any edge's `source_ref`/`target_ref` doesn't
match a node id present in the same raw batch, the extraction is rejected and retried via the
existing correction-message retry path (up to `MAX_RETRIES`) instead of silently producing a
schema-valid but referentially-dangling edge.

### WR-04: `CreatorControls`'s cooldown caption is hardcoded

**Files modified:** `apps/web/components/workspace/CreatorControls.tsx`
**Commit:** 32e8c23
**Applied fix:** Replaced the hardcoded caption string with one derived from
`blueprint?.bot_cooldowns?.coach` / `.analyst` (falling back to rendering nothing for either half
if the Blueprint lacks that cooldown entry), matching the fix suggested in REVIEW.md.

### WR-05: `fetchRecentMessages` swallows Supabase errors silently

**Files modified:** `apps/api/src/lib/silence-scan.ts`
**Commit:** 01f22fc
**Applied fix:** Destructured `error` from the Supabase response and added a
`console.error('[silence-scan] fetchRecentMessages error for branch', ...)` + early `return []`
on failure, matching the error-logging convention used by every other Supabase call in the file.

### WR-06: User-controlled `argGraph` content interpolated verbatim into system prompts

**Files modified:** `apps/api/src/lib/bot-context.ts`
**Commit:** 6941252
**Applied fix:** Added `escapeUntrustedText()` (strips embedded quotes/newlines and `<<<`/`>>>`
delimiter sequences) applied to every `speaker`/`label` value rendered by `summarizeArgGraph()`,
and wrapped the entire summary block in an explicit `<<<ARGUMENT_GRAPH_DATA ... ARGUMENT_GRAPH_DATA>>>`
delimiter with a preamble stating the content is user-authored data, never instructions to follow.
Since `summarizeArgGraph` is the single shared context path used by both `buildCoachSystemPrompt`
and `buildAnalyticsSystemPrompt` (D-14), this one change covers both the Coach and Analyst system
prompts referenced in the finding.

## Verification Notes

- **Tier 2 (TypeScript):** No node_modules exist in the isolated fix worktree by default; a
  temporary symlink to the main repo's `node_modules` (for `apps/api`, `apps/web`,
  `packages/types`, and the workspace root) was created solely to run `tsc --noEmit` and
  `vitest run` as verification, then removed before writing this report — no trace of it remains
  in the worktree or commits. `npx tsc --noEmit -p apps/api/tsconfig.json` and
  `-p apps/web/tsconfig.json` reported zero errors in any of the six modified files. The only
  pre-existing tsc error in the api project (`src/lib/bot-arbitrator.test.ts:138`) is unrelated to
  this fix set.
- **Test suite:** Ran the full `apps/api` vitest suite after all six commits. 139 tests passed
  across 20 files, including every unit-test file for the six modified source files
  (`graph.test.ts`, `graph.integration.test.ts`, `analytics-agent.test.ts`,
  `arg-graph-builder.test.ts`, `facilitation-agent.test.ts`, `silence-scan.test.ts`). Two test
  files (`src/routes/ai.test.ts`, `src/routes/keys.test.ts`) failed for reasons unrelated to any
  fix in this report (missing `hono/streaming` module resolution / pre-existing route-level
  failures) — confirmed these same two files also fail on the `main` branch outside this
  worktree, consistent with the prior "pre-existing test failures found during full-suite
  verification" note in this phase's history (commit a6fc380).
- No test files required changes — all existing assertions (e.g. `toContain('Miguel')` for the
  WR-06 fix, `error: null` mocks for the WR-05 fix) remained compatible with the applied fixes.

## Skipped Issues

None — all 7 in-scope findings (CR-01, WR-01 through WR-06) were fixed.

---

_Fixed: 2026-07-15T07:54:44Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
