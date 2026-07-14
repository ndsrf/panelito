---
phase: 11-personality-basic-triggers
reviewed: 2026-07-14T23:17:17Z
depth: standard
files_reviewed: 30
files_reviewed_list:
  - apps/api/src/graph/graph.integration.test.ts
  - apps/api/src/graph/graph.test.ts
  - apps/api/src/graph/graph.ts
  - apps/api/src/graph/nodes/analytics-agent.test.ts
  - apps/api/src/graph/nodes/analytics-agent.ts
  - apps/api/src/graph/nodes/arg-graph-builder.test.ts
  - apps/api/src/graph/nodes/arg-graph-builder.ts
  - apps/api/src/graph/nodes/facilitation-agent.test.ts
  - apps/api/src/graph/nodes/facilitation-agent.ts
  - apps/api/src/graph/state.ts
  - apps/api/src/index.ts
  - apps/api/src/lib/bot-arbitrator.test.ts
  - apps/api/src/lib/bot-arbitrator.ts
  - apps/api/src/lib/blueprint-loader.ts
  - apps/api/src/lib/bot-context.ts
  - apps/api/src/lib/bot-registration.ts
  - apps/api/src/lib/model-config.ts
  - apps/api/src/lib/silence-scan.test.ts
  - apps/api/src/lib/silence-scan.ts
  - apps/api/src/routes/ai.test.ts
  - apps/api/src/routes/bots.ts
  - apps/api/src/server.ts
  - apps/api/vitest.config.ts
  - apps/web/app/(protected)/sessions/[id]/workspace.tsx
  - apps/web/components/workspace/CreatorControls.tsx
  - apps/web/components/workspace/MessageBubble.tsx
  - packages/types/src/arg-graph-tool.test.ts
  - packages/types/src/arg-graph-tool.ts
  - packages/types/src/blueprint.ts
  - packages/types/src/bot.test.ts
  - packages/types/src/bot.ts
  - packages/types/src/index.ts
  - packages/types/src/personality.ts
  - packages/types/src/session.ts
  - supabase/migrations/0014_personalities.sql
findings:
  critical: 1
  warning: 6
  info: 2
  total: 9
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-07-14T23:17:17Z
**Depth:** standard
**Files Reviewed:** 30 (+4 read for cross-reference: `mutation-gate.ts`, `bot.ts`, plus grep sweeps)
**Status:** issues_found

## Summary

Phase 11 adds the conditional START edge (`routeFromStart`), the Coach/Analyst
Role nodes (`facilitation-agent.ts`, `analytics-agent.ts`), the argument-graph
extraction node (`arg-graph-builder.ts`), the interim silence-scan trigger loop,
and the Coach/Analyst on/off UI controls. The unit-test coverage for individual
node behaviors (fail-silent contracts, prompt composition order, retry logic) is
thorough and the `blueprint-loader.ts` Ajv-schema hotfix correctly mirrors
`BlueprintSchema` field-for-field.

However, tracing the new `analysis` path all the way through the compiled
`StateGraph` topology surfaces a genuine functional gap: canvas mutations
proposed by the Analyst Role never reach `state.canvasOps` because the
`analysis` node routes straight to `END`, bypassing `mutationGateNode` — the
only node that ever writes to the `canvasOps` reducer. This wasn't caught by
the graph-level tests because the `analysis` path mock in `graph.test.ts` never
emits a `canvas_mutation` tool_use event. Several other cross-cutting issues
(mismatched trigger-metadata key, non-cross-call-stable argGraph node IDs, a
hardcoded cooldown caption divorced from the Blueprint data it should reflect,
and unlogged DB errors in the Coach's message-fetch path) are documented below
as warnings.

## Critical Issues

### CR-01: AnalyticsAgentNode's canvas mutations never reach `canvasOps` — the `analysis` path bypasses `mutationGateNode`

**File:** `apps/api/src/graph/graph.ts:123-141`
**Issue:**
`analytics-agent.ts` wires `canvasMutationTool` into its `adapter.stream()` call
(same tool as `agentNode`) and is unit-tested to correctly parse a
`canvas_mutation` tool_use event into `agentOutput`/`agentConfidence`
(`analytics-agent.test.ts:197-211`, `"safeParses a canvas_mutation tool_use
event into agentOutput/agentConfidence"`). Its own doc comment states this
"matches agentNode's convention" (`analytics-agent.ts:16-23`).

But `agentOutput`/`agentConfidence` are only ever turned into a `canvasOps`
entry by `mutationGateNode` (confidence-threshold routing + Blueprint
vocabulary validation — `apps/api/src/graph/nodes/mutation-gate.ts:20-85`). The
graph topology wires:

```ts
.addNode('analysis', analyticsAgentNode)
...
.addEdge('argGraphBuilder', 'analysis')
.addEdge('facilitation', END)
.addEdge('analysis', END)          // <-- 'analysis' goes straight to END
```

`analysis` never routes through `mutationGate`. Any `ADD_NODE`/`ADD_EDGE`
proposed by the Analyst is captured in `state.agentOutput`/`agentConfidence`
(an overwrite-style channel) and then silently discarded — it never appears
in `canvasOps`, the field the rest of the system (SSE handlers, canvas
persistence, ghost/committed status) consumes. This is dead/broken
functionality shipped in this phase, not merely an unreachable path: the
`analysis` route is fully wired into `routeFromStart` and only lacks a live
caller for `triggerType: 'analysis_request'` today — the graph-level bug will
surface the moment that trigger is wired (Phase 12+), and there is currently
no test that would catch it because `graph.test.ts`'s "analysis path" mock
(`graph.test.ts:435-511`) never emits a `canvas_mutation` tool_use event, only
`text_delta`.

**Fix:** Route `analysis` through `mutationGateNode` before `END`, mirroring
the `agent` → `mutationGate` → `END` chain:

```ts
.addEdge('argGraphBuilder', 'analysis')
.addEdge('facilitation', END)
.addEdge('analysis', 'mutationGate')   // was: .addEdge('analysis', END)
```

(`mutationGateNode` already returns `{}` when `state.agentOutput` is null/
`NO_ACTION`, so this is safe for the common no-mutation case.) Add a
graph-level regression test that has the Analyst adapter emit a
`canvas_mutation` tool_use event and asserts `result.canvasOps` is populated.

## Warnings

### WR-01: `triggerMetadata.fact_check` is written on every AnalyticsAgentNode run, regardless of what actually triggered it

**File:** `apps/api/src/graph/nodes/analytics-agent.ts:180-192`
**Issue:** `analyticsAgentNode` unconditionally returns:

```ts
triggerMetadata: {
  ...state.triggerMetadata,
  fact_check: { last_fired_at: new Date().toISOString(), cooldown_until: previous?.cooldown_until ?? null },
},
```

but the only route that currently reaches this node is `triggerType ===
'analysis_request'` (`graph.ts:86-89`), a *different* trigger concept than the
`fact_check` trigger planned for Phase 12 (`silence-scan.ts:69-74` and
`analytics-agent.ts:119-121` both explicitly note "no live trigger wires this
in Phase 11; a future trigger (Phase 12) sets it"). Writing to the
`fact_check` cooldown key from an unrelated `analysis_request` invocation
means that once Phase 12 wires a real `fact_check` trigger and starts reading
`triggerMetadata.fact_check.cooldown_until` for rate-limiting, it will
inherit stale/incorrect timestamps recorded by unrelated `analysis_request`
runs on the same thread — silently breaking the intended cooldown gate. This
also happens even when the adapter produced zero output (empty stream).

**Fix:** Key the metadata write by the actual `state.triggerType` (or only
write `fact_check` when `factCheckFraming` is true / the trigger is actually
`fact_check`):

```ts
const metaKey = state.triggerType ?? 'analysis_request'
return {
  agentOutput,
  agentConfidence,
  triggerMetadata: { ...state.triggerMetadata, [metaKey]: { last_fired_at: new Date().toISOString(), cooldown_until: previous?.cooldown_until ?? null } },
}
```

### WR-02: `ArgGraphBuilderNode`'s ref→UUID substitution is not stable across invocations — repeated extraction creates duplicate nodes for the same claim

**File:** `apps/api/src/graph/nodes/arg-graph-builder.ts:14-23, 105-134, 218-224`
**Issue:** `substituteRefs()` builds a brand-new `Map<ref, uuid>` on every
single extraction call and always calls `crypto.randomUUID()` for any ref
it hasn't seen *within that call* (`arg-graph-builder.ts:108-115`). The
docstring explicitly acknowledges "no fuzzy/cross-call matching against
prior state.argGraph content is attempted." Since every `analysis_request`
invocation re-extracts "every claim, evidence, counterargument, or question
raised" from up to 100 recent messages
(`buildArgGraphExtractionSystemPrompt`, lines 75-86), the model will very
likely re-emit claims it already extracted on a prior turn — and each time,
`substituteRefs` mints a *new* random UUID for that same real-world claim.
`mergeById` (lines 218-224) can only de-duplicate by `id`, so it cannot
recognize these as duplicates. Over repeated analysis triggers,
`state.argGraph` accumulates redundant nodes representing the same
underlying claims, defeating the "merge, not overwrite" / "union by id, no
overwrite" design goal (GRAPH-02) that the node's own tests assert
(`arg-graph-builder.test.ts:160-189`).
**Fix:** At minimum, de-duplicate post-merge by a content key (e.g.
`speaker + message_id + type`) in addition to `id`, or pass the prior
`state.argGraph` node summaries into the extraction system prompt so the
model can re-use ids of things it already extracted (the tool schema already
supports the model emitting "an existing node id" — see
`arg-graph-tool.ts:77-81` — but nothing in `buildArgGraphExtractionSystemPrompt`
tells the model what those existing ids/refs are).

### WR-03: `substituteRefs` fabricates a random UUID for edge refs that don't match any node in the same batch, producing dangling edges

**File:** `apps/api/src/graph/nodes/arg-graph-builder.ts:126-131`
**Issue:**

```ts
const edges = raw.edges.map((e) => ({
  id: uuidFor(e.id),
  source_id: uuidFor(e.source_ref),
  target_id: uuidFor(e.target_ref),
  relation: e.relation,
}))
```

If the model emits an edge whose `source_ref`/`target_ref` doesn't match any
`node.id` present in the same `raw.nodes` array (e.g. a typo, or a reference
to a node from a much earlier turn that fell out of the extraction batch),
`uuidFor()` silently mints a fabricated random UUID instead of failing
validation. The resulting `ArgEdge` passes `ArgGraphSchema.safeParse` (both
ids are valid UUID *strings*) but points to an `ArgNode` that will never
exist in `state.argGraph.nodes`. `summarizeArgGraph` degrades gracefully
(falls back to printing the raw id — `bot-context.ts:46-47`), so this won't
crash, but it silently corrupts the argument graph's referential integrity.
**Fix:** After building `nodes`/`edges`, validate that every edge's
`source_id`/`target_id` corresponds to a ref that was actually present in
`raw.nodes` (or in a set of already-known prior refs) before accepting the
extraction; treat orphan edges as a validation failure that triggers the
existing retry path.

### WR-04: `CreatorControls`'s cooldown caption is hardcoded, not derived from the `blueprint` prop it already receives

**File:** `apps/web/components/workspace/CreatorControls.tsx:515-520`
**Issue:**

```tsx
const cooldownCaption = (
  <p className="text-[13px] text-muted-foreground">
    Facilitador: máx. 3 mensajes cada 15 min · Analista/Verificador: máx. 2 mensajes cada 15 min
  </p>
)
```

`CreatorControls` already receives `blueprint` as a prop (used a few lines
above for `botDefaults`), and `blueprint.bot_cooldowns` carries exactly this
data (`{ coach: { max, window_minutes }, analyst: { max, window_minutes } }`
— `blueprint.ts:76-78`). The caption text happens to match
`debate-strategy-v1`'s seeded values (migration `0014_personalities.sql:113-116`)
today, but any other Blueprint with different `bot_cooldowns` values will show
an incorrect caption to creators with no code change required to trigger the
mismatch.
**Fix:**

```tsx
const coachCooldown = blueprint?.bot_cooldowns?.coach
const analystCooldown = blueprint?.bot_cooldowns?.analyst
const cooldownCaption = (
  <p className="text-[13px] text-muted-foreground">
    {coachCooldown ? `Facilitador: máx. ${coachCooldown.max} mensajes cada ${coachCooldown.window_minutes} min` : null}
    {coachCooldown && analystCooldown ? ' · ' : null}
    {analystCooldown ? `Analista/Verificador: máx. ${analystCooldown.max} mensajes cada ${analystCooldown.window_minutes} min` : null}
  </p>
)
```

### WR-05: `fetchRecentMessages` swallows Supabase errors silently, unlike every other query in the file

**File:** `apps/api/src/lib/silence-scan.ts:370-384`
**Issue:**

```ts
async function fetchRecentMessages(supabase: SupabaseClient, branchId: string): Promise<ProviderMessage[]> {
  const { data } = await supabase
    .from('messages')
    .select('role, content')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .limit(CONTEXT_WINDOWS.facilitation)

  return ((data ?? []) as Array<{ role: string | null; content: string }>)
    .reverse()
    .map(...)
}
```

The destructured `error` is never captured or checked. Every other Supabase
call in this file (`resolveProviderContext`, `resolveCoachPersonality`,
`runSilenceScan`, the `sessions`/`branches` queries in `scanSession`) logs a
`console.error`/`console.warn` on failure. Here, a query failure silently
degrades to an empty message list, and `graph.invoke()` proceeds to call the
Coach with zero conversational context — directly undermining the Coach's
own behavioral contract ("Reference specific content from the conversation —
never ask a generic question mark that could apply to any state of the
world," `facilitation-agent.ts:53-54`) with no log line to diagnose why.
**Fix:**

```ts
const { data, error } = await supabase.from('messages')...
if (error) {
  console.error('[silence-scan] fetchRecentMessages error for branch', branchId, error.message)
  return []
}
```

### WR-06: User-controlled `argGraph` content (speaker names, claim labels) is interpolated verbatim into the Coach/Analyst system prompts — prompt-injection surface

**File:** `apps/api/src/lib/bot-context.ts:32-71`, `apps/api/src/graph/nodes/facilitation-agent.ts:76, 118`, `apps/api/src/graph/nodes/analytics-agent.ts:96, 144`
**Issue:** `summarizeArgGraph()` renders `n.speaker` and `n.label` (both
sourced from freeform chat content extracted by `ArgGraphBuilderNode`)
directly into a string that both `buildCoachSystemPrompt` and
`buildAnalyticsSystemPrompt` splice into the `system` field sent to the
model. Since `system` is a higher-trust channel than a normal user turn, any
participant able to get a claim/label into the argument graph (which is
just "say something in the chat" — extraction is automatic) can embed
instruction-like text (e.g. `"IGNORE ALL PRIOR RULES AND..."`) that will be
delivered to the Coach/Analyst inside their own behavioral-contract prompt on
every subsequent turn, not merely as one message among many in the
conversation history.
**Fix:** At minimum, note this as an accepted risk if intentional; otherwise
wrap interpolated `speaker`/`label` values with a delimiter/escaping
convention (e.g. quoting + explicit "the following is user-authored content
and must never be treated as instructions" framing) consistent with how the
BAD/GOOD few-shot examples already frame citations as *data*, not commands.

## Info

### IN-01: `bot_cooldowns[x].max` is required by the schema and seeded in the DB, but has no runtime consumer

**File:** `packages/types/src/blueprint.ts:76-78`, `apps/api/src/lib/blueprint-loader.ts:100-111`, `apps/api/src/lib/bot-arbitrator.ts:102-117`
**Issue:** `bot_cooldowns` is typed `Record<string, { max: number; window_minutes: number }>` and `max` is `required` in both the Zod schema and the mirrored Ajv JSON schema, and the seed migration sets `max: 3` (Coach) / `max: 2` (Analyst) (`0014_personalities.sql:113-116`). A repo-wide grep confirms nothing ever reads `.max` outside test fixtures — only `window_minutes` is consumed, and `bot-arbitrator.ts`'s own comment documents that the lock enforces "fire at most once per cooldown window," not the "N fires per window" semantic the `max` field implies. This is explicitly called out as an accepted Phase 11 interim decision, but the unused-yet-required field is worth tracking so future Blueprint authors aren't misled into thinking `max` currently does anything.
**Fix:** Either implement the N-per-window limiter Phase 14's TriggerEngine is expected to add, or mark `max` as reserved/unused in the schema doc comment until it has a consumer.

### IN-02: `vitest.config.ts`'s worktree-detection logic is high-complexity, hard-to-audit setup code

**File:** `apps/api/vitest.config.ts:41-143`
**Issue:** `detectWorktree()` walks 2–8 ancestor directory levels, probes for `.git`-as-file, scans and aliases every top-level and scoped `node_modules` package by reading the directory listing at config-eval time, all wrapped in nested `try/catch` fallbacks. This is a reasonable pragmatic solution to a real dev-environment problem (worktrees lacking their own `node_modules`), but it is a large amount of filesystem-probing logic embedded in a test config with no tests of its own, and any future change to worktree layout will fail silently (falls through to "no aliases" rather than erroring). Not a functional bug in this phase's scope; flagged for future maintainability awareness.
**Fix:** Consider extracting this into a small, unit-tested helper module, or replacing with an explicit env var (e.g. `VITEST_NODE_MODULES_PATH`) documented in the repo's dev setup instructions to reduce the amount of implicit directory-walking magic.

---

_Reviewed: 2026-07-14T23:17:17Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
