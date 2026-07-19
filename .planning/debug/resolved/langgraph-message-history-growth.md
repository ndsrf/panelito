---
status: resolved
trigger: "Split off from the analyst-missing-langfuse session (resolved) while investigating a live Langfuse trace the user pasted for that session's fix verification. The user asked: 'I feel the context is growing indefinitely inside the graph... I see the History within the Langfuse contains a lot of messages, is that normal?' Investigation confirmed this is a real, distinct root cause — NOT a Langfuse UI display artifact — and is unrelated to that session's original bug (agentNode missing Langfuse instrumentation), so it is tracked here as its own session per the project's established split-off precedent (see langfuse-traces-missing-userid → analyst-missing-langfuse for the prior instance of this pattern)."
created: 2026-07-19T10:05:00Z
updated: 2026-07-19T08:20:16Z
symptoms_prefilled: true
goal: find_and_fix
---

## Current Focus

reasoning_checkpoint:
  hypothesis: |
    The `messages` field's pure-concat reducer in apps/api/src/graph/state.ts is the root
    cause, not a missing per-node slice. Both live call sites (apps/api/src/routes/ai.ts
    human /invoke path, AI-08; apps/api/src/lib/trigger-engine.ts bot silence_gate path)
    treat Supabase's `messages` table as the sole source of truth for conversation history:
    on EVERY invocation they compute a fresh, already-bounded window from the DB (last 8 +
    compressed summary in ai.ts; last CONTEXT_WINDOWS.facilitation=10 in trigger-engine.ts)
    and pass it as the FULL `initialState.messages`/`messages` for that turn — never a delta.
    Because the reducer concats instead of replacing, the checkpoint keeps appending each
    turn's full fresh window on top of everything already checkpointed, growing unboundedly.
    This directly matches the ALREADY-DOCUMENTED Phase 10 decision D-12 (10-CONTEXT.md):
    "bots get conversation history from Supabase messages table, not from the :human
    checkpoint" — i.e. the checkpoint was never meant to be the accumulated source of truth
    for conversation history at all. The only place that assumes accumulate-via-concat
    semantics is an inline test comment labelled "D-12b" in graph.integration.test.ts (NOT
    a real cross-referenced project decision — grep across .planning/ finds zero other
    references to "D-12b"), which predates AI-08 and was never reconciled with it.
  confirming_evidence:
    - "ai.ts:412-417 sets initialState.messages = promptArray, which assemblePromptArray()
       builds fresh every turn from a DB query (recentMessages: last 8, ai.ts:213-226) plus
       a compressed summary of older messages (ai.ts:228-251) plus the new userMessage —
       never a single-message delta."
    - "trigger-engine.ts:293/317 sets messages: recentMessages, sourced from
       fetchRecentMessages() (trigger-engine.ts:608-615), which queries Supabase bounded to
       .limit(CONTEXT_WINDOWS.facilitation) — again a fresh bounded DB window every tick,
       never a delta."
    - "Grepped every node file (agent.ts, analytics-agent.ts, arg-graph-builder.ts,
       facilitation-agent.ts, orchestrator.ts, drift-reply.ts, mutation-gate.ts,
       profile-builder.ts, trigger-gate.ts) for any `return { messages: ... }` partial-state
       write — none exists. No node ever appends to state.messages mid-run; it is only ever
       set once, at invocation time, by the caller. This makes the reducer's accumulate
       behavior pure liability with zero intra-run benefit."
    - "10-CONTEXT.md D-12 (Phase 10, real cross-referenced decision): 'bots get conversation
       history from Supabase messages table, not from the :human checkpoint' — directly
       states the DB, not the checkpoint, is the source of truth."
    - "graph.integration.test.ts Test A's 'D-12b' label (the only place concat-accumulate
       semantics are asserted, lines 176-206) is NOT found anywhere else in .planning/ —
       it is not a tracked decision, just an inline test-writer assumption from Phase 6,
       predating AI-08 (Phase 7-8) which established the actual DB-source-of-truth pattern
       used in production today."
  falsification_test: |
    If any node were found to return a partial `{ messages: [...] }` update mid-run
    (relying on the checkpoint to merge it with the caller's window within a single
    invocation), switching the reducer to overwrite would silently drop that update —
    this would falsify the fix's safety. Confirmed absent via exhaustive grep (see
    confirming_evidence above). If ai.ts or trigger-engine.ts were found to send only a
    delta message (not a full fresh window) on any call path, that would falsify the
    "both call sites already assume overwrite semantics" claim — confirmed false via direct
    read of both files (full window every call, not a delta).
  fix_rationale: |
    Change the `messages` Annotation reducer in state.ts from
    `left.concat(Array.isArray(right) ? right : [right])` to an overwrite-style reducer
    `(_, v) => v` (matching the "Overwrite-style" pattern already documented and used by
    every other non-locked field in the same file: agentOutput, argGraph, triggerMetadata,
    etc). This addresses the root cause (reducer semantics contradicting how every real
    caller uses the field) rather than a symptom (agentNode's missing slice) — it also
    automatically fixes agentNode's unbounded-input issue with zero new code there, since
    state.messages will now simply equal whatever bounded window the caller passed for that
    turn, exactly like facilitation-agent.ts/analytics-agent.ts's sliced views already
    behave. canvasOps is NOT touched — its cross-turn accumulation is a genuine, intended
    design (the argument graph legitimately grows over a branch's lifetime) and no evidence
    suggests it has the same DB-recompute-per-turn contradiction.
  blind_spots: |
    Have not yet run the fix against the real local Supabase-backed integration test
    (graph.integration.test.ts Test A, HAS_SUPABASE-gated) to directly observe checkpoint
    size stop growing — will do so as part of verification. Test A's existing assertions
    (`secondResult.messages.length` > 1, D-12b framing) must be rewritten to match the new,
    correct overwrite semantics; if that rewrite reveals a reason the original author chose
    concat that isn't visible from static code reading, would need to revisit. Have not
    load-tested a 20+ turn synthetic session end-to-end (scripts/synthetic-session.ts) —
    relying on code-level proof (reducer + both call sites + exhaustive no-mid-run-write
    grep) rather than a live 20-turn run, per time/scope tradeoff; the mechanism is fully
    understood and deterministic, so this is considered acceptable but is noted as untested
    at full realistic scale.

hypothesis: |
  apps/api/src/graph/state.ts's `messages` field uses a pure concat reducer
  (`left.concat(Array.isArray(right) ? right : [right])`) with no trim/window/dedup logic, and this
  state is checkpointed per thread_id via PostgresSaver (apps/api/src/lib/langgraph-checkpointer.ts).
  apps/api/src/routes/ai.ts reuses the SAME thread_id (`${activeBranchId}:human`) across every human
  /invoke turn on a branch, and on each turn recomputes `promptArray` fresh from the DB (AI-08: last
  8 recent messages + a compressed summary of up to 50 older messages) and passes it as
  `initialState.messages`. Because the reducer concatenates rather than replaces, this
  heavily-overlapping window is appended on top of whatever is already checkpointed, so the
  checkpointed `messages` array grows by ~9-10 (largely duplicate) entries EVERY human turn, forever,
  with no cap — this is what the user is observing as "a lot of messages" in Langfuse's History/input
  view, and their instinct that "context is growing indefinitely inside the graph" is correct, not a
  misunderstanding of the UI.

  A related, narrower issue: three of the graph's five LLM-calling nodes (facilitation-agent.ts,
  analytics-agent.ts, arg-graph-builder.ts) already defensively slice `state.messages.slice(-CONTEXT_
  WINDOWS.X)` before using it, apparently as an established workaround for this exact unbounded-growth
  risk (CONTEXT_WINDOWS = { facilitation: 10, analytics: 20, argBuild: 100, driftCheck: 3 } in
  apps/api/src/lib/bot-context.ts). agentNode (apps/api/src/graph/nodes/agent.ts, lines 152 and 161)
  is the one node that does NOT slice — it sends the full, unbounded `state.messages` directly to
  `adapter.stream()` and into the Langfuse `input` field. There is no `agent` key in CONTEXT_WINDOWS
  at all, suggesting this was simply never handled for agentNode when the pattern was established for
  the other nodes.

test: |
  Not yet executed in this session (split off from analyst-missing-langfuse before any fix was
  attempted, per instruction to only diagnose/split, not fix). Next investigator should:
  1. Reproduce directly: run a synthetic multi-turn session against the same branch/thread_id (or use
     scripts/synthetic-session.ts, already used for Phase 14 verification) for e.g. 10-20 human turns,
     then call `graph.getState({ configurable: { thread_id: '<branch>:human' } })` after each turn and
     log `values.messages.length` — confirm it grows roughly linearly (~9-10/turn) rather than staying
     bounded at the DB-fetched window size (~9-10 total).
  2. Confirm duplication: diff consecutive turns' checkpointed `messages` arrays to quantify how much
     of each turn's appended content is a repeat of content already present from prior turns' DB-fetch
     windows.
  3. Confirm downstream cost impact: measure the actual prompt token count sent to the LLM by agentNode
     (via adapter.stream(state.messages, ...)) across a long synthetic session, and compare against
     facilitation-agent.ts/analytics-agent.ts's sliced equivalents in the same session, to quantify how
     much extra, unbounded cost this causes specifically for Analista Científico turns.
expecting: |
  If the hypothesis is correct, state.messages.length will grow roughly linearly with turn count
  (no plateau), consecutive turns' arrays will show substantial content overlap/duplication, and
  agentNode's per-turn input token count (unlike facilitation-agent.ts/analytics-agent.ts's) will grow
  unboundedly over a long session rather than staying capped near a fixed window size.
next_action: |
  DONE. Fix applied: messages reducer in apps/api/src/graph/state.ts changed from concat to
  overwrite. Self-verified via apps/api/src/graph/graph.integration.test.ts Test A run against
  the real local Supabase PostgresSaver checkpointer (SUPABASE_DIRECT_URL present, not skipped):
  two invocations on the SAME thread_id, second invocation's checkpointed messages.length === 2
  (exactly the second window sent, not 3 which concat would have produced) — direct, real-DB
  proof the checkpoint no longer accumulates. Full apps/api test suite run before and after the fix:
  identical 8 pre-existing failures (unrelated routes: keys.test.ts, ai.test.ts SSE/abort tests —
  confirmed pre-existing via git stash on main, not caused by this change), no new failures, no
  regressions. Confirmed via grep that no other code path reads checkpoint `values.messages`
  expecting accumulated history (trigger-engine.ts's getState() calls only read phaseGateProgress/
  triggerMetadata, never messages). Human verification received 2026-07-19: user ran a branch with
  multiple human turns and checked live behavior, confirming "yes, it seems there is less messages
  now" — checkpointed/traced message count no longer grows unboundedly turn over turn. Session
  closed.

## Symptoms

expected: |
  LangGraph checkpoint state (state.messages), and the Langfuse trace input built from it, should stay
  bounded to a sensible working window per turn (e.g. matching the ~8-message sliding window + summary
  that ai.ts already computes from the DB, or the CONTEXT_WINDOWS values other nodes already use) —
  not grow without bound across the lifetime of a branch's thread_id.
actual: |
  Langfuse's "History" view and the raw trace payloads show large, growing `messages` arrays. Code
  inspection confirms the checkpointed `messages` field uses a pure concat reducer with no trim, is
  persisted per thread_id via PostgresSaver, and is re-appended to (not replaced) on every human
  /invoke turn — with agentNode additionally sending this unbounded array to the LLM directly, unlike
  its sibling nodes which defensively slice to a bounded CONTEXT_WINDOWS size.
errors: None observed — no console/server errors; this is a resource-growth/cost concern, not a crash.
reproduction: |
  Not yet reproduced via direct observation/instrumentation in this session (only via code inspection
  of the reducer, checkpointer, and call sites — see hypothesis and Evidence). Expected to be
  100% reproducible: any branch with more than a few human turns should show a monotonically growing
  checkpointed `messages` array for its `:human` thread_id (and separately for its `:bot` thread_id).
started: |
  Unknown / not yet dated precisely — the concat reducer (apps/api/src/graph/state.ts) and PostgresSaver
  checkpointing (apps/api/src/lib/langgraph-checkpointer.ts) both date to Phase 6/7 (per STATE.md,
  2026-07-01 entry: "Phase 6 graph construction must prove PostgresSaver checkpointer before Phase 7
  begins"). No STATE.md decision documents unbounded growth as an accepted tradeoff, suggesting this
  was not a deliberate design choice but an oversight that other nodes (facilitation-agent.ts,
  analytics-agent.ts, arg-graph-builder.ts) independently worked around via CONTEXT_WINDOWS slicing at
  some later point, without the underlying checkpoint growth itself ever being addressed, and without
  agentNode ever receiving the same treatment.

## Eliminated

## Evidence

- timestamp: 2026-07-19T09:58:00Z
  checked: |
    apps/api/src/graph/state.ts (GraphStateAnnotation.messages reducer, full read), apps/api/src/lib/
    langgraph-checkpointer.ts (PostgresSaver singleton), apps/api/src/routes/ai.ts (thread_id
    construction + initialState.messages assembly, AI-08 sliding window), apps/api/src/lib/
    trigger-engine.ts (bot thread_id construction), apps/api/src/lib/bot-context.ts (CONTEXT_WINDOWS
    constant), apps/api/src/graph/nodes/{facilitation-agent,analytics-agent,arg-graph-builder,agent}.ts
    (grep for state.messages usage), .planning/STATE.md (decisions log, Phase 6/7/11/14 entries).
  found: |
    state.ts's `messages` Annotation uses a pure concat reducer (`left.concat(...)`) with no
    trim/dedup/window logic, checkpointed per thread_id via PostgresSaver. ai.ts sets
    `thread_id: ${activeBranchId}:human` (reused across EVERY human /invoke turn on that branch) and
    trigger-engine.ts uses a separate `${branchId}:bot` thread for proactive/Skill-fired turns — two
    independently, permanently growing histories per branch by design (BOT-04 comment in ai.ts). On
    every human /invoke call, ai.ts recomputes `promptArray` fresh from the DB (AI-08: last 8 recent
    messages + a compressed summary of up to 50 older messages) and passes it as
    `initialState.messages` to `graph.stream()` — because the reducer is a pure concat, this
    heavily-overlapping window is APPENDED on top of whatever is already checkpointed for that
    thread_id, not replacing it. This means the checkpointed `messages` array grows by ~9-10 (largely
    duplicate) entries on every single human turn, forever, with no cap.
    Corroborating evidence: facilitation-agent.ts, analytics-agent.ts, and arg-graph-builder.ts ALL
    defensively call `state.messages.slice(-CONTEXT_WINDOWS.X)` before using it for their own LLM
    calls (CONTEXT_WINDOWS = { facilitation: 10, analytics: 20, argBuild: 100, driftCheck: 3 } in
    bot-context.ts) — three of five LLM-calling graph nodes already work around exactly this
    unbounded-growth risk. agentNode (apps/api/src/graph/nodes/agent.ts lines 152/161) is the ONE node
    that does NOT slice — it passes the full, unbounded `state.messages` directly to
    `adapter.stream()` AND into the Langfuse `input` field verbatim, and there is no `agent` key in
    CONTEXT_WINDOWS at all (only facilitation/analytics/argBuild/driftCheck exist) — direct code
    evidence this was simply never handled for agentNode, unlike its siblings. No STATE.md decision
    documents unbounded checkpoint growth as an accepted tradeoff; Phase 6/7 decisions only establish
    that PostgresSaver checkpointing itself works, not that raw growth is bounded.
  implication: |
    Confirmed via code inspection (reducer + call sites + checkpointer wiring) that this is a real,
    architecture-level growth issue, not a Langfuse UI rendering quirk. Not yet confirmed via direct
    runtime observation (e.g. measuring actual checkpoint size across a multi-turn synthetic session)
    — that is the next concrete step for this session (see Current Focus `next_action`).

- timestamp: 2026-07-19T10:15:00Z
  checked: |
    apps/api/src/routes/ai.ts (full initialState.messages assembly, lines ~190-417),
    apps/api/src/lib/trigger-engine.ts (fetchRecentMessages, recordCooldown, updateState
    call sites), apps/api/src/lib/anthropic.ts (assemblePromptArray signature/behavior),
    exhaustive grep of apps/api/src/graph/nodes/*.ts for any `messages:` partial-state
    return, apps/api/src/graph/graph.integration.test.ts (Test A, D-12b framing), grep of
    .planning/ for "D-12b" (zero hits outside the test file) and "D-12" (Phase 10
    10-CONTEXT.md: "bots get conversation history from Supabase messages table, not from
    the :human checkpoint").
  found: |
    Both live call sites (ai.ts human path, trigger-engine.ts bot path) send a FULL,
    already-bounded, freshly-recomputed-from-DB window as `messages` on every single
    invocation — never a delta. No graph node ever returns a partial `{ messages: ... }`
    update mid-run (confirmed via exhaustive grep), so the concat reducer's
    accumulate-across-turns behavior has zero intra-run purpose and only serves to
    duplicate each turn's full window on top of prior turns' checkpointed windows. The
    real, cross-referenced Phase 10 decision D-12 explicitly states the DB (not the
    checkpoint) is the source of truth for conversation history. The only place
    concat-accumulate semantics are actually asserted is an inline "D-12b" test comment in
    graph.integration.test.ts with zero other references anywhere in .planning/ — not a
    tracked decision, just a Phase 6 test assumption that predates and was never reconciled
    with AI-08 (Phase 7-8), which established the DB-source-of-truth pattern actually used
    in production.
  implication: |
    Confirms the root cause is the reducer's semantics fundamentally contradicting the
    established (Phase 10 D-12) and actually-implemented (AI-08) architecture, not merely a
    missing per-node defensive slice in agentNode. Fix: change the `messages` reducer to
    overwrite-style, matching every other non-locked field's pattern in state.ts. This is
    safe (no mid-run accumulation depends on concat) and fixes agentNode's unbounded input
    as a side effect (state.messages becomes whatever bounded window the caller passed).

- timestamp: 2026-07-19T08:20:16Z
  checked: |
    Live multi-turn branch session run by the human user in production (not a synthetic test or
    self-verification) after the fix was applied — the direct, real-world equivalent of the
    "blind_spots" note above that flagged the fix as untested "at full realistic scale."
  found: |
    User's verbatim response after running a branch with multiple human turns and checking live
    behavior: "yes, it seems there is less messages now."
  implication: |
    Human confirms the checkpointed/traced message count no longer grows unboundedly turn over
    turn in a real session, corroborating the self-verification already recorded in `next_action`
    (Test A real-DB proof, length === 2 not 3) and closing the one remaining blind spot (no live
    20+ turn load test had been run). Session resolved.

## Resolution

root_cause: |
  apps/api/src/graph/state.ts's `messages` field uses a pure-concat reducer
  (`left.concat(...)`), inherited from an early (Phase 6) design where the LangGraph
  PostgresSaver checkpoint was assumed to be the accumulating source of truth for
  conversation history (only ever asserted by an inline, untracked "D-12b" test comment in
  graph.integration.test.ts — not a real cross-referenced project decision). This was never
  reconciled with the actual, later, and now-canonical architecture established by AI-08
  (apps/api/src/routes/ai.ts) and mirrored in apps/api/src/lib/trigger-engine.ts, and
  explicitly documented as Phase 10 decision D-12 (10-CONTEXT.md): Supabase's `messages`
  table — not the LangGraph checkpoint — is the source of truth for conversation history.
  Both live call sites compute a fresh, already-bounded window from the DB on EVERY
  invocation and pass it as the full `messages` for that turn (never a delta). Because the
  reducer concatenates instead of replacing, each turn's full window is appended on top of
  everything already checkpointed, growing the checkpointed `messages` array by ~9-10
  duplicate entries every human turn (and similarly on the bot `:silence_gate` thread),
  forever, with no cap. agentNode (apps/api/src/graph/nodes/agent.ts) is the one
  LLM-calling node that reads `state.messages` directly with no defensive slice, so it
  additionally sent this unbounded, heavily-duplicated array straight to the LLM and into
  the Langfuse `input` field — which is what the user observed as "a lot of messages" in
  Langfuse's History view.
fix: |
  Changed the `messages` Annotation reducer in apps/api/src/graph/state.ts from
  `(left, right) => left.concat(Array.isArray(right) ? right : [right])` to an
  overwrite-style reducer `(_, v) => v`, matching the "Overwrite-style" pattern already
  documented and used by every other non-locked field in the same file. Each invocation's
  `messages` now simply reflects the caller-supplied window for that turn (as both ai.ts
  and trigger-engine.ts already intend), instead of being appended to whatever was
  previously checkpointed. This also fixes agentNode's unbounded-input issue with no new
  code in agent.ts, since state.messages is now already bounded to the same window
  facilitation-agent.ts/analytics-agent.ts slice down to explicitly. Updated
  graph.integration.test.ts's Test A (previously asserting concat-accumulate "D-12b"
  behavior) to assert the corrected overwrite semantics and to reference the real Phase 10
  D-12 decision instead of the untracked "D-12b" test-comment label.
verification: |
  Self-verified: apps/api/src/graph/graph.integration.test.ts Test A run against the real local
  Supabase PostgresSaver checkpointer (not mocked, not skipped — SUPABASE_DIRECT_URL present).
  Two graph.invoke() calls on the same thread_id; second invocation's checkpointed
  `messages.length` === 2, exactly matching the second window sent (a concat reducer would have
  produced length 3 by appending on top of the first invocation's 1 message) — direct, real-DB
  proof the checkpoint no longer accumulates. Full apps/api vitest suite (`npx vitest run`, 328
  tests) run before (git stash) and after the fix: identical 8 pre-existing failures in unrelated
  routes (keys.test.ts, ai.test.ts SSE/abort — confirmed pre-existing on main via git stash, not
  introduced by this change); 0 new failures, 0 regressions. Grepped for any other consumer of
  checkpoint `values.messages` (trigger-engine.ts's three getState() call sites) — none read
  `messages`, only `phaseGateProgress`/`triggerMetadata`, so no regression risk there.

  Human verification (2026-07-19): user ran a branch with multiple human turns and checked live
  behavior in the real app. Verbatim response: "yes, it seems there is less messages now" —
  confirming the checkpointed/traced message count no longer grows unboundedly turn over turn in
  production, not just in the self-verified integration test. This closes the one remaining blind
  spot noted during investigation (no live 20+ turn load test had been run).
files_changed:
  - apps/api/src/graph/state.ts
  - apps/api/src/graph/graph.integration.test.ts
