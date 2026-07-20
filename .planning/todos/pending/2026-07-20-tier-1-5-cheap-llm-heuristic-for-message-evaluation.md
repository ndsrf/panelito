---
created: 2026-07-20T16:52:54.587Z
title: Tier-1.5 cheap-LLM heuristic for message evaluation
area: api
files:
  - apps/api/src/lib/skills/moderation.ts
  - apps/api/src/lib/skills/fact-check.ts
  - .planning/phases/15-message-evaluation-pipeline-evaluate-and-trace-every-message/15-CONTEXT.md
---

## Problem

Phase 15's tier-1 heuristics (`checkModerationHeuristic()`, `looksLikeCheckableClaim()`) are pure zero-LLM-cost, zero-I/O code (regex/string matching), per that phase's locked D-05/D-06 decisions and ROADMAP success criterion #2 ("tier-1 heuristic pre-filter runs on every message with zero LLM token cost"). Pure heuristics will miss nuanced signals — implicit claims, unstated hypotheses for fact-check, subtler moderation cases — that a model could catch but a regex can't.

Raised during Phase 15 planning (2026-07-20): is it possible to add an extremely cheap LLM call as an additional/replacement tier-1 heuristic — a single-message, tiny-prompt, no-session-context call against a cheap model (e.g., Haiku/nano tier) — to catch what pure heuristics miss, without materially changing the cost profile?

Explicitly deferred rather than folded into Phase 15 because:
- It conflicts with Phase 15's locked "zero LLM token cost" success criterion and D-05/D-06 (heuristics must be zero-I/O).
- It changes the cost model that Phase 15's own Langfuse trace-volume-sizing research was built around (every message in every session would now carry a real, if small, per-message LLM cost).
- Phase 15 planning was already complete and committed (4 plans) when this came up — reworking it would have meant amending CONTEXT.md and replanning.

## Solution

TBD. Needs its own scoping pass:
- Define the cost/latency tradeoff of a "tier-1.5" cheap-LLM pass vs. the current zero-cost tier-1 (would need real per-message token/cost estimates, not just "cheap").
- Decide whether it replaces or supplements the existing regex heuristics, and whether it applies to all Skills or only ones where regex heuristics demonstrably miss cases (e.g. fact-check's implicit-claim detection).
- Reconcile with Phase 15's Langfuse trace-volume sizing research (`.planning/phases/15-.../15-RESEARCH.md`) — a nonzero-cost tier-1 changes the unit-count-per-invocation math.
- Likely belongs in its own future phase, not a Phase 15 amendment, given Phase 15 is already planned/committed.
