# Phase 14: Polish + TriggerEngine Wiring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-17
**Phase:** 14-Polish + TriggerEngine Wiring
**Areas discussed:** Speech artifact filtering, TriggerEngine dispatch design, Persona re-anchor behavior, Cost attribution tagging scope

---

## Speech Artifact Filtering

| Option | Description | Selected |
|--------|-------------|----------|
| Curated exact-string list | Small, explicit blocklist, zero false positives | ✓ |
| Bracket-pattern regex | Catches unnamed future variants, risks false positives | |

**User's choice:** Curated exact-string list.
**Notes:** User pointed out a genuinely new artifact string needs a code update either way ("if we add a new artifact we would need to do a code update anyway?"), so the simpler exact-match approach was preferred.

| Option | Description | Selected |
|--------|-------------|----------|
| Change the fallback text | Replace `ai.ts:469`'s `'[canvas updated]'` with neutral text | |
| Exempt this exact path | Keep the string, special-case the frontend filter | |
| You decide | — | |

**User's choice:** Neither — redirected to a UI redesign instead ("change the buble in the UI to something else... use a little icon... We should not use a buble as that's reserved for text").
**Notes:** Follow-up question clarified whether this meant an in-chat icon or zero chat-stream presence. User chose zero presence, deferring the icon idea: "OK, no chat presence at all for the time being. We can always add an icon later if needed."

| Option | Description | Selected |
|--------|-------------|----------|
| Prompt + frontend only | SPEECH-01 (LLM discipline) + SPEECH-02 (frontend filter) | ✓ |
| Add backend filter too | Third layer at the API write path | |

**User's choice:** Prompt + frontend only (Recommended).

---

## TriggerEngine Dispatch Design

**Initial framing (asked, then corrected via user clarification):** "Should the TriggerEngine call graph.invoke() twice per branch per tick (silence + analysis_request paths) or once (unified routing)?" — User didn't understand the question; asked for clarification twice.

**Clarifying exchange:**
- User: "Can you please explain this to me better? I don't understand." → Claude re-explained in plain language (cost vs. routing-risk tradeoff).
- User: "Why do we need to run all the conditions on a timer? 15 seconds is too little, I would change it to 1 min or so. How long does it take for the session to auto freeze?" → Claude checked `auto-freeze.ts` and found the real 15-minute/30s-grace mechanism is unrelated to trigger polling, then corrected the framing: only the silence trigger genuinely needs a timer; the other 5 already fire reactively via `TriggerGateNode`.
- User: "the phase readiness might be a consequence of the silence... suggesting to move on might be something we can do in certain blueprints, like coaching in the GROW in the O (options)... I would reduce it from 15 mins to 5 mins [auto-freeze], so there are only roughly 5 silences allowed if the creator is not available. I want to ensure we are not spending creator's money if he/she is not in the chat."

**Outcome (superseding the original two-vs-one framing):**
- TriggerEngine timer only re-evaluates silence.
- Silence firing considers phase-readiness as a secondary signal, for Blueprints that opt in.
- Scan interval: ~1 minute.
- Auto-freeze timeout: 900,000ms → 300,000ms (15min → 5min).

| Option | Description | Selected |
|--------|-------------|----------|
| Blueprint-configurable | Silence↔phase-readiness coupling opt-in per Blueprint | ✓ |
| Always check both | Every Blueprint always couples them | |
| You decide | — | |

**User's choice:** Blueprint-configurable (Recommended).

---

## Persona Re-Anchor Behavior

**Initial questions rejected** — user asked for clarification: "Sorry I don't understand - what is this about? what is what we want to do every 15 messages? I think it is important to compact the chat history..."

**Clarifying exchange:**
- Claude distinguished PERSONA-04 (behavioral/discipline consistency) from chat history compaction (already tracked as v2.1 `ORCH-06`, not this phase's scope).
- User: "do you think this re-anchor is necessary? I wouldn't think this would happen if the personality is there in the prompt somewhere?" → Claude gave an honest technical assessment: plausible (LLM "lost in the middle" effect in long contexts) but unconfirmed in this codebase; recommended the cheap version as low-cost insurance given it's a locked, tested requirement.
- User: "proceed with the cheap version."

| Option | Description | Selected |
|--------|-------------|----------|
| Stronger prompt reminder | Extra-emphasized discipline reminder near generation point, no extra LLM call | ✓ |
| Self-check + regenerate pass | Validate output, regenerate on failure | |
| Both | | |

**User's choice:** Stronger prompt reminder only (cheap version).

| Option | Description | Selected |
|--------|-------------|----------|
| Per-role, per-branch | Coach and Analyst each get their own 15-invocation counter | ✓ |
| Shared per-branch counter | One counter for any bot invocation | |
| You decide | — | |

**User's choice:** Per-role, per-branch (Recommended).

---

## Cost Attribution Tagging Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Tag all calls | Every LLM call gets trigger + tier tags, including human-reactive | ✓ |
| Proactive-only tagging | Only trigger-driven calls get tagged | |
| You decide | — | |

**User's choice:** Tag all calls, plus: "if possible try to infer the cost... please investigate how we can do it so the actual cost shows in Langfuse... We also need to tag with the environment (development, production). Please investigate all we can trace in Langfuse (usage_details)."

**Notes:** Claude ran a web search on Langfuse's LangChain/LangGraph integration and cost-tracking docs. Findings: cost is auto-computed per-generation from model name + token usage for Anthropic/OpenAI models, but requires the call to go through a LangChain-recognized model wrapper — this project's custom multi-provider adapter (`TASK_MODELS`/`adapter-factory.ts`) may not surface that automatically, flagged as an explicit research question (D-14 in CONTEXT.md) rather than resolved here. Langfuse also has a native `environment` field (distinct from tags) worth using for dev/prod. User confirmed: "Yes, lock it in."

---

## Claude's Discretion

- Exact curated blocklist string contents beyond the 3 ROADMAP examples
- Exact field name/shape for the per-role-per-branch re-anchor counter in LangGraph thread state
- Exact wording/positioning of the re-anchor prompt reinforcement text
- Exact Blueprint field name/shape for the silence↔phase-readiness coupling toggle
- Exact mechanism for removing the `ai.ts:469` fallback so canvas-only turns produce zero chat-stream presence
- Exact trigger-type tag values and every call site needing the new `CallbackHandler` tagging

## Deferred Ideas

- Chat history compaction/summarization — already tracked as v2.1 `ORCH-06`, not pulled into Phase 14
- A small chat-stream icon/indicator for canvas-only bot activity — proposed, then explicitly deferred by the user
- Self-check/regenerate validation pass for persona re-anchor — rejected for now, could be revisited if the 100-turn synthetic session reveals real drift
- `.planning/todos/pending/define-bot-toolset-spec.md` — reviewed, not folded (unrelated future tool-calling capability)
