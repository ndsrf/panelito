# Root Cause: Untagged Messages Produce No Langfuse Activity

**Quick task:** 260719-e9x
**Status:** Confirmed against live code (all citations re-verified during execution, not copied blind from the planning brief)

---

## 1. User's report (restated)

The user expects that when they type a message in the session chat WITHOUT tagging
`@analista`, the system should still leave *some* Langfuse trace — the mental model being
"the agent evaluated my message and chose to stay silent, and that evaluation should be
observable." Instead, untagged messages currently produce zero Langfuse activity of any
kind.

---

## 2. The three-path model (confirmed file:line)

### Path A — Reactive, tagged (`@analista` present)

- `apps/web/app/(protected)/sessions/[id]/workspace.tsx:60`
  ```ts
  const ANALISTA_PATTERN = /@analista/i
  ```
- `apps/web/app/(protected)/sessions/[id]/workspace.tsx:264-273` (`handleAfterSend`)
  ```ts
  const handleAfterSend = (content: string) => {
    if (ANALISTA_PATTERN.test(content)) {
      openAIStream(content, false, activeBranchId).catch((err) => {
        console.error('[Workspace] openAIStream failed:', err)
      })
    }
    setTimeout(refreshMessages, 300)
  }
  ```
  Confirmed live: `openAIStream` (which POSTs to `/invoke`, opening the SSE stream) is only
  called when the regex matches. This is the only per-message reactive entry point gated by
  message content.

- **Additional reactive entry point found during re-verification (not previously cited in
  the plan's `<interfaces>` block — the plan explicitly asked for a grep of "any OTHER
  caller of openAIStream"):** Power reactions. `apps/web/hooks/use-reactions.ts:279-293`
  posts a reaction to `apps/api/src/routes/reactions.ts:104`:
  ```ts
  const triggersAI = ['🔥', '📌', '🎯'].includes(body.emoji)
  ```
  and `MessageList.tsx:223-228` / `workspace.tsx:346` wire `onTriggerAIStream` to also call
  `openAIStream('', false)` when `triggersAI` is `true`. So there are exactly **two** ways a
  human action reactively invokes the graph today: (1) typing `@analista`, or (2) reacting to
  any message with 🔥, 📌, or 🎯. Both routes converge on the same `/invoke` endpoint. Neither
  is relevant to a *plain untagged, unreacted* message — which is the case the user is asking
  about, and which never calls `openAIStream` at all.

### Path B — Reactive, untagged (the case the user is asking about)

Confirmed: untagged content with no power-reaction never calls `openAIStream`. The `if`
branch above is simply skipped — only `setTimeout(refreshMessages, 300)` runs (a UI refresh
of the message list, not an AI invocation). No HTTP request to `/invoke` is made, so no
`CallbackHandler` is ever constructed for that message, and nothing reaches the graph.

### Path C — Reactive invocation, once reached, is unconditional

- `apps/api/src/routes/ai.ts:65` — `POST /:id/invoke` route entry.
- `apps/api/src/routes/ai.ts:378` — per-request `CallbackHandler` is **always** constructed
  when this route runs (no conditional gate around it):
  ```ts
  const callbackHandler = new CallbackHandler({ ... })
  ```
- `apps/api/src/routes/ai.ts:411` — `callbacks: [callbackHandler]` passed unconditionally to
  `graph.invoke(...)`.
- `apps/api/src/graph/graph.ts:113-134` (`routeFromStart`):
  ```ts
  export function routeFromStart(state: GraphState): 'facilitation' | 'analysis' | 'orchestrator' {
    const { triggerType } = state
    if (triggerType === 'silence_gate') { return 'facilitation' }
    if (triggerType === 'analysis_request') { return 'analysis' }
    if (triggerType === null || triggerType === undefined) {
      // Valid human path — no trigger set at all. Not an error.
      return 'orchestrator'
    }
    throw new Error(`[graph] routeFromStart: unrecognized triggerType "${triggerType}"`)
  }
  ```
  Confirmed: once `/invoke` runs at all, `triggerType` is `null`/`undefined` for the human
  path, which routes to `'orchestrator'` and proceeds through the graph to a response. **There
  is no "agent evaluated and decided to stay silent" branch anywhere in this path** — if the
  graph runs, it produces output (subject to existing domain-drift/ignore logic elsewhere in
  the orchestrator, which is out of scope here). The only gate is upstream, in the frontend
  (Path A/B above): whether `/invoke` gets called at all.

### Path D — Proactive, timer-based silence scan (the ONLY path the user currently sees fire on its own)

- `apps/api/src/lib/trigger-engine.ts` header comment (lines 1-31, confirmed) states
  explicitly: *"Five of the six trigger types already fire reactively... this module is the
  ONE timer-based trigger — the silence-window re-evaluation — because silence, by
  definition, has no inbound event to react to."* This confirms architecturally that
  per-message agent evaluation of untagged content is not a design gap — it was never built,
  by design, for any trigger type other than the timer-based silence scan.
- `scanBranch()` (`trigger-engine.ts:256-345`) runs on every `SCAN_INTERVAL_MS` tick
  (`:67`, default 60s) per active branch, and early-returns **before** constructing any
  `CallbackHandler` at each of the following gates:
  - `:271` — `if (!gateResult.passed) return` (silence threshold not yet met)
  - `:275-278` — cooldown active:
    ```ts
    const cooldownUntil = await readCooldownUntil(graph, botThreadId)
    if (cooldownUntil && new Date(cooldownUntil).getTime() > Date.now()) {
      console.info('[trigger-engine] cooldown active for', branch.id, 'until', cooldownUntil)
      return
    }
    ```
  - `:281-282` — arbitration winner is not the Coach:
    ```ts
    const winner = await runArbitration(branch.id, blueprint, supabase)
    if (winner !== 'coach') return
    ```
  - **Additional early-return found during re-verification, not previously cited:**
    `:284-291` — budget guard:
    ```ts
    const budget = await checkBotBudget(supabase, branch.id, ESTIMATED_COACH_FIRE_TOKENS)
    if (!budget.allowed) { ... return }
    ```
    This is a fourth silent-return point, also before any `CallbackHandler` exists.
  - Only after **all four** gates pass does the code reach `:311-317` (`CallbackHandler`
    construction) and `:317-343` (`graph.invoke(...)` with `triggerType: 'silence_gate'`,
    `callbacks: [callbackHandler]`). This is the only point in the entire proactive path
    where a Langfuse trace is created.

Confirmed: every proactive tick that evaluates the branch and decides NOT to have the Coach
speak (whichever of the four gates it fails on) returns with **no Langfuse trace whatsoever**
— exactly mirroring the reactive-untagged case. The only visible activity the user has ever
seen is a tick where the Coach actually fires.

---

## 3. Core finding

**Untagged messages are not evaluated per-message by any agent, on any path, today.** There
is no code path in which a plain untagged, unreacted message causes an LLM (or any other
evaluator) to look at it and decide to stay silent. Concretely:

- Reactively: the frontend gate (`ANALISTA_PATTERN` / power-reaction check) decides
  *before* any server call whether `/invoke` — and therefore the graph, and therefore any
  Langfuse trace — happens at all. An untagged, unreacted message simply never reaches the
  server's AI machinery.
- Proactively: the *only* timer-based re-evaluation is the silence-window scan, which is
  branch-level (not message-level) and only produces a trace when the Coach actually wins
  arbitration and fires — every "evaluated and declined" tick is silent by construction.

So the user's mental model — "the agent looked at my specific untagged message and chose
silence" — does not match the current architecture. There is currently no code path that
"looks at" an untagged message individually at all; the frontend decision (call `/invoke` or
don't) is the entirety of the decision, and it is a pure regex/emoji check with no LLM
involvement and no trace of its own.

---

## 4. Why this is not a trivial, low-risk fix

Per `CLAUDE.md`'s budget constraint — *"BYOK means zero AI compute cost to the platform;
creator's API key is the cost surface"* — any change that makes the system genuinely
"evaluate every untagged message and trace the decision" has to spend the **creator's own
API key** on every keystroke-worth of chat traffic, not just on `@analista`-tagged or
power-reacted messages. That is a material, recurring cost change to the product's BYOK
economics, not a bug fix. Two independent concerns follow from this:

1. **Cost surface.** Reactively evaluating every human message (even with a cheap
   classifier) multiplies LLM/API calls by however many untagged messages are sent per
   session — today those messages cost the creator nothing. Any such change needs an
   explicit cost-budget decision, not an incidental one made while investigating a
   visibility complaint.
2. **Trace volume.** Even a zero-LLM instrumentation choice on the proactive silence path
   (see options below) adds Langfuse event/span volume for every scan tick across every
   active branch, which has its own downstream (Langfuse plan/quota) cost implications.

Because of this, the fix is a product/cost decision that belongs to the user (the
creator paying for their own BYOK key and Langfuse plan), not something to auto-implement
during a diagnostic quick task.

---

## 5. Recommended Options

| Option | What it does | Cost impact | Effort | Matches user's literal expectation? |
|---|---|---|---|---|
| **accept** — Document only | No code change. This ROOT-CAUSE.md is the deliverable. | None | None | No — gap remains, now explained |
| **proactive-trace** — Low-risk observability | Emit a lightweight Langfuse event/span in `trigger-engine.ts::scanBranch()` at each of the four early-return points (`:271`, `:275-278`, `:282`, `:284-291`), *before* the early return, with no new LLM call. Contained to one file. | No new LLM spend (creator's BYOK key untouched); adds Langfuse event volume | Small (single file) | Partial — shows the system evaluated a branch and declined, but it's the timer scan, not tied to any specific untagged message |
| **reactive-eval** — Evaluate every untagged message | Add a real per-message evaluation (LLM call or new cheap classifier) on every untagged message, plus a new "stay silent" decision node/path on the reactive graph (`routeFromStart` / orchestrator), so every typed message gets a trace. | Recurring LLM spend on creator's BYOK key for every untagged message sent; new architecture (new graph node/path) | Large — architectural, needs its own planned phase and explicit cost budget | Yes — fully matches "every message I type leaves a trace" |

**Note on `reactive-eval`:** this is explicitly out of scope for a quick task per the plan's
own framing — it requires a new graph topology decision (a silent-decision node/path) and an
explicit, separate cost-budget conversation. If chosen, it should be handed to a dedicated
planned phase rather than implemented here.

---

## 6. What this document does NOT do

Per task constraint, no application code was modified while producing this document. All
citations above were re-opened and re-read live during this task's execution (not copied
from the pre-dispatch planning brief) and two additional details were confirmed beyond the
original brief: the power-reaction reactive path (`use-reactions.ts` / `reactions.ts:104`)
and the budget-guard early return (`trigger-engine.ts:284-291`).

---

## 7. Correction: moderation/fact-check evaluation is also gated, not just tracing

**This section corrects and extends Section 3's "core finding."** The original writeup
correctly identified WHY nothing traces for untagged messages, but undersold what's actually
missing: it is not merely an observability gap on an existing evaluation — the moderation and
fact-check Skills are **never evaluated at all** for untagged, unreacted messages, because the
node that runs them is unreachable without a full graph invocation.

### 7.1 TriggerGateNode consolidates all Skill detection onto the human-message path

- `apps/api/src/graph/nodes/trigger-gate.ts:1-12` (own top-of-file doc comment, re-verified):
  ```
  Consolidates ALL 4 new Skills' detect() calls (plus the retrofitted silence-break Skill,
  D-03) into ONE LangGraph node... TriggerGateNode is inserted into BOTH the primary
  human-message path (after mutationGate) AND the proactive analysis_request path...
  ```
  (Note: the phrase "Five of the six trigger types already fire reactively... synchronous
  Skills evaluated inline during a human /invoke turn" — quoted in the corrected finding this
  section is based on — is actually the `trigger-engine.ts:4-7` header comment, already cited
  correctly in Section 2 Path D of this document, not `trigger-gate.ts`'s own comment. The
  substance is the same and independently confirmed here from `trigger-gate.ts`'s own text:
  TriggerGateNode is the ONE node where every reactive Skill — moderation, fact-check,
  phase-readiness, orphan-edge, silence-break — gets its `detect()` called.)
- `apps/api/src/graph/graph.ts` edge wiring (re-verified, lines 220-293): for the human-message
  path (`triggerType === null`), the route is
  `orchestrator → agent → mutationGate → (routeAfterMutationGate, triggerGateComplete !== true,
  triggerType null) → argGraphBuilder → (routeAfterArgGraphBuilder, not analysis_request) →
  profileBuilder → (fixed edge) → triggerGate`. `TriggerGateNode` is reached on **every**
  human-message graph invocation that gets this far — but the graph is only invoked in the
  first place via the two gated entry points below (Section 7.3).

### 7.2 The heuristic tiers already exist and already fail cheap/safe

- `apps/api/src/lib/skills/moderation.ts:70` — `checkModerationHeuristic()` is confirmed as a
  **pure, zero-I/O, zero-adapter-call** function (own doc comment: "zero I/O, zero
  adapter/LLM calls"). It only reads `moderation_count` from the DB when the heuristic itself
  flags content — no LLM call at all for a message that isn't rude/insulting.
- `apps/api/src/lib/skills/fact-check.ts:59` — `looksLikeCheckableClaim()` is confirmed as tier
  1 of a three-tier escalation gate, also **pure, zero-I/O** (own doc comment: "A non-match
  makes ZERO adapter calls (COST-01)"). Tier 2 (`classifyTier2`, :93) — a cheap
  classification-tier model call — only runs when tier 1 matched. Tier 3 (the expensive
  `analyticsAgentNode` call) is not invoked by `detect()` at all; TriggerGateNode is
  detection-only and only routes to `analysis` on a confirmed tier-2 positive
  (`routeAfterTriggerGate`, `graph.ts`).
- **Confirmed implication:** the cost-safety infrastructure for cheap message-level evaluation
  already exists in the codebase today. The missing piece is not a new evaluator — it's a
  reactive invocation path that reaches `TriggerGateNode` for every message, not just
  tagged/reacted ones.

### 7.3 Confirmed exhaustive: only two reactive graph-invocation entry points exist

Re-grepped the entire codebase for every `createGraph(`, `graph.invoke(`/`graph.stream(`, and
`/invoke` caller to confirm exhaustiveness (not just the two paths originally cited):

- `createGraph(...)` is called in exactly two places: `apps/api/src/routes/ai.ts:284` (the
  `/invoke` route) and `apps/api/src/lib/trigger-engine.ts:153` (the proactive silence-scan
  loop, already covered in Section 2 Path D).
- The graph itself is driven in exactly two places: `ai.ts` uses `graph.stream()` (SSE,
  `:456`) and `trigger-engine.ts` uses `graph.invoke()` (`:317`). No other call site exists.
- On the frontend, the only two paths that reach `POST /invoke` (and therefore `ai.ts`'s
  `graph.stream()`) are: (1) `workspace.tsx:60,264-273` — the `@analista` tag match via
  `ANALISTA_PATTERN`; and (2) `use-reactions.ts` → `reactions.ts:104` — a power-reaction emoji
  (🔥📌🎯), surfaced through `QuickReactionPopover.tsx` / `MessageList.tsx` (already documented
  in Section 2 Path A of this document).
- Searched for any Supabase Database Webhook / `pg_net` / server-side trigger that might invoke
  the graph independent of these two frontend paths — none found in `apps/api` or the
  `supabase/` migrations directory.
- **Confirmed exhaustive:** there is no third path. A plain untagged, unreacted message
  literally never causes `createGraph`/`graph.stream`/`graph.invoke` to run, which means
  `TriggerGateNode` — and therefore moderation, fact-check, and every other Skill's
  `detect()` — never executes for that message. This is stronger than Section 3's original
  framing: it is an **evaluation gap**, not merely a **tracing gap**.

### 7.4 User's decision (resolves Task 2's checkpoint)

The user has reviewed this corrected finding and decided: **evaluation AND a Langfuse entry
on every single message — even when the heuristics fire on nothing and no Skill triggers.**

This resolves Task 2's `checkpoint:decision` as a **refined version of `reactive-eval`**, NOT
the original `reactive-eval` framing in Section 5 (which assumed full-cost LLM evaluation of
every message from scratch). The refined version is cheaper than originally framed, because
the zero-cost heuristic tiers (Section 7.2) already exist and already gate the expensive LLM
tiers — the only missing piece is a per-message invocation path that reaches
`TriggerGateNode` for every human message (not just tagged/reacted ones), plus a Langfuse
span/trace emitted for that evaluation turn regardless of whether a Skill fired. "Heuristic
ran, nothing triggered" becomes visible in Langfuse exactly like a fired Skill or a tagged
reply is today.

**Per the plan's own success criteria, this refined `reactive-eval` is still out of scope for
a quick task** (it requires a new reactive graph-topology decision) and is escalated below to
a dedicated planned phase — it is NOT implemented in this quick task.

### 7.5 Handoff to planned phase

A future `/gsd:plan-phase` can consume the following directly:

**Shape of the change:**
- A new reactive invocation path that reaches `TriggerGateNode` for every human message,
  independent of the existing `@analista`-tag / power-reaction gate. This does not replace the
  existing `/invoke` gate (tagged/reacted messages still get the full agent response as
  today) — it adds a parallel evaluation path for the messages that currently skip `/invoke`
  entirely.
- A per-request Langfuse `CallbackHandler` on that new path, constructed and passed to the
  graph invocation even when no Skill ultimately fires — mirroring the existing per-request
  pattern in `ai.ts:378` and `trigger-engine.ts:311-317`, so "evaluated, nothing fired" is
  visibly distinct in Langfuse from "evaluated, Skill X fired."

**Cost safety already in place (do not rebuild):**
- Tier-1 heuristics (`checkModerationHeuristic`, `looksLikeCheckableClaim`) are pure,
  zero-I/O, zero-adapter-call functions that already gate every paid tier. Any new per-message
  path should route through the *existing* `TriggerGateNode` (via `triggerGate`/Skills
  registered in `skills.ts`) rather than duplicating detection logic, so the cost-safety
  guarantees (Section 7.2) are inherited, not re-derived.
- `apps/api/src/lib/skills/moderation.ts` T-12-09-style billing-surface threat-model notes in
  `fact-check.ts` (tier-2/tier-3 model resolution as a BYOK billing surface) apply identically
  to this new path and should be re-read by whoever plans the phase.

**Explicitly NOT decided yet (planned phase must resolve):**
1. **Inline-blocking vs. async/fire-and-forget:** should the new evaluation run inline,
   blocking the message-send response, or should it run asynchronously after the message is
   already stored (so message-send latency is unaffected)?
2. **Endpoint/transport shape:** should this reuse the existing `/invoke` SSE endpoint (with a
   new `triggerType` or flag that routes straight to `mutationGate`/`argGraphBuilder` →
   `triggerGate` without the tag gate), or should it be a new lightweight endpoint / background
   job (e.g., a queue consumer) separate from the SSE streaming path entirely?
3. **Frontend wiring:** where does the "call this for every message" trigger live — inside
   `handleAfterSend` unconditionally (replacing/supplementing the current `if
   (ANALISTA_PATTERN.test(content))` gate), or server-side on message insert?
4. **Rate/volume implications:** even at zero LLM cost for the common case, every message now
   produces a Langfuse trace/span — the planned phase should size expected trace volume
   against the user's Langfuse plan tier before implementation.
