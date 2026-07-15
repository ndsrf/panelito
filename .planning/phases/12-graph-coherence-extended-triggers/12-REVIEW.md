---
phase: 12-graph-coherence-extended-triggers
reviewed: 2026-07-15T17:18:01Z
depth: standard
files_reviewed: 37
files_reviewed_list:
  - apps/api/package.json
  - apps/api/src/graph/graph.integration.test.ts
  - apps/api/src/graph/graph.test.ts
  - apps/api/src/graph/graph.ts
  - apps/api/src/graph/nodes/analytics-agent.test.ts
  - apps/api/src/graph/nodes/analytics-agent.ts
  - apps/api/src/graph/nodes/arg-graph-builder.test.ts
  - apps/api/src/graph/nodes/facilitation-agent.test.ts
  - apps/api/src/graph/nodes/facilitation-agent.ts
  - apps/api/src/graph/nodes/trigger-gate.test.ts
  - apps/api/src/graph/nodes/trigger-gate.ts
  - apps/api/src/graph/state.ts
  - apps/api/src/lib/bot-arbitrator.test.ts
  - apps/api/src/lib/bot-arbitrator.ts
  - apps/api/src/lib/bot-context.ts
  - apps/api/src/lib/bot-registration.test.ts
  - apps/api/src/lib/bot-registration.ts
  - apps/api/src/lib/embeddings.test.ts
  - apps/api/src/lib/embeddings.ts
  - apps/api/src/lib/moderation-count.test.ts
  - apps/api/src/lib/moderation-count.ts
  - apps/api/src/lib/silence-scan.test.ts
  - apps/api/src/lib/skills.ts
  - apps/api/src/lib/skills/drift-redirect.test.ts
  - apps/api/src/lib/skills/drift-redirect.ts
  - apps/api/src/lib/skills/fact-check.test.ts
  - apps/api/src/lib/skills/fact-check.ts
  - apps/api/src/lib/skills/moderation.test.ts
  - apps/api/src/lib/skills/moderation.ts
  - apps/api/src/lib/skills/orphan-edge.test.ts
  - apps/api/src/lib/skills/orphan-edge.ts
  - apps/api/src/lib/skills/silence-break.test.ts
  - apps/api/src/lib/skills/silence-break.ts
  - apps/api/src/routes/ai.test.ts
  - packages/types/src/blueprint.ts
  - packages/types/src/fact-check-tool.ts
  - packages/types/src/index.ts
  - packages/types/src/skill.test.ts
  - packages/types/src/skill.ts
  - supabase/migrations/0015_graph_coherence_triggers.sql
findings:
  critical: 2
  warning: 2
  info: 0
  total: 4
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-07-15T17:18:01Z
**Depth:** standard
**Files Reviewed:** 37
**Status:** issues_found

## Summary

Reviewed the Phase 12 "graph coherence / extended triggers" changeset: the new `TriggerGateNode` and its four new Skills (drift-redirect, moderation, fact-check, orphan-edge), the retrofitted silence-break Skill, the extended `graph.ts` topology (conditional edges for mutationGate/argGraphBuilder/triggerGate), `bot-arbitrator.ts`/`bot-registration.ts` D-06 scoring extensions, `embeddings.ts`, `moderation-count.ts`, and the accompanying migration and shared types.

The prompt-injection hardening (`escapeUntrustedText` + `<<<...DATA>>>` framing), fail-open/fail-closed conventions, and the Promise.allSettled skill-isolation pattern are all implemented carefully and consistently with the codebase's documented precedents. However, two functional defects were found that undermine stated Phase 12 requirements:

1. The moderation escalation counter (D-16) is never incremented anywhere in production code, so the "tone escalates after repeated triggers" behavior can never activate.
2. The new `TriggerGateNode` topology allows `AnalyticsAgentNode` to run twice for a single `analysis_request` invocation when an Analyst Skill also fires, producing a duplicate LLM call and a duplicate streamed response — a real cost/UX bug given the production blueprint enables the Analyst by default.

Two further quality issues (duplicated escaping helper, and a `triggerMetadata` key that silently collapses distinct Skill firings into one bucket) are noted as warnings.

## Critical Issues

### CR-01: `incrementModerationCount` is never called — D-16 moderation escalation is permanently inert

**File:** `apps/api/src/lib/skills/moderation.ts:118-128`
**Issue:**
`moderationSkill.detect()` calls `getModerationCount()` to decide the escalation tier, but nothing in the codebase ever calls `incrementModerationCount()` (defined and unit-tested in `apps/api/src/lib/moderation-count.ts`, backed by the atomic RPC added in `supabase/migrations/0015_graph_coherence_triggers.sql`). A repository-wide search confirms the only references to `incrementModerationCount` are its own definition, its own doc comments, and `moderation-count.test.ts` — there is no production call site:

```
$ grep -rn "incrementModerationCount" apps/api/src --include="*.ts" | grep -v test
apps/api/src/lib/moderation-count.ts:4: (doc comment)
apps/api/src/lib/moderation-count.ts:58: (doc comment)
apps/api/src/lib/moderation-count.ts:65:export async function incrementModerationCount(
```

Because `moderation_counts.count` is never incremented, `getModerationCount()` always returns `0` (row never created), so `escalationTier` in `moderation.ts:121` is always `0 >= ESCALATION_THRESHOLD_N` → `false` → gentle tier, forever. The entire D-16 "escalation tone" feature this phase implements (migration, RPC, `escalationTier` lookup in `buildPromptGuidance`) is unreachable dead functionality in production — every moderation intervention will render as a first-offense gentle nudge no matter how many times the same participant is flagged.

**Fix:** Call `incrementModerationCount(supabase, branchId, participantId)` from `moderationSkill.detect()` immediately after (or instead of) `getModerationCount()`, e.g.:
```typescript
if (supabase && branchId && participantId) {
  const countAfterThisOffense = await incrementModerationCount(supabase, branchId, participantId)
  escalationTier = countAfterThisOffense > ESCALATION_THRESHOLD_N ? 1 : 0
} else {
  console.error(...)
}
```
(Adjust the threshold comparison to account for the fact `incrementModerationCount` returns the count *including* the current offense.) Update `moderation.test.ts` to assert the increment call happens exactly once per flagged detection.

### CR-02: `TriggerGateNode` can invoke `AnalyticsAgentNode` twice for a single `analysis_request` call, producing a duplicate LLM call and duplicate streamed response

**File:** `apps/api/src/graph/graph.ts:168-170, 236-255`
**Issue:**
For the `analysis_request` trigger path, `routeAfterArgGraphBuilder` sends the invocation straight to `'analysis'` (preserving Phase 11 behavior). `analysis` then unconditionally flows to `mutationGate` (`.addEdge('analysis', 'mutationGate')`), and `routeAfterMutationGate` — on the *first* pass through mutationGate in this invocation — always routes to `'triggerGate'` (since `triggerGateComplete` is still null). If an Analyst Skill (orphan-edge or fact-check) then fires during that `triggerGate` evaluation, `routeAfterTriggerGate` routes back to `'analysis'` a **second time** in the same `graph.invoke()` call:

```
START --(analysis_request)--> argGraphBuilder --> analysis [1st call]
  --> mutationGate --(triggerGateComplete==null)--> triggerGate
  --(firingSkillRole==='analyst')--> analysis [2nd call] --> mutationGate --(complete)--> END
```

`analyticsAgentNode` calls `adapter.stream()` and forwards every token via `config.configurable.streamWriter(text)` — this happens for BOTH invocations, so a single user-triggered "analyze this" request produces two separate LLM calls and two separate streamed text blocks forwarded to the same caller-supplied `streamWriter`. This is not a hypothetical edge case: the seeded production blueprint (`debate-strategy-v1`, per `silence-scan.test.ts`'s fixture and migration 0014) sets `bot_defaults: { coach: true, analyst: true }`, so the Analyst role — and therefore its Skills (orphan-edge, fact-check) — is enabled by default. Any `analysis_request` invocation made while there's an orphaned committed canvas node (a very ordinary state once 3+ nodes exist) or a checkable claim in the last message will trigger this double-invocation.

`graph.test.ts`'s own test for this path (`"(d) Proactive analysis_request path still reaches analysis..."`) explicitly uses `debateBlueprint`'s `bot_defaults: {}` (both roles disabled) specifically to avoid exercising this interaction, so the double-fire scenario has no test coverage and was evidently not accounted for when the topology was designed — none of `graph.ts`'s extensive doc comments mention this interaction, unlike every other topology corner case in that file.

**Impact:** duplicate BYOK API spend (violates the project's cost-consciousness constraint) and a confusing double AI response surfaced for one user action.

**Fix:** Either (a) have `routeAfterArgGraphBuilder`'s `analysis_request` branch set `triggerGateComplete: true` up front (skip the loop-guard's first-pass allowance for this specific trigger type, since `analysis` already ran the Analyst once by design), or (b) have `routeAfterTriggerGate` refuse to re-route into `'analysis'` when the invocation's `triggerType === 'analysis_request'` (the Analyst already ran for this trigger), routing to `'end'` instead. Add a regression test that enables `bot_defaults.analyst` and asserts `analyticsAdapter.stream` is called at most once for an `analysis_request` invocation.

## Warnings

### WR-01: `escapeUntrustedText` is duplicated instead of imported, contradicting the module's own documented convention

**File:** `apps/api/src/lib/skills/fact-check.ts:143-145`, `apps/api/src/lib/skills/orphan-edge.ts:51-53`
**Issue:** `bot-context.ts` exports `escapeUntrustedText` and its doc comment states: *"drift-redirect.ts and moderation.ts's buildPromptGuidance() reuse this exact helper... rather than reimplementing their own escaping logic."* However, `fact-check.ts` and `orphan-edge.ts` each define an identical, independent local copy of the same function instead of importing the shared one. The three copies (`bot-context.ts`, `fact-check.ts`, `orphan-edge.ts`) currently do the same thing, but any future change to the escaping rule (e.g. widening the stripped-character set to close a new injection vector) would silently miss these two call sites since nothing ties them together.
**Fix:**
```typescript
// fact-check.ts / orphan-edge.ts
import { escapeUntrustedText } from '../bot-context'
// remove the local `function escapeUntrustedText(...)` definition
```

### WR-02: `triggerMetadata` key selection collapses distinct Skill-triggered Analyst runs into a single generic bucket

**File:** `apps/api/src/graph/nodes/analytics-agent.ts:204-205`
**Issue:** `const metaKey = state.triggerType ?? 'analysis_request'` is meant to key the recorded firing timestamp by "the actual triggerType that invoked this node" (per the inline comment), but `state.triggerType` is only ever set by the invoker for the `silence_gate`/`analysis_request` proactive paths — it is `null` for the ordinary human-message path, including when `AnalyticsAgentNode` is reached via `TriggerGateNode` because the `fact-check` or `orphan-edge` Skill fired. In that (very common, human-path) case the fallback unconditionally writes to the generic `'analysis_request'` key regardless of which Skill actually fired, so a `fact-check` firing and a later `orphan-edge` firing on the same branch will overwrite each other's `last_fired_at`/`cooldown_until` timestamp under the same key once anything reads it for per-Skill cooldown enforcement. Currently nothing reads these keys for orphan-edge/fact-check cooldowns (no cooldown check exists in `trigger-gate.ts` for those Skills yet), so the impact is latent rather than actively wrong today — but the key-selection logic itself doesn't achieve what its own comment claims for the Skill-driven paths this phase introduces.
**Fix:** Prefer `state.firingSkillId` over `state.triggerType` when a Skill actually fired: `const metaKey = state.firingSkillId ?? state.triggerType ?? 'analysis_request'`.

---

_Reviewed: 2026-07-15T17:18:01Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
