---
status: resolved
trigger: "Analyst persona ('analista') never produces Langfuse trace entries, even though it responds normally in the live chat. Only 'facilitation_coach'/'facilitation-coach' type entries appear. Split off from the langfuse-traces-missing-userid session (resolved) as a separate, independent issue per that session's blind-spot note: the Analyst's Langfuse call site (analytics-agent.ts) is structurally identical to the Coach's (facilitation-agent.ts) and would still emit a rootless/orphan trace even under the OTel context-propagation bug that session fixed — so this is not explained by that fix."
created: 2026-07-18T22:35:00Z
updated: 2026-07-19T10:00:00Z
symptoms_prefilled: true
goal: find_and_fix
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "Two unrelated 'Analyst' systems exist in this codebase. The one the user actually sees respond in chat is the legacy PERSONA_LIBRARY 'Analista Científico' persona (packages/types/src/persona.ts), toggled via session.active_personas and injected into AgentNode's (apps/api/src/graph/nodes/agent.ts) system prompt as activePersonaInstructions (ai.ts step 4, D-10). AgentNode is reached on every ordinary human /invoke turn (orchestrator -> agent -> mutationGate). The NEWER 'Analyst Role' (AnalyticsAgentNode / analytics-agent.ts, wrapped in streamWithGeneration under Generation name 'analytics-analyst') is a structurally different NSAI system, reachable ONLY via TriggerGateNode's ANALYST_SKILLS firing (fact-check/orphan-edge/phase-readiness) — never via the direct persona-toggle chat path. AgentNode calls adapter.stream() directly with a raw for-await loop and NEVER wraps it in streamWithGeneration (unlike facilitationAgentNode and analyticsAgentNode) — so no Langfuse Generation observation is ever created for the code path that actually produces the persona-labeled 'Analista Científico' chat replies the user is looking at. This explains why zero Analyst-tagged entries ever appear, while facilitation-coach entries do (Coach is properly wrapped) and why the user sees the Analyst 'respond normally in chat' despite zero traces — because the visible response comes from an entirely untraced node."
  confirming_evidence:
    - "apps/api/src/graph/nodes/agent.ts:140-177 (agentNode): calls `for await (const event of adapter.stream(...))` directly, manually forwarding text via config.configurable.streamWriter — no import of, or call to, streamWithGeneration anywhere in this file (confirmed via Read)."
    - "apps/api/src/graph/nodes/facilitation-agent.ts:206-219 and analytics-agent.ts:245-273 both wrap adapter.stream() in streamWithGeneration(..., { name: 'facilitation-coach' | 'analytics-analyst', ... }) — the only two Generation-name strings that could ever appear in Langfuse, and 'analytics-analyst' is only reachable via TriggerGateNode's Skill-firing path, not the direct chat path."
    - "apps/api/src/lib/langfuse-generation.ts doc comment (lines 1-27) explicitly states: 'Every LLM call in this codebase goes through AIProvider.stream(), never a LangChain BaseChatModel... Without this helper, the Langfuse dashboard shows correct trigger/tier tags but $0.00 cost for every generation' — i.e. streamWithGeneration is the ONLY mechanism that produces a Generation observation at all for this codebase's adapter pattern. AgentNode has none, so it produces zero observations, not even a $0.00 one, matching the user's report of it being completely absent."
    - "packages/types/src/persona.ts: PERSONA_LIBRARY has exactly one entry, id 'analista_cientifico', displayName 'Analista Científico' — this is what session.active_personas toggles and what ai.ts inserts as display_name for AgentNode's chat message (ai.ts line ~488: display_name: matchedPersonas[0]?.displayName ?? 'AI'). This is almost certainly what the user means by 'the Analyst responds normally in chat.'"
    - "apps/api/src/graph/graph.ts routeFromStart: the ONLY two triggerType branches that reach analyticsAgentNode/facilitationAgentNode directly from START are 'silence_gate' and 'analysis_request'. grep across apps/api/src confirms 'analysis_request' is never set as a graph.invoke() triggerType anywhere in production code (routes/*.ts, lib/trigger-engine.ts) — only 'silence_gate' is (trigger-engine.ts:316,544). trigger-engine.ts's scanBranch() also hardcodes `if (winner !== 'coach') return` (line 282) even though bot-registration.ts registers an analystScorer — by design (D-06 comments) the Analyst can only win arbitration via TriggerGateNode Skill context, which the silence-gate timer loop never sets. So analyticsAgentNode is reachable ONLY through a live ANALYST_SKILLS firing during a human turn — a narrow, conditional path — while AgentNode (untraced) runs on literally every human turn with the persona active."
  falsification_test: "If the user's Langfuse UI, filtered/sorted by full trace detail (not just the default list view), shows ANY observation named 'analytics-analyst' at all (even rare/sparse) correlated with a genuine ANALYST_SKILLS firing, that confirms analyticsAgentNode's own wiring is not itself broken — consistent with this hypothesis (analyticsAgentNode's tracing works when reached; it's just rarely/never reached, and is not what the user perceives as the chat-visible 'Analyst'). Conversely, if AgentNode is patched to call streamWithGeneration and NO new generation entries appear even though the Analista Científico persona keeps replying in chat, this hypothesis is refuted and the bug lies elsewhere (e.g. CallbackHandler/OTel export gap specific to this route)."
  fix_rationale: "The root cause is a missing instrumentation call, not a routing or context-propagation bug (this session's trigger note explicitly ruled out the OTel context bug already fixed for langfuse-traces-missing-userid). The minimal, idiomatic fix is to wrap AgentNode's adapter.stream() call in streamWithGeneration, exactly mirroring the existing pattern in facilitation-agent.ts and analytics-agent.ts (same onEvent tool_use handling shape as analytics-agent.ts, since AgentNode also uses canvasMutationTool). This makes AgentNode's LLM calls visible in Langfuse for the first time, closing the actual gap the user is observing, without altering routing/business logic."
  blind_spots: "(1) Have not yet visually confirmed in the live Langfuse UI that 'analytics-analyst' entries are truly nonexistent vs. just not shown in the default view the user pasted (the user's evidence excerpt was a short window, not exhaustive). (2) Switching AgentNode from its current early-return-on-first-tool-use for-loop to streamWithGeneration's full-drain-until-adapter-done iteration is a small behavioral change (previously the code `return`ed immediately after the first canvas_mutation tool_use event, potentially leaving the adapter's underlying stream not fully drained) — this should be safe/more correct (captures usage, matches analytics-agent.ts's already-proven pattern) but is technically a secondary behavior change beyond pure instrumentation, worth flagging in the fix summary. (3) Have not run the full agent.ts-related test suite yet to confirm no existing test asserts the early-return-on-tool_use timing/shape."
test: patch AgentNode to use streamWithGeneration (mirroring analytics-agent.ts's onEvent/tool_use pattern) with Generation name 'agent-canvas-mutation', then run the graph/agent test suites to confirm no regressions
expecting: agent.ts's LLM call now produces a named Langfuse Generation observation on every human turn where an active persona (e.g. Analista Científico) is toggled on, closing the observability gap; existing tests (graph.test.ts, graph.integration.test.ts) continue to pass since agentOutput/agentConfidence return shape is preserved
next_action: DONE — live Langfuse trace pasted by the user (2026-07-19) shows a real, non-$0.00 'agent-canvas-mutation' Generation (step 28, thread_id ':human', model gpt-5.4, $0.010078) confirming the instrumentation fix works end-to-end in production, not just self-verified via tests. Two follow-up concerns raised alongside this confirmation were investigated and resolved: (1) the trigger mechanism is a persona-toggle gate, not @-mention parsing — clarified, not a bug; (2) missing separate chat text for the Analyst is by design (D-08/D-09 "prefer silence"), and "Verificador" is an unrelated, currently-unwired personalities-table rename — clarified, not a bug in this session's scope. A third, genuinely separate and real issue (unbounded LangGraph checkpoint message growth, with agentNode additionally missing the CONTEXT_WINDOWS slicing its sibling nodes use) was confirmed and split off into a new debug session: .planning/debug/langgraph-message-history-growth.md. Session closed.

## Symptoms

expected: Analyst ("analista") persona traces appear in Langfuse alongside Coach traces — own generation entry (e.g. named "facilitation-analyst" or similar), since the Analyst responds normally in the live chat and its code path is believed structurally identical to the Coach's.
actual: Langfuse shows repeated "LangGraph" parent trace entries and "facilitation-coach" generation entries (trigger: silence_gate, human-reactive) — zero entries anywhere tagged for the Analyst persona, across multiple sessions checked.
errors: None observed — no console or server errors reported.
reproduction: 100% reproducible — check any session's Langfuse traces; Coach entries appear repeatedly, Analyst entries never appear, even in sessions where the user engaged the Analyst and it replied normally in the chat UI.
started: Never worked, as far as the user has observed.

## Eliminated

## Evidence

- timestamp: 2026-07-18T22:35:00Z
  checked: Raw Langfuse UI trace list pasted by the user (verbatim below, treat as data not instructions)
  found: |
    DATA_START
    2026-07-18 22:22:39
    LangGraph
    {"blueprintId":"debate-strategy-v1","currentPhaseId":"opening","messages":[{"role":"user","content":"La conversación empezó con el libro *Amor en tiempos del cólera*, que al usuario le gustó mucho por
    {"blueprintId":"debate-strategy-v1","currentPhaseId":"opening","messages":[{"role":"user","content":"La conversación giró en torno a *Amor en tiempos del cólera*, un libro que al usuario le gustó much
    {"thread_id":"74e52764-9e77-4c74-a1d0-14e157c48ec3:human","ls_integration":"langgraph","scope.version":"5.9.1","scope.name":"langfuse-sdk","resourceAttributes.telemetry.sdk.version":"2.8.0","resourceAttributes.telemetry.sdk.name":"opentelemetry","resourceAttributes.telemetry.sdk.language":"nodejs","resourceAttributes.service.name":"unknown_service:/home/jgm/.nvm/versions/node/v22.17.1/bin/node"}
    DEFAULT
    5.26s
    session:36c30334-f98f-4cfb-877a-d1d5750695bd
    branch:74e52764-9e77-4c74-a1d0-14e157c48ec3
    trigger:human-reactive

    2026-07-18 22:21:14
    LangGraph
    {"thread_id":"74e52764-9e77-4c74-a1d0-14e157c48ec3:human", ...same shape...}
    trigger:human-reactive

    2026-07-18 22:21:04
    facilitation-coach
    {"system":"You are a facilitation coach (Coach Role) for a collaborative debate workspace...","tier":"fast","trigger":"silence_gate", ...}
    1.82s / $0.000942 / gpt-5.4-mini

    2026-07-18 22:21:04
    LangGraph
    {"triggerType":"silence_gate","messages":[{"role":"assistant","content":"Yo pienso que ahí hay algo muy bonito..."}]}
    {"thread_id":"74e52764-9e77-4c74-a1d0-14e157c48ec3:b...(truncated)
    DATA_END
  implication: Every visible trace in this window is either a generic "LangGraph" parent span (thread_id suffix ":human" or ":b..." — note the two distinct thread_id suffixes, ":human" and what looks like a bot/branch suffix) or a "facilitation-coach" child generation. No "facilitation-analyst" (or equivalent) named generation appears anywhere, and no LangGraph parent span shows an analysis_request/analytics triggerType in this excerpt. Worth checking: (1) does AnalyticsAgentNode use a different/missing Langfuse generation name that might be filtered out of this default view, (2) does the graph ever actually route to AnalyticsAgentNode at runtime, or (3) is the Analyst's chat reply coming from a code path that was never wired to emit a Langfuse generation at all.

- timestamp: 2026-07-18T23:05:00Z
  checked: apps/api/src/graph/nodes/analytics-agent.ts and facilitation-agent.ts side by side (full read)
  found: |
    Both nodes are structurally near-identical and BOTH correctly wrap their adapter.stream() call
    in streamWithGeneration (lib/langfuse-generation.ts): facilitationAgentNode uses
    name: 'facilitation-coach'; analyticsAgentNode uses name: 'analytics-analyst'. Both are properly
    instrumented. This rules out a wiring bug specific to analytics-agent.ts's own Langfuse call —
    if analyticsAgentNode ever actually runs, it WILL produce a Langfuse generation.
  implication: The instrumentation itself is not the problem for analyticsAgentNode. The problem must
    be either (a) analyticsAgentNode is never/rarely actually invoked at runtime, or (b) what the user
    perceives as "the Analyst" in chat is a different code path entirely that lacks this wrap.

- timestamp: 2026-07-18T23:10:00Z
  checked: apps/api/src/graph/graph.ts (routeFromStart, routeAfterTriggerGate, createGraph edges) — full read
  found: |
    analyticsAgentNode ('analysis' node) is reachable via exactly two paths: (1) START with
    triggerType === 'analysis_request' (routeFromStart), or (2) triggerGate -> routeAfterTriggerGate
    when state.firingSkillRole === 'analyst' (set only when an ANALYST_SKILLS Skill's detect() fires
    inside TriggerGateNode). There is no third path. The ordinary human-message path
    (triggerType null/undefined) goes orchestrator -> agent -> mutationGate -> argGraphBuilder ->
    profileBuilder -> triggerGate, and ONLY reaches analyticsAgentNode if a Skill fires there.
  implication: analyticsAgentNode is a narrow, conditional path (only reachable via genuine
    fact-check/orphan-edge/phase-readiness Skill firings), never a direct consequence of a user
    simply chatting with an "Analyst" persona toggled on.

- timestamp: 2026-07-18T23:15:00Z
  checked: grep for 'analysis_request' and 'triggerType' across apps/api/src/routes/*.ts and lib/*.ts (excluding tests); read apps/api/src/lib/trigger-engine.ts in full
  found: |
    'analysis_request' is NEVER set as a graph.invoke() triggerType anywhere in production code —
    only 'silence_gate' is (trigger-engine.ts lines 316, 544). trigger-engine.ts's scanBranch()
    additionally hardcodes `if (winner !== 'coach') return` (line 282) even though
    bot-registration.ts registers both 'coach' and 'analyst' scorers — by explicit design (D-06
    doc comments), the Analyst can only outscore the Coach in arbitration when
    ArbContext.firingSkillRole === 'analyst', which the silence-gate timer loop never sets.
  implication: The 'analysis_request' triggerType branch in routeFromStart is effectively dead code
    in production — never invoked. analyticsAgentNode's ONLY live path is the triggerGate/Skill-firing
    route, confirming it is a narrow, conditional path, not something exercised by ordinary chat use.

- timestamp: 2026-07-18T23:20:00Z
  checked: apps/api/src/routes/ai.ts (full read) and packages/types/src/persona.ts
  found: |
    ai.ts's /invoke route (the ONLY route that handles a normal human chat message) resolves
    `session.active_personas` against `PERSONA_LIBRARY` (persona.ts) — which has exactly ONE entry:
    id 'analista_cientifico', displayName 'Analista Científico'. If matched, its
    systemPromptAddition is passed into config.configurable.activePersonas, which agentNode
    (agent.ts) splices into its own system prompt (D-10) and streams a response via
    config.configurable.streamWriter. The resulting chat message is inserted with
    `display_name: matchedPersonas[0]?.displayName ?? 'AI'` — i.e. "Analista Científico" — entirely
    via agentNode, NOT analyticsAgentNode. This is almost certainly the "Analyst" the user sees
    "respond normally in chat."
  implication: There are two unrelated "Analyst" concepts in this codebase — the legacy
    PERSONA_LIBRARY toggle (routed through agentNode) and the newer NSAI "Analyst Role"
    (analyticsAgentNode, routed through TriggerGateNode). The user-visible one goes through agentNode.

- timestamp: 2026-07-18T23:25:00Z
  checked: apps/api/src/graph/nodes/agent.ts (full read, lines 86-178) and apps/api/src/lib/langfuse-generation.ts doc comment
  found: |
    agentNode calls `for await (const event of adapter.stream(...))` directly and forwards
    text_delta events to config.configurable.streamWriter manually — it NEVER imports or calls
    streamWithGeneration, unlike facilitationAgentNode and analyticsAgentNode. langfuse-generation.ts's
    own doc comment confirms streamWithGeneration is the ONLY mechanism in this codebase that
    produces any Langfuse Generation observation for adapter.stream() calls (the LangChain
    CallbackHandler auto-instrumentation only fires for on_llm_start/on_llm_end events, which a
    plain async generator never emits). agentNode therefore produces ZERO Langfuse Generation
    observations for any of its LLM calls — not even a $0.00 placeholder.
  implication: ROOT CAUSE CONFIRMED. The code path that actually produces the user-visible
    "Analista Científico" chat replies (agentNode) has no Langfuse instrumentation at all, while
    the newer, differently-named "Analyst Role" (analyticsAgentNode) IS instrumented but is only
    reachable via a narrow Skill-firing path the user's ordinary chat interactions rarely/never hit.
    This fully explains the reported symptom without requiring any routing or OTel-context fix.

- timestamp: 2026-07-19T09:45:00Z
  checked: |
    Live Langfuse trace dump pasted by the user (2026-07-19, ~1 day after the fix was self-verified),
    apps/api/src/graph/nodes/agent.ts (patched version, re-read in full), apps/api/src/routes/ai.ts
    (full read, persona-resolution + graph.invoke config), packages/types/src/persona.ts.
  found: |
    (1) The `agent-canvas-mutation` Generation entry IS present in the live trace: step 28,
    thread_id `74e52764-...:human`, 09:30:55, model gpt-5.4, 1.29s, $0.010078 — a real, non-zero-cost
    Generation observation. This is live, production proof the streamWithGeneration wrap in agent.ts
    works end-to-end (not just self-verified via typecheck/tests).
    (2) The firing at 09:30:55 was NOT caused by an "@analista" mention. ai.ts's /invoke route
    (lines 155-161) has NO mention-parsing logic anywhere — it resolves `session.active_personas`
    (a DB column toggled via POST /api/sessions/:id/bots, unrelated to message text) against
    PERSONA_LIBRARY; if any persona is active, agentNode runs UNCONDITIONALLY on every human
    /invoke turn regardless of message content (409 no_active_persona is the only gate, and it's a
    toggle check, not a text-parse check). Confirmed via grep across apps/api/src for
    "mention"/"@analista"/"parseM" — zero mention-parsing hits anywhere in the codebase (the one
    "mention" hit, in drift-reply.ts, is an unrelated prompt instruction: "Do not mention that you
    are an AI assistant"). The trace's triggering message content at 09:30:54/55 (`__start__`,
    `orchestrator`) is about the book *Amor en tiempos del cólera* — no "@analista" substring. The
    literal "@analista" text instead appears later, in the `:bot` thread's `__start__` messages array
    at 09:31:55 (langgraph_step 40), attached to the silence_gate-triggered `facilitation` node turn —
    a completely different thread_id, different graph invocation, and different (Coach) code path.
    So "@analista" never actually reached or triggered agentNode/the Analyst in this trace at all;
    it happened to be typed by the user but was only ever seen (as plain text) by the Coach's
    silence-gate turn on the bot thread.
  implication: |
    The streamWithGeneration fix is CONFIRMED working via live evidence — this closes the original
    bug (agentNode had zero Langfuse instrumentation). However, the user's mental model that
    "@analista" is a targeted mention-trigger is incorrect: this codebase has no mention-parsing
    mechanism at all. agentNode/Analista Científico fires on literally every human turn once the
    persona toggle is on, independent of message content. Documenting this precisely rather than
    silently agreeing with the user's assumption.

- timestamp: 2026-07-19T09:50:00Z
  checked: |
    apps/api/src/graph/nodes/agent.ts (buildAgentSystemPrompt D-08/D-09 rules), apps/api/src/routes/ai.ts
    (lines 482-512, accumulatedText/message-insert gate), packages/types/src/persona.ts (full),
    git log -S"Verificador"/-S"analyst_default" (commits 52f686c, 2d3583d, 7355868 — all
    2026-07-18), apps/api/src/lib/trigger-engine.ts (resolveCoachPersonality, lines 589-606),
    apps/api/src/graph/nodes/analytics-agent.ts (personality param source, lines 150/223).
  found: |
    (1) buildAgentSystemPrompt's D-08/D-09 rules explicitly instruct the model: "NEVER describe your
    canvas operations in text... Produce text output ONLY when the information cannot be fully
    represented in the canvas mutation... Prefer silence." ai.ts then skips the DB message INSERT
    entirely when accumulatedText.length === 0 (T-07-08/SPEECH-01 comment: "Canvas-only bot turns
    (no chat text) must write NO message row"). In the pasted trace, the ADD_NODE mutation fully
    captured the insight (a hypothesis about reading habits), so per design the model produced no
    text and no chat message was ever inserted — this is INTENDED behavior, not a broken/missing
    code path.
    (2) "Verificador" does NOT exist in PERSONA_LIBRARY (packages/types/src/persona.ts) — PERSONA_IDS
    has exactly one entry, 'analista_cientifico' ("Analista Científico"). "Verificador" is an
    unrelated concept: it is the renamed `name` column (migration 0018_rename_verificador.sql,
    2026-07-18 commits 52f686c/2d3583d/7355868) of the `analyst_default` row in the Supabase
    `personalities` table — a completely different system from PERSONA_LIBRARY. Moreover, that
    `personalities` table is currently wired into the graph ONLY for the 'coach' role:
    trigger-engine.ts's resolveCoachPersonality() reads `blueprint.role_personalities?.coach`
    exclusively; there is no resolveAnalystPersonality equivalent, and grep confirms
    `role_personalities.analyst` (or any analyst-keyed personality lookup) is never read anywhere in
    the codebase. The SAME resolved `personality` object (coach-only) is passed as
    `config.configurable.personality` into BOTH facilitationAgentNode and analyticsAgentNode
    (trigger-engine.ts lines 322-327) — so even analyticsAgentNode (the Skill-firing "Analyst Role")
    never actually receives the "Verificador"/analyst_default personality voice.
    (3) Stronger finding on re-check: apps/web/components/workspace/MessageBubble.tsx's
    BOT_PERSONA_DISPLAY map (added by quick task 260718-u7k, same day) DOES have a ready 'Verificador'
    entry (icon SearchCheck, badgeLabel 'Verificador') — the UI display side is fully wired. But
    trigger-engine.ts's scanBranch() (the ONLY confirmed-live proactive trigger path, per Phase 14
    STATE.md notes) hardcodes `if (winner !== 'coach') return` (line 282) immediately after
    arbitration — it NEVER proceeds to invoke the graph, build a message, or insert a row when the
    Analyst wins arbitration; the only `messages` insert in trigger-engine.ts (line 348) is
    Coach-only (`display_name: COACH_DISPLAY_NAME`). Combined with the earlier-confirmed fact that
    ai.ts's 'analysis_request' triggerType (the only other path to analyticsAgentNode) is never set
    anywhere in production code, this means there is currently NO live code path anywhere in the
    running system that can ever actually produce a 'Verificador'-authored chat message — the UI
    component is ready, the DB row is renamed, but the invocation path is fully dead/unreachable
    today, independent of the personality-voice gap noted above.
  implication: |
    Two separate, real clarifications, neither a bug in this session's fix: (a) structured-only,
    silent-by-default output for Analista Científico is intentional design (D-08/D-09/SPEECH-01),
    confirmed by the trace's behavior. (b) "Verificador" (analyst_default) is UI-ready (MessageBubble
    display mapping exists) and DB-renamed, but its ENTIRE invocation path is currently dead in
    production: trigger-engine.ts's scanBranch() hardcodes an early return for any arbitration winner
    other than 'coach', and ai.ts's only other route to analyticsAgentNode ('analysis_request'
    triggerType) is never set anywhere in production code. So "Verificador" cannot produce any chat
    output today, under any circumstance, traced or otherwise — not because of a missing personality
    voice, but because nothing in the running system ever invokes analyticsAgentNode outside of tests.
    The user is not misremembering a persona name; they observed a real, recent (same-day) UI/DB
    rename of a feature that is not yet functionally reachable. This is a pre-existing product/wiring
    gap (most likely intentional incremental rollout — Analyst-Skill wiring appears deliberately
    deferred per the earlier eliminated-hypothesis notes in this file), not something this debug
    session's scope (missing Langfuse instrumentation) should fix — flagging for a future
    feature/wiring task, not spinning up a new debug session for it since nothing has regressed; it
    was simply never connected.

- timestamp: 2026-07-19T09:58:00Z
  checked: |
    apps/api/src/graph/state.ts (GraphStateAnnotation.messages reducer, full read), apps/api/src/lib/
    langgraph-checkpointer.ts (PostgresSaver singleton), apps/api/src/routes/ai.ts (thread_id
    construction + initialState.messages assembly, AI-08 sliding window), apps/api/src/lib/
    trigger-engine.ts (bot thread_id construction), apps/api/src/lib/bot-context.ts (CONTEXT_WINDOWS
    constant), apps/api/src/graph/nodes/{facilitation-agent,analytics-agent,arg-graph-builder,agent}.ts
    (grep for state.messages usage), .planning/STATE.md (decisions log, Phase 6/7/11/14 entries).
  found: |
    state.ts's `messages` Annotation uses a pure concat reducer (`left.concat(...)`) with no
    trim/dedup/window logic, checkpointed per thread_id via PostgresSaver. ai.ts sets
    `thread_id: ${activeBranchId}:human` (reused across EVERY human /invoke turn on that branch) and
    trigger-engine.ts uses a separate `${branchId}:bot` thread for proactive/Skill-fired turns — two
    independently, permanently growing histories per branch by design (BOT-04). On every human
    /invoke call, ai.ts recomputes `promptArray` fresh from the DB (AI-08: last 8 recent messages +
    a compressed summary of up to 50 older messages) and passes it as `initialState.messages` to
    `graph.stream()` — because the reducer is a pure concat, this heavily-overlapping window is
    APPENDED on top of whatever is already checkpointed for that thread_id, not replacing it. This
    means the checkpointed `messages` array grows by ~9-10 (largely duplicate) entries on every
    single human turn, forever, with no cap — confirmed by code inspection, not just symptom
    correlation. Corroborating evidence: facilitation-agent.ts, analytics-agent.ts, and
    arg-graph-builder.ts ALL defensively call `state.messages.slice(-CONTEXT_WINDOWS.X)` before using
    it for their own LLM calls (CONTEXT_WINDOWS = { facilitation: 10, analytics: 20, argBuild: 100,
    driftCheck: 3 } in bot-context.ts) — three of five LLM-calling graph nodes already work around
    exactly this unbounded-growth risk. agentNode (agent.ts lines 152/161) is the ONE node that does
    NOT slice — it passes the full, unbounded `state.messages` directly to `adapter.stream()` AND
    into the Langfuse `input` field verbatim, and there is no `agent` key in CONTEXT_WINDOWS at all
    (only facilitation/analytics/argBuild/driftCheck exist) — direct code evidence this was simply
    never handled for agentNode, unlike its siblings. No STATE.md decision documents unbounded
    checkpoint growth as an accepted tradeoff; Phase 6/7 decisions only establish that PostgresSaver
    checkpointing itself works, not that raw growth is bounded.
  implication: |
    CONFIRMED: this is a real, distinct root cause — NOT merely a Langfuse UI display artifact.
    The user's instinct ("context is growing indefinitely inside the graph") is correct. Every
    Analista Científico turn sends an unbounded, ever-duplicating message array to the LLM (real,
    growing prompt-token cost and eventual context-window overflow risk) and logs that same
    unbounded array into Langfuse's trace input — exactly matching what was observed ("History
    within Langfuse contains a lot of messages"). This is genuinely separate from the original
    "agentNode had no Langfuse instrumentation" bug and is being split into a new debug session
    per this session's own established split-off precedent (see this session's own trigger field).

## Resolution

root_cause: |
  agentNode (apps/api/src/graph/nodes/agent.ts) — the code path that runs on EVERY ordinary human
  /invoke turn and produces the chat-visible "Analista Científico" persona replies (via
  session.active_personas -> PERSONA_LIBRARY, ai.ts, D-10) — calls adapter.stream() directly with
  a raw for-await loop and never wraps it in streamWithGeneration (lib/langfuse-generation.ts),
  unlike its sibling nodes facilitationAgentNode and analyticsAgentNode. Since streamWithGeneration
  is the ONLY mechanism in this codebase that produces a Langfuse Generation observation for this
  project's non-LangChain AIProvider.stream() adapters, agentNode's LLM calls are completely
  untraced. The separate, newer "Analyst Role" (analyticsAgentNode) IS correctly instrumented
  (Generation name 'analytics-analyst') but is reachable only via a narrow TriggerGateNode
  Skill-firing path (fact-check/orphan-edge/phase-readiness), not via the ordinary persona-toggle
  chat path the user is actually using — so it rarely/never fires and rarely/never appears either.
  The user's "Analyst" is agentNode's output; agentNode has zero Langfuse instrumentation.
fix: |
  Wrapped agentNode's adapter.stream() call in streamWithGeneration (Generation name
  'agent-canvas-mutation'), mirroring the existing pattern already used in facilitation-agent.ts
  and analytics-agent.ts (same onEvent/tool_use handling shape as analytics-agent.ts, since
  agentNode also uses canvasMutationTool). Text forwarding now goes through streamWithGeneration's
  own streamWriter param instead of a manual call inside the loop; the previous early-return on the
  first tool_use event was replaced with full-drain iteration (matching analytics-agent.ts) so the
  underlying adapter stream completes naturally and usage/cost data is captured.
verification: |
  Self-verified (2026-07-18): `npm run typecheck` passes with no errors. `npx vitest run src/graph`
  (7 test files, 99 tests, graph.test.ts + graph.integration.test.ts) all pass unchanged, including
  the Analyst-Skill-firing and analysis_request paths. Full suite `npx vitest run` shows 8
  pre-existing failures (routes/ai.test.ts SSE tests + routes/keys.test.ts) that are confirmed
  PRE-EXISTING and unrelated to this fix — reproduced identically via `git stash` on the
  unmodified codebase.

  Human/live-verified (2026-07-19): user pasted a live Langfuse trace showing a real,
  non-$0.00 'agent-canvas-mutation' Generation entry (thread_id ':human', model gpt-5.4,
  $0.010078) — CONFIRMS the instrumentation fix works end-to-end in production. This is the
  primary bug (agentNode had zero Langfuse instrumentation) and it is now fully resolved and
  live-confirmed.

  Two additional concerns raised alongside this confirmation were investigated and resolved as
  NOT bugs in this session's scope (see Evidence entries dated 2026-07-19):
    - Trigger mechanism: confirmed this codebase has NO @-mention parsing anywhere; agentNode
      fires on every human turn once a persona is toggled on (session.active_personas), not on
      "@analista" text specifically. The "@analista" text in the user's trace never actually
      reached agentNode — it was typed but only seen by an unrelated Coach silence-gate turn on
      the separate ':bot' thread. Clarified, not a bug.
    - Missing separate chat text for the Analyst: confirmed intentional design (D-08/D-09 —
      "prefer silence", text only when the canvas mutation doesn't fully capture the insight;
      ai.ts skips the message INSERT entirely when accumulatedText is empty, SPEECH-01). "Verificador"
      does not exist in PERSONA_LIBRARY; it is an unrelated, partially-completed rename of the
      `analyst_default` row in the Supabase `personalities` table (migration 0018, 2026-07-18) that
      is NOT wired into any live code path (only 'coach' role personalities are ever resolved,
      via trigger-engine.ts's resolveCoachPersonality) — it cannot currently produce any output.
      Clarified as a product/config gap, not a regression or bug to fix in this session.

  A third, genuinely separate and real issue was confirmed and intentionally NOT fixed here:
  LangGraph checkpoint `state.messages` grows unboundedly across turns (pure concat reducer, no
  trim), and agentNode additionally lacks the CONTEXT_WINDOWS-based slicing its sibling nodes
  (facilitation-agent.ts, analytics-agent.ts, arg-graph-builder.ts) already use to guard against
  this. Split off into a new debug session per this session's own split-off precedent:
  .planning/debug/langgraph-message-history-growth.md
files_changed:
  - apps/api/src/graph/nodes/agent.ts
