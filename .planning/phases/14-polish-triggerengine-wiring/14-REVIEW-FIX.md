---
phase: 14-polish-triggerengine-wiring
fixed_at: 2026-07-18T18:23:40Z
review_path: .planning/phases/14-polish-triggerengine-wiring/14-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 14: Code Review Fix Report

**Fixed at:** 2026-07-18T18:23:40Z
**Source review:** .planning/phases/14-polish-triggerengine-wiring/14-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (2 critical, 3 warning; fix_scope=critical_warning, Info findings IN-01/IN-02 excluded)
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: SPEECH-02 artifact filter silently blanks human message content, not just AI output

**Files modified:** `apps/web/components/workspace/MessageBubble.tsx`
**Commit:** 2f57b0d
**Applied fix:** Removed the `containsSpeechArtifact(message.content) ? '' : message.content}` check
from the human-bubble render branch (line 283), replacing it with plain `{message.content}`.
The AI-bubble branches (`isAI === true`) still correctly apply the filter, matching
`MessageList.tsx`'s `role === 'assistant'` scoping. Verified via `tsc --noEmit` (clean, no
errors referencing MessageBubble.tsx) and Tier 1 re-read.

### CR-02: Silence↔phase-readiness coupling can never fire the coverage-judgment call for any Blueprint using the default gate

**Status:** fixed (corrected — see follow-up below)
**Files modified:** `apps/api/src/lib/trigger-engine.ts`
**Commits:** b97549e (initial attempt), 81984d3 (follow-up correction)

**Initial attempt (b97549e), later found insufficient:** `applyPhaseReadinessCoupling` was
changed to read/persist `phaseGateProgress` via `graph.getState`/`graph.updateState` on the
bot thread (`${branchId}:bot`), replacing the always-fresh `null` with a durably persisted
counter. **Orchestrator-level post-fix verification (not the code-fixer agent) traced this
end-to-end and found it insufficient**: the human-reactive path that actually increments
`messagesSinceGateOpen` (`phase-readiness.ts`, only when `triggerType == null`) runs on a
*different* thread (`${branchId}:human`, set in `apps/api/src/routes/ai.ts`). Nothing ever
writes to the `:bot` thread's `phaseGateProgress` except this exact call site, and the
silence path is (correctly, by design) excluded from incrementing it — so the persisted
counter was durably stuck at `0` instead of freshly `null` each tick. Same practical
outcome: `0 < 5` stays true forever, `detect()` still always returned `fires: false` before
reaching the coverage-judgment LLM call.

**Follow-up correction (81984d3):** Since this coupling call is silence-triggered — no
messages accrue while the group is silent, so gating on message count is inapplicable
regardless of which thread tracks it — `applyPhaseReadinessCoupling` now builds a
non-mutating shallow-cloned `Blueprint` before constructing `skillContext`, with the active
phase's `phase_readiness_gate.min_messages_after` forced to `0` (preserving the real
`min_nodes` value). This makes the call gate purely on committed canvas-node count, which
*is* correctly read from Supabase and thread-independent. The original `blueprint` object
and all other phases are untouched — verified by a new targeted test. The b97549e
getState/updateState round-trip was left in place (now harmless — the counter no longer
gates anything at this call site) rather than removed, to minimize risk of a second
incomplete fix.

**Verification:** `tsc --noEmit` clean. `vitest run trigger-engine.test.ts
phase-readiness.test.ts` — 27/27 pass, including a new regression test
(`CR-02-followup: coupling call forces min_messages_after to 0 on the active phase
(node-count-only gate), leaves min_nodes and the original Blueprint untouched`). Manual
trace confirmed end-to-end: for a `debate-strategy-v1`-style gate (`min_nodes: 3,
min_messages_after: 5`) with 3+ committed nodes, `detect()` now reaches the
coverage-judgment call — previously permanently unreachable.

### WR-01: facilitation-agent.ts unconditionally keys triggerMetadata by 'silence_gate' regardless of the actual firing trigger

**Status:** fixed: requires human verification (logic/condition fix — see verification_strategy)
**Files modified:** `apps/api/src/graph/nodes/facilitation-agent.ts`
**Commit:** 2b6c391
**Applied fix:** Mirrored the fix already applied in `analytics-agent.ts` (its documented
WR-01/WR-02 fix): `const metaKey = state.firingSkillId ?? state.triggerType ?? 'silence_gate'`,
then keyed `triggerMetadata[metaKey]` instead of hardcoding `silence_gate`. Verified via
`tsc --noEmit` (clean) and `vitest run facilitation-agent.test.ts` (all 26 tests pass,
including the `updates triggerMetadata.silence_gate.last_fired_at on success` test, which
still resolves to the `silence_gate` key because the test's default state has
`firingSkillId: null` / `triggerType: null`). Flagged for human verification because this is a
conditional key-selection logic change with no dedicated new test asserting the
moderation/drift-redirect key-selection branches specifically (existing coverage only
exercises the `silence_gate` fallback path).

### WR-02: streamWithGeneration never ends the Langfuse Generation observation if the wrapped stream throws mid-iteration

**Files modified:** `apps/api/src/lib/langfuse-generation.ts`
**Commit:** 77d8235
**Applied fix:** Wrapped the `for await` iteration and the `generation.update()`/`.end()` call
in a single `try/finally`, so the Generation observation is always ended (with whatever
partial `usage`/`text` was accumulated before the throw) even if the wrapped adapter's stream
throws mid-iteration. The original error propagates unchanged after the `finally` block runs,
preserving the caller's existing fail-silent `try/catch` contract (facilitation-agent.ts /
analytics-agent.ts both already catch and return `{}` on this error). Verified via
`tsc --noEmit` (clean) and `vitest run langfuse-generation.test.ts facilitation-agent.test.ts
analytics-agent.test.ts` (7 + 26 + 29 = 62 tests, all pass).

### WR-03: gemini.ts usage extraction silently drops usage when only one of the two token counts is present

**Files modified:** `apps/api/src/lib/adapters/gemini.ts`
**Commit:** 4ed80cb
**Applied fix:** Added an `else if (lastUsageMetadata) { console.warn(...) }` branch after the
existing usage-emission `if`, logging the incomplete `usageMetadata` object when the SDK
provides only one of the two token counts. Purely additive (no control-flow change to the
existing happy-path emission). Verified via `tsc --noEmit` (clean) and
`vitest run gemini.test.ts` (all 16 tests pass).

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-07-18T18:23:40Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
