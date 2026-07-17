# Phase 14: Polish + TriggerEngine Wiring - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Generalize the interim silence-scan loop (built in Phase 11) into a persistent TriggerEngine on the standalone Node.js server (`server.ts`). During discussion this was refined significantly from the literal ROADMAP/REQUIREMENTS wording: the TriggerEngine's timer only needs to re-evaluate the **silence-window** trigger — the other 5 trigger types (drift, orphan-edge, fact-check, moderation, phase-readiness) already fire correctly today, synchronously, the instant a human message arrives via `TriggerGateNode`. They do not need periodic re-evaluation to work; TRIGGER-07's "evaluates all 6 trigger conditions" is satisfied by 5 of them already being reactively wired (confirmed complete in Phases 12-13) plus the TriggerEngine adding genuine timer-based coverage for the one condition that's fundamentally about *absence* of activity (silence).

Additionally: silence-firing is coupled to phase-readiness for Blueprints that opt in (e.g. GROW coaching's "Options" phase) — when nobody's adding anything, that can mean "redirect" or "suggest advancing," and the Coach should be able to choose based on which signal is stronger. Persona consistency gets a lightweight periodic re-anchor (prompt reinforcement only, per-role-per-branch, every 15 invocations). Bot speech gets audited/filtered for system artifacts, with UI handling for canvas-only bot turns redesigned (no chat-bubble presence at all, matching SPEECH-03). Langfuse gets cost-attribution tagging across ALL LLM calls (not just proactive ones), plus an investigation into why/whether cost inference works given this project's custom multi-provider adapter layer.

**What this phase does NOT include:**
- A periodic re-check of drift/orphan-edge/fact-check/moderation — they remain purely event-driven (fire on human message arrival via `TriggerGateNode`), unchanged from Phases 12-13. No "second graph path" polling for these.
- Chat history compaction/summarization ("skip the hello-how-are-you noise") — already tracked as v2.1's `ORCH-06` (`Prompt caching + LangGraph state compression`) in REQUIREMENTS.md. Raised during this discussion but explicitly NOT pulled into Phase 14 — it's a context-size/cost concern, distinct from PERSONA-04's behavioral-consistency concern.
- A self-check/regenerate LLM pass for persona re-anchor — considered and explicitly rejected as solving an unconfirmed problem (no evidence of actual persona drift in this codebase yet) at real ongoing cost. Only the free prompt-reinforcement version is in scope.
- A visible chat-stream icon/indicator for canvas-only bot turns — considered and explicitly deferred; these turns get zero chat-stream presence for now (icon idea can be revisited later if needed).
- A creator-facing UI for adjusting re-anchor frequency, blocklist patterns, or scan interval — no new settings surface implied by this phase's requirements.

</domain>

<decisions>
## Implementation Decisions

### TriggerEngine Architecture (core structural change this phase)

- **D-01:** The TriggerEngine's `setInterval` scan loop only needs to re-evaluate the **silence-window** trigger on a timer. The other 5 trigger types are already correctly wired as event-driven Skills via `TriggerGateNode` (Phases 12-13) and fire the instant a human message arrives — they require no periodic re-check. This significantly narrows TRIGGER-07's implementation: the TriggerEngine generalizes/replaces the Phase 11 interim silence-scan loop, it does not need to additionally invoke `graph.invoke({triggerType:'analysis_request'})` on a timer for the other 5.
- **D-02:** Scan interval is **~1 minute** (up from the Phase 11 interim loop's 15s default) — chosen independently of any other timing concern. Explicitly confirmed as decoupled from session auto-freeze timing (see D-05).
- **D-03:** When silence fires, and for Blueprints that opt in (D-04), the engine also considers **phase-readiness** as an alternative or additional signal — "nobody's adding anything" can mean "redirect the conversation" (today's content-aware question, Phase 11 D-13/D-14) or "suggest advancing to the next phase" (e.g. GROW coaching's "Options" stage), and the Coach should weigh both when deciding what to say.
- **D-04:** The silence↔phase-readiness coupling is **Blueprint-configurable**, not universal — follows the existing `drift_detection_enabled`-style explicit-toggle pattern (12-CONTEXT.md D-09) rather than forcing every Blueprint to consider phase-readiness on every silence fire.

### Auto-Freeze Timeout (cost-control, adjacent to TriggerEngine's new proactive spend)

- **D-05:** `AUTO_FREEZE_AFTER_MS` (currently 900,000ms / 15 minutes, in `apps/api/src/lib/auto-freeze.ts`) is reduced to **5 minutes**. Explicit cost-control decision: since the TriggerEngine will now fire proactive (and billable) bot messages automatically on a ~1-minute cadence, an absent creator should only accumulate roughly 5 silence-triggered bot messages' worth of spend before the session freezes, not ~20. The existing 30-second grace period (`AUTO_FREEZE_GRACE_MS`) is unchanged.

### Persona Re-Anchor (PERSONA-04)

- **D-06:** Re-anchor is scoped to the **cheap version only**: on the 15th bot invocation (per role, per branch — see D-07), append an extra-emphasized reminder of the Role's discipline rules positioned close to the generation point in the prompt (a "recency boost" against the documented LLM "lost in the middle" effect in long multi-turn contexts). **No self-check/regenerate LLM call** — that option was explicitly considered and rejected: it would add a real ongoing cost to defend against a phenomenon that hasn't actually been observed in this codebase (no 100-turn session has been run yet to confirm drift occurs). This mechanism remains a locked requirement with its own testable ROADMAP.md success criterion regardless of whether real drift is later confirmed — dropping it entirely would be a roadmap-level scope conversation, out of bounds for this phase discussion.
- **D-07:** The 15-invocation counter is **per role, per branch** — Coach and Analyst each get their own independent count within a branch. Matches the existing `bot_cooldowns` `Record<roleId, {...}>` scoping precedent (11-CONTEXT.md D-11) rather than one shared branch-wide counter (which would let a chatty Coach consume count that was meant to also protect Analyst discipline).
- **Inherited constraint (not re-litigated):** the counter must persist in LangGraph `PostgresSaver` thread state, not JS process memory — this follows directly from the project's standing architectural rule (BOT-05, reaffirmed every phase since Phase 10) and the `moderation_count`/`participant_profiles` precedent (12-CONTEXT.md D-16, 13-CONTEXT.md D-01/D-02). No new discussion needed; Claude's discretion on exact field shape/location within thread state.

### Speech Artifact Filtering (SPEECH-01/02/03)

- **D-08:** The blocklist is a **curated exact-string list** (not a bracket-pattern regex) — user's own reasoning: a genuinely new artifact string would require a code update regardless of which approach is chosen, so the simpler, zero-false-positive exact-match list is preferred. Exact list contents are Claude's discretion (the 3 ROADMAP examples plus any others discovered during implementation/audit).
- **D-09:** Filtering is **two layers only**: SPEECH-01 (LLM prompt discipline — never emit artifact strings) + SPEECH-02 (frontend defense-in-depth filter). **No third backend/API-level filtering layer** — explicitly decided as unnecessary scope; matches the requirements as literally written.
- **D-10:** The existing collision at `apps/api/src/routes/ai.ts:469` — where `'[canvas updated]'` is used as fallback message text when a mutation produces zero streamed content (to satisfy a `messages_content_check` DB constraint) — is resolved by **redesigning the UI for canvas-only bot turns entirely**, not by picking different fallback text. See D-11.
- **D-11:** Bot turns that result in **only a canvas mutation with no real chat text** — whether from the `ai.ts:469` fallback path or from SPEECH-02's filter reducing content to empty — get **zero chat-stream presence**. No message bubble, no icon, no row of any kind. This matches SPEECH-03's literal wording ("communicated exclusively through the canvas UI... never through chat text") taken to its logical conclusion: not just "never through chat *text*" but never through the chat stream at all for these turns. Confirmation lives 100% on the canvas (ghost→committed animation, node count badge). A future chat-stream icon/indicator for these turns was explicitly proposed and deferred (see `<deferred>`).

### Cost Attribution Tagging (COST-03)

- **D-12:** **Every** LLM call gets tagged — not just proactive/trigger-driven ones. Ordinary human-reactive messages get tagged too (e.g. `trigger:none` or `trigger:human-reactive`), so proactive vs. reactive cost can be compared in the same Langfuse view, not just proactive costs viewed in isolation.
- **D-13:** Tags include, at minimum: **trigger type** (silence_gate / drift-redirect / moderation / orphan-edge / fact-check / phase-readiness / human-reactive) and **model tier** (fast/capable). Use Langfuse's **native `environment` field** (a first-class concept in recent Langfuse SDK versions, distinct from free-text tags) for dev/production, rather than encoding environment as another tag string — confirm the installed SDK version supports this during research.
- **D-14 (flagged for research, not resolved here):** Whether Langfuse's automatic per-generation cost inference (computed from model name + token usage, natively supported for Anthropic/OpenAI models) actually works in this codebase is **unconfirmed and must be verified** — this project routes LLM calls through a custom multi-provider adapter (`TASK_MODELS`/`adapter-factory.ts`, per CLAUDE.md) rather than LangChain's native `ChatAnthropic` wrapper class. If the adapter doesn't surface model name + token usage in a way LangChain's Langfuse `CallbackHandler` recognizes, cost may not auto-populate and additional manual instrumentation (constructing a Generation observation with explicit `usage_details`) may be required. The researcher must check this concretely before planning assumes automatic cost inference "just works."
- **Inherited fix (already known, not re-discussed):** today only the human `/invoke` route constructs a `CallbackHandler` (tagged session/branch only, `apps/api/src/routes/ai.ts:367-369`); the proactive silence-scan path (`silence-scan.ts`) passes no `callbacks` at all to `graph.invoke()`, so proactive fires currently aren't traced in Langfuse whatsoever. This gap must be closed as part of D-12/D-13 — every `graph.invoke()` call site (human path and the new TriggerEngine path) needs its own per-request `CallbackHandler` with the new tags, following the existing per-request-not-module-level construction pattern (11-CONTEXT.md/12-CONTEXT.md "Module-level Langfuse singleton" out-of-scope precedent).

### Claude's Discretion

- Exact curated blocklist string contents beyond the 3 named in ROADMAP.md (`[canvas updated]`, `[graph modified]`, `[node added]`)
- Exact field name/shape for the per-role-per-branch re-anchor invocation counter within LangGraph thread state
- Exact wording/positioning of the re-anchor prompt reinforcement text
- Exact Blueprint field name/shape for the silence↔phase-readiness coupling toggle (D-04), following the `drift_detection_enabled` precedent
- Exact mechanism for removing/replacing the `ai.ts:469` `'[canvas updated]'` fallback logic so canvas-only turns produce zero chat-stream presence (D-11) — likely means the message write path itself needs to signal "no chat row" rather than writing a placeholder string, verify no other consumer depends on a non-empty `messages.content` for these rows
- Exact set of trigger-type tag values and where in the codebase each `graph.invoke()`/LLM call site needs the new `CallbackHandler` tagging wired in

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §PERSONA-04, §TRIGGER-07, §COST-03, §SPEECH-01–03 — this phase's locked requirements
- `.planning/REQUIREMENTS.md` §ORCH-06 (v2.1 Deferred) — chat history compaction, explicitly NOT this phase's scope (see `<deferred>`)
- `.planning/ROADMAP.md` §Phase 14 (lines 362-376) — goal, 5 testable success criteria, depends-on Phase 13

### Phase 11-13 Foundations (must reuse, not rebuild)
- `.planning/phases/11-personality-basic-triggers/11-CONTEXT.md` — D-15/D-16: the interim silence-scan loop this phase generalizes; D-13/D-14: content-aware silence question context-building, reused as-is for the redirect branch of D-03
- `.planning/phases/12-graph-coherence-extended-triggers/12-CONTEXT.md` — D-01–D-07: Skill abstraction + `TriggerGateNode` mechanism that already makes 5 of the 6 triggers reactive (this phase does not rebuild this); D-09: `drift_detection_enabled` explicit-toggle precedent for D-04's new Blueprint field
- `.planning/phases/13-user-profiles-phase-signal/13-CONTEXT.md` — D-08: `phase-readiness` Skill this phase's D-03 coupling reads from; D-12/D-13: the `config.configurable.branchId`/`supabase`/`botOverrides` reachability fixes already made in Phase 13 that the TriggerEngine's new invocation path depends on
- `apps/api/src/lib/silence-scan.ts` — `startSilenceScanLoop`/`scanBranch`; direct base this phase's TriggerEngine builds from (generalizes, not replaces from scratch)
- `apps/api/src/graph/nodes/trigger-gate.ts` — `TriggerGateNode`; confirmed already reachable via the human-message path and the (currently uncalled) `analysis_request` path — this phase does NOT need to add new callers of this path
- `apps/api/src/lib/skills/` — `silence-break.ts`, `moderation.ts`, `drift-redirect.ts`, `fact-check.ts`, `phase-readiness.ts`, `orphan-edge.ts` — existing Skill implementations; `phase-readiness.ts`'s `detect()` is what D-03's silence-coupling reads from
- `apps/api/src/lib/bot-arbitrator.ts`, `apps/api/src/lib/bot-budget.ts` — unchanged arbitration/budget mechanisms the TriggerEngine's silence path continues to use exactly as today

### Auto-Freeze (existing — adjust one constant, do not rebuild)
- `apps/api/src/lib/auto-freeze.ts` — `AUTO_FREEZE_AFTER_MS` (line 33, default 900000) changes to 300000 per D-05; `AUTO_FREEZE_GRACE_MS` unchanged

### Speech / Message Rendering (existing — extend, do not duplicate)
- `apps/api/src/routes/ai.ts:465-482` — SSE `phase_signal` emission; line 469 specifically is the `'[canvas updated]'` fallback text this phase's D-10/D-11 removes/redesigns
- `apps/web/components/workspace/MessageBubble.tsx` — renders `message.content` (lines ~246, ~282 per codebase scout); SPEECH-02's frontend filter and D-11's "zero presence for canvas-only turns" logic land here
- `apps/web/components/workspace/MessageList.tsx:65` — message list rendering; needs to handle "this row should not render at all" per D-11

### Langfuse / Cost Tracking (existing — extend, fix reachability gap)
- `apps/api/src/routes/ai.ts:367-369` — the ONLY current `CallbackHandler` construction site (`tags: [session:..., branch:...]`), no trigger/tier/environment tags today, no `metadata:` field used — direct template to extend per D-12/D-13
- `apps/api/src/lib/langfuse-otel.ts` — OTel bootstrap; check for any environment-configuration hooks already present
- `apps/api/src/lib/silence-scan.ts` — `graph.invoke()` call passes **no** `callbacks` today; the TriggerEngine's silence path must add a `CallbackHandler` here for the first time
- [Langfuse: Token & Cost Tracking docs](https://langfuse.com/docs/observability/features/token-and-cost-tracking) — cost is computed per-generation from model name + token usage, natively for Anthropic/OpenAI models, but requires the LLM call to go through a LangChain-recognized model wrapper (see D-14 research flag)
- [Langfuse: LangChain/LangGraph integration docs](https://langfuse.com/integrations/frameworks/langchain) — `CallbackHandler` → LangGraph node → generation hierarchy; confirm how `environment` and `tags` differ in the currently-installed SDK version

### Blueprint / Cooldown Precedent
- `packages/types/src/blueprint.ts:93-95` — `bot_cooldowns: z.record(z.string(), z.object({max, window_minutes})).optional()` — the `Record<roleId,...>` scoping pattern D-07's re-anchor counter and D-04's silence↔phase-readiness toggle both follow
- `packages/types/src/blueprint.ts` `drift_detection_enabled` field (12-CONTEXT.md D-09) — direct precedent for D-04's new Blueprint-configurable toggle

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `checkSilenceGate()`, `runArbitration()`, `checkBotBudget()` (Phase 10 primitives, called from `silence-scan.ts`) — unchanged, the generalized TriggerEngine's silence path continues to use these exactly as today
- `phaseReadinessSkill.detect()` (`apps/api/src/lib/skills/phase-readiness.ts`) — D-03's silence-coupling reads this Skill's detection logic rather than duplicating it
- The existing `bot_overrides ?? bot_defaults ?? false` per-role activation gate pattern (12-CONTEXT.md D-07) — applies to whether silence-coupling with phase-readiness is even relevant for a given session

### Established Patterns
- `[nodename]`/`[modulename]` console logging prefix, fail-open/fail-silent error handling — applies to TriggerEngine and any new re-anchor/tagging code
- Per-request (not module-level) `CallbackHandler` construction — every new `graph.invoke()` call site needing tracing must construct its own handler, matching the existing "Module-level Langfuse singleton" out-of-scope precedent
- Explicit Blueprint boolean/map fields (`bot_defaults`, `bot_cooldowns`, `drift_detection_enabled`) rather than overloading existing fields — D-04's new toggle follows this
- LangGraph `PostgresSaver` thread state for all bot-related counters/state, never JS process memory (BOT-05) — applies to D-07's re-anchor counter

### Integration Points
- `apps/api/src/server.ts` — TriggerEngine's `setInterval` registration point, replacing/generalizing the existing `startSilenceScanLoop()` call
- `apps/api/src/lib/auto-freeze.ts` — one-line constant change (D-05)
- `apps/api/src/routes/ai.ts` — the fallback-text removal (D-10) and the first `CallbackHandler` tag extension (D-12/D-13) both land here
- `apps/web/components/workspace/MessageBubble.tsx`, `MessageList.tsx` — SPEECH-02 filter + D-11 zero-presence logic

</code_context>

<specifics>
## Specific Ideas

- User's framing for the silence↔phase-readiness coupling: "the phase readiness might be a consequence of the silence... if no one else wants to add anything then it might be because we need to switch... suggesting to move on might be something we can do in certain blueprints, like coaching in the GROW in the O (options)." — directly produced D-03/D-04.
- User's cost-consciousness driving D-05: "I want to ensure we are not spending creator's money if he/she is not in the chat" — explicit rationale for cutting auto-freeze from 15 to 5 minutes once the TriggerEngine starts firing proactively on a timer.
- User's skepticism about re-anchor necessity ("I wouldn't think this would happen if the personality is there in the prompt somewhere?") led to an honest technical exchange about the LLM "lost in the middle" phenomenon and a deliberate choice to build only the cheap, low-risk version rather than assume drift is real.
- User's UI instinct on canvas-only bot turns: "change the buble in the UI to something else... use a little icon... We should not use a buble as that's reserved for text (messages)" — refined through follow-up into D-11's "zero chat-stream presence for now," with the icon idea explicitly deferred rather than dropped.
- User's request to "investigate how we can do it so the actual cost shows in Langfuse... please investigate all we can trace" — produced the web research behind D-14 and the environment-field finding in D-13.

</specifics>

<deferred>
## Deferred Ideas

- **Chat history compaction/summarization** — already tracked as v2.1's `ORCH-06` in REQUIREMENTS.md. User raised it while trying to understand PERSONA-04; confirmed as a distinct, already-scheduled concern, not pulled into Phase 14.
- **A small icon/indicator in the chat stream for canvas-only bot activity** — user explicitly proposed this, then deferred it in favor of zero chat-stream presence for now ("We can always add an icon later if needed").
- **Self-check/regenerate validation pass for persona re-anchor** — considered and rejected for this phase as solving an unconfirmed problem at real ongoing cost; could be revisited if the 100-turn synthetic session (this phase's own verification step) actually reveals drift.

### Reviewed Todos (not folded)
- `.planning/todos/pending/define-bot-toolset-spec.md` ("Define Bot Toolset Specifications and Interface Schemas") — scored a partial keyword match (0.6, "bot") against Phase 14 but covers an unrelated future capability (tool-calling: search_web, generic_delay_scheduler, check_weather, image/YouTube tools). User confirmed leaving it out — belongs in a future phase, not Phase 14's polish/TriggerEngine scope.

</deferred>

---

*Phase: 14-Polish + TriggerEngine Wiring*
*Context gathered: 2026-07-17*
