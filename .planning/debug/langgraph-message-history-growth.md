---
status: investigating
trigger: "Split off from the analyst-missing-langfuse session (resolved) while investigating a live Langfuse trace the user pasted for that session's fix verification. The user asked: 'I feel the context is growing indefinitely inside the graph... I see the History within the Langfuse contains a lot of messages, is that normal?' Investigation confirmed this is a real, distinct root cause — NOT a Langfuse UI display artifact — and is unrelated to that session's original bug (agentNode missing Langfuse instrumentation), so it is tracked here as its own session per the project's established split-off precedent (see langfuse-traces-missing-userid → analyst-missing-langfuse for the prior instance of this pattern)."
created: 2026-07-19T10:05:00Z
updated: 2026-07-19T10:05:00Z
symptoms_prefilled: true
goal: find_root_cause_only
---

## Current Focus

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
  Reproduce the growth pattern directly (see `test` above) using scripts/synthetic-session.ts or an
  equivalent multi-turn harness, to move from code-level inference (confirmed via reducer/call-site
  inspection) to direct observation of the checkpointed state's actual size over many turns, before
  proposing a fix (e.g. either switching the messages reducer to a replace/trim strategy, or applying
  the same CONTEXT_WINDOWS.slice(-N) pattern to agentNode as an immediate, minimal mitigation, or both
  — a full fix likely needs a project-level decision on whether the checkpoint should be the source of
  truth for "the conversation" at all, given ai.ts already recomputes promptArray fresh from the DB
  every turn).

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

## Resolution

root_cause: ""
fix: ""
verification: ""
files_changed: []
