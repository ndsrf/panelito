# Phase 15: Message Evaluation Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-20
**Phase:** 15-Message Evaluation Pipeline
**Areas discussed:** Inline vs async evaluation, Transport shape, Frontend wiring point, Budget/arbitration safety net, Blueprint/Role/Personality architecture review

---

## Inline vs async evaluation

| Option | Description | Selected |
|--------|-------------|----------|
| Async, fire-and-forget | Message send returns immediately; evaluation kicks off right after | ✓ |
| Inline, blocking | Send request doesn't complete until evaluation finishes | |
| You decide | Claude picks based on existing conventions | |

**User's choice:** Async, fire-and-forget
**Notes:** No added latency on typing, even for messages escalating to a tier-2 classifier call.

| Option | Description | Selected |
|--------|-------------|----------|
| Fail silent, log only | Matches existing fail-open/fail-silent convention | ✓ |
| Retry once | New retry-tracking mechanism, no precedent in codebase | |
| You decide | | |

**User's choice:** Fail silent, log only

---

## Transport shape

| Option | Description | Selected |
|--------|-------------|----------|
| New lightweight endpoint | Small non-streaming endpoint/background job | ✓ |
| Extend /invoke with a new flag | Reuse SSE /invoke with new triggerType | |
| You decide | | |

**User's choice:** New lightweight endpoint
**Notes:** "I think we need a new lightweight endpoint, but I would like to see an entry in Langfuse as this will still be part of the graph - it will be evaluated and then nothing else will happen if the light heuristics say so."

| Option | Description | Selected |
|--------|-------------|----------|
| Skip argGraph update on this path | Bypass ArgGraphBuilderNode entirely when heuristics say nothing to do | ✓ |
| Always run argGraphBuilder too | Every message costs one LLM call | |
| You decide | | |

**User's choice:** Skip argGraph update unless something fires
**Notes:** "We need to skip argGraph if the heuristics says so. If the heuristic says we have to do something then we will have to do whatever is needed."

| Option | Description | Selected |
|--------|-------------|----------|
| New Blueprint toggle | Per-Blueprint configurable heuristic behavior | |
| Fixed behavior, no new toggle | Same rule for every Blueprint | (partial) |
| You decide | | |

**User's choice:** Neither exactly — heuristics belong to the Role (code), not Blueprint config. Also requested: decouple heuristics from Roles so one heuristic implementation can be reused across multiple Roles, since Phase 15 adds many new heuristics.
**Notes:** This reframed the question — led directly into the architecture review area.

---

## Frontend wiring point

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side, on message insert | Fires from backend on message row write | ✓ |
| Client-side in handleAfterSend | Call new endpoint unconditionally from frontend | |
| You decide | | |

**User's choice:** Server-side, on message insert

---

## Budget/arbitration safety net

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, close it as part of Phase 15 | Wire checkBotBudget/runArbitration into reactive Skill-fire path | ✓ |
| No, keep it explicitly out of scope | Treat as separate future fix | |
| You decide | | |

**User's choice:** Yes, close it as part of Phase 15
**Notes:** Widening evaluation frequency makes the existing v3.0-MILESTONE-AUDIT.md BOT-01/BOT-02 gap meaningfully worse, not just unchanged.

| Option | Description | Selected |
|--------|-------------|----------|
| Silently suppress | No bot reply, still traced as suppressed | ✓ |
| Queue for next window | New mechanism, no precedent | |
| You decide | | |

**User's choice:** Silently suppress

---

## Blueprint/Role/Personality architecture review

**Initial framing presented:** current code has `Skill{role, detect(), buildPromptGuidance()}` with hardcoded `COACH_SKILLS`/`ANALYST_SKILLS` arrays.

| Option | Description | Selected |
|--------|-------------|----------|
| Matches, but the role coupling needs to go | Role/Personality/Skill split is right, but role field is too rigid | |
| This is different from what I expected | | ✓ |

**User's choice:** "This is different from what I expected"

**Follow-up — what diverged:**

| Option | Description | Selected |
|--------|-------------|----------|
| How Roles are defined | Expected more data-driven/configurable Roles | |
| How Skills attach to Roles | Expected many-to-many from the start | |
| How Personality relates to Role/Skill | Expected different Personality/Skill/Role interaction | (closest, elaborated below) |

**User's full answer:** "I was expecting analyst, coach, etc. are roles, and they should not have anything special. The blueprint defines those by default roles we need to add to the session. The personality in addition to the voice, also brings a name for the agent. That way the session can refer to the agents with a proper name, and we can even have 2 agents with the same role, but different personality. The skills are ways to share code between roles (and in the future we could create a screen to dynamically create agents combining one of the base roles + one of the existing skills (like web research) + give it a personality and a name 'Einstein')."

**Scope split decided:**

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 15: only decouple Skills from Roles | Minimum needed for this phase's own goal | ✓ |
| Phase 15: also add Personality naming + multi-instance-per-role | Bigger scope, build against flexible model now | |

**User's choice:** Phase 15 only decouples Skills from Roles. Multi-personality-per-role, agent naming, and the dynamic agent-builder UI deferred to a future "Dynamic Agent Composition" phase.

**Sharing shape clarified:**

| Option | Description | Selected |
|--------|-------------|----------|
| Shared detect(), separate Skill instances per Role | Reusable detect() code, each Role keeps its own Skill object | ✓ |
| One Skill instance assignable to multiple Roles | Single object, Role decided by session config | |

**User's choice:** Shared detect(), separate Skill instances per Role — no ambiguity about which Role a firing belongs to.

---

## Claude's Discretion

- Exact endpoint/route shape for the new lightweight evaluation path
- Exact mechanism for preserving a fired Skill's normal argGraph-update behavior when it fires via the new path
- Exact TypeScript shape for decoupling shared `detect()` logic from per-Role `Skill` instances
- Exact Langfuse trace/span shape distinguishing "evaluated, nothing fired" from "evaluated, Skill X fired"
- Whether budget/arbitration wiring on the reactive path needs new DB/state or can reuse existing primitives as-is

## Deferred Ideas

- **Dynamic Agent Composition** (future phase) — Personality carrying a display name, multiple named instances of the same Role per session, and a creator-facing UI to compose new agents from Role + Skills + Personality + name.
- **Langfuse trace-volume sizing** against the user's Langfuse plan tier — flagged in the originating quick task's handoff, not resolved in this discussion; carries into the research phase.
- Reviewed but not folded: `.planning/todos/pending/define-bot-toolset-spec.md` (weak 0.2 keyword match only, already reviewed and excluded in Phase 14).
