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
