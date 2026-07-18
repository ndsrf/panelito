---
phase: 14-polish-triggerengine-wiring
reviewed: 2026-07-18T16:38:33Z
depth: standard
files_reviewed: 40
files_reviewed_list:
  - apps/api/src/graph/nodes/analytics-agent.test.ts
  - apps/api/src/graph/nodes/analytics-agent.ts
  - apps/api/src/graph/nodes/arg-graph-builder.test.ts
  - apps/api/src/graph/nodes/facilitation-agent.test.ts
  - apps/api/src/graph/nodes/facilitation-agent.ts
  - apps/api/src/graph/nodes/profile-builder.test.ts
  - apps/api/src/graph/nodes/trigger-gate.ts
  - apps/api/src/graph/state.ts
  - apps/api/src/lib/adapters/anthropic.ts
  - apps/api/src/lib/adapters/gemini.test.ts
  - apps/api/src/lib/adapters/gemini.ts
  - apps/api/src/lib/adapters/openai.test.ts
  - apps/api/src/lib/adapters/openai.ts
  - apps/api/src/lib/auto-freeze.test.ts
  - apps/api/src/lib/auto-freeze.ts
  - apps/api/src/lib/bot-arbitrator.ts
  - apps/api/src/lib/bot-registration.test.ts
  - apps/api/src/lib/bot-registration.ts
  - apps/api/src/lib/langfuse-generation.test.ts
  - apps/api/src/lib/langfuse-generation.ts
  - apps/api/src/lib/langfuse-otel.ts
  - apps/api/src/lib/moderation-count.test.ts
  - apps/api/src/lib/skills/fact-check.test.ts
  - apps/api/src/lib/skills/orphan-edge.test.ts
  - apps/api/src/lib/skills/phase-readiness.test.ts
  - apps/api/src/lib/skills/silence-break.ts
  - apps/api/src/lib/trigger-engine.test.ts
  - apps/api/src/lib/trigger-engine.ts
  - apps/api/src/routes/ai.test.ts
  - apps/api/src/routes/ai.ts
  - apps/api/src/server.ts
  - apps/api/vitest.config.ts
  - apps/web/components/workspace/MessageBubble.tsx
  - apps/web/components/workspace/MessageList.tsx
  - packages/types/src/ai.ts
  - packages/types/src/blueprint.test.ts
  - packages/types/src/blueprint.ts
  - packages/types/src/index.ts
  - packages/types/src/speech-artifacts.test.ts
  - packages/types/src/speech-artifacts.ts
  - scripts/synthetic-session.ts
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-07-18T16:38:33Z
**Depth:** standard
**Files Reviewed:** 40
**Status:** issues_found

## Summary

This phase generalizes Phase 11's interim silence-scan loop into the full `trigger-engine.ts`,
adds COST-03 token-usage capture across all three provider adapters plus a manual Langfuse
Generation wrapper (`langfuse-generation.ts`), adds PERSONA-04 periodic re-anchor + SPEECH-01
prompt discipline to the Coach/Analyst Role nodes, adds a SPEECH-02/03 client-side artifact
filter, and adds a Blueprint-opt-in silence↔phase-readiness coupling. Most of the diff is
comment/rename churn (`silence-scan.ts` → `trigger-engine.ts`) plus solid, well-tested new
logic (usage-event plumbing, re-anchor counters).

However, I found two provable BLOCKER-level defects and three WARNING-level defects when
tracing the new code against its own stated intent and against sibling implementations in the
same diff:

1. `MessageBubble.tsx` applies the SPEECH-02 assistant-only artifact filter to **human**-authored
   message content too, silently blanking real user messages that happen to contain one of the
   three blocklisted substrings.
2. The new "silence↔phase-readiness coupling" feature (`trigger-engine.ts`
   `applyPhaseReadinessCoupling`) can never actually reach its coverage-judgment LLM call for
   any Blueprint using the schema's default `min_messages_after` gate (5), because the ad-hoc
   `GraphState` it builds always resets `phaseGateProgress` to a fresh zero-count object and the
   silence path is (correctly, by its own WR-01 comment) excluded from incrementing that
   counter — so the M-message threshold is permanently unsatisfiable via this call site.

I also found that `facilitation-agent.ts` never received the "key `triggerMetadata` by the
actual firing trigger" fix that `analytics-agent.ts` explicitly documents having received
(comments cite "WR-01 fix — REVIEW.md"), and that `langfuse-generation.ts`'s `streamWithGeneration`
leaves the Langfuse Generation observation permanently open (never `.end()`'d) if the wrapped
adapter stream throws mid-iteration.

## Critical Issues

### CR-01: SPEECH-02 artifact filter silently blanks human message content, not just AI output

**File:** `apps/web/components/workspace/MessageBubble.tsx:283`
**Issue:** The SPEECH-02 defense-in-depth filter (`containsSpeechArtifact`) is designed and
documented (see `packages/types/src/speech-artifacts.ts` and `MessageList.tsx:254`, which
correctly scopes the equivalent check to `msg.role === 'assistant'`) to suppress bot-authored
"canvas mutation" phrasing artifacts (`[canvas updated]`, `[graph modified]`, `[node added]`)
that a Role node might accidentally speak into chat. Inside `MessageBubble.tsx`, the same check
is applied to the AI-bubble branches (`isAI === true`, correct) **and also** to the human bubble
branch at line 283 — the block rendered when `isAI` is `false`:

```tsx
{/* Human bubble content */}
<div ... role="article" aria-label={`Message from ${message.display_name}`}>
  {isForking && (...)}
  {containsSpeechArtifact(message.content) ? '' : message.content}
</div>
```

Any human participant who types a message containing one of the three blocklisted substrings —
plausible in normal conversation, e.g. discussing the feature itself, quoting another tool, or
coincidentally using bracketed phrasing like "[node added]" as commentary — will see their
entire message rendered as an empty bubble with no error, no truncation notice, and no
indication that content was dropped. This is silent, unrecoverable-looking data loss in the UI
for real user content (the DB row itself is untouched, but the participant-facing chat renders
nothing).
**Fix:** Scope the filter to `isAI` only, mirroring `MessageList.tsx`'s `role === 'assistant'`
scoping:
```tsx
{isForking && (...)}
{message.content}
```
(Remove the `containsSpeechArtifact` check entirely from the human-bubble branch — human
messages should never be filtered by a bot-output discipline check.)

### CR-02: Silence↔phase-readiness coupling can never fire the coverage-judgment call for any Blueprint using the default gate

**File:** `apps/api/src/lib/trigger-engine.ts:391-428` (`applyPhaseReadinessCoupling`),
`apps/api/src/lib/trigger-engine.ts:434-460` (`buildPhaseReadinessState`)
**Issue:** `applyPhaseReadinessCoupling` calls the real `phaseReadinessSkill.detect()` against a
synthetic `GraphState` built fresh on every silence tick by `buildPhaseReadinessState()`, which
hardcodes `phaseGateProgress` implicitly to `null` (the field is simply omitted from the object
literal, so `context.state.phaseGateProgress` is `undefined` inside `detect()`). Per
`phase-readiness.ts:153-160`, a `null`/`undefined` `phaseGateProgress` (or a phase-id mismatch)
resets `progress` to `{ phaseId, nodeCountAtGateOpen: 0, messagesSinceGateOpen: 0 }` — i.e. the
gate is treated as freshly opened on every single invocation of this coupling path, forever.

Then, per `phase-readiness.ts:186-187`:
```ts
const messagesSinceGateOpen =
  context.state.triggerType == null ? progress.messagesSinceGateOpen + 1 : progress.messagesSinceGateOpen
```
`buildPhaseReadinessState` sets `triggerType: 'silence_gate'` (not `null`), so this branch never
increments — `messagesSinceGateOpen` stays at `progress.messagesSinceGateOpen`, which was just
reset to `0` above. Since `gateConfig.min_messages_after` defaults to `5`
(`DEFAULT_GATE_CONFIG`/the seeded Blueprint fixture's `phase_readiness_gate.min_messages_after:
5`), the condition `messagesSinceGateOpen < gateConfig.min_messages_after` (`0 < 5`) is always
true, so `detect()` always returns `{ fires: false, ... }` at line 188-194 before ever reaching
the coverage-judgment LLM call — regardless of how many committed canvas nodes exist or how long
the group has actually been silent.

The net effect: the entire Phase 14 "D-03/D-04 silence↔phase-readiness coupling" feature this
phase advertises is dead code in practice for any Blueprint that doesn't set
`min_messages_after: 0` — it will call `detect()` (burning the Supabase `canvas_nodes` count
query every silence tick when the Blueprint opts in) but can never reach `fires: true`, so the
Coach's system prompt never actually receives the phase-advance nudge this feature exists to
deliver. `trigger-engine.test.ts`'s coupling tests all mock `phaseReadinessSkill.detect()`
directly at the module boundary, so this integration gap between `trigger-engine.ts` and the
real `phase-readiness.ts` state-machine contract was never exercised end-to-end.
**Fix:** Persist and thread through the real gate progress instead of rebuilding a stateless
object every tick — e.g. read `graph.getState({ configurable: { thread_id: botThreadId } })`'s
`values.phaseGateProgress` (the bot thread's own checkpoint, already read for
`readCooldownUntil`) before constructing `buildPhaseReadinessState`, and persist
`result.meta.phaseGateProgress` back via `graph.updateState` (mirroring `recordCooldown`'s
existing merge-and-writeback pattern) after calling `detect()`. Alternatively, if the intent is
genuinely "silence fires only gate on node-count, never message-count", change
`DEFAULT_GATE_CONFIG`/the coupling call to pass an override gate config with
`min_messages_after: 0` explicitly rather than silently relying on an always-reset counter.

## Warnings

### WR-01: facilitation-agent.ts unconditionally keys triggerMetadata by 'silence_gate' regardless of the actual firing trigger

**File:** `apps/api/src/graph/nodes/facilitation-agent.ts:225-241`
**Issue:** `COACH_SKILLS = [silenceBreakSkill, moderationSkill, driftRedirectSkill]`
(`apps/api/src/lib/skills.ts:63`) — three distinct Skills can all route into
`facilitationAgentNode` via `TriggerGateNode`. Yet on every successful turn,
`facilitationAgentNode` writes:
```ts
const previous = state.triggerMetadata?.silence_gate
return {
  triggerMetadata: {
    ...state.triggerMetadata,
    silence_gate: { last_fired_at: new Date().toISOString(), cooldown_until: previous?.cooldown_until ?? null },
  },
  ...
}
```
This hardcodes the `silence_gate` key regardless of whether the actual firing trigger was
`moderation`, `drift-redirect`, or a genuine `silence_gate` proactive fire. `analytics-agent.ts`
(same phase family) explicitly fixed the analogous bug for the Analyst side — its comment block
at `analytics-agent.ts:280-288` documents this exact defect class as "WR-02 fix (REVIEW.md)" and
keys by `state.firingSkillId ?? state.triggerType ?? 'analysis_request'`. The Coach side was
never given the same fix, so `moderation`/`drift-redirect` firings now silently overwrite
`triggerMetadata.silence_gate.last_fired_at` with the wrong trigger's timestamp — data that
`trigger-engine.ts`'s `readCooldownUntil` (`trigger-engine.ts:540-548`) reads on every silence
tick to decide whether to suppress a proactive Coach fire. While `cooldown_until` itself is
preserved unchanged (so the practical cooldown gate isn't directly bypassed today), the metadata
is now factually wrong and any future feature that reads `last_fired_at` for a genuine
`silence_gate` fire will read stale/incorrect data.
**Fix:** Mirror the fix already applied in `analytics-agent.ts`:
```ts
const metaKey = state.firingSkillId ?? state.triggerType ?? 'silence_gate'
const previous = state.triggerMetadata?.[metaKey]
return {
  triggerMetadata: {
    ...state.triggerMetadata,
    [metaKey]: { last_fired_at: new Date().toISOString(), cooldown_until: previous?.cooldown_until ?? null },
  },
  ...
}
```

### WR-02: streamWithGeneration never ends the Langfuse Generation observation if the wrapped stream throws mid-iteration

**File:** `apps/api/src/lib/langfuse-generation.ts:69-97`
**Issue:**
```ts
let generation: LangfuseGeneration | undefined
try {
  generation = startObservation(name, { model, input, metadata }, { asType: 'generation' })
} catch (err) { ... }

let text = ''
let usage: ... | undefined

for await (const event of stream) {   // <-- NOT wrapped in try/catch/finally
  ...
}

if (generation) {
  try { generation.update(...); generation.end() } catch (err) { ... }
}

return { text, usage }
```
If the wrapped `adapter.stream()` throws partway through iteration (a real, documented
possibility — every adapter's own doc comments describe try/finally wrapping specifically
because mid-stream errors are expected), the `for await` loop throws, `streamWithGeneration`
itself throws (propagating to the caller's own try/catch, which is the intended fail-silent
behavior for the Role node's turn), but the `if (generation)` block is skipped entirely — the
started Generation observation is never `.end()`'d. Every Langfuse Generation the SDK considers
"open" until ended; a stream error now leaves an orphaned/never-closed trace in Langfuse for
every failed generation, which will show as perpetually-pending in the dashboard and skews
cost/latency aggregates. Every one of `langfuse-generation.test.ts`'s test cases only exercises
happy-path streams or `startObservation`/`generation.update`/`generation.end` throwing — none
exercise the wrapped `stream` itself throwing mid-iteration, so this gap has no test coverage.
**Fix:** Wrap the iteration and the update/end call in a single try/finally so `generation.end()`
(with an error-flagged `.update()`) always runs:
```ts
try {
  for await (const event of stream) {
    onEvent?.(event)
    if (event.type === 'text_delta') { text += event.text; streamWriter?.(event.text) }
    else if (event.type === 'usage') { usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens } }
  }
} finally {
  if (generation) {
    try {
      generation.update({ usageDetails: usage ? { input: usage.inputTokens, output: usage.outputTokens } : undefined, model, metadata })
      generation.end()
    } catch (err) {
      console.warn('[langfuse-generation] update/end failed (non-fatal):', (err as Error).message)
    }
  }
}
return { text, usage }
```
(Re-throw the original stream error after the finally block runs, so the caller's existing
fail-silent catch is unaffected.)

### WR-03: gemini.ts usage extraction silently drops usage when only one of the two token counts is present

**File:** `apps/api/src/lib/adapters/gemini.ts:105-113`
**Issue:**
```ts
if (
  lastUsageMetadata?.promptTokenCount !== undefined &&
  lastUsageMetadata?.candidatesTokenCount !== undefined
) {
  yield { type: 'usage', inputTokens: lastUsageMetadata.promptTokenCount, outputTokens: lastUsageMetadata.candidatesTokenCount }
}
```
This is defensible per the "never fabricate" convention documented elsewhere in the same file,
but note it silently omits the whole usage event (both input AND output token counts) if the
Gemini SDK ever emits `usageMetadata` with only one of the two fields populated (e.g. a
provider-side partial response) — there is no `console.warn` here documenting why the event was
dropped, unlike the OpenAI/Anthropic adapters' equivalent paths, which makes a future "why is
COST-03 usage data missing for this Gemini call" investigation harder to diagnose than the other
two adapters. Low severity — flagging for consistency with sibling adapters' logging discipline,
not a functional defect.
**Fix:** Add a `console.warn` when `lastUsageMetadata` is defined but incomplete, so a partial
usage payload is at least observable in logs:
```ts
} else if (lastUsageMetadata) {
  console.warn('[gemini] usageMetadata present but incomplete — omitting usage event', lastUsageMetadata)
}
```

## Info

### IN-01: synthetic-session.ts re-anchor check reads authoritative state via `graph.getState` on every turn, adding non-trivial overhead

**File:** `scripts/synthetic-session.ts:348-358`
**Issue:** The harness calls `graph.getState(...)` after every single turn (up to 100 times) purely
to log re-anchor firings. This is a standalone dev/ops script (not production code), so this is
informational only — not a functional defect — but worth noting for anyone extending this script:
each `getState` call is an extra round trip against whatever checkpointer is configured (in this
script, `MemorySaver`, so cheap; if ever pointed at a real Postgres checkpointer, this would add
~100 extra DB round trips to an already-expensive real-LLM-call harness).
**Fix:** No action required for this phase; consider gating the `getState` call behind a
`--verbose`/env flag if this script is later pointed at a Postgres checkpointer.

### IN-02: server.ts registers SIGTERM/SIGINT handlers unconditionally at module load, before `serve()` has produced a `stopTriggerEngine`

**File:** `apps/api/src/server.ts:18-26`
**Issue:** `process.on('SIGTERM', ...)`/`process.on('SIGINT', ...)` are registered at the top of
the module, but `stopTriggerEngine` is only populated once `startTriggerEngine(...)` resolves
inside the `serve()` callback (an async operation). If a SIGTERM/SIGINT arrives in the narrow
window after module load but before `startTriggerEngine` resolves, `shutdown()` calls
`stopTriggerEngine?.()` which is a safe no-op (optional chaining), so this is not a crash — but
the TriggerEngine's background loop (started via the un-awaited `startTriggerEngine(...).then(...)`
promise) may still be mid-bootstrap and its `AbortController` was never captured, so that
in-flight bootstrap could continue running an orphaned scan loop after `process.exit(0)` is
called synchronously right after. In practice `process.exit(0)` terminates the process
immediately, so the orphaned loop's very next `asyncInterval` tick simply never executes — low
real-world impact, but the shutdown sequence's completeness depends on `process.exit()`'s
synchronous nature rather than an explicit await on any in-flight `startTriggerEngine()` promise.
**Fix:** Track the in-flight startup promise and await it (or ignore it explicitly) inside
`shutdown()` before calling `stopTriggerEngine?.()`, to make the intent explicit rather than
relying on `process.exit()` timing:
```ts
let triggerEngineReady: Promise<() => void> | null = null;
// ...
triggerEngineReady = startTriggerEngine(createServiceClient());
triggerEngineReady.then((stop) => { stopTriggerEngine = stop; }).catch(...);

async function shutdown(signal: string): Promise<void> {
  console.log(`[panelito/api] received ${signal}, shutting down`);
  const stop = await triggerEngineReady?.catch(() => null);
  stop?.();
  clearAllTrackers();
  process.exit(0);
}
```

---

_Reviewed: 2026-07-18T16:38:33Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
