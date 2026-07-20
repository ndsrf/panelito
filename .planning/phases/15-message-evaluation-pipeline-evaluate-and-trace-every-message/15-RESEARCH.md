# Phase 15: Message Evaluation Pipeline - Research

**Researched:** 2026-07-20
**Domain:** LangGraph topology extension (cheap parallel evaluation path), Skill/Role refactor, Langfuse trace-volume/cost sizing
**Confidence:** HIGH (all findings sourced from direct reads of the live codebase; one MEDIUM item — Langfuse pricing sourced from official docs but the user's actual plan tier is unknown)

## Summary

Phase 15 closes the evaluation gap confirmed in quick task `260719-e9x`: untagged, unreacted messages never reach `TriggerGateNode`, so moderation/fact-check Skills never run on them. The fix is **not** a new evaluator — the zero-cost tier-1 heuristics (`checkModerationHeuristic`, `looksLikeCheckableClaim`) already exist and already gate every paid tier. The fix is a new, cheap **entry point into the existing graph** that reaches `TriggerGateNode` without paying for `OrchestratorNode`/`AgentNode`/`ArgGraphBuilderNode` first.

The single most important research finding, not previously identified in CONTEXT.md or the quick-task handoff: **the only currently-wired path that reaches `TriggerGateNode` is the full human `/invoke` path** — `orchestrator → agent → mutationGate → argGraphBuilder → profileBuilder → triggerGate` — which spends 2–3 LLM calls (guardrail classifier, domain agent, argGraph extraction) *before* the cheap tier-1 heuristics ever run. Naively reusing this path for "evaluate every message" would defeat the entire point of tier-1 gating and contradicts D-05 outright. The proactive `silence_gate` path bypasses `TriggerGateNode` entirely (routes straight to `facilitation`). Neither existing `triggerType` route is reusable as-is.

**Primary recommendation:** Add a new `triggerType` value (e.g. `'passive_eval'`) with a direct `START → triggerGate` conditional edge, and extend `routeAfterTriggerGate`/`routeAfterArgGraphBuilder` with two small new branches so that a **fired** Skill routes through `argGraphBuilder` (for context) before its Role node, while a **non-firing** evaluation (the common case) terminates at `END` immediately after `triggerGate` — zero LLM calls beyond whatever a Skill's own tier-2 classifier needs. This reuses every existing node and only adds ~10 lines across two router functions in `graph.ts` — no parallel/duplicate invocation mechanism is needed.

The lightweight endpoint itself should not be a new HTTP route at all: the codebase's own established idiom for "fire an async side-effect after a message insert, fail-silent, no queue" is a plain in-process async function call from `messages.ts`'s `POST /` handler (see `maybeAutoName`, already doing exactly this today). A new HTTP endpoint would add network overhead this phase explicitly wants to avoid and would require the client to make an extra call the client doesn't need to know about (D-10 puts the trigger server-side, on insert).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Message insert (trigger point) | API / Backend | — | `apps/api/src/routes/messages.ts` `POST /` — D-10 locks this server-side |
| Tier-1 heuristic evaluation | API / Backend | — | Pure, zero-I/O functions already in `apps/api/src/lib/skills/*.ts` |
| Tier-2 classifier escalation | API / Backend | — | `fact-check.ts`'s `classifyTier2` — LLM call gated behind tier-1 |
| Graph routing / new entry point | API / Backend (LangGraph) | — | `apps/api/src/graph/graph.ts` — new conditional START branch |
| Skill/Role registry refactor | API / Backend | — | `apps/api/src/lib/skills.ts` + `skills/*.ts` |
| Budget/arbitration guard | API / Backend | Database (RPC) | `bot-budget.ts`/`bot-arbitrator.ts` — RPC-backed atomic checks |
| Langfuse tracing | API / Backend | Observability platform (Langfuse Cloud) | Per-request `CallbackHandler`, same convention as `ai.ts`/`trigger-engine.ts` |
| Frontend | — | — | Explicitly untouched (D-10) — no client wiring for this phase |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

- **D-01:** New per-message evaluation runs async, fire-and-forget — message-send response unaffected.
- **D-02:** Evaluation call failures fail silently and log only — no retry mechanism.
- **D-03:** New, separate, lightweight endpoint/background job — not an extension of `/invoke` SSE.
- **D-04:** Must still produce a Langfuse trace entry every time it runs — "evaluated, nothing fired" is a visible outcome, not silence.
- **D-05:** `ArgGraphBuilderNode`'s LLM extraction call must be skipped whenever tier-1 heuristics say there's nothing to do; if a heuristic/Skill *does* fire, do whatever work is normally needed for that fired Skill's path (which may include an argGraph update).
- **D-06:** The skip-unless-fires behavior is not a new Blueprint-configurable toggle — heuristics belong to the Role (code-defined), not Blueprint-level dynamic configuration.
- **D-07:** Heuristics (`detect()` logic) must be decoupled from Roles so the same heuristic implementation can be reused by more than one Role.
- **D-08:** Decoupling shape: shared `detect()` logic as reusable code, with separate per-Role `Skill` instances wrapping it. Rejected: one Skill instance directly attachable to multiple Roles at once (ambiguous firing attribution).
- **D-09 (scope boundary, NOT implemented):** Personality-carries-a-name / multiple named instances of the same Role / creator-facing agent-builder UI — deferred to "Dynamic Agent Composition" future phase.
- **D-10:** Trigger point is server-side, on message insert — not client-side in `handleAfterSend`.
- **D-11:** Also wires `checkBotBudget`/`runArbitration` into the reactive Skill-fire path (currently only checked on the proactive silence-trigger path — BOT-01/BOT-02 gap from `v3.0-MILESTONE-AUDIT.md`).
- **D-12:** When a reactive Skill fires but budget is exhausted or arbitration favors a different bot, the turn is silently suppressed — no bot reply, but still traced in Langfuse as a suppressed fire.

### Claude's Discretion

- Exact name/endpoint path/route shape for the new lightweight evaluation endpoint (D-03)
- Exact mechanism for how a fired Skill's normal argGraph-update behavior is preserved when it fires via this new path (D-05)
- Exact TypeScript shape for decoupling shared `detect()` logic from per-Role `Skill` instances (D-07/D-08)
- Exact Langfuse trace/span shape for "evaluated, nothing fired" events (D-04)
- Whether the budget/arbitration wiring (D-11/D-12) needs its own DB/state changes or can reuse `bot-arbitrator.ts`/`bot-budget.ts` exactly as they exist today

### Deferred Ideas (OUT OF SCOPE)

- **Dynamic Agent Composition** (future phase) — Personality carries a display name; multiple simultaneous named instances of the same Role with different Personalities; creator-facing UI to compose Role + Skills + Personality + name.
- **Langfuse trace-volume sizing against the user's Langfuse plan tier** — explicitly deferred to this research phase (see `## Langfuse Trace-Volume Sizing` below).
- Queueing/retry mechanism for failed evaluation calls — fail-silent, log-only, matches existing convention.
- Blueprint-level dynamic heuristic configuration — heuristics live in code, attached to Roles.

</user_constraints>

<phase_requirements>
## Phase Requirements

No REQ-IDs exist yet for this phase (per `.planning/REQUIREMENTS.md` and `15-CONTEXT.md` — "TBD, to be assigned during planning"). The planner should derive REQ-IDs from this phase's four success criteria (ROADMAP.md §Phase 15):

| Draft Success Criterion | Research Support |
|----|-------------|
| 1. TriggerGateNode's Skills evaluated on every human message, not only @-tag/power-reaction | New `passive_eval` `triggerType` + direct `START → triggerGate` edge (see `## Architecture Patterns` Pattern 1) |
| 2. Tier-1 heuristic pre-filter runs at zero LLM cost; only passing messages escalate | Tier-1 heuristics already exist and are pure (`moderation.ts`, `fact-check.ts`) — reused as-is; new routing ensures zero LLM nodes run before them |
| 3. Existing @-tag/power-reaction paths continue to work unchanged | New path is fully additive — no existing `graph.ts` edges are removed, only 2 router functions gain new branches |
| 4. Developer can tell, per message, whether tier-1 fired and whether it escalated | Langfuse tags on `CallbackHandler` (mirrors `trigger:silence_gate` / `trigger:human-reactive` convention) — see `## Langfuse Trace-Volume Sizing` |

</phase_requirements>

## Standard Stack

No new external packages are required for this phase — it is entirely a graph-topology and Skill-registry extension using libraries already installed (`@langchain/langgraph`, `@langfuse/langchain`, `@supabase/supabase-js`, `zod`). See `## Package Legitimacy Audit` below (empty — nothing to install).

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@langchain/langgraph` | already installed | `StateGraph` conditional edges for the new entry point | Existing project convention (`graph.ts`) |
| `@langfuse/langchain` | already installed | Per-request `CallbackHandler` for the new evaluation trace | Existing project convention (`ai.ts`, `trigger-engine.ts`) |

**Installation:** None — no new packages.

## Package Legitimacy Audit

Not applicable — this phase installs zero new external packages. All work reuses existing libraries and internal modules.

## Architecture Patterns

### System Architecture Diagram

```
Client sends message
        │
        ▼
POST /api/sessions/:id/messages  (messages.ts, unchanged: insert row, broadcast, maybeAutoName)
        │
        ├──► HTTP response returned to client (unaffected — D-01)
        │
        └──► (fire-and-forget, NOT awaited) evaluateMessageAsync(row, session, supabase)
                   │
                   ▼
             Resolve Blueprint + creator provider/key + Coach/Analyst enablement
                   │  (fail-silent: any missing dependency → log + return, D-02)
                   ▼
             Fetch recent messages window (mirrors trigger-engine.ts's fetchRecentMessages)
                   │
                   ▼
             graph.invoke({ triggerType: 'passive_eval', messages, ... },
                           { configurable: { thread_id: `${branchId}:human`, blueprint,
                                              supabase, branchId, participantId: row.author_id,
                                              lastMessageId: row.id, ... },
                             callbacks: [new CallbackHandler({ tags: [..., 'trigger:passive-eval'] })] })
                   │
                   ▼
        START ──(routeFromStart: triggerType==='passive_eval')──► triggerGate
                   │
                   │  Promise.allSettled over COACH_SKILLS/ANALYST_SKILLS candidates
                   │  (role-gated by bot_defaults/bot_overrides) — tier-1 heuristics run here,
                   │  zero LLM cost for the "nothing matches" case; tier-2 classifier calls
                   │  (e.g. fact-check) only run when tier-1 matched
                   ▼
         ┌─────────┴─────────┐
   nothing fires        a Skill fires (firingSkillId/Role set)
         │                     │
         ▼                     ▼
       END                routeAfterTriggerGate (NEW branch for triggerType==='passive_eval')
   (Langfuse trace              │
    still emitted —             ▼
    "evaluated, nothing    argGraphBuilder (LLM extraction — ONLY paid here, D-05)
    fired", D-04)               │
                                 ▼
                     routeAfterArgGraphBuilder (NEW branch: firingSkillRole set + triggerType
                                 │              ==='passive_eval' → 'facilitation'/'analysis')
                    ┌────────────┴────────────┐
                    ▼                         ▼
              facilitation                analysis
           (Coach reply,               (Analyst reply,
            checkBotBudget/             checkBotBudget/
            runArbitration              runArbitration
            gate here — D-11/12)        gate here — D-11/12)
                    │                         │
                    ▼                         ▼
                   END                   mutationGate → routeAfterMutationGate
                                          (triggerGateComplete===true → END,
                                           same termination as analysis_request path)
                    │                         │
                    └────────────┬────────────┘
                                 ▼
                 If accumulatedText non-empty: insert `messages` row
                 (author_id = COACH_AUTHOR_ID or new ANALYST_AUTHOR_ID sentinel),
                 broadcast via httpSend — mirrors trigger-engine.ts's insert step
```

### Recommended Project Structure

No new top-level folders. New/changed files:

```
apps/api/src/
├── lib/
│   ├── message-evaluation.ts        # NEW — the fire-and-forget evaluation entry point
│   │                                 #        (equivalent role to trigger-engine.ts's scanBranch,
│   │                                 #        but per-message instead of per-tick)
│   ├── skills.ts                    # CHANGED — COACH_SKILLS/ANALYST_SKILLS assembled from
│   │                                 #           factory functions (D-07/D-08)
│   └── skills/
│       ├── moderation.ts            # CHANGED — export makeModerationSkill(role) factory
│       └── fact-check.ts            # CHANGED — export makeFactCheckSkill(role) factory
│                                     #           (only if a heuristic needs multi-role reuse
│                                     #            this phase; otherwise minimal-diff, see Pattern 3)
├── graph/
│   └── graph.ts                     # CHANGED — new triggerType branch in routeFromStart,
│                                     #           routeAfterTriggerGate, routeAfterArgGraphBuilder
├── routes/
│   └── messages.ts                  # CHANGED — fire-and-forget call to
│                                     #           evaluateMessageAsync() after insert (mirrors
│                                     #           the existing maybeAutoName() call exactly)
└── lib/
    └── bot-arbitrator.ts            # CHANGED (small) — runArbitration() gains an optional
                                      #                    firingSkillRole param, finally wiring
                                      #                    the extension point bot-registration.ts's
                                      #                    analystScorer already anticipates
```

### Pattern 1: New direct `START → triggerGate` graph entry point

**What:** Add a `triggerType` value (this research uses `'passive_eval'` as a placeholder name — Claude's Discretion per D-03) that routes straight from `START` to `triggerGate`, bypassing `orchestrator`/`agent`/`argGraphBuilder`/`mutationGate` entirely for the common "evaluate, nothing fires" case.

**When to use:** This is the ONLY way to satisfy D-05's cost-skip requirement. Every other existing `triggerType` route (`null` → full human path, `'analysis_request'` → argGraphBuilder-first, `'silence_gate'` → facilitation directly) either pays for 2–3 LLM calls before reaching `triggerGate`, or bypasses `triggerGate` altogether. None is reusable as-is.

**Example (concrete diffs against the real file, `apps/api/src/graph/graph.ts`):**

```typescript
// Source: apps/api/src/graph/graph.ts (existing routeFromStart, extend the return type)
export function routeFromStart(
  state: GraphState
): 'facilitation' | 'analysis' | 'orchestrator' | 'triggerGate' {   // NEW union member
  const { triggerType } = state
  if (triggerType === 'silence_gate') return 'facilitation'
  if (triggerType === 'analysis_request') return 'analysis'
  if (triggerType === 'passive_eval') {                             // NEW branch
    console.info('[graph] START → triggerGate (passive_eval trigger, zero-LLM entry)')
    return 'triggerGate'
  }
  if (triggerType === null || triggerType === undefined) return 'orchestrator'
  console.error('[graph] unrecognized triggerType:', triggerType)
  throw new Error(`[graph] routeFromStart: unrecognized triggerType "${triggerType}"`)
}

// createGraph()'s addConditionalEdges(START, routeFromStart, { ... }) pathsMap gains:
//   triggerGate: 'triggerGate'
```

```typescript
// Source: apps/api/src/graph/graph.ts (existing routeAfterTriggerGate, extend)
export function routeAfterTriggerGate(
  state: GraphState
): 'facilitation' | 'analysis' | 'argGraphBuilder' | 'end' {         // NEW union member
  if (state.firingSkillRole === null) return 'end'
  // NEW: passive_eval's fired case needs fresh argGraph context (D-05) — every OTHER
  // path that reaches facilitation/analysis already ran argGraphBuilder BEFORE
  // triggerGate; this is the only path where triggerGate runs first.
  if (state.triggerType === 'passive_eval') return 'argGraphBuilder'
  if (state.firingSkillRole === 'coach') return 'facilitation'
  if (state.firingSkillRole === 'analyst') {
    return state.triggerType === 'analysis_request' ? 'end' : 'analysis'
  }
  return 'end'
}

// createGraph()'s addConditionalEdges('triggerGate', routeAfterTriggerGate, { ... })
// pathsMap gains: argGraphBuilder: 'argGraphBuilder'
```

```typescript
// Source: apps/api/src/graph/graph.ts (existing routeAfterArgGraphBuilder, extend)
export function routeAfterArgGraphBuilder(
  state: GraphState
): 'analysis' | 'profileBuilder' | 'facilitation' {                  // NEW union member
  // NEW: passive_eval's fired case — triggerGate already set firingSkillRole before
  // this argGraphBuilder pass ran (routed here via the new branch above). Route
  // straight to the firing Role's node — never to profileBuilder (that's the
  // human-path-only concern) and never re-enter 'analysis_request' handling.
  if (state.triggerType === 'passive_eval' && state.firingSkillRole !== null) {
    return state.firingSkillRole === 'coach' ? 'facilitation' : 'analysis'
  }
  return state.triggerType === 'analysis_request' ? 'analysis' : 'profileBuilder'
}
```

**Termination proof for the new path:** `triggerGateComplete` is set to `true` by `triggerGateNode` on every return path (including the fail-open missing-blueprint path), exactly as today. When the fired-Skill sub-path re-enters `mutationGate` (via `analysis → mutationGate`, the existing fixed edge), `routeAfterMutationGate`'s FIRST check (`if (state.triggerGateComplete === true) return 'end'`) fires immediately — no re-entry into `triggerGate`, no loop. This is identical to the existing `analysis_request` path's own termination behavior — no new loop-guard logic needed.

**Cost accounting for this pattern (directly answers D-05):**
- Nothing fires (expected common case): 0 LLM calls beyond whatever a Skill's own tier-2 classifier needs (e.g. fact-check's tier-2, only when tier-1 matched) — `orchestrator`, `agent`, `argGraphBuilder` never execute.
- A Skill fires (rare case): exactly 1 `argGraphBuilder` extraction call + 1 Role-node LLM call (Coach or Analyst) — matches D-05's explicit allowance ("do whatever work is normally needed for that fired Skill's path").

### Pattern 2: Fire-and-forget in-process evaluation call (not a new HTTP endpoint)

**What:** `messages.ts`'s `POST /` handler, after the existing insert + broadcast + `maybeAutoName` fire-and-forget call, adds one more uncoupled call:

```typescript
// Source: apps/api/src/routes/messages.ts (existing maybeAutoName call, line 144-148 — the
// exact precedent this pattern mirrors)
if (sessionId) {
  maybeAutoName(supabase, sessionId).catch((err) =>
    console.error('[messages] maybeAutoName error:', err)
  )
}

// NEW — same shape, same fire-and-forget convention (D-01/D-02), NOT awaited:
evaluateMessageAsync(supabase, session, row).catch((err) =>
  console.error('[messages] evaluateMessageAsync error:', err)
)

return c.json(row, 201)
```

**When to use:** D-03 asks for "a new, separate, lightweight endpoint/background job." This codebase has no job queue (confirmed: no BullMQ/pg-boss/similar dependency in `apps/api/package.json`) and no precedent for a second internal HTTP round-trip to itself. The established idiom for "do async side-effect work after an insert, without blocking the response, fail-silent" is exactly the `maybeAutoName` pattern already in this same file. An in-process function call:
- Satisfies D-01 (fire-and-forget, unawaited) and D-02 (`.catch()` logs only) with zero new infrastructure.
- Avoids an unnecessary extra HTTP hop (auth re-check, JSON parse, cold start) that a separate route would require.
- Is directly reachable from the one true trigger point (D-10: server-side, on message insert) without any new wiring.

**Known risk (flag for planner, not a blocker):** On Vercel's Node.js runtime (confirmed via `vercel.json`/`apps/web/app/api/[[...route]]/route.ts`: `runtime = "nodejs"`, `maxDuration: 60`), a fire-and-forget promise NOT passed to `waitUntil()` risks being frozen if the underlying Lambda container is reused/frozen before the promise settles — though in practice AWS Lambda-based Node runtimes keep the function alive until the event loop drains (or `maxDuration` elapses), which is why `maybeAutoName` already works today without `waitUntil`. This codebase has **no existing `waitUntil()` usage anywhere** (`grep` confirmed zero hits) despite `OBS-02`'s original text mentioning it — the actual implemented pattern in `ai.ts` is `await flushLangfuse()` synchronously before the SSE response's `'done'` event, not `waitUntil`. Recommend the planner keep this phase consistent with the established (unawaited, no `waitUntil`) convention rather than introducing a new pattern, and note this as a pre-existing, accepted risk profile — not a new one this phase introduces. [ASSUMED: risk characterization — not independently load-tested in this session; see Assumptions Log A1]

### Pattern 3: Decoupling `detect()` heuristic logic from Role via factory functions (D-07/D-08)

**What:** The low-level pure heuristics (`checkModerationHeuristic`, `looksLikeCheckableClaim`) are **already** standalone exported functions, separate from the `Skill` object literal — this part of the decoupling already exists. What's NOT decoupled is the full async `detect()`/`buildPromptGuidance()` orchestration (DB round-trips, tier-2 escalation, prompt text) — each is currently hardcoded into exactly one `Skill` object with a fixed `role` field.

**Concrete shape (factory function wrapping shared logic, D-08's explicit choice):**

```typescript
// Source: apps/api/src/lib/skills/moderation.ts — refactor sketch
// The detect/buildPromptGuidance BODIES are unchanged from today; only the export shape changes.

async function detectModeration(context: SkillContext): Promise<SkillDetectionResult> {
  /* ...exact existing body, unchanged... */
}

function buildModerationPromptGuidance(context: SkillContext): string {
  /* ...exact existing body, unchanged... */
}

/** Factory — wraps the shared detect()/buildPromptGuidance() pair for a specific Role.
 *  D-08: separate per-Role Skill INSTANCES, no ambiguity about which Role a firing belongs to. */
export function makeModerationSkill(role: 'coach' | 'analyst'): Skill {
  return {
    id: 'moderation',
    role,
    detect: detectModeration,
    buildPromptGuidance: buildModerationPromptGuidance,
  }
}

// Preserves the existing default export/import sites — no call-site churn required
// anywhere that doesn't need multi-role reuse this phase.
export const moderationSkill: Skill = makeModerationSkill('coach')
```

```typescript
// Source: apps/api/src/lib/skills.ts — refactor sketch
import { makeModerationSkill } from './skills/moderation'
// ... other imports unchanged

export const COACH_SKILLS: Skill[] = [
  silenceBreakSkill,
  makeModerationSkill('coach'),   // was: moderationSkill
  driftRedirectSkill,
]
export const ANALYST_SKILLS: Skill[] = [
  factCheckSkill,
  phaseReadinessSkill,
  orphanEdgeSkill,
  // A future/this-phase addition can now cheaply add, e.g.:
  // makeModerationSkill('analyst'),   // same detect()/buildPromptGuidance, zero duplication
]
```

**When to use:** Apply this factory pattern to every Skill this phase adds or touches. `Skill.id` stays the SAME string across role-bound instances of the same heuristic (mirrors `factCheckSkill`'s existing single-`id` convention) — `TriggerGateNode`'s priority-order-wins logic and `firingSkillId` reporting are unaffected since only one Role's array is ever active for a given firing (role-gate runs before candidate assembly, per `trigger-gate.ts`'s existing D-07 doc comment from Phase 12).

**Rejected alternative (explicitly, per D-08):** A single `Skill` instance directly registered into both `COACH_SKILLS` and `ANALYST_SKILLS` arrays — rejected because `result.role` (used by `routeAfterTriggerGate` for Role-node routing and by Langfuse tag attribution) would be ambiguous when the same instance is shared, if both Roles happen to be enabled simultaneously.

### Anti-Patterns to Avoid

- **Routing the new "evaluate every message" path through the existing human `triggerType: null` path:** This re-runs `orchestrator` (guardrail classifier LLM call) and `agent` (domain agent LLM call) on every single message — directly contradicts D-05 and the entire cost premise of this phase. Confirmed via `graph.ts`'s own routing doc comment: this is the ONLY currently-wired route into `triggerGate`.
- **Building a second, parallel, non-graph invocation of the Skills registry** (e.g. calling `COACH_SKILLS`/`ANALYST_SKILLS` `.detect()` directly from `messages.ts`, bypassing `TriggerGateNode`): This would duplicate `triggerGateNode`'s role-gating, `Promise.allSettled` fail-isolation, and `phaseGateProgress` surfacing logic — a second implementation of the exact same consolidation `TriggerGateNode` already exists to provide (per `trigger-gate.ts`'s own top-of-file doc comment: "Consolidates ALL Skills' detect() calls... into ONE LangGraph node"). Reuse the node via a new graph entry point (Pattern 1) instead.
- **A new HTTP endpoint that the client must call:** Contradicts D-10 (server-side, on message insert) and adds an unnecessary round trip D-01 explicitly wants to avoid.
- **Emitting multiple Langfuse observations per "nothing fired" evaluation:** Directly inflates unit consumption (see `## Langfuse Trace-Volume Sizing`) for the overwhelmingly common outcome. Keep the "nothing fired" trace to the minimum shape LangGraph's `CallbackHandler` produces for a short `triggerGate`-only run (see that section for the concrete unit-count estimate).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rude/insulting message detection | A new keyword/regex scanner | `checkModerationHeuristic()` (`apps/api/src/lib/skills/moderation.ts`) | Already pure, zero-I/O, curated Spanish keyword list, tuned to avoid false positives (12-AI-SPEC.md Pitfall 6) |
| Checkable-claim detection | A new claim-shape regex | `looksLikeCheckableClaim()` (`apps/api/src/lib/skills/fact-check.ts`) | Already pure, zero-I/O, covers numbers/units, dates, absolute qualifiers, capitalized entities |
| Consolidating multiple Skills' detect() calls | A second Skills-iteration loop outside the graph | `TriggerGateNode` (`apps/api/src/graph/nodes/trigger-gate.ts`) | Already has `Promise.allSettled` fail-isolation, role-gating, priority-order-wins, `phaseGateProgress` surfacing |
| Recent-message-window fetching for Skill context | A new Supabase query in the new evaluation module | Extract `trigger-engine.ts`'s local `fetchRecentMessages()` into a shared helper (it is currently un-exported/local to that file) | Same query shape (`role != 'system'`, ordered, limited, reversed) is needed by both callers — avoid a second copy drifting out of sync |
| Token budget circuit breaker | A new spend-tracking mechanism | `checkBotBudget()` (`apps/api/src/lib/bot-budget.ts`) | RPC-backed, atomic, fail-closed (T-10-07) — already exists, just needs a new call site (D-11) |
| Bot arbitration / mutual exclusion | A new lock mechanism | `runArbitration()`/`releaseBotLock()` (`apps/api/src/lib/bot-arbitrator.ts`) | Atomic DB compare-and-set lock already exists; `analystScorer` (`bot-registration.ts`) already anticipates a `firingSkillRole`-aware caller — Phase 15 is that caller |
| Coach/Analyst display name + author attribution for an inserted bot message | A fresh ad-hoc insert shape | Mirror `trigger-engine.ts`'s `COACH_AUTHOR_ID`/`COACH_DISPLAY_NAME` insert pattern | Consistent sentinel-author convention across all proactive/reactive-via-graph bot message inserts (see Open Question 2 for the missing Analyst-side sentinel) |

**Key insight:** Every piece of cost-safety and detection infrastructure this phase needs already exists in the codebase from Phases 10–14. The entire scope of Phase 15 is (1) a new graph entry point that reaches this existing infrastructure cheaply, (2) a Skill/Role registry refactor to reduce future duplication, and (3) two new call sites for budget/arbitration primitives that already exist. No new detection, cost-guard, or locking logic should be written from scratch.

## Common Pitfalls

### Pitfall 1: Reusing the human-path route defeats D-05's entire purpose

**What goes wrong:** A planner might route the new "evaluate every message" trigger through `triggerType: null` (the existing human path) since it already reaches `triggerGate`. This silently reintroduces 2-3 LLM calls (orchestrator classifier, domain agent, argGraph extraction) on every message — the exact cost explosion this phase exists to prevent.
**Why it happens:** `triggerType: null` is the ONLY path that already reaches `triggerGate` without new graph.ts changes, so it's the path of least resistance.
**How to avoid:** Use the new `passive_eval`-style direct `START → triggerGate` edge (Pattern 1). This is a hard requirement, not a nice-to-have — CONTEXT.md's D-05 explicitly names this exact hazard ("reusing the existing argGraphBuilder→profileBuilder→triggerGate chain for this new path would make every message cost an LLM call, defeating the point of the tier-1 heuristics").
**Warning signs:** Any `TASK_MODELS[...].classification`/`.analysis` adapter call showing up in Langfuse for a message that tier-1 heuristics did NOT flag.

### Pitfall 2: Fired-Skill path loses argGraph context if `argGraphBuilder` is skipped entirely

**What goes wrong:** If the new path routes `triggerGate`'s fired case straight to `facilitation`/`analysis` without running `argGraphBuilder` first, the Role node's `summarizeArgGraph(state.argGraph)` call renders an empty graph — the Analyst can't cite prior claims, mirroring the exact `GRAPH-01` gap the v3.0 milestone audit already found on the proactive silence-trigger thread ("the TriggerEngine's silence-triggered Coach invocation never sees the argGraph built on the human thread").
**Why it happens:** Skipping `argGraphBuilder` unconditionally (to satisfy D-05 for the common case) is the natural first instinct, but D-05 only asks to skip it when NOTHING fires — the fired case explicitly should "do whatever work is normally needed for that fired Skill's path."
**How to avoid:** Route the fired case through `argGraphBuilder` before the Role node (Pattern 1's `routeAfterTriggerGate`/`routeAfterArgGraphBuilder` extension) — this is the one extra LLM call D-05 explicitly permits for the rare "something fired" case.
**Warning signs:** Fact-check/orphan-edge replies from this new path that never reference specific prior speakers/claims by name, unlike the same Skills firing via the tagged `/invoke` path.

### Pitfall 3: No existing Analyst-side author sentinel for a bot-inserted message

**What goes wrong:** `trigger-engine.ts` has `COACH_AUTHOR_ID`/`COACH_DISPLAY_NAME` constants for its own message insert, but there is no equivalent `ANALYST_AUTHOR_ID` constant anywhere in the codebase. The existing reactive-tagged path (`ai.ts`) sidesteps this by always using `session.creator_id`/`matchedPersonas[0]?.displayName` regardless of which Role actually produced the reply (that insert code never branches on `firingSkillRole` at all) — this convention doesn't distinguish Coach-triggered vs. Analyst-triggered replies today, which is a pre-existing quirk, not something Phase 15 introduces, but the new path needs its OWN, correct insert logic since it has no SSE/`ai.ts` code path to inherit from.
**Why it happens:** The two existing message-insert call sites (`ai.ts`, `trigger-engine.ts`) each solved this narrowly for their own single-Role or Role-agnostic case; neither is a template for "insert a message correctly attributed to whichever Role's Skill just fired."
**How to avoid:** Mint a new sentinel (e.g. `ANALYST_AUTHOR_ID`, mirroring `COACH_AUTHOR_ID`'s exact pattern — a fixed UUID, no FK constraint on `messages.author_id`) and resolve `display_name` from `blueprint.role_personalities.analyst` via the same `resolveAnalystPersonality()`/`resolveCoachPersonality()` helpers already in `ai.ts`/`trigger-engine.ts`, branching on `firingSkillRole` from the graph's `finalState`.
**Warning signs:** Both Coach- and Analyst-fired replies from the new path showing up with the same display name, or with `author_id === session.creator_id` (misattributing a bot reply to the human creator, breaking any future "who said this" UI logic).

### Pitfall 4: `runArbitration()`'s `firingSkillRole` extension point is documented but not yet wired

**What goes wrong:** `bot-registration.ts`'s `analystScorer` already branches on `context.firingSkillRole === 'analyst'` to give the Analyst a chance to outscore the Coach in arbitration — but `runArbitration(branchId, blueprint, supabase)`'s actual implementation constructs `const context: ArbContext = { branchId, blueprint, supabase }` internally, with no parameter for the caller to supply `firingSkillRole`. Calling `runArbitration()` exactly as it exists today from the new reactive path (as CONTEXT.md's discretion note allows) means `firingSkillRole` is always `undefined`, and `analystScorer` always scores 0 — the Analyst can never win arbitration via this new path even when its own Skill fired.
**Why it happens:** The extension point was deliberately added in Phase 12 as "additive... a future Phase 14 TriggerEngine caller can thread a real value in" — but no caller has done so yet; Phase 14 didn't either (confirmed: `trigger-engine.ts`'s own call site never sets it, by design, since it's Coach-only).
**How to avoid:** This is the one place D-11 requires a genuinely small (not zero) code change: extend `runArbitration`'s signature to accept an optional 4th param (e.g. `firingSkillRole?: 'coach' | 'analyst' | null`) and thread it into the internally-constructed `ArbContext`. This is a mechanical, additive, backward-compatible signature change — no DB/schema change, and every EXISTING call site (`trigger-engine.ts`) is unaffected since the new param is optional.
**Warning signs:** Analyst-role Skills firing via the new path but never actually producing a reply because arbitration always awards the lock to Coach (score 7 vs. Analyst's un-signaled 0).

### Pitfall 5: `checkModerationHeuristic`'s escalation counter needs the correct `participantId`

**What goes wrong:** `moderation.ts`'s `detect()` reads `participantId` from `config.configurable.participantId` to increment/read the per-participant moderation escalation count. `ai.ts` resolves this via an elaborate "find the last human message's author" query (`lastHumanAuthorId`, WR-04) because the /invoke route doesn't directly know who sent the message being evaluated. The new evaluation path does NOT have this problem — it's called directly from `messages.ts`'s insert handler, which already has `row.author_id` from the just-inserted row.
**Why it happens:** Copying `ai.ts`'s elaborate resolution logic wholesale (instead of recognizing the new path already has the answer for free) would be over-engineering.
**How to avoid:** Pass `row.author_id` directly as `config.configurable.participantId` — no extra query needed. Same applies to `fact-check.ts`'s `claimMessageId` (`config.configurable.lastMessageId`) — use `row.id` directly.
**Warning signs:** An unnecessary extra Supabase round-trip in the new evaluation path duplicating work `messages.ts` already did.

### Pitfall 6: Session/branch state must be re-verified, not assumed, inside the fire-and-forget call

**What goes wrong:** Because the evaluation runs after the HTTP response for the insert has already been prepared, and asynchronously relative to it, a session could freeze (status change) or the branch could be archived between the insert and the evaluation actually running. `trigger-engine.ts` has an explicit defense-in-depth re-check (`if (session.status !== 'active') return` — "Critical Failure Mode 6") even though its own query already filtered on `status='active'`.
**Why it happens:** Fire-and-forget code has no natural moment to re-verify preconditions unless the author deliberately adds one.
**How to avoid:** Re-check `session.status === 'active'` inside the new evaluation function itself, mirroring `trigger-engine.ts`'s own defensive pattern, even though `messages.ts`'s synchronous insert path already checked status before the insert.
**Warning signs:** A bot reply appearing on a session the creator explicitly froze moments after sending the last message.

## Langfuse Trace-Volume Sizing

**This is the research item CONTEXT.md's `<deferred>` section explicitly carries forward — resolved here as far as codebase + public documentation can resolve it. The user's actual Langfuse plan tier is NOT discoverable from this codebase or session and is flagged as an open question requiring the user's own account dashboard.**

### What Langfuse bills on

Per Langfuse's official pricing page [CITED: langfuse.com/pricing]: **a billable "unit" is any trace, observation (span/event/generation), or score ingested** — a single request producing 3 LLM calls and 2 eval scores costs 6 units. Plan tiers and included monthly units [CITED: langfuse.com/pricing]:

| Plan | Price/mo | Included units | Overage |
|------|----------|-----------------|---------|
| Hobby (free) | $0 | 50,000/mo | Not available — ingestion stops at the cap |
| Core | $29 | 100,000/mo | $8/100k |
| Pro | $199 | 100,000/mo | $8/100k |
| Enterprise | $2,499 | 100,000/mo | $8/100k (graduated lower at higher volume) |

### What this phase adds per message

Per `CallbackHandler`'s existing behavior in this codebase (confirmed via `ai.ts`/`trigger-engine.ts`'s own doc comments: "a per-request CallbackHandler... passed to graph.invoke()'s callbacks array"), one `graph.invoke()` call produces at minimum: 1 trace + 1 span per graph node actually executed. For the new path's common case (`triggerGate` runs, nothing fires, `END`):

- 1 trace (the invocation itself)
- 1 observation/span for the `triggerGate` node execution

**Estimated: ~2 units per evaluated message that doesn't fire anything** (this is an estimate derived from LangGraph's per-node span emission pattern already observed in this codebase's existing traces — not independently measured in this research session; see Assumptions Log A2). A firing message additionally adds spans for `argGraphBuilder` + the Role node's LLM generation (each generation is itself both an observation AND typically a nested generation-type observation with token/cost metadata) — likely 4-6 units for the rare fired case.

### Sizing against volume

At **~2 units/message** for the dominant "nothing fired" case:
- Hobby tier (50,000 units/mo, shared with ALL other Langfuse activity in the project — human `/invoke` traces, silence-gate traces, etc.): roughly **25,000 evaluated messages/month** of headroom for this feature alone, before the hard cap stops ALL ingestion project-wide (not just this feature's).
- A single active session generating, say, 200 human chat messages in a sitting would consume ~400 units from this feature alone — trivial relative to the cap, but multiplied across many concurrent sessions/users this adds up faster than the existing `@analista`/power-reaction-gated volume did (which only traced a minority of messages).

**Recommendation:** Because "nothing fired" is the overwhelming majority outcome and D-04 requires it to always be visibly traced, keep the trace shape to the absolute minimum (1 trace + 1 span, as above) — do NOT add extra child spans/events for "heuristic X evaluated, no match" per-Skill detail inside the "nothing fired" case; a single node-level span carrying which Skills were checked (e.g. via span metadata/tags, not separate child observations) keeps unit cost flat regardless of how many Skills exist in `COACH_SKILLS`/`ANALYST_SKILLS`. If real production volume later approaches the plan's cap, the natural lever (not built this phase, but worth flagging to the user) is a sampling toggle on the "nothing fired" trace specifically (e.g. trace 1-in-N non-firing evaluations, but always trace every firing/suppressed-fire event) — this was NOT requested in CONTEXT.md and should not be built preemptively, only noted as the mitigation path if volume becomes a real problem.

**Confidence: MEDIUM** — the pricing/unit-definition facts are HIGH confidence (official docs), but the actual per-invocation unit count is an estimate based on this codebase's existing `CallbackHandler` usage pattern, not independently verified against a live Langfuse dashboard in this research session, and the user's actual plan tier is entirely unknown here.

## Code Examples

### Fetching recent messages (existing pattern to extract/reuse)

```typescript
// Source: apps/api/src/lib/trigger-engine.ts (existing, currently un-exported local function —
// recommend exporting or extracting to a shared helper for the new evaluation path to reuse)
async function fetchRecentMessages(supabase: SupabaseClient, branchId: string): Promise<ProviderMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content')
    .eq('branch_id', branchId)
    .neq('role', 'system')
    .order('created_at', { ascending: false })
    .limit(CONTEXT_WINDOWS.facilitation)

  if (error) {
    console.error('[trigger-engine] fetchRecentMessages error for branch', branchId, error.message)
    return []
  }

  return ((data ?? []) as Array<{ role: string | null; content: string }>)
    .reverse()
    .map((m) => ({
      role: (m.role === 'assistant' || m.role === 'system' ? m.role : 'user') as ProviderMessage['role'],
      content: m.content,
    }))
}
```

### Per-request CallbackHandler construction (existing convention to mirror exactly)

```typescript
// Source: apps/api/src/lib/trigger-engine.ts (scanBranch) — mirror this shape for the new
// evaluation path, changing only the tags array's trigger label
const callbackHandler = new CallbackHandler({
  userId: langfuseUserId,             // resolveCreatorLangfuseUserId(supabase, session.creator_id)
  sessionId: session.id,
  tags: [`session:${session.id}`, `branch:${branch.id}`, 'trigger:passive-eval'],  // NEW label
})
```

### Message insert + broadcast (existing pattern to mirror for a fired-Skill reply)

```typescript
// Source: apps/api/src/lib/trigger-engine.ts (scanBranch) — same shape needed for the new
// path's fired-Skill message insert, with author_id/display_name resolved per firingSkillRole
const { data: row, error: insertError } = await supabase
  .from('messages')
  .insert({
    session_id: session.id,
    author_id: COACH_AUTHOR_ID,           // or a new ANALYST_AUTHOR_ID, per firingSkillRole
    display_name: COACH_DISPLAY_NAME,     // or resolved analyst personality display name
    parent_id: null,
    path_id: branch.path_id,
    branch_id: branch.id,
    role: 'assistant',
    content: accumulatedText,
    canvas_snapshot_state: null,
  })
  .select()
  .single()

if (!insertError && row) {
  supabase
    .channel(`session:${session.id}`)
    .httpSend('new_message', row)
    .catch((err: unknown) => console.error('[message-evaluation] broadcast failed', err))
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Skill evaluation only reachable via `@analista` tag or 🔥📌🎯 power reaction | Every human message triggers a cheap tier-1-gated evaluation | Phase 15 (this phase) | Moderation/fact-check finally run on ordinary conversation, closing the `260719-e9x` gap |
| `checkBotBudget`/`runArbitration` only checked on the proactive silence path | Also checked on every reactive Skill-fire path | Phase 15 (this phase, D-11) | Closes the BOT-01/BOT-02 gap identified in `v3.0-MILESTONE-AUDIT.md` — cost/arbitration guards finally cover the dominant source of bot LLM spend (reactive Skills), not just the minority proactive silence trigger |
| Skill = one hardcoded `role` + one hardcoded object literal | Skill = factory function producing role-bound instances from shared `detect()`/`buildPromptGuidance()` logic | Phase 15 (this phase, D-07/D-08) | Removes duplication risk as more heuristics are added across Roles |

**No deprecations** — this phase is purely additive to the existing graph/Skill infrastructure; nothing built in Phases 10-14 is removed or replaced.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Fire-and-forget promises without `waitUntil()` reliably complete on Vercel's Node.js runtime before the Lambda container freezes, based on `maybeAutoName`'s existing (untested-at-scale) precedent | Pattern 2 | If wrong, the new evaluation call could be silently killed mid-flight in production under load, meaning D-04's "always traced" guarantee silently fails for some fraction of messages — recommend the planner add a `checkpoint:human-verify` step to confirm live Langfuse traces appear for genuinely untagged messages in the deployed (not just local dev) environment, matching the precedent Phase 14 already used for its own TriggerEngine live-verification checkpoint |
| A2 | Each `graph.invoke()` call emits roughly 1 trace + 1 span per executed node (used to estimate ~2 Langfuse units per non-firing evaluated message) | Langfuse Trace-Volume Sizing | If the actual unit count is higher (e.g. LangGraph/Langfuse emits multiple spans per node, or a `chain`-level wrapper span in addition to per-node spans), the sizing estimate under-counts and the plan-tier headroom is smaller than stated — recommend confirming against a live Langfuse dashboard during implementation, not just this research |
| A3 | The user's actual Langfuse plan tier is unknown — sizing above assumes the reader will map it themselves | Langfuse Trace-Volume Sizing | If the user is on the free Hobby tier and runs high message volume, ingestion could stop project-wide (not just for this feature) once the 50k/mo cap is hit — this is a product/cost decision for the user, not something this research can resolve without their account info |

**If this table is empty:** N/A — see rows above.

## Open Questions

1. **What is the actual name for the new `triggerType` value?**
   - What we know: This research used `'passive_eval'` as a placeholder; CONTEXT.md leaves the exact naming to Claude's Discretion (bundled into D-03's "exact shape" discretion).
   - What's unclear: No strong convention pulls toward one name over another (`'passive_eval'`, `'message_scan'`, `'reactive_scan'` are all defensible).
   - Recommendation: Planner picks a name during plan-writing; it is a pure naming decision with no architectural consequence, since `state.triggerType` is a plain `Annotation<string | null>` (no enum/schema constraint to update elsewhere).

2. **Should a new `ANALYST_AUTHOR_ID` sentinel be introduced, or should the new path resolve `author_id` differently?**
   - What we know: `COACH_AUTHOR_ID` exists as a precedent (fixed UUID, `messages.author_id` has no FK constraint). No Analyst equivalent exists anywhere in the codebase today (confirmed via grep).
   - What's unclear: Whether the planner wants a single new sentinel now, or wants to generalize to a `ROLE_AUTHOR_IDS: Record<string,string>` map anticipating Phase 15's own D-09-deferred "multiple named instances of a Role" future work (without implementing D-09 itself).
   - Recommendation: Mint `ANALYST_AUTHOR_ID` as a single new sentinel constant this phase (matching `COACH_AUTHOR_ID`'s exact pattern) — do not attempt to generalize to a map, since D-09 (multiple named instances per Role) is explicitly out of scope and a map would be speculative complexity ahead of that future phase.

3. **Does `checkBotBudget`'s token estimate constant need a Skill-specific value, or can it reuse `ESTIMATED_COACH_FIRE_TOKENS`?**
   - What we know: `trigger-engine.ts` uses a single `ESTIMATED_COACH_FIRE_TOKENS = 400` constant to guard `checkBotBudget()` BEFORE the LLM call (since actual usage isn't known ahead of time). This new path fires both Coach (moderation) and Analyst (fact-check/orphan-edge/phase-readiness) Skills, whose reply lengths/costs likely differ (Analyst's `analysis` tier model is more expensive than Coach's `facilitation`/classification tier per `TASK_MODELS`/`COST-01`).
   - What's unclear: Whether a single shared estimate constant is precise enough, or whether budget accuracy meaningfully suffers from treating Analyst fires the same as Coach fires.
   - Recommendation: Define two estimate constants (e.g. `ESTIMATED_COACH_FIRE_TOKENS`, reused as-is from `trigger-engine.ts` if extracted to a shared location, plus a new `ESTIMATED_ANALYST_FIRE_TOKENS`, sized higher to reflect the `.analysis`-tier model's typical output) rather than one generic constant — this is a small, low-risk addition, not a new subsystem.

## Environment Availability

Skipped — this phase has no new external dependencies (code/config-only changes; no new packages, no new services). All required infrastructure (LangGraph, Langfuse, Supabase RPCs for budget/arbitration) is already installed and configured per Phases 10-14.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | New evaluation path is server-triggered post-insert; the insert itself is already behind `requireAuth` (unchanged by this phase) |
| V3 Session Management | no | No new session/token handling |
| V4 Access Control | no | New evaluation runs with the same service-role Supabase client already used by `trigger-engine.ts`/`ai.ts` — no new access-control surface |
| V5 Input Validation | yes | `SkillDetectionResultSchema.safeParse()` (existing, `packages/types/src/skill.ts`) already bounds any Skill's `detect()` output — reused as-is for new call sites, no new validation gap |
| V6 Cryptography | no | No new key/secret handling — reuses `decryptKey()`/`env.KEY_ENCRYPTION_SECRET` exactly as `trigger-engine.ts`/`ai.ts` already do |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via a crafted message content reaching a Role node's system prompt through the new path's `buildPromptGuidance()` | Tampering | Already mitigated by `escapeUntrustedText()` + `<<<...DATA>>>` delimiter framing, used identically in `moderation.ts`/`fact-check.ts`/`drift-redirect.ts` today — the new path calls the SAME `buildPromptGuidance()` functions, so this protection is inherited automatically, not something to re-implement |
| Cost-exhaustion / billing-surface abuse (a flood of messages designed to repeatedly trip tier-2 classifier calls) | Denial of Service (against the creator's BYOK budget) | `checkBotBudget()`'s existing circuit breaker (BOT-01), now finally reachable from this path per D-11 — this phase's own D-11 IS the mitigation for a threat that was previously unmitigated on the reactive-Skill path (per `v3.0-MILESTONE-AUDIT.md`) |
| Repudiation — an inserted bot reply misattributed to the wrong author/Role | Repudiation | Use a dedicated `ANALYST_AUTHOR_ID` sentinel (Pitfall 3 / Open Question 2), mirroring `COACH_AUTHOR_ID`'s existing convention, rather than defaulting to `session.creator_id` (which would misattribute a bot's own reply to the human creator, exactly the ambiguity `COACH_AUTHOR_ID`'s own doc comment already calls out as a "Repudiation threat," T-11-20) |

## Sources

### Primary (HIGH confidence)

- `apps/api/src/graph/graph.ts` — full routing topology (routeFromStart, routeAfterMutationGate, routeAfterArgGraphBuilder, routeAfterTriggerGate), read in full
- `apps/api/src/graph/nodes/trigger-gate.ts` — TriggerGateNode implementation, read in full
- `apps/api/src/graph/nodes/arg-graph-builder.ts` — ArgGraphBuilderNode implementation, read in full
- `apps/api/src/lib/skills.ts`, `apps/api/src/lib/skills/moderation.ts`, `apps/api/src/lib/skills/fact-check.ts`, `apps/api/src/lib/skills/silence-break.ts`, `apps/api/src/lib/skills/drift-redirect.ts` — read in full
- `apps/api/src/lib/trigger-engine.ts` — read in full (proactive path precedent for CallbackHandler construction, message insert, budget/arbitration call sites)
- `apps/api/src/lib/bot-arbitrator.ts`, `apps/api/src/lib/bot-budget.ts`, `apps/api/src/lib/bot-registration.ts` — read in full
- `apps/api/src/routes/ai.ts`, `apps/api/src/routes/messages.ts` — read in full (existing message insert + reactive graph invocation call sites)
- `apps/api/src/graph/state.ts` — GraphState schema, read in full
- `apps/api/src/graph/nodes/trigger-gate.test.ts` — existing test conventions (vi.mock hoisting, Suffix-Mock naming)
- `apps/api/src/lib/auto-name.ts` — fire-and-forget precedent (`maybeAutoName`)
- `apps/api/src/lib/langfuse-user.ts`, `apps/api/src/lib/langfuse-otel.ts` — Langfuse wiring conventions
- `apps/api/src/index.ts`, `apps/api/src/server.ts`, `apps/web/app/api/[[...route]]/route.ts`, `vercel.json` — deployment topology (shared Hono app across Vercel Node.js runtime + standalone server)
- `packages/types/src/skill.ts`, `packages/types/src/blueprint.ts` — SkillDetectionResult/Blueprint schema fields (bot_defaults, role_personalities)
- `.planning/quick/260719-e9x-investigate-why-non-tagged-agent-message/260719-e9x-ROOT-CAUSE.md` — full root-cause analysis, read in full
- `.planning/v3.0-MILESTONE-AUDIT.md` — BOT-01/BOT-02/GRAPH-01 findings, read in full
- `.planning/phases/15-.../15-CONTEXT.md` — user decisions, read in full
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — read in full
- [Langfuse Pricing](https://langfuse.com/pricing) — official pricing/unit-definition page, fetched directly

### Secondary (MEDIUM confidence)

- Langfuse per-invocation unit-count estimate (~2 units for a non-firing evaluation) — derived from this codebase's own documented CallbackHandler/per-node-span behavior, not independently measured against a live dashboard this session

### Tertiary (LOW confidence)

None — every claim in this document is either sourced from a direct codebase read, official Langfuse documentation, or explicitly flagged in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: N/A — no new packages
- Architecture (graph topology extension): HIGH — derived directly from reading `graph.ts`, `trigger-gate.ts`, `arg-graph-builder.ts`, `state.ts` in full; the recommended routing extensions are minimal, mechanical diffs against real, current code
- Skill/Role refactor shape: HIGH — directly matches D-08's explicit requirement and existing file structure
- Pitfalls: HIGH — each pitfall is grounded in a specific, cited line/behavior in the actual codebase, not speculation
- Langfuse trace-volume sizing: MEDIUM — pricing facts are HIGH (official docs), per-invocation unit estimate is an informed estimate, user's actual plan tier is unknown

**Research date:** 2026-07-20
**Valid until:** 30 days (stable internal codebase architecture; Langfuse pricing should be re-checked if this research is reused after a longer gap, as SaaS pricing pages change without notice)
