# Phase 13: User Profiles + Phase Signal - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning

<domain>
## Phase Boundary

A new `ProfileBuilderNode` runs after `ArgGraphBuilderNode` and maintains a persistent, per-participant profile (stated positions, key assertions, engagement level) keyed by `author_id`. The Coach personalizes its facilitation moves using these profiles via a shared enrichment path invoked by whichever Coach Skill wins arbitration. Separately, a new Analyst `phase-readiness` Skill — following the exact Phase 12 Skill/TriggerGateNode pattern — judges when the group has sufficiently covered the current Blueprint phase's general purpose (not a fixed topic checklist) and emits a `phase_signal`; the Coach asks the group if they're ready to advance. The human still must click "Advance Phase" — the LLM never advances `current_phase` autonomously (unchanged HUMAN-02 invariant).

**What this phase does NOT include:**
- Session-specific goal/objective elicitation (agents asking the group to state their goal, timing varying by Blueprint type) — remains unscoped; deferred from Phase 12 (12-CONTEXT.md D-10) and still deferred here. Phase-readiness judges against the Blueprint phase's existing `llm_instructions` field, not a session-specific stated goal.
- Cross-session profile continuity for registered users (MEM-01/MEM-02) — v4.0. Profiles are session-scoped (per branch) even though they're keyed by the stable `author_id`, which is deliberately chosen to make v4.0 continuity additive later.
- The full TriggerEngine generalization (all 6 triggers under one persistent scan-loop mechanism) — Phase 14, TRIGGER-07.
- Any new UI for phase-readiness beyond the existing "Advance Phase" affordance (HUMAN-02) — the existing `phase_signal` → SSE → UI → PATCH plumbing (`ai.ts`, `use-ai-stream.ts`, `CreatorControls.tsx`, `sessions.ts`) is reused, not rebuilt.

</domain>

<decisions>
## Implementation Decisions

### Profile Storage Mechanism

- **D-01:** Per-participant profiles are stored in a **new Postgres table** (`participant_profiles` or similar: `branch_id, participant_id, positions, assertions, messages_sent, reactions_used, moderation_count, updated_at`) — NOT a true LangGraph `InMemoryStore`. PROFILE-01's literal wording names `InMemoryStore`, but that's ephemeral process memory and does not survive a Vercel cold start, directly conflicting with the project's standing architectural rule ("all bot state in PostgresSaver, no JS process memory" — set in Phase 10, reaffirmed 12-CONTEXT.md D-16). This follows the exact precedent Phase 12 already set with `moderation_counts` (`supabase/migrations/0015_graph_coherence_triggers.sql`).
- **D-02:** Phase 12's `moderation_counts` table is **folded into** the new profile table via migration — `moderation_count` becomes one column among positions/assertions/engagement, not a parallel system. This was explicitly anticipated by 12-CONTEXT.md D-16 ("folds into the Phase 13 profile model as one field among many"). `moderation.ts`'s read/write path (`getModerationCount`/`incrementModerationCount`) gets repointed at the new table/RPC.
- **D-03:** Profile-update logic lives in a **new dedicated `ProfileBuilderNode`**, running immediately after `ArgGraphBuilderNode` in the graph topology — NOT folded into `ArgGraphBuilderNode` itself (despite PROFILE-01's literal wording naming that node). Keeps `ArgGraphBuilderNode`'s responsibility narrow (graph extraction only); `ProfileBuilderNode` consumes its output (`state.argGraph`) to upsert the speaking participant's profile row.

### Participant Identity & Profile Content

- **D-04:** Profiles are keyed by **`author_id`** (stable UUID, matches `messages.author_id`), not the `speaker` display-name string that `ArgNode` currently carries (`packages/types/src/bot.ts`). `ProfileBuilderNode` resolves `speaker` → `author_id` via the `message_id` already present on each `ArgNode`. This is deliberately compatible with both registered users and session-only guests today — storage doesn't distinguish them in v3.0 — while keeping the door open for v4.0's MEM-01/MEM-02 cross-session continuity for registered users specifically.
- **D-05:** "Engagement level" is exactly **`messages_sent` count + `reactions_used` count** — no derived activity tier (e.g., "active"/"quiet"/"dominant"). Matches PROFILE-01's literal wording; no new classification logic.
- **D-06:** "Stated positions" and "key assertions" are **derived by filtering existing argGraph nodes** where `speaker` resolves to this `author_id` — not a dedicated LLM extraction pass. Zero new LLM calls; pure filtering of data `ArgGraphBuilderNode` already produced that turn (deduped, capped at a reasonable N most-recent).

### Phase-Readiness Coverage Check

- **D-07:** Coverage is judged via **LLM judgment against the phase's existing `llm_instructions` field** (`PhaseSequenceSchema`, `packages/types/src/blueprint.ts:37-44`) — NOT a new static `required_topics: string[]` field on Blueprint. User correction during discussion: Blueprint `phase_sequence` entries describe general session behavior/purpose, not a fixed topic checklist a specific session must hit. No Blueprint schema change for this.
- **D-08:** Phase-readiness is wired as a **new Analyst Skill (`phase-readiness`)** inside the Phase 12 `TriggerGateNode` pattern — same `detect()`/`buildPromptGuidance()` contract as `drift-redirect`/`orphan-edge`/`fact-check`/`moderation`. The existing ad-hoc path — where the general-purpose `AgentNode` emits `phase_signal` directly during a canvas-op tool call (`agent.ts:150-181`) — is **deprecated/removed** in favor of this Skill-driven path. The downstream plumbing (`phase_signal` → SSE event → `CreatorControls.tsx` → `PATCH /:id/phase`) is unchanged and reused as-is.
- **D-09:** The cheap pre-LLM gate is **sequential, not independent AND/OR**: **N committed argGraph nodes accumulate first; only after that does a counter of M subsequent human messages start**, and the actual capable-tier coverage-judgment call fires once M is reached. This catches the case where canvas-node production stalls but the conversation keeps evolving in ways not yet formalized into nodes. Both N and M are Blueprint-configurable (new fields, following the `bot_cooldowns`-style explicit-field precedent — likely `phase_readiness_gate: { min_nodes: number, min_messages_after: number }`, global or per-phase — exact shape is Claude's discretion).
- **D-10:** The Analyst's coverage-judgment LLM call receives **both** the phase's `llm_instructions`, the argGraph summary (`summarizeArgGraph()`), **and the last M raw human messages** — not argGraph alone. User's own reasoning: topics can be discussed in conversation without ever being formalized into a committed canvas node, so judging coverage from the graph alone would miss them.

### Coach Personalization Delivery

- **D-11:** Personalization is **not a competing/firing Skill** in the `TriggerGateNode` arbitration sense (reconciling an initial answer that named it a "dedicated Skill" with the follow-up clarification). It's implemented as a **shared `summarizeParticipant()` enrichment function** (sibling to `summarizeArgGraph()` in `bot-context.ts`), invoked by whichever Coach Skill already won arbitration (silence-break, drift-redirect, moderation, or the new phase-readiness) to append that Skill's target participant's profile summary into its own `buildPromptGuidance()` output. There is no independent "personalize wins arbitration" path — personalization always rides along with whichever Skill is already firing, targeting whichever participant that Skill is already responding to.

### Claude's Discretion

- Exact `participant_profiles` table schema/migration shape and RPC naming (following `0015_graph_coherence_triggers.sql`'s `moderation_counts` + `increment_moderation_count` precedent)
- Exact new Blueprint field name/shape for the sequential N/M phase-readiness gate (e.g. `phase_readiness_gate: { min_nodes, min_messages_after }`) — global on Blueprint vs. per-`PhaseSequenceSchema` entry
- Cap/recency window for how many positions/assertions are retained per participant profile
- Exact `speaker` → `author_id` resolution mechanism in `ProfileBuilderNode` (via `ArgNode.message_id` → message lookup)
- Removal/deprecation mechanics for the existing `agent.ts:150-181` ad-hoc `phase_signal` emission path — confirm no other consumer depends on that exact emission site before removing it

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §PROFILE-01, §PROFILE-02, §TRIGGER-02 — this phase's locked requirements
- `.planning/ROADMAP.md` §Phase 13 — goal, 3 testable success criteria, depends-on Phase 12

### Phase 12 Foundations (must reuse, not rebuild)
- `.planning/phases/12-graph-coherence-extended-triggers/12-CONTEXT.md` — full D-01–D-16 decisions this phase builds on: Skill abstraction (D-01–D-03), `TriggerGateNode` mechanism (D-04–D-07), `moderation_count` precedent explicitly meant to fold in here (D-16), deferred goal-elicitation question (D-10)
- `apps/api/src/graph/nodes/trigger-gate.ts` — `TriggerGateNode`; the new `phase-readiness` Skill is detected here alongside the existing 4 Phase 12 Skills, following D-05/D-06/D-07's established routing pattern
- `apps/api/src/lib/skills/` — existing Skill implementations (`drift-redirect`, `moderation`, `orphan-edge`, `fact-check`) — `phase-readiness` follows the same `{ id, detect(context), buildPromptGuidance(context) }` contract
- `apps/api/src/lib/bot-arbitrator.ts` — `registerBot()`/`runArbitration()`; unchanged mechanism, Coach's scorer needs to account for `phase-readiness` firing alongside its other Skills
- `apps/api/src/lib/moderation-count.ts` — `getModerationCount`/`incrementModerationCount`; repointed at the new profile table per D-02
- `apps/api/src/lib/skills/moderation.ts:116,121` — reads `participantId` from `config.configurable.participantId`; same injection pattern `ProfileBuilderNode` and the `phase-readiness` Skill should follow
- `supabase/migrations/0015_graph_coherence_triggers.sql` — `moderation_counts` table + RLS + `increment_moderation_count` RPC; direct template for the new `participant_profiles` migration (D-01/D-02)

### LangGraph Graph Structure (existing — extend, do not duplicate)
- `apps/api/src/graph/graph.ts` — `createGraph()` factory; this phase adds `ProfileBuilderNode` after `ArgGraphBuilderNode` (D-03)
- `apps/api/src/graph/nodes/arg-graph-builder.ts` (lines ~282-349) — `ArgGraphBuilderNode`; `mergeArgNodes`, `substituteRefs`; `ProfileBuilderNode` consumes `state.argGraph` output from this node
- `apps/api/src/graph/state.ts` (lines 16-154) — `GraphStateAnnotation`; already has `phase_signal` (lines 82-85), `argGraph`, `triggerMetadata`, `triggerType`, `firingSkillId`, `firingSkillRole`, `skillMeta` — no new top-level state fields expected beyond what `phase-readiness` needs to pass through the existing Skill metadata fields
- `apps/api/src/graph/nodes/agent.ts` (lines 150-181) — the CURRENT ad-hoc `phase_signal` emission path, to be deprecated/removed per D-08
- `apps/api/src/lib/model-config.ts` — `TASK_MODELS`; `phase-readiness`'s coverage judgment uses the `analysis` task type (capable tier, COST-01) — already exists, no new task type needed

### Human Consensus Pattern Plumbing (existing — reuse as-is, do not rebuild)
- `packages/types/src/canvas-tool.ts:72-77` — `phase_signal` boolean field on the canvas tool schema
- `apps/api/src/routes/ai.ts:465-482` — SSE `phase_signal` event emission with `next_phase_id`
- `apps/web/hooks/use-ai-stream.ts:113-114,251-259` — consumes the SSE event, sets `phaseSignal`/`pendingPhaseId`
- `apps/web/components/workspace/CreatorControls.tsx:199-294` — `AdvancePhaseButton`, enabled only when `phaseSignal && pendingPhaseId != null`
- `apps/api/src/routes/sessions.ts:407-430` — `PATCH /:id/phase`; requires auth + creator check, writes `current_phase`, broadcasts `phase_advanced`
- `supabase/migrations/0009_sessions_current_phase.sql:24-25` — `sessions.current_phase` column (human-writable only — invariant unchanged: LLM never writes this directly)

### Canvas / Graph Data Model (existing — extend, do not duplicate)
- `packages/types/src/bot.ts:18-25,33-38,47-52` — `ArgNode` (`speaker: string`, `message_id`), `ArgEdge`, `state.argGraph` shape (`{ nodes, edges }`)
- `packages/types/src/message.ts:10-25` — `MessageSchema`; `author_id: z.string().uuid()`, `display_name: z.string()` — the stable identity `ProfileBuilderNode` resolves `speaker` against
- `packages/types/src/blueprint.ts:37-44` — `PhaseSequenceSchema { id, label, llm_instructions, allowed_node_types }`; coverage judgment reads `llm_instructions` per D-07; new gate config field (D-09) added here or as a Blueprint-level sibling
- `packages/types/src/blueprint.ts:76-82` — `bot_defaults`, `role_personalities`, `bot_cooldowns` — the `z.record(roleId, ...)` shape precedent the new phase-readiness gate config should likely follow

### Shared Context-Building
- `apps/api/src/lib/bot-context.ts` — `summarizeArgGraph()` + `escapeUntrustedText()`; this phase adds a sibling `summarizeParticipant()` per D-11, following the same escaping discipline for user-controlled content (per 11-REVIEW-FIX.md WR-06's `<<<ARGUMENT_GRAPH_DATA>>>` delimiter pattern)

### DB Migration Precedent
- `supabase/migrations/0015_graph_coherence_triggers.sql` — most recent migration (Phase 12); this phase's `participant_profiles` table (D-01/D-02) and Blueprint gate-config field (D-09) get the next sequential migration number

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `summarizeArgGraph()` + `escapeUntrustedText()` (`apps/api/src/lib/bot-context.ts`) — direct template for the new `summarizeParticipant()` (D-11)
- `mergeArgNodes`/`substituteRefs` (`apps/api/src/graph/nodes/arg-graph-builder.ts`) — `ProfileBuilderNode` reads this node's merged output, doesn't duplicate its extraction logic
- `getModerationCount`/`incrementModerationCount` (`apps/api/src/lib/moderation-count.ts`) — repointed at new table, same function signatures likely reusable
- `TASK_MODELS` `analysis` task type (`apps/api/src/lib/model-config.ts`) — phase-readiness judgment call uses this, already exists
- Existing `phase_signal` → SSE → UI → PATCH plumbing (see Human Consensus Pattern Plumbing above) — reused wholesale, only the *source* of `phase_signal` changes

### Established Patterns
- `[nodename]` console logging prefix, fail-open/fail-silent error handling (never throw from a graph node) — `ProfileBuilderNode` and the `phase-readiness` Skill follow this
- Skill `{ id, detect(context), buildPromptGuidance(context) }` contract (Phase 12) — `phase-readiness` is a new instance of this, not a new shape
- `config.configurable` seam for test injection (`agentAdapter`, `classifierAdapter`, `participantId`) — `ProfileBuilderNode` and `summarizeParticipant()` should accept an equivalent injectable context
- Zod schema + inferred type co-located in `packages/types/src/*.ts` — any new profile/gate-config types follow this
- Explicit boolean/map fields on Blueprint (`bot_defaults`, `bot_cooldowns`) rather than overloading existing fields — the new phase-readiness gate config follows this (D-09)

### Integration Points
- `apps/api/src/graph/graph.ts` — new `ProfileBuilderNode` in the topology (after `ArgGraphBuilderNode`) is this phase's structural change, lower risk than Phase 11/12's conditional-routing changes since it's a straight-line addition, not a new branch
- `apps/api/src/graph/nodes/trigger-gate.ts` — `phase-readiness` Skill registration point
- `apps/api/src/graph/nodes/agent.ts:150-181` — removal site for the deprecated ad-hoc `phase_signal` emission (D-08) — verify no other caller depends on this exact code path first
- `supabase/migrations/` — new migration for `participant_profiles` + Blueprint gate-config field

</code_context>

<specifics>
## Specific Ideas

- User's correction that reframed the phase-readiness area entirely: "The blueprint will be a general way of describing how the session can and should operate, but it will not dictate what topics will be covered." — this is why D-07 uses `llm_instructions` for a holistic LLM judgment rather than a fixed topic checklist.
- User's reasoning for the sequential N-then-M gate (D-09): "after adding N nodes, the conversation might not evolve... the check to move phases must also take into account some of the last messages, not just the nodes of the graph" — directly produced D-09 and D-10 (raw messages included in the judgment context, not just the argGraph summary).
- User's framing on identity (D-04): distinguishing registered users (who should eventually get cross-session continuity, v4.0) from non-registered/guest users (session-scoped only) — both use `author_id` as the key in v3.0, but the distinction matters for future MEM-01/MEM-02 work.

</specifics>

<deferred>
## Deferred Ideas

- **Session-specific stated-goal elicitation** — agents proactively asking the group to state their goal (timing varies by Blueprint type: upfront for coaching, reactive-after-N-messages for debate, unneeded for others). Still unscoped after being deferred from Phase 12 (12-CONTEXT.md D-10) into Phase 13's discussion — remains an open question for a future phase; Phase 13's phase-readiness check judges against the Blueprint phase's generic `llm_instructions` instead.
- **v4.0 MEM-01/MEM-02** — cross-session profile continuity for registered users. `author_id`-keyed storage in v3.0 is deliberately compatible with this later, but persistence across sessions (and retrieval at session start) is out of scope now.
- Full TriggerEngine generalization (all 6 triggers under one persistent scan-loop mechanism) — Phase 14, TRIGGER-07.

### Reviewed Todos (not folded)
None — no pending todos matched this phase (`todo.match-phase` returned 0 matches for 1 total todo in the system).

</deferred>

---

*Phase: 13-User Profiles + Phase Signal*
*Context gathered: 2026-07-16*
