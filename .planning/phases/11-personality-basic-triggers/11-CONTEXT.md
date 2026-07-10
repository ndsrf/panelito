# Phase 11: Personality + Basic Triggers - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the Coach and Analyst/Fact-Checker **Roles** into the LangGraph graph as `FacilitationAgentNode` and `AnalyticsAgentNode`, with the conditional START-edge routing between them isolated and fully tested. Introduce a new **Role × Personality** architecture: Roles are fixed behavioral node types (code); Personalities are standalone data (Supabase-backed) that supply voice/tone/language on top of a Role. Introduce the argGraph structure and `ArgGraphBuilderNode`. Ship the silence-window trigger as the first *live* trigger — a real Coach message must appear in chat after real silence, which requires a minimal interim scan mechanism since the full TriggerEngine (persistent scan loop) is Phase 14 scope.

**What this phase does NOT include:**
- The full TriggerEngine (persistent setInterval scan loop over all active branches, all 6 trigger types) — Phase 14 (TRIGGER-07). Phase 11 builds a minimal single-trigger (silence only) interim scan loop that Phase 14 will generalize.
- Semantic drift, unlinked assertion, fact-check, moderation triggers — Phase 12
- A creator-facing personality *creation/editing* UI — explicitly out of scope for v3.0 per PROJECT.md (political persona clones, custom actor personas are "examples of extensibility, not built-in v1 presets"). Phase 11 builds the data model + 2 shipped personalities, not an editor.
- Per-participant profiles (PROFILE-01/02) and the phase-signal trigger (TRIGGER-02) — Phase 13
- Refactoring the existing reactive Analista Científico invocation *path* (the agentNode / `/invoke` route) — only its personality *data* migrates onto the new structure (see D-06); the reactive invocation mechanism itself is untouched

</domain>

<decisions>
## Implementation Decisions

### Role vs. Personality Architecture (core pivot for this phase)

- **D-01:** **Role** = fixed behavioral discipline, implemented as a LangGraph node type. `FacilitationAgentNode` (Coach role: every output ends in a question, never gives conclusions) and `AnalyticsAgentNode` (Analyst/Fact-Checker role: always cites a specific prior message; when in fact-check framing, uses uncertainty language exclusively, never confident counter-assertions). Roles are code, not data — adding a new Role means writing a new node (e.g. a future Devil's Advocate role in v3.1).
- **D-02:** **Personality** = a standalone, Role-agnostic data record supplying voice/tone: language, formality, Socratic-discipline flavor text, knowledge scope, catchphrases. Personalities carry NO behavioral rules — they are a pure styling layer.
- **D-03 (precedence rule — locked, non-negotiable):** A Role's behavioral contract always overrides whatever a Personality's voice would otherwise produce. Prompt composition order: Role discipline rules are structurally dominant; Personality voice is appended as styling only. This means any Personality can safely be attached to any Role — there is no need for a compatibility/preclusion mechanism between them.
- **D-04:** Personalities are stored in a **real Supabase table** (not a hardcoded TS list), even though only 2 personalities ship in Phase 11 (default Coach voice, default Analyst voice). This anticipates a future personality-management feature without a later migration. Exact table shape (columns, RLS) is left to research/planning — follow the existing `domain_blueprints` table pattern (jsonb definition column) as the closest analog.
- **D-05:** Blueprint declares which Roles are active for a domain, plus a **default Personality per active Role**. The Creator can **override the Personality assigned to a Role per session** via a dropdown (same drawer as D-09). Exact schema for the Blueprint→Role→default-Personality link and the session-level override storage is left to research/planning; follow the precedent of `bot_cooldowns` being added as an optional Blueprint extension in Phase 10.
- **D-06:** The existing reactive `Analista Científico` persona (today: a single hardcoded `systemPromptAddition` string in `packages/types/src/persona.ts`, invoked via the existing reactive `agentNode`/`/invoke` path) gets its **personality data** migrated onto the new structured Personality model in this phase. Its invocation *mechanism* (the reactive agentNode path, toggled per-message) is explicitly NOT refactored or touched — only the data representation of its voice moves onto the new model.
- **D-07:** Default language/tone for the two personalities Phase 11 ships: **Spanish, informal (tú)** — matching Analista Científico's existing tone and the rest of the UI copy ("Congelar", "Analistas activos", etc.).
- **D-08:** Display names are Spanish: Coach role's default personality reads as **"Facilitador"**; Analyst/Fact-Checker role's default personality reads as **"Analista/Verificador"**. (Exact final copy is Claude's discretion at planning/implementation time — the direction is Spanish naming consistent with the existing UI.)

### Creator Control & Visibility

- **D-09:** Coach/Facilitador and Analyst/Verificador are **toggleable per session** by the creator, reusing the existing "Analistas activos" Sheet drawer pattern in `CreatorControls.tsx` (same UI location as the Analista Científico switch today).
- **D-10:** The **list of available bots and their default on/off state come from the active Blueprint**, not a global hardcoded default. This requires an explicit defaults structure on the Blueprint (see D-11) rather than inferring "on" from mere presence in `active_persona_ids`.
- **D-11:** A **new explicit defaults map** is added to the Blueprint schema (e.g. a `bot_defaults`-shaped field keyed by Role, giving explicit true/false) rather than overloading the existing `active_persona_ids` field's presence/absence semantics. Exact field name/shape is research/planning's call — follow the precedent of `bot_cooldowns` as an optional Blueprint extension (see Phase 10's `bot-arbitrator.ts` `BlueprintWithCooldowns` pattern).
- **D-12:** Per-persona cooldown budgets (Coach 3/15min, Analyst 2/15min per REQUIREMENTS.md PERSONA-03) are surfaced as a **read-only display** in the same "Analistas activos" drawer — no creator-editable cooldown UI in Phase 11. This satisfies ROADMAP.md Phase 11 success criterion 5 ("Creator can see the cooldown configuration in session settings") at minimal UI cost; editable cooldowns are not in scope here.

### Silence Trigger — Content Strategy

- **D-13:** The Coach's silence-break message is **content-aware**, not generic — it references specific recent conversation/canvas content rather than a generic "anyone want to add anything?" prompt.
- **D-14:** Context for the content-aware question comes from **both** the argGraph summary (structured nodes/edges — the same context GRAPH-04 already requires injecting into the Analyst's prompt) **and** the last few raw messages (same sliding-window pattern already used in `ai.ts` AI-08). This means the argGraph/ArgGraphBuilderNode work and the silence-trigger Coach prompt share one context-building path — build it once, use it for both.

### Silence Trigger — Live Firing Mechanism

- **D-15:** Phase 11 ships a **minimal, single-trigger interim scan loop** (silence gate only) — NOT the full 6-trigger TriggerEngine (that's Phase 14, TRIGGER-07). Pattern: a `setInterval` in `apps/api/src/server.ts`, following the exact same shape as the existing `startAutoFreezeTracker` registration in `apps/api/src/lib/auto-freeze.ts`. Phase 14 will generalize this into the full TriggerEngine; some rework in Phase 14 is expected and accepted.
- **D-16:** The scan loop's resulting Coach message is delivered by **inserting directly into the `messages` table** (no SSE, since there's no active HTTP request to stream over for a proactively-fired message). Clients pick it up via the existing SSE-fallback/polling pattern already used for WSL2 Realtime-dead scenarios (per `feedback_wsl2_realtime.md` memory).

### Claude's Discretion

- Exact copy/wording for "Facilitador" and "Analista/Verificador" display names and their default personality descriptions
- Exact Supabase table schema for the new personalities table (columns, RLS policy) — follow `domain_blueprints` table pattern as closest analog
- Exact Blueprint schema field name/shape for the Role→default-Personality link and the `bot_defaults`-style map (D-11)
- Exact session-level storage location for the creator's per-session Personality override per Role
- Scan loop interval/frequency and scope (which branches/sessions it evaluates) for the interim silence scanner
- Whether/how the Fact-Checker framing mode within `AnalyticsAgentNode` is triggered — Phase 12 wires the live fact-check trigger (TRIGGER-05), but PERSONA-02 requires the framing behavior to exist and be testable in Phase 11 even with no live trigger invoking it yet

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §PERSONA-01–04, §TRIGGER-01, §GRAPH-01–02, §GRAPH-04 — this phase's locked requirements
- `.planning/ROADMAP.md` §Phase 11 (lines 257–270) — goal, success criteria (5 testable scenarios), depends-on Phase 10

### Phase 10 Infrastructure (must reuse, not rebuild)
- `.planning/phases/10-infrastructure-foundation/10-CONTEXT.md` — full D-01–D-15 decisions this phase builds on (dual thread_id, bot arbitration lock, budget guard, silence gate, state schema)
- `.planning/phases/10-infrastructure-foundation/10-PATTERNS.md` — exact code patterns/analogs already extracted for bot infrastructure; same methodology applies to this phase's new files
- `apps/api/src/lib/silence-gate.ts` — `checkSilenceGate()` already implements the two-signal gate (BOT-03); Phase 11 calls this, does not reimplement it
- `apps/api/src/lib/bot-arbitrator.ts` — `registerBot()` / `runArbitration()` plugin registry; Coach and Analyst register here in Phase 11 (registry was empty in Phase 10)
- `apps/api/src/lib/bot-budget.ts` — budget guard Coach/Analyst invocations must check before firing
- `apps/api/src/graph/state.ts` — `GraphStateAnnotation` already has `argGraph` and `triggerMetadata` fields (empty defaults) from Phase 10; Phase 11's `ArgGraphBuilderNode` populates `argGraph` for the first time

### LangGraph Graph Structure (existing — extend, do not duplicate)
- `apps/api/src/graph/graph.ts` — `createGraph()` factory + `routeAfterOrchestrator` conditional edge; Phase 11 adds the new conditional START edge for facilitation-vs-analysis routing
- `apps/api/src/graph/nodes/agent.ts` — existing reactive `agentNode` + `buildAgentSystemPrompt()`; template for how Blueprint vocabulary/phase instructions get injected into a node's system prompt — the new `FacilitationAgentNode`/`AnalyticsAgentNode` follow this same injection pattern
- `apps/api/src/graph/nodes/orchestrator.ts`, `apps/api/src/graph/nodes/mutation-gate.ts`, `apps/api/src/graph/nodes/drift-reply.ts` — existing node shape/conventions (config.configurable seams, fail-open logging with `[nodename]` prefix, never import `@anthropic-ai/sdk` directly)
- `apps/api/src/lib/model-config.ts` — `TASK_MODELS` registry; Coach/facilitation moves should route to the light/fast tier per COST-01 (Phase 12 formalizes this, but Phase 11 should not hardcode a model name)

### Existing Persona System (being extended, not replaced)
- `packages/types/src/persona.ts` — `PERSONA_LIBRARY`, `PersonaConfigSchema`, `PERSONA_IDS` — current reactive persona system; Analista Científico's voice data migrates onto the new Personality model (D-06) but its invocation path stays as-is
- `packages/types/src/blueprint.ts` — `BlueprintSchema`, `active_persona_ids` (D-05 in that file: text IDs resolved at runtime, not compile-time enum — same principle applies to the new Role→Personality Blueprint fields)
- `apps/api/src/routes/personas.ts` — existing POST toggle route for `active_personas`; the new Role toggle (D-09) likely follows this route's pattern
- `apps/web/components/workspace/CreatorControls.tsx` — the "Analistas activos" Sheet drawer (`personaCard`, `handlePersonaToggle`) is the exact UI location or new toggles land (D-09) and where cooldown read-only display goes (D-12)

### Live Firing Mechanism (interim scan loop)
- `apps/api/src/server.ts` — `startAutoFreezeTracker()` registration call is the exact pattern to follow for registering the new interim silence-scan loop
- `apps/api/src/lib/auto-freeze.ts` — the auto-freeze tracker's `setInterval` implementation is the direct analog for the interim scan loop (D-15)
- `.claude/projects/memory/feedback_wsl2_realtime.md` (referenced via project memory) — WSL2 Realtime is dead in local dev; the direct-DB-insert delivery approach (D-16) must degrade the same way existing SSE-fallback code already does

### DB Migration Precedent
- `supabase/migrations/0012_bot_infrastructure.sql` — most recent migration (Phase 10); the new personalities table (D-04) and any Blueprint schema extension (D-11) get the next sequential migration number
- `supabase/migrations/0008_nsai_foundation.sql` — `domain_blueprints` table shape (jsonb `definition` column) is the closest analog for the new personalities table

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `checkSilenceGate()` (`apps/api/src/lib/silence-gate.ts`) — two-signal gate, fully built in Phase 10, ready to call from the new interim scan loop
- `registerBot()` / `runArbitration()` (`apps/api/src/lib/bot-arbitrator.ts`) — plugin registry ready for Coach/Analyst to register into
- `startAutoFreezeTracker()` pattern (`apps/api/src/lib/auto-freeze.ts`) — direct template for the interim silence-scan `setInterval` loop
- `PERSONA_LIBRARY` / `PersonaConfigSchema` (`packages/types/src/persona.ts`) — existing pattern for a typed persona list; informs (but is being superseded by) the new Personality data model

### Established Patterns
- Zod schema + inferred type co-located in `packages/types/src/*.ts`, exported from `packages/types/src/index.ts` in a grouped comment block (see Phase 10 pattern map for the exact template)
- `config.configurable` seam for test injection (`agentAdapter`, `classifierAdapter`, `driftReplyAdapter`) — new nodes should follow this same test-seam convention
- `[nodename]` console logging prefix convention, fail-open/fail-silent error handling (never throw from a graph node)
- Supabase RPC atomic compare-and-set pattern (mic lock / bot lock) — relevant if the Role→Personality override write needs concurrency safety

### Integration Points
- `apps/api/src/graph/graph.ts` — new conditional START edge (facilitation-trigger vs analysis-trigger routing) is the highest-risk topology change per STATE.md; must error clearly on misconfigured routing, never silently default (ROADMAP.md success criterion 2)
- `apps/api/src/server.ts` — new interim scan loop registration alongside `startAutoFreezeTracker`
- `apps/web/components/workspace/CreatorControls.tsx` — new Role toggles + cooldown display in the existing "Analistas activos" Sheet
- `supabase/migrations/` — new migration for personalities table + Blueprint schema extension (bot_defaults-style map)

</code_context>

<specifics>
## Specific Ideas

- The user's own example for the Role/Personality split: "Albert Einstein as fact-checker = Einstein Checker" — same Role (Analytics/Fact-Checker discipline), different Personality (Einstein voice). This is the concrete mental model downstream agents should design against, even though only 2 default personalities ship in Phase 11.
- User explicitly wants eventual support for recreating politicians/actors as personalities (per PROJECT.md's deferred "Political persona clones" note) — Phase 11's job is to make the data model right for that future, not to build the creation UI now.
- "Do whatever you think will be easier" was said in the context of node-file design — user deferred the Facilitation/Analytics-vs-generic-node implementation question to Claude, provided the Role/Personality conceptual split (which the user does care about) is respected.

</specifics>

<deferred>
## Deferred Ideas

- Full creator-facing personality creation/editing UI (custom personalities, political/actor clones) — explicitly out of scope for v3.0 per PROJECT.md; Phase 11 only builds the data model + 2 shipped personalities
- Editable (not just read-only) cooldown configuration in session settings — deferred past Phase 11; D-12 ships read-only only
- Full TriggerEngine generalization (all 6 triggers, persistent scan loop architecture) — Phase 14, TRIGGER-07
- Migrating Analista Científico's *invocation mechanism* (not just its personality data) onto the new Role/Personality node architecture — no request to do this; only the voice data migrates (D-06)

### Reviewed Todos (not folded)
None — no pending todos matched this phase (`todo.match-phase` returned 0 matches).

</deferred>

---

*Phase: 11-Personality + Basic Triggers*
*Context gathered: 2026-07-10*
