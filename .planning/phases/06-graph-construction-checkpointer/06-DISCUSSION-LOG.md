# Phase 6: Graph Construction + Checkpointer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 06-graph-construction-checkpointer
**Areas discussed:** DOMAIN_DRIFT reply, AgentNode output binding, Blueprint data in graph state, Test isolation strategy

---

## DOMAIN_DRIFT Reply

**Q1: When a message is classified as DOMAIN_DRIFT, how should the reply be generated?**

| Option | Description | Selected |
|--------|-------------|----------|
| Real Claude call (DriftReplyNode) | Separate lightweight Claude call with minimal system prompt — natural response, costs tokens | |
| OrchestratorNode generates inline | Classification + reply in a single Claude call (two-in-one) | |
| Template/rule-based | No LLM call, canned message — zero cost but rigid | |

**User's choice:** Free-text: prefers DriftReplyNode but does NOT want to always reply to drift. Different domains may want to let drift messages go completely. Configurable per Blueprint.

**Notes:** The user introduced a key product insight — drift behavior should be domain-specific. A debate domain might redirect most drift; a casual brainstorm domain might ignore all of it.

---

**Q2: How should the Blueprint control drift behavior?**

| Option | Description | Selected |
|--------|-------------|----------|
| drift_policy field ('reply' \| 'ignore') | Enum field on Blueprint schema | |
| drift_reply_enabled boolean | Simpler boolean flag | |
| You decide | Claude picks field name and schema | |

**User's choice:** Free-text: "it should be a percentage" — allowing grey areas where sometimes replies happen, sometimes not.

**Notes:** User extended the original options to a probabilistic model (`drift_reply_probability: number`, 0.0–1.0). This enables nuanced domain-level control. Claude maps 0.0 = always ignore, 1.0 = always reply.

---

**Q3: When DOMAIN_DRIFT is silently ignored (probability roll fails), what happens on the client?**

| Option | Description | Selected |
|--------|-------------|----------|
| Nothing — stream ends immediately | No SSE events, connection closes | |
| Silent done event only | Single 'done' SSE for clean handshake | |
| You decide | Claude picks client-side pattern | |

**User's choice:** Observability-first: "I would like to see this in Langfuse, as long as it is observable I don't mind." UX on client is secondary.

**Notes:** The key requirement is that even silent DRIFT exits produce a Langfuse trace. Client-side handshake is Claude's discretion.

---

## AgentNode Output Binding

**Q1: How should AgentNode bind Claude to produce structured output?**

| Option | Description | Selected |
|--------|-------------|----------|
| Tool use — canvas_mutation tool | Consistent with render_panel in ai.ts | ✓ |
| LangGraph withStructuredOutput() | Built-in LangGraph model binding | |
| You decide | Claude picks based on LangGraph docs | |

**User's choice:** Tool use — canvas_mutation tool (Recommended).

**Notes:** User chose the option that stays consistent with the existing adapter pattern. This avoids coupling AgentNode to LangGraph's native model binding vs the AIProvider abstraction.

---

**Q2: Where does the canvas_mutation tool schema live?**

| Option | Description | Selected |
|--------|-------------|----------|
| In @panelito/types alongside renderPanelTool | Shared, importable by both apps | ✓ |
| Inside the graph module itself | Co-located with AgentNode | |

**User's choice:** In @panelito/types alongside renderPanelTool (Recommended).

**Notes:** Keeps the tool schema importable by apps/web for Phase 9 ghost node parsing.

---

## Blueprint Data in Graph State

**Q1: What Blueprint data lives in the LangGraph state?**

| Option | Description | Selected |
|--------|-------------|----------|
| blueprintId only — reload per invocation | Lean checkpoints, uses existing blueprint-loader.ts | ✓ |
| Full Blueprint JSON in state | Always available but adds ~2-5 KB to every checkpoint | |

**User's choice:** blueprintId only — reload per invocation (Recommended).

**Notes:** Blueprint object passed via config.configurable (ephemeral, not checkpointed). blueprint-loader.ts already handles caching and validation.

---

**Q2: What else does the LangGraph State carry?**

| Option | Description | Selected |
|--------|-------------|----------|
| Accumulated canvas ops | canvasOps: CanvasOp[] from this thread | ✓ |
| Current phase id | currentPhaseId for BLUE-04 system prompt mutation | ✓ |
| Conversation history (messages) | messages: ProviderMessage[] fed into AgentNode | ✓ |
| You decide the rest | Claude designs remaining state fields | ✓ |

**User's choice:** All four — user locked three explicit state fields and gave Claude discretion for the rest.

---

## Test Isolation Strategy

**Q1: How should Phase 6 tests handle Claude API calls?**

| Option | Description | Selected |
|--------|-------------|----------|
| Mock adapter — deterministic stubs | Fast, free, CI-safe, covers all graph paths | ✓ |
| Real Claude API call | Proves end-to-end but slow, costly, flaky in CI | |
| Real API for MemorySaver, mock for PostgresSaver | Hybrid approach | |

**User's choice:** Mock adapter — deterministic stubs (Recommended).

**Notes:** Mock stubs must cover all 5 paths: 3 confidence thresholds + DRIFT reply + DRIFT silent.

---

**Q2: PostgresSaver checkpointer test — real Supabase or local Postgres?**

| Option | Description | Selected |
|--------|-------------|----------|
| Real Supabase (SUPABASE_DIRECT_URL) — integration test | Proves actual deployment path | ✓ |
| Local Postgres via Docker | CI-safe but adds setup overhead | |
| You decide | Claude picks based on existing test infrastructure | |

**User's choice:** Real Supabase (SUPABASE_DIRECT_URL) — integration test.

**Notes:** Requires SUPABASE_DIRECT_URL env var in the test runner environment. The existing test infrastructure has no Docker setup, so real Supabase is the simpler path.

---

## Claude's Discretion

- Exact `canvasMutationTool` schema (ADD_NODE / ADD_EDGE / NO_ACTION shape + confidence field)
- Remaining LangGraph State fields beyond user-locked set
- `graph/` directory structure (nodes/, state.ts, graph.ts layout)
- Langfuse waitUntil flush pattern for Hono Node.js runtime
- Debate Blueprint `drift_reply_probability` default value
- MemorySaver vs PostgresSaver switch mechanism in graph factory
- Client-side SSE handshake for DOMAIN_DRIFT silent exits

## Deferred Ideas

None — discussion stayed within Phase 6 scope.
