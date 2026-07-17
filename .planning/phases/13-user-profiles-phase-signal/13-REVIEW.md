---
phase: 13-user-profiles-phase-signal
reviewed: 2026-07-17T06:27:23Z
depth: standard
files_reviewed: 35
files_reviewed_list:
  - apps/api/src/graph/graph.integration.test.ts
  - apps/api/src/graph/graph.test.ts
  - apps/api/src/graph/graph.ts
  - apps/api/src/graph/nodes/agent.ts
  - apps/api/src/graph/nodes/analytics-agent.test.ts
  - apps/api/src/graph/nodes/analytics-agent.ts
  - apps/api/src/graph/nodes/arg-graph-builder.test.ts
  - apps/api/src/graph/nodes/facilitation-agent.test.ts
  - apps/api/src/graph/nodes/facilitation-agent.ts
  - apps/api/src/graph/nodes/profile-builder.test.ts
  - apps/api/src/graph/nodes/profile-builder.ts
  - apps/api/src/graph/nodes/trigger-gate.test.ts
  - apps/api/src/graph/nodes/trigger-gate.ts
  - apps/api/src/graph/state.ts
  - apps/api/src/lib/blueprint-loader.ts
  - apps/api/src/lib/bot-arbitrator.test.ts
  - apps/api/src/lib/bot-context.test.ts
  - apps/api/src/lib/bot-context.ts
  - apps/api/src/lib/embeddings.test.ts
  - apps/api/src/lib/moderation-count.test.ts
  - apps/api/src/lib/moderation-count.ts
  - apps/api/src/lib/participant-profile.test.ts
  - apps/api/src/lib/participant-profile.ts
  - apps/api/src/lib/silence-scan.test.ts
  - apps/api/src/lib/skills.ts
  - apps/api/src/lib/skills/fact-check.test.ts
  - apps/api/src/lib/skills/orphan-edge.test.ts
  - apps/api/src/lib/skills/phase-readiness.test.ts
  - apps/api/src/lib/skills/phase-readiness.ts
  - apps/api/src/routes/ai.test.ts
  - apps/api/src/routes/ai.ts
  - packages/types/src/blueprint.ts
  - packages/types/src/index.ts
  - packages/types/src/participant-profile.ts
  - packages/types/src/phase-readiness-tool.ts
  - supabase/migrations/0016_participant_profiles.sql
findings:
  critical: 1
  warning: 5
  info: 1
  total: 7
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-07-17T06:27:23Z
**Depth:** standard
**Files Reviewed:** 35
**Status:** issues_found

## Summary

Phase 13 wires participant profiles (PROFILE-01/02) and the phase-readiness advisory
signal (TRIGGER-02) into the human-message path for the first time, plus fixes a
long-standing reachability gap (`ProfileBuilderNode` was previously unreachable in
production). The graph-topology work in `graph.ts` (routing/termination proofs for
`routeAfterMutationGate`/`routeAfterArgGraphBuilder`/`routeAfterTriggerGate`) is careful
and well-tested, and the fail-open/fail-closed discipline in `trigger-gate.ts`,
`phase-readiness.ts`, `moderation-count.ts`, and `participant-profile.ts` is consistently
applied.

However, `ProfileBuilderNode`'s core attribution algorithm has a real, demonstrable
data-loss bug: it groups argument-graph nodes by a freeform, LLM-extracted `speaker`
label rather than by the participant's resolved `author_id`, and then issues one
full-replace upsert per speaker-group. Two speaker labels that resolve to the same real
participant (a very plausible outcome for LLM-extracted display names — nicknames,
capitalization/spelling drift, full name vs. first name) will silently overwrite each
other's `positions`/`assertions` within a single node invocation. This is the highest
severity finding below.

Several smaller correctness/quality gaps are also flagged: the phase-readiness N/M gate
counter conflates proactive `analysis_request` invocations with genuine human messages,
`ai.ts`'s `phase_signal` next-phase lookup silently defaults to `phase_sequence[0]` when
the current phase id doesn't resolve, the new participant-profile prompt-splicing code
path in `facilitation-agent.ts`/`analytics-agent.ts` has zero test coverage, and the
`participantId` threaded into the moderation Skill is always the session creator (never
the actual author of the flagged message) due to how the ownership gate works.

## Critical Issues

### CR-01: ProfileBuilderNode groups by freeform `speaker` label, causing silent data loss on upsert when the same participant is cited under two different labels

**File:** `apps/api/src/graph/nodes/profile-builder.ts:122-134` (`groupBySpeaker`) and `apps/api/src/graph/nodes/profile-builder.ts:148-185` (per-speaker loop)

**Issue:** `groupBySpeaker()` buckets `state.argGraph.nodes` by `node.speaker` — a
freeform string extracted by the LLM in `arg-graph-builder.ts` (`packages/types/src/bot.ts:24`:
`speaker: z.string(), // participant display name for citations`), not a stable
identifier. `arg-graph-builder.ts`'s extraction system prompt (`buildArgGraphExtractionSystemPrompt`)
never instructs the model to reuse a canonical name; different extraction calls (each
scoped to a 100-message window, `CONTEXT_WINDOWS.argBuild`) can plausibly label the same
real participant "Miguel", "Miguel G.", or "miguel" across turns.

`profileBuilderNode` then iterates `bySpeaker` and calls `upsertParticipantProfile()`
once **per speaker-group**, resolving `authorId` independently for each group
(`resolveAuthorId(supabase, firstNode.message_id)`). If two different speaker labels
resolve to the **same** `authorId` (the common case: one real person, inconsistently
labeled across turns), the loop issues two upserts for the same `(branch_id,
participant_id)` primary key within the same node invocation.

`upsert_participant_profile` (migration `0016_participant_profiles.sql:159-164`) is a
full-replace, not a merge:
```sql
ON CONFLICT (branch_id, participant_id) DO UPDATE
  SET positions      = EXCLUDED.positions,
      assertions     = EXCLUDED.assertions,
      messages_sent  = EXCLUDED.messages_sent,
      reactions_used = EXCLUDED.reactions_used,
      updated_at     = now();
```
So the **second** speaker-group's upsert silently discards the first group's
`positions`/`assertions` for that participant — real stated positions are lost, with no
error, no log, and no test covering this interaction. `profile-builder.test.ts`'s
"two speakers" test only exercises two *distinct* `author_id`s (never two speaker labels
resolving to the same author), so this regression would not be caught by the existing
suite.

**Fix:** Resolve `authorId` first, then group/merge by the resolved `authorId` (not by
the raw `speaker` string) before upserting — e.g.:
```ts
const byAuthor = new Map<string, ArgNode[]>()
for (const [, nodes] of bySpeaker) {
  const resolved = await resolveAuthorId(supabase, nodes[0]!.message_id)
  if (!resolved || resolved.role !== 'user') continue
  const existing = byAuthor.get(resolved.authorId) ?? []
  byAuthor.set(resolved.authorId, existing.concat(nodes))
}
for (const [authorId, nodes] of byAuthor) {
  // compute positions/assertions from the UNION of nodes for this authorId, then upsert once
}
```
Alternatively (cheaper, no behavior change to the per-node resolution), collapse
`bySpeaker` groups whose resolved `authorId` collides before slicing/upserting.

## Warnings

### WR-01: phase-readiness `messagesSinceGateOpen` counter is incremented on every invocation that reaches `triggerGate`, including proactive `analysis_request` invocations that are not genuine human messages

**File:** `apps/api/src/lib/skills/phase-readiness.ts:182-190`

**Issue:** `detect()` unconditionally does `messagesSinceGateOpen = progress.messagesSinceGateOpen + 1` once the node-count gate is open. `detect()` runs for every `triggerGate` invocation where the Analyst role is enabled — and per `graph.ts`'s `routeAfterMutationGate`, `triggerGate` is now reached from **both** the real human-message path (`triggerType === null`) **and** the proactive `analysis_request` path (`triggerType === 'analysis_request'`, documented in `graph.ts:8` and `trigger-gate.ts:8` as "the proactive analysis_request path"). Since `analysis_request` invocations are not tied 1:1 to a real chat message from a human participant, the "M subsequent human messages" gate (per this file's own header comment, line 6-9) can be satisfied faster than intended whenever `analysis_request` invocations occur, inflating the counter with non-human-message ticks.

**Fix:** Only advance `messagesSinceGateOpen` when `context.state.triggerType` is `null`/`undefined` (the genuine human-message path), e.g.:
```ts
const messagesSinceGateOpen =
  context.state.triggerType == null ? progress.messagesSinceGateOpen + 1 : progress.messagesSinceGateOpen
```

### WR-02: `ai.ts` phase_signal next-phase lookup silently falls back to `phase_sequence[0]` when the current phase id doesn't resolve

**File:** `apps/api/src/routes/ai.ts:486-501`

**Issue:**
```ts
const currentPhaseIndex = blueprint.phase_sequence.findIndex(
  (p) => p.id === (session.current_phase ?? blueprint.phase_sequence[0]?.id)
)
const nextPhase = blueprint.phase_sequence[currentPhaseIndex + 1] ?? null
```
If `session.current_phase` is set but does not match any `phase_sequence[].id` (e.g. the
Blueprint definition was edited/phases renamed after the session already advanced, or the
DB row holds a stale/corrupted value), `findIndex` returns `-1`. `currentPhaseIndex + 1`
then evaluates to `0`, so `nextPhase` resolves to `blueprint.phase_sequence[0]` — the
*first* phase, not "no next phase" or an error. The SSE `phase_signal` event then offers
the human "advance to phase 0", which may already be behind the group's actual (unknown)
position. This is a silent misbehavior rather than a fail-closed suppression.

**Fix:** Treat `-1` as "unknown current phase" and suppress the signal:
```ts
const nextPhase = currentPhaseIndex >= 0 ? (blueprint.phase_sequence[currentPhaseIndex + 1] ?? null) : null
```

### WR-03: New participant-profile prompt-splicing path (`skillMeta.participantId`) in `facilitation-agent.ts`/`analytics-agent.ts` has zero test coverage

**File:** `apps/api/src/graph/nodes/facilitation-agent.ts:136-156`, `apps/api/src/graph/nodes/analytics-agent.ts:164-186`

**Issue:** Both nodes gained a new "Step 2.5" (D-11) block this phase that conditionally
calls `getParticipantProfile()` (a live Supabase round-trip) and splices
`summarizeParticipant()` output into the system prompt whenever
`state.skillMeta?.participantId` is set. Neither `facilitation-agent.test.ts` nor
`analytics-agent.test.ts` exercises this branch at all — `grep -n "participantId"` across
both test files returns no matches. This is a new, live-DB-touching code path shipped
with no direct unit coverage: a regression here (e.g. wrong table/branch scoping, a
thrown error not actually caught, or `combinedSkillGuidance` composition breaking) would
not be caught by the existing suite. `moderationSkill` is the one Skill today that sets
`skillMeta.participantId` (per the code comments), so a targeted test using
`firingSkillId: 'moderation'` + `skillMeta: { participantId: ... }` + an injected
`serviceClient`/`branchId` would close this gap.

**Fix:** Add at least one test per node asserting: (a) `getParticipantProfile` is called
with the injected `serviceClient`/`branchId`/`skillMeta.participantId` when set, (b) the
resulting `summarizeParticipant()` text appears in the composed system prompt after the
Skill guidance block, and (c) a profile-fetch failure/`null` result still produces a safe
placeholder rather than throwing.

### WR-04: Moderation Skill's `participantId` is always the invoking user (session creator), never the actual author of the flagged message

**File:** `apps/api/src/routes/ai.ts:355-369` (`participantId: user.id`)

**Issue:** `graphConfig.configurable.participantId` is set to `user.id`, which — per the
route's own ownership gate (`ai.ts:87-89`, `session.creator_id !== user.id` → 403 —
T-02-05) — is *always* `session.creator_id`. `moderation.ts`'s `detect()` (Phase 12,
consumer of this new wiring) reads `context.state.messages[messages.length - 1]` (the
most recent chat message, which in a multi-participant session may have been authored by
someone other than the creator) but increments the moderation escalation counter keyed to
`config.configurable.participantId` — i.e., always the creator's own row, never the real
author of the flagged message. This phase's own docstring in `participant-profile.ts`/
`moderation-count.ts` states the intent as "moderation intervention tone escalates after
repeated triggers on the **same participant**" (D-16) — but for any non-creator
participant, escalation is misattributed entirely to the creator's account, and the
creator's own count would be inflated by other participants' flagged messages. This is
newly reachable in production this phase (previously `participantId` was only supplied by
test harnesses, per the `ai.ts` comment at line 348-356).

**Fix:** If the product model intends per-message-author moderation (matching how
`ProfileBuilderNode` correctly resolves `author_id` per message via the `messages`
table), thread the actual last message's resolved author id into
`config.configurable.participantId` (or have `moderation.ts` resolve it itself), rather
than reusing the /invoke-request's authenticated `user.id`. If the intended design really
is "escalate on the invoking account only," update the D-16 doc comment to say so
explicitly so this isn't mistaken for a bug again.

### WR-05: `ProfileBuilderNode` per-speaker-group `resolveAuthorId`/count queries are re-run redundantly and can race/interleave inconsistently when two groups resolve to the same author

**File:** `apps/api/src/graph/nodes/profile-builder.ts:148-185`

**Issue:** Closely related to CR-01 but distinct: even setting aside the overwrite/data-loss
bug, the current per-speaker-group loop issues independent `countMessagesSent`/
`countReactionsUsed` queries per group. If two groups resolve to the same `authorId` (the
CR-01 scenario), the two upserts race with slightly different `positions`/`assertions`
slices but write the *same* `messages_sent`/`reactions_used` values twice — functionally
harmless once CR-01 is fixed (since the groups would be merged before querying), but
called out here so the fix for CR-01 also collapses these now-redundant per-group count
queries into one per resolved author.

**Fix:** Addressed by the same refactor as CR-01 (resolve-then-group-by-author before
querying/upserting).

## Info

### IN-01: `phaseGateProgress.nodeCountAtGateOpen` is declared, threaded through `GraphState`, and always initialized to `0`, but is never written to a meaningful value or read anywhere

**File:** `apps/api/src/graph/state.ts:164-176`, `apps/api/src/lib/skills/phase-readiness.ts:65, 155, 159`

**Issue:** `PhaseGateProgress`'s `nodeCountAtGateOpen` field exists in the type and is
constructed with a literal `0` at every reset site in `phase-readiness.ts`, but no code
path ever assigns it a non-zero value (e.g. the actual `committedCount` at the moment the
gate opens) and no code path ever reads it back for a decision. It is effectively dead
state carried across every checkpoint write. `trigger-gate.test.ts` sets non-zero values
in test fixtures for illustrative purposes only — production code never produces them.

**Fix:** Either populate it meaningfully when the gate opens (`nodeCountAtGateOpen:
committedCount` at the point `committedCount >= gateConfig.min_nodes` first becomes true)
if a future feature needs it (e.g. detecting node-count regression), or remove the field
until it has a consumer, to avoid confusing future readers into thinking it's load-bearing.

---

_Reviewed: 2026-07-17T06:27:23Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
