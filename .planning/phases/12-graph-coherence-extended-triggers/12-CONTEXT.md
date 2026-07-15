# Phase 12: Graph Coherence + Extended Triggers - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the canvas graph coherent — after the first 3 committed nodes, every bot-proposed CanvasNode carries at least one edge proposal, falling back to a ghost edge to the most semantically similar existing node when the LLM itself can't find a strong connection. Wire four new triggers as **Skills** on the existing Coach/Analyst Roles: semantic drift (Coach), unlinked assertion (Analyst), fact-check (Analyst), and moderation (Coach). Formalize the Skill abstraction (detect + prompt-guidance contract, decoupled from delivery mechanism) as the general shape all future trigger-driven bot behaviors will use — including retrofitting Phase 11's silence-break trigger onto it. Validate task-based model routing (COST-01/02) end-to-end across all trigger types via a three-tier escalation gate for fact-check and a zero-LLM-cost heuristic pre-filter for moderation.

**What this phase does NOT include:**
- The full TriggerEngine (persistent `setInterval` scan loop wrapping ALL 6 trigger types under one generalized mechanism) — Phase 14 (TRIGGER-07). Phase 12's 4 new triggers fire synchronously as graph nodes; only silence (Phase 11, unchanged in its delivery mechanism) needs polling because it's an absence-based signal.
- Dynamic, session-specific objective/goal elicitation by agents (asking the group to state their goal, timing varying by Blueprint type) — redirected to Phase 13; overlaps with TRIGGER-02 (Blueprint phase-signal trigger) and PROFILE-01/02 (per-session profiles). Phase 12 uses only the static Blueprint-derived domain centroid.
- The full per-session profile/engagement-tracking system (PROFILE-01/02) — Phase 13. Phase 12 adds only a narrow, single-purpose moderation-count field per participant per branch, purely to support moderation escalation tone; this folds into the Phase 13 profile model rather than being rebuilt there.
- A creator-facing editor for Skills or drift thresholds beyond the existing "Analistas activos" drawer pattern — no new UI surface is implied by this phase's requirements.

</domain>

<decisions>
## Implementation Decisions

### Skill Architecture (core structural addition this phase)

- **D-01:** Introduce a formal **Skill** abstraction: `{ id, detect(context) → { fires, confidence, meta }, buildPromptGuidance(context) → string }`. A Skill is a capability a Role can perform — decoupled from *when/how* it's invoked (delivery mechanism). This generalizes the Role/Personality split from Phase 11 (11-CONTEXT.md D-01/D-02): Role = fixed behavioral discipline (code), Personality = voice/tone (data), Skill = a concrete capability the Role can exercise. Mirrors Phase 11's D-04 precedent of building the real data shape even when only a couple of instances ship.
- **D-02:** Each Role declares an array of registered Skills. Phase 12 ships: Coach → `drift-redirect`, `moderation` (plus the retrofitted `silence-break`); Analyst → `orphan-edge`, `fact-check`. Future skills (explicitly cited by the user: a "joke about anything" skill for a future comical Role personality-tuned as "Chiquito de la Calzada"; a "Reminders" skill that fires on a scheduled callback) register onto whichever Role uses them without changing Skill's core contract.
- **D-03:** Phase 11's silence-break trigger is retrofitted onto the Skill shape as Coach's first Skill. Its `detect()` wraps the existing `checkSilenceGate()`; its `buildPromptGuidance()` wraps the existing content-aware question logic (11-CONTEXT.md D-13/D-14). Its delivery mechanism is explicitly NOT changed — it still fires via the Phase 11 `setInterval` scan loop + direct-DB-insert (11-CONTEXT.md D-15/D-16). Skill is purely the detect+prompt-guidance contract; delivery mechanism is orthogonal and can differ per Skill (scan-loop for silence-break, synchronous graph node for the 4 new Phase 12 skills, a future scheduled-callback for a hypothetical Reminders skill).

### Trigger Firing Mechanism

- **D-04:** The 4 new Skills (drift-redirect, moderation, orphan-edge, fact-check) evaluate **synchronously**, as graph nodes — not via polling. All 4 are event-driven (react to a message arriving or a node being committed), unlike silence which is fundamentally about *absence* of activity and genuinely needs a timer.
- **D-05:** All 4 new Skills' detection logic is consolidated into **one combined `TriggerGateNode`**, running after `ArgGraphBuilderNode`. This node's job is strictly detection (cheap local checks: orphan-edge lookup, drift cosine-similarity, heuristic pre-filters for moderation/fact-check) — it enforces the COST-02 three-tier escalation gate in one place rather than duplicating that logic across 4 separate nodes.
- **D-06:** When `TriggerGateNode` confirms a firing Skill, it does NOT generate the bot response itself. It sets trigger/skill metadata and routes via a conditional edge into the existing `FacilitationAgentNode` (Coach) or `AnalyticsAgentNode` (Analyst) from Phase 11 — the same Role nodes, using their existing Role discipline, Personality voice, and cooldown/arbitration path (`bot-arbitrator.ts`, `bot-registration.ts`) unchanged. `bot-registration.ts`'s `analystScorer` (currently hardcoded to 0 — see its own comment anticipating this) gets extended to score based on which Skill's context is present.
- **D-07:** Role activation gating follows the exact pattern already used in `silence-scan.ts:190-191` (`session.bot_overrides?.coach ?? blueprint.bot_defaults?.coach ?? false`) — `TriggerGateNode` must check this before evaluating a Role's Skills at all. A session with Analyst toggled off never evaluates orphan-edge or fact-check.

### Domain Centroid (Semantic Drift Skill)

- **D-08:** The domain centroid is a **static, per-Blueprint value**: Blueprint description text + `node_types`/`edge_types` labels, concatenated and embedded once at Blueprint-load time via the local ONNX model (`all-MiniLM-L6-v2`), then cached in memory. No new creator-facing Blueprint field is added for this. This choice was explicitly made to keep Phase 13's future session-level override (a stated-objective embedding, checked first and falling back to this Blueprint-level default) additive rather than requiring a schema change here.
- **D-09:** A new explicit Blueprint field `drift_detection_enabled: boolean` (default `true`) lets a Blueprint opt out of drift detection entirely, for domains where an "on-topic scope" doesn't meaningfully apply. Follows the explicit-field precedent set by `bot_defaults`/`bot_cooldowns` (11-CONTEXT.md D-11) rather than overloading the numeric threshold with off/on semantics.
- **D-10:** Dynamic, session-specific objective elicitation (agents proactively asking the group to state their goal — upfront for coaching-type Blueprints, reactively after N unclear messages for debate-type Blueprints, not needed for others) is **out of scope for Phase 12** and captured as a Phase 13 candidate (see `<deferred>`).

### Heuristic Pre-Filter Content (Spanish)

- **D-11:** Moderation heuristic pre-filter (TRIGGER-06, zero LLM cost): a curated **Spanish insult/profanity keyword list** plus structural signals (ALL-CAPS ratio, excessive/repeated `!`/`?`). Deterministic, matches COST-02's "heuristic regex/rule" framing exactly.
- **D-12:** Fact-check heuristic pre-filter (TRIGGER-05, tier 1 of 3): **claim-shaped pattern matching** — numbers+units, dates/years, absolute qualifiers ("siempre", "nunca", "todos saben que"), named-entity-like capitalized phrases. Only messages matching these patterns escalate to the light-tier classifier (tier 2), keeping tier 1 genuinely cheap.

### Ghost-Edge Fallback (GRAPH-03)

- **D-13:** The ghost-edge similarity fallback embeds **node `label` only** (not the originating message content) — reuses the same ONNX embedding pipeline used for drift detection, keeping the fallback path cheap since it only runs when the LLM couldn't find a strong connection itself.
- **D-14:** Only nodes with `status='committed'` are eligible targets for a proposed edge (both LLM-proposed and ghost-fallback). Ghost nodes are themselves unconfirmed; excluding them prevents chains of tentative content with no anchor to the accepted graph.

### Fact-Check & Moderation Tone

- **D-15:** The Analyst's fact-check challenge cites the specific claim (using the argGraph summary context per GRAPH-04/`bot-context.ts`'s `summarizeArgGraph()`) and asks for a source — stays in uncertainty framing (never a confident counter-assertion), consistent with the Analyst Role's "always cites a specific prior message" discipline (11-CONTEXT.md D-01).
- **D-16:** Moderation intervention tone **escalates after repeated triggers** on the same participant within a session — shifts from a gentle redirect toward a more direct one after N occurrences. This requires a minimal, single-purpose `moderation_count` field (per participant, per branch) — explicitly scoped as narrow enough to fold into Phase 13's full profile model (PROFILE-01) as one field among many, not a parallel system.

### Claude's Discretion

- Exact Skill TypeScript interface shape/location (likely `packages/types/src/` or a new `apps/api/src/lib/skills.ts`, following the co-located Zod-schema-plus-type convention from 11-CONTEXT.md's Established Patterns)
- Exact escalation thresholds (N occurrences before tone shift) for moderation
- Exact Spanish insult/profanity keyword list contents and claim-shaped regex patterns
- Exact storage location/shape for the minimal `moderation_count` field (new migration column vs. in-memory with periodic flush — follow Phase 10/11 Postgres-backed-state precedent, not JS process memory, per the project's "All bot state in PostgresSaver" architectural constraint)
- Exact `TriggerGateNode` → Role-node conditional edge implementation, following `orchestrator.ts`'s existing conditional-routing pattern

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §GRAPH-03, §GRAPH-04, §TRIGGER-03–06, §COST-01–02 — this phase's locked requirements
- `.planning/ROADMAP.md` §Phase 12 — goal, 5 testable success criteria, depends-on Phase 11

### Phase 11 Foundations (must reuse, not rebuild)
- `.planning/phases/11-personality-basic-triggers/11-CONTEXT.md` — full D-01–D-16 decisions this phase builds on: Role/Personality split (D-01–D-03), silence-scan interim loop (D-15/D-16), content-aware context building (D-13/D-14)
- `.planning/phases/11-personality-basic-triggers/11-PATTERNS.md` — exact code patterns/analogs extracted for bot infrastructure; same methodology applies here
- `.planning/phases/11-personality-basic-triggers/11-REVIEW-FIX.md` — WR-06 established the `escapeUntrustedText()` + `<<<ARGUMENT_GRAPH_DATA>>>` delimiter pattern for interpolating user-controlled argGraph content into system prompts; any new prompt-guidance built from argGraph/message content in this phase MUST follow the same pattern
- `apps/api/src/lib/silence-gate.ts` — `checkSilenceGate()`, wrapped by the retrofitted `silence-break` Skill's `detect()` (D-03)
- `apps/api/src/lib/bot-arbitrator.ts` — `registerBot()`/`runArbitration()`; unchanged mechanism, `analystScorer` extended per D-06
- `apps/api/src/lib/bot-registration.ts` — its own comment already anticipates Phase 12 extending `analystScorer`'s logic
- `apps/api/src/lib/bot-budget.ts` — budget guard all Skill-triggered invocations must still check
- `apps/api/src/lib/silence-scan.ts` (lines ~190-191) — the `bot_overrides ?? bot_defaults ?? false` Role-activation gate pattern (D-07)
- `apps/api/src/lib/bot-context.ts` — `summarizeArgGraph()`, the shared context-building path the fact-check Skill's claim-citation (D-15) reuses

### LangGraph Graph Structure (existing — extend, do not duplicate)
- `apps/api/src/graph/graph.ts` — `createGraph()` factory; this phase adds `TriggerGateNode` after `ArgGraphBuilderNode` plus new conditional routing into the Role nodes (D-05/D-06)
- `apps/api/src/graph/nodes/arg-graph-builder.ts` — `ArgGraphBuilderNode`; `TriggerGateNode` runs immediately after this, consuming its output (`state.argGraph`) for orphan-edge detection
- `apps/api/src/graph/nodes/mutation-gate.ts` — confidence-threshold routing (`>0.85 committed / 0.5–0.85 ghost / <0.5 silent`) and Blueprint vocabulary validation (`node_types`/`edge_types`); the ghost-edge fallback (D-13/D-14) still passes through this same gate
- `apps/api/src/graph/nodes/orchestrator.ts` — existing `DOMAIN_MATCH`/`DOMAIN_BRIDGE`/`DOMAIN_DRIFT` conditional-routing pattern; direct template for `TriggerGateNode`'s conditional edges into Role nodes. **Note:** `DOMAIN_DRIFT` here is a different, pre-existing, per-message REACTIVE classification (LLM-based) — not to be confused with this phase's new semantic-drift Skill (ONNX-embedding-based, proactive, compares last 3 messages against a Blueprint domain centroid)
- `apps/api/src/graph/nodes/facilitation-agent.ts`, `apps/api/src/graph/nodes/analytics-agent.ts` — the Coach/Analyst Role nodes Skills route into (D-06)
- `apps/api/src/lib/model-config.ts` — `TASK_MODELS` registry; already has `facilitation`/`classification`/`analysis` task types mapped to light/capable tiers per provider — the three-tier escalation gate (D-12/COST-02) uses `classification` for tier 2 and `analysis` for tier 3, no new task types needed

### Canvas / Graph Data Model (existing — extend, do not duplicate)
- `packages/types/src/canvas.ts` — `CanvasNodeSchema`, `CanvasEdgeSchema`, `CanvasOpSchema` (`ADD_NODE`/`ADD_EDGE`/`NO_ACTION` discriminated union, `confidence` field drives Mutation Gate routing)
- `packages/types/src/blueprint.ts` — `BlueprintSchema`, `node_types`/`edge_types` (vocabulary), `bot_cooldowns`, `bot_defaults`; this phase adds `drift_detection_enabled` (D-09) following the same explicit-field pattern

### DB Migration Precedent
- `supabase/migrations/0012_bot_infrastructure.sql` — most recent migration (Phase 10); this phase's Blueprint schema extension (D-09) and the minimal moderation-count field (D-16) get the next sequential migration number

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `checkSilenceGate()` (`apps/api/src/lib/silence-gate.ts`) — wrapped by the retrofitted silence-break Skill, unchanged
- `registerBot()`/`runArbitration()` (`apps/api/src/lib/bot-arbitrator.ts`) — unchanged mechanism; only the registered scorers' logic changes
- `summarizeArgGraph()` + `escapeUntrustedText()` (`apps/api/src/lib/bot-context.ts`) — shared context-building path; fact-check claim citation and orphan-edge detection both consume `state.argGraph` through this
- `TASK_MODELS` (`apps/api/src/lib/model-config.ts`) — already has the tiers needed for COST-01/02; no new task types required
- Mutation Gate confidence routing (`apps/api/src/graph/nodes/mutation-gate.ts`) — ghost-edge fallback still flows through this unchanged

### Established Patterns
- `[nodename]` console logging prefix, fail-open/fail-silent error handling (never throw from a graph node) — `TriggerGateNode` follows this
- `config.configurable` seam for test injection (`agentAdapter`, `classifierAdapter`) — Skill `detect()`/`buildPromptGuidance()` functions should accept an equivalent injectable context
- Zod schema + inferred type co-located in `packages/types/src/*.ts` — the new Skill interface and any new Blueprint/DB fields follow this
- Explicit boolean/map fields on Blueprint (`bot_defaults`, `bot_cooldowns`) rather than overloading existing numeric fields with off/on semantics — `drift_detection_enabled` follows this (D-09)

### Integration Points
- `apps/api/src/graph/graph.ts` — new `TriggerGateNode` + conditional edges is this phase's highest-risk topology change (comparable to Phase 11's conditional START edge)
- `apps/api/src/lib/bot-registration.ts` — `analystScorer` extension point, already anticipated in its own comments
- `supabase/migrations/` — new migration for `drift_detection_enabled` + moderation-count field

</code_context>

<specifics>
## Specific Ideas

- User's concrete example for the Skill/Role/Personality mental model: a future "comical" Role with a "joke about anything the user says" Skill, personality-tuned as "Chiquito de la Calzada" — same conceptual pattern as Phase 11's "Einstein as fact-checker = Einstein Checker" example, extended one level: Role (behavior) × Personality (voice) × Skill (capability).
- User's example for delivery-mechanism independence: a future "Reminders" Skill that fires via a scheduled callback (not a graph-node event, not a scan-loop tick) — reinforcing that Skill = detect+prompt-guidance contract, decoupled from *how* it gets invoked.
- User's framing for the domain-centroid/goal question: "In a debate, one of the agents should ask about [the goal] if after X messages it is not clear. In a coaching session, the facilitator needs to ask for it at the very beginning. For other blueprints it might not even be needed." — directly shaped D-08/D-09/D-10.

</specifics>

<deferred>
## Deferred Ideas

- **Dynamic, session-specific objective elicitation** — agents proactively asking the group to state their goal (timing varies by Blueprint type: upfront for coaching, reactive-after-N-messages for debate, not needed for others). Belongs in Phase 13 — overlaps with TRIGGER-02 (Blueprint phase-signal trigger) and PROFILE-01/02 (per-session profiles). Flag this explicitly when scoping Phase 13's discussion.
- Full per-participant profile/engagement-tracking system (PROFILE-01/02) — Phase 13; Phase 12 only adds the narrow `moderation_count` field.
- Full TriggerEngine generalization (all 6 triggers under one persistent scan-loop mechanism) — Phase 14, TRIGGER-07.

### Reviewed Todos (not folded)
None — no pending todos matched this phase (`todo.match-phase` returned 0 matches).

</deferred>

---

*Phase: 12-Graph Coherence + Extended Triggers*
*Context gathered: 2026-07-15*
