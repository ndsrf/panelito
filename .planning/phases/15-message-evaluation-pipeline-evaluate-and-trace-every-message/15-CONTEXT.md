# Phase 15: Message Evaluation Pipeline - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a new reactive invocation path so every human message — not only `@analista`-tagged or power-reaction messages — is evaluated by the existing tier-1 heuristic layer (and the Skills registry behind `TriggerGateNode`), with a Langfuse trace recorded for that evaluation turn whether or not a Skill fires. This closes the evaluation gap confirmed in quick task `260719-e9x`: today a plain untagged, unreacted message never reaches `createGraph`/`graph.invoke` at all, so moderation, fact-check, and every other Skill's `detect()` never runs for it.

The existing `@analista`-tag / power-reaction path (`ANALISTA_PATTERN`, 🔥📌🎯 reactions → `/invoke` SSE) is **not replaced** — it keeps producing full agent responses exactly as today. Phase 15 adds a **parallel**, cheap, mostly-server-side evaluation path for the messages that currently skip `/invoke` entirely.

Because Phase 15 is adding a large number of new per-message heuristics, this phase also does a **foundational refactor** of the Skill/Role coupling: today a Skill hardcodes a single `role: 'coach' | 'analyst'` field and is registered into one of two fixed arrays (`COACH_SKILLS`/`ANALYST_SKILLS`). Phase 15 decouples the heuristic (`detect()`) implementation from the Role binding, so the same heuristic logic can be reused by more than one Role's Skill instance without duplicating code.

**What this phase does NOT include:**
- Replacing or changing the existing `@analista`-tag / power-reaction reactive path — it is untouched.
- Full "dynamically composed agents" (Personality carrying a display name, multiple simultaneous named instances of the same Role with different Personalities, a creator-facing agent-builder UI combining Role + Skills + Personality + name) — this is a real, larger vision the user described during discussion, but it's explicitly deferred to its own future phase ("Dynamic Agent Composition" — see `<deferred>`). Phase 15 only does the narrower "decouple Skill/heuristic from Role" refactor needed to support its own new heuristics cleanly.
- A queueing/retry mechanism for failed evaluation calls — fail-silent, log-only, matching this codebase's existing fail-open convention.
- Blueprint-level dynamic heuristic configuration — heuristics live in code, attached to Roles, not configured per-Blueprint (see D-08).

</domain>

<decisions>
## Implementation Decisions

### Evaluation Timing & Failure Handling

- **D-01:** The new per-message evaluation runs **async, fire-and-forget** — the message-send response is unaffected. This matches the existing pattern where sending a message already returns immediately (`workspace.tsx`'s `handleAfterSend` calls `openAIStream` without blocking the send). Zero added latency on typing, even for messages that escalate to a tier-2 classifier call.
- **D-02:** If the evaluation call fails for any reason (network error, adapter timeout, server restart mid-flight), it **fails silently and logs only** — no retry mechanism. Matches the existing fail-open/fail-silent convention already used across every Skill/graph node in this codebase (never throw from a Skill `detect()` call). A dropped evaluation simply means that one message doesn't get a Langfuse trace.

### Transport Shape

- **D-03:** The new evaluation path is a **new, separate, lightweight endpoint/background job** — not an extension of the existing `/invoke` SSE endpoint. Most calls do zero LLM work and never need a stream, so opening an SSE connection for every message would be wasted overhead. The existing `/invoke` route and its `@analista`/power-reaction gate are completely untouched.
- **D-04:** Despite being "lightweight," this path **must still produce a Langfuse trace entry every time** it runs — "evaluated, nothing fired" needs to be a visible outcome, not silence, since it's still part of the graph/evaluation system. This mirrors D-12/D-13 from `14-CONTEXT.md` (every LLM-adjacent call gets tagged/traced, not just proactive ones) extended to this new path.
- **D-05:** `ArgGraphBuilderNode` makes its own LLM extraction call on every pass, **independent of whether any Skill fires** — reusing the existing argGraphBuilder→profileBuilder→triggerGate chain for this new path would make every message cost an LLM call, defeating the point of the tier-1 heuristics. Resolution: **skip the argGraph update (and any other LLM work) whenever tier-1 heuristics say there's nothing to do.** If a heuristic/Skill *does* fire, do whatever work is normally needed for that fired Skill's path (which may include an argGraph update, if that's part of its normal flow) — the short-circuit only applies to the common "nothing fired" case.
- **D-06:** This "skip unless something fires" behavior is **not** a new Blueprint-configurable toggle — heuristics belong to the Role (code-defined, see D-07), not to Blueprint-level dynamic configuration. A per-Blueprint heuristic override was considered and explicitly rejected as too complex for a dynamic-JSON-configured field.

### Skill/Role Architecture Refactor

- **D-07:** Heuristics (a Skill's `detect()` logic) must be **decoupled from Roles** so the same heuristic implementation can be reused by more than one Role — Phase 15 is adding a large number of new heuristics, and duplicating detection code per Role was rejected as unsustainable. This directly extends the existing Skill abstraction (`skills.ts`, Phase 12 D-01/D-02: `{ id, role, detect(), buildPromptGuidance() }`) rather than inventing a new mechanism.
- **D-08:** The decoupling shape is: **shared `detect()` logic as reusable code, with separate per-Role `Skill` instances** wrapping it. Each Role still gets its own `Skill` object with its own `role` field and its own `buildPromptGuidance()`, but the underlying detection function can be written once and referenced by multiple Skill instances. This was explicitly chosen over "one Skill instance directly attachable to multiple Roles at once" — the latter would leave ambiguity about which Role a firing belongs to when more than one enabled Role has the same Skill registered; the chosen shape has no such ambiguity.
- **D-09 (scope boundary, not implemented this phase):** A much larger vision came up during discussion — Personality carrying a display **name** in addition to voice, multiple simultaneous named instances of the same Role with different Personalities in one session (e.g. two distinct "Analyst"-role agents), and a future creator-facing UI to dynamically compose a new agent from Role + Skill(s) + Personality + name. This is **explicitly out of scope for Phase 15** — captured as a deferred idea for its own future phase ("Dynamic Agent Composition"). Phase 15 only does the narrower D-07/D-08 refactor.

### Frontend/Backend Wiring

- **D-10:** The trigger point for the new evaluation is **server-side, on message insert** — not client-side in `handleAfterSend`. This works even if the client disconnects or closes the tab immediately after sending, and keeps all evaluation logic on the server rather than split across client and server.

### Budget/Arbitration Safety Net (scope expansion from the v3.0 milestone audit)

- **D-11:** Phase 15 **also wires the token-budget guard (`checkBotBudget`) and arbitration lock (`runArbitration`) into the reactive Skill-fire path** — today (per `.planning/v3.0-MILESTONE-AUDIT.md`, BOT-01/BOT-02) these are only ever checked on the proactive silence-trigger path; reactive Skill fires (moderation/fact-check/etc., today gated behind `@analista`/power-reaction) never check them at all. Since Phase 15's entire point is to make reactive Skills fire far more often (every message, not just tagged ones), leaving this gap unaddressed would make an already-identified cost/arbitration hole meaningfully worse. This is an intentional, explicit scope expansion beyond the original quick-task handoff — confirmed by the user during discussion.
- **D-12:** When a reactive Skill fires but the budget is exhausted or arbitration favors a different bot, the turn is **silently suppressed** — no bot reply is produced, but it is still traced in Langfuse as a suppressed fire (not invisible, just silent in chat). This matches the existing proactive-path convention exactly (`checkBotBudget`/`runArbitration` already silently return/skip today in `trigger-engine.ts`).

### Claude's Discretion

- Exact name/endpoint path/route shape for the new lightweight evaluation endpoint (D-03)
- Exact mechanism for how a fired Skill's normal argGraph-update behavior is preserved when it fires via this new path (D-05) — should mirror the existing analysis_request/silence_gate paths' behavior as closely as possible
- Exact TypeScript shape for decoupling shared `detect()` logic from per-Role `Skill` instances (D-07/D-08) — e.g. a standalone heuristic function referenced by multiple `Skill` object literals, following the existing `packages/types`/`apps/api/src/lib/skills/*.ts` file organization conventions
- Exact Langfuse trace/span shape for "evaluated, nothing fired" events (D-04) — should distinguish clearly from "evaluated, Skill X fired" and from the existing tagged/reacted path's traces
- Whether the budget/arbitration wiring (D-11/D-12) needs its own DB/state changes or can reuse `bot-arbitrator.ts`/`bot-budget.ts` exactly as they exist today

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/ROADMAP.md` §Phase 15 — goal, 4 draft success criteria, depends-on Phase 14
- `.planning/REQUIREMENTS.md` — no REQ-IDs exist yet for this phase; requirements TBD, to be assigned during planning

### Quick Task Handoff (the direct origin of this phase — MUST read in full)
- `.planning/quick/260719-e9x-investigate-why-non-tagged-agent-message/260719-e9x-ROOT-CAUSE.md` — full root-cause analysis: the three-path model (tagged reactive / untagged reactive / proactive silence-scan), confirmed-exhaustive list of graph-invocation entry points, why the tier-1 heuristic cost-safety infrastructure already exists, and §7.5's explicit "Shape of the change" / "Explicitly NOT decided yet" handoff list — this discussion resolved items 1–3 of that list (D-01 through D-10 above); item 4 (Langfuse trace-volume sizing against the user's plan tier) remains a research-phase concern, not resolved here.

### Cost/Safety Gap (this phase's scope expansion)
- `.planning/v3.0-MILESTONE-AUDIT.md` — BOT-01/BOT-02 findings: `checkBotBudget`/`runArbitration` only ever invoked from `trigger-engine.ts` (the proactive silence path); reactive Skill fires never call them. D-11/D-12 close this gap as part of Phase 15.

### Prior Phase Foundations (must reuse, not rebuild)
- `.planning/phases/12-graph-coherence-extended-triggers/12-CONTEXT.md` — D-01–D-07: the original Skill abstraction (`{ id, detect(), buildPromptGuidance() }`), `TriggerGateNode` consolidation, Role-activation gate pattern (`bot_overrides ?? bot_defaults ?? false`) — Phase 15's D-07/D-08 refactor extends this, does not replace it
- `.planning/phases/14-polish-triggerengine-wiring/14-CONTEXT.md` — D-12/D-13: "every LLM call gets tagged, not just proactive ones" precedent that D-04 extends to the new path; per-request (not module-level) `CallbackHandler` construction pattern

### Graph Topology (existing — extend, do not duplicate)
- `apps/api/src/graph/graph.ts` — full routing doc comment + `routeFromStart`/`routeAfterMutationGate`/`routeAfterArgGraphBuilder`/`routeAfterTriggerGate`; confirms `TriggerGateNode` is reached on every human-message invocation that reaches the graph at all, via `orchestrator → agent → mutationGate → argGraphBuilder → profileBuilder → triggerGate` — the new lightweight path (D-03) needs a comparable-but-cheaper route into `TriggerGateNode` per D-05
- `apps/api/src/graph/nodes/trigger-gate.ts` — `TriggerGateNode`: Role-activation gate, `Promise.allSettled` fail-isolation, `COACH_SKILLS`/`ANALYST_SKILLS` candidate assembly — the exact site whose candidate-array assembly changes shape per D-07/D-08
- `apps/api/src/graph/nodes/arg-graph-builder.ts` — confirmed LLM extraction call (`createAdapter`/`TASK_MODELS`/`adapter.stream()`) on every pass; the cost D-05 explicitly designs around
- `apps/api/src/lib/trigger-engine.ts` — the proactive silence-scan path; its four early-return gates (silence threshold, cooldown, arbitration, budget) are the existing precedent D-11/D-12 extends to the new reactive path

### Skills Registry (existing — refactor per D-07/D-08)
- `apps/api/src/lib/skills.ts` — `Skill`/`SkillContext` interfaces, `COACH_SKILLS`/`ANALYST_SKILLS` arrays; the `role: 'coach' | 'analyst'` field and the two hardcoded arrays are what D-07/D-08's refactor changes
- `apps/api/src/lib/skills/moderation.ts`, `apps/api/src/lib/skills/fact-check.ts` — existing tier-1 heuristics (`checkModerationHeuristic()`, `looksLikeCheckableClaim()`), confirmed pure/zero-I/O/zero-adapter-call — reused as-is, not rebuilt, by the new path

### Cost-Safety Primitives (existing — extend reach per D-11/D-12, do not rebuild)
- `apps/api/src/lib/bot-arbitrator.ts` — `runArbitration()`/`registerBot()`
- `apps/api/src/lib/bot-budget.ts` — `checkBotBudget()`

### Frontend (existing — reference only, not modified by D-10's server-side choice)
- `apps/web/app/(protected)/sessions/[id]/workspace.tsx:60,264-273` — `ANALISTA_PATTERN` regex + `handleAfterSend`, the existing tagged-path gate this phase's new path runs in parallel with, unmodified
- `apps/web/hooks/use-reactions.ts:279-293`, `apps/api/src/routes/reactions.ts:104` — the power-reaction reactive path, also unmodified

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `checkModerationHeuristic()`, `looksLikeCheckableClaim()` — zero-cost tier-1 heuristics, already built, already gate the paid tiers correctly; the new path routes through them, does not duplicate them
- `runArbitration()`/`checkBotBudget()` (Phase 10 primitives) — unchanged mechanisms; D-11 extends their *callers*, not their implementation
- `Promise.allSettled` fail-isolation pattern in `TriggerGateNode` — the new path's Skill evaluation should preserve this same fail-isolation guarantee

### Established Patterns
- Fail-open/fail-silent error handling, never throw from a graph node or Skill `detect()` — applies directly to D-02
- Per-request (not module-level) `CallbackHandler` construction — the new lightweight endpoint needs its own, per D-04
- Explicit boolean/map fields on Blueprint (`bot_defaults`, `drift_detection_enabled`) rather than dynamic per-Blueprint heuristic config — precedent that informed rejecting a Blueprint-level toggle in D-06
- `[nodename]` console logging prefix convention — applies to the new endpoint/job and any new Skill-sharing code

### Integration Points
- A new lightweight endpoint/background job (exact shape is Claude's discretion, D-03) is the main new integration point
- `apps/api/src/lib/skills.ts` — refactor site for D-07/D-08 (shared `detect()`, per-Role `Skill` instances)
- `apps/api/src/graph/nodes/trigger-gate.ts` — candidate-assembly logic changes shape to consume however Skills are organized post-refactor
- `apps/api/src/lib/bot-arbitrator.ts`/`bot-budget.ts` call sites — new callers added on the reactive Skill-fire path per D-11

</code_context>

<specifics>
## Specific Ideas

- User's framing for the ArgGraph cost problem: "We need to skip argGraph if the heuristics says so. If the heuristic says we have to do something then we will have to do whatever is needed." — directly produced D-05.
- User's reasoning for keeping heuristics code-defined rather than Blueprint-configurable: "I believe the heuristic is related to the blueprint (certain blueprints might require the agents to use LLM always) and also the role... let's stick with role heuristics only... Please separate the heuristics from the roles so a heuristic can be applied to multiple roles." — produced D-06/D-07/D-08.
- User's architecture vision (deferred, not this phase): "I was expecting analyst, coach, etc. are roles, and they should not have anything special. The blueprint defines those by default roles we need to add to the session. The personality in addition to the voice, also brings a name for the agent. That way the session can refer to the agents with a proper name, and we can even have 2 agents with the same role, but different personality. The skills are ways to share code between roles (and in the future we could create a screen to dynamically create agents combining one of the base roles + one of the existing skills (like web research) + give it a personality and a name 'Einstein')." — produced D-09 and the Dynamic Agent Composition deferred idea.

</specifics>

<deferred>
## Deferred Ideas

- **Dynamic Agent Composition** (future phase) — Personality carries a display name in addition to voice, so a session can run multiple simultaneous named instances of the same Role with different Personalities (e.g. two distinct Analysts). A future creator-facing UI lets someone compose a new agent from a base Role + one or more existing Skills (e.g. web research) + a Personality + a name (e.g. "Einstein"). Blueprint would define which default role instances a session adds, more flexibly than today's single `role_personalities`/`bot_defaults` 1:1-per-Role mapping. Raised while discussing this phase's Skill/Role architecture review; explicitly scoped out of Phase 15 (see D-09).
- **Langfuse trace-volume sizing against the user's Langfuse plan tier** — flagged in the original quick-task handoff (`260719-e9x-ROOT-CAUSE.md` §7.5, item 4) as needing research before implementation, since every message now produces a trace/span even at zero LLM cost. Not resolved in this discussion — carry into the research phase.

### Reviewed Todos (not folded)
- `.planning/todos/pending/define-bot-toolset-spec.md` ("Define Bot Toolset Specifications and Interface Schemas") — matched with a low score (0.2, keyword "2026" only) against Phase 15. Already reviewed and left out during Phase 14's discussion as belonging to a future phase; the match here is too weak (no thematic overlap with message-evaluation) to reconsider.

</deferred>

---

*Phase: 15-Message Evaluation Pipeline*
*Context gathered: 2026-07-20*
