# Phase 7: /invoke Route Modification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 07-invoke-route-modification
**Areas discussed:** V1 session fallback, Text streaming seam, Abort controller wiring, Langfuse tracing scope, AI behavior in Blueprint sessions

---

## V1 Session Fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Dual path | blueprint_id null → existing adapter.stream() code path; blueprint_id set → graph | |
| Single graph path with v1-compat Blueprint | All sessions go through the graph; seed a v1-legacy Blueprint | |
| Deprecate v1 sessions in this phase | All sessions require a Blueprint; return 400 for sessions without blueprint_id | ✓ |

**User's choice:** Deprecate v1 sessions
**Follow-up — error code:** 400 no_blueprint (not 409 — it's a configuration error, not a flow control response)
**Notes:** User wants a clean break. No dual code path. Existing v1 sessions will get a clear 400 error instead of silently hanging. Matches the existing no_api_key and no_active_persona error patterns.

---

## Text Streaming Seam

| Option | Description | Selected |
|--------|-------------|----------|
| StreamWriter seam | Pass streamWriter callback via config.configurable; nodes call it per text_delta; route uses Promise.all | ✓ |
| Switch to LangChain-native (ChatAnthropic) | Add @langchain/anthropic; rewrite nodes to use ChatAnthropic; use graph.streamEvents("v2") | |
| Post-graph text dump | Accumulate text in LangGraph state; stream after graph completes (no real-time) | |

**User's choice:** StreamWriter seam (after first expressing concern about over-complication and asking to investigate LangChain native streams)
**Notes:** User initially raised a concern that the async coordination might be too complex and asked whether LangChain native streams would be simpler. After investigation: @langchain/anthropic is not installed; using it would require rewriting all 3 Phase 6 nodes; it would bypass the AIProvider abstraction. User confirmed the StreamWriter seam is the right call. Minimal node changes (one line per node), no new packages.

---

## Abort Controller Wiring

| Option | Description | Selected |
|--------|-------------|----------|
| c.req.raw.signal directly | Pass Hono's native AbortSignal to graph.astream() via config.signal | (Claude decides) |
| Manual AbortController on stream close | Create AbortController; wire to Hono SSE close callback | |
| Timeout-only fallback | No abort signal; rely on Vercel function timeout | |

**User's choice:** "I don't mind as long as it is logged in Langfuse"
**Notes:** User deferred the mechanism to Claude but added a hard requirement: client disconnect events MUST appear in the Langfuse trace (as a span attribute or event). Claude will use c.req.raw.signal as the simplest approach.

---

## Langfuse Tracing Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Graph path only | Per-request CallbackHandler on graph.astream() is sufficient | |
| All /invoke calls including early exits | Wrap entire route in a Langfuse trace | |
| Route-level parent span + graph child spans | Parent span for route; CallbackHandler creates child spans | |
| Configurable via env var | LANGFUSE_TRACE_LEVEL: 'graph' \| 'full' | ✓ |

**User's choice:** Add a .env configuration for trace level (LANGFUSE_TRACE_LEVEL: 'graph' | 'full')
**Notes:** User spontaneously asked for a settings knob rather than committing to one approach. Default 'graph' (graph-path only). 'full' wraps the route in a parent span for DB query visibility. Early-exit 400/409/429 paths are NOT traced in either level.

---

## AI Behavior in Blueprint Sessions

### Text output rules

| Option | Description | Selected |
|--------|-------------|----------|
| Enrichment-only, no canvas meta-commentary | Explicitly ban "I added a node" etc. Text only when information can't be shown on canvas | ✓ (hybrid) |
| Brief canvas acknowledgment + enrichment | One-liner canvas note + enrichment text | |
| No text on canvas mutations | Completely silent for canvas operations | ✓ (preferred default) |

**User's choice:** Hybrid — prefer silence; add text ONLY when information cannot be represented in the canvas. If canvas mutation fully captures the insight, output NO text.
**Notes:** User described it as "only add commentary when it actually adds value on top of the canvas changes." Silence is the default, brief enrichment text is the exception. AgentNode system prompt explicitly bans canvas meta-commentary phrases.

### DOMAIN_BRIDGE steering

| Option | Description | Selected |
|--------|-------------|----------|
| Gentle steering text (probability-gated) | Apply drift_reply_probability roll to DOMAIN_BRIDGE too; occasional redirection | ✓ |
| Map it anyway + steering text | Canvas mutation + steering text always | |
| Silent bridge | No text, no steering | |

**User's choice:** Option 1 (gentle steering) + extend drift_reply_probability to cover DOMAIN_BRIDGE cases
**Notes:** User explicitly said "consider the draft probability we added to the blueprint to also use this in this scenario — so not always we add text." The same probability roll that governs DOMAIN_DRIFT replies now also governs DOMAIN_BRIDGE steering text. DOMAIN_BRIDGE still routes to AgentNode for canvas mutation regardless of the probability roll.

### Persona behavior with Blueprint

| Option | Description | Selected |
|--------|-------------|----------|
| Blueprint replaces personas entirely | No persona check in Blueprint sessions | |
| Personas stack on top of Blueprint | Active persona instructions appended after Blueprint phase instructions | ✓ |
| Persona required even with Blueprint | Keep 409 gate; creator must toggle persona AND select Blueprint | |

**User's choice:** Personas stack — and Blueprints specify their default personas
**Notes:** User clarified the product model: "Blueprints will activate by default some personas from the library. But you can add personas on top to any blueprint, even if that will end up in funny results. When the creator creates a session, the session type determines the blueprint (a debate is linked to the debate blueprint)." 409 no_active_persona gate is preserved. Blueprint's default_personas field pre-seeds active_personas at session creation time (Phase 5/Foundation concern). Phase 7 route uses session.active_personas as-is.

---

## Claude's Discretion

- Exact async queue / Promise.all coordination pattern for concurrent graph execution + SSE piping
- Whether to use `c.req.raw.signal` directly or manual AbortController with Hono stream lifecycle hooks
- `active_personas` field name in `config.configurable` (suggested: `activePersonas: string[]`)
- `buildAgentSystemPrompt()` signature extension to accept persona instructions
- LANGFUSE_TRACE_LEVEL 'full' parent span implementation details

## Deferred Ideas

- **phase_signal (HUMAN-02)**: Mentioned during discussion. Phase 7 graph state can include the signal but the UI affordance is Phase 8.
- **Canvas snapshot state for Blueprint sessions**: Phase 8 handles canvas DB writes; Phase 7 sets `canvas_snapshot_state = null` for Blueprint sessions.
- **Blueprint hot-reload**: Session type → Blueprint mapping is established; switching Blueprint mid-session is v2.1 (BLUE-07).
