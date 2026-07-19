# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## langfuse-traces-missing-userid — Langfuse traces never show session creator userId
- **Date:** 2026-07-18
- **Error patterns:** userid, langfuse, traces, facilitation_coach, analista, CallbackHandler, propagateAttributes, ContextManager, NoopContextManager, AsyncLocalStorage, OpenTelemetry, context propagation
- **Root cause:** No OpenTelemetry ContextManager was ever registered process-wide (apps/api/src/lib/langfuse-otel.ts's setupLangfuseOtel() only registers a TracerProvider, never calls context.setGlobalContextManager()). @opentelemetry/api therefore defaults to NoopContextManager, whose with(ctx, fn) discards ctx and calls fn() directly, and whose active() always returns ROOT_CONTEXT. @langfuse/core's propagateAttributes() (used by CallbackHandler.handleChainStart to inject userId/sessionId/tags onto root traces) relies entirely on context.with(ctxWithUserId, fn) making userId observable via context.active().getValue(...) inside fn — under NoopContextManager this is a silent no-op, so userId is never attached to any trace, on every persona, every session.
- **Fix:** Add @opentelemetry/context-async-hooks as a dependency and register AsyncLocalStorageContextManager as the global OTel context manager inside setupLangfuseOtel() (apps/api/src/lib/langfuse-otel.ts), alongside the existing TracerProvider registration, guarded by the same idempotency check.
- **Files changed:** apps/api/src/lib/langfuse-otel.ts, apps/api/package.json, pnpm-lock.yaml
---

## analyst-missing-langfuse — AgentNode (Analista Científico) never produced Langfuse Generation entries
- **Date:** 2026-07-19
- **Error patterns:** analista, analyst, langfuse, agent-canvas-mutation, agentNode, streamWithGeneration, facilitation-coach, Analista Científico, Verificador, personalities, mention parsing, context growth, checkpoint messages
- **Root cause:** agentNode (apps/api/src/graph/nodes/agent.ts) — the code path that runs on every ordinary human /invoke turn and produces the chat-visible "Analista Científico" persona replies — called adapter.stream() directly with a raw for-await loop and never wrapped it in streamWithGeneration, unlike sibling nodes facilitationAgentNode and analyticsAgentNode. Since streamWithGeneration is the only mechanism in this codebase producing a Langfuse Generation observation for AIProvider.stream() calls, agentNode's LLM calls were completely untraced. Separately clarified (not bugs): this codebase has no @-mention parsing anywhere — personas are gated purely by a session.active_personas toggle, firing on every human turn once active; Analista Científico is designed to prefer silence (text only when the canvas mutation doesn't fully capture the insight); and "Verificador" (analyst_default in the `personalities` table, renamed same-day via migration 0018) has zero live invocation path in production (trigger-engine.ts's scanBranch hardcodes `if (winner !== 'coach') return`; ai.ts's only other route, triggerType 'analysis_request', is never set anywhere) despite being UI-display-ready.
- **Fix:** Wrapped agentNode's adapter.stream() call in streamWithGeneration (Generation name 'agent-canvas-mutation'), mirroring facilitation-agent.ts/analytics-agent.ts's pattern. Live-verified via a real Langfuse trace showing a non-$0.00 Generation entry.
- **Files changed:** apps/api/src/graph/nodes/agent.ts
---

## langgraph-message-history-growth — LangGraph checkpoint `state.messages` grows unboundedly across turns (split off, unresolved)
- **Date:** 2026-07-19
- **Error patterns:** context growing, messages array, checkpoint, PostgresSaver, concat reducer, thread_id, unbounded, CONTEXT_WINDOWS, Langfuse History, langgraph state
- **Root cause:** Not yet fixed — see .planning/debug/langgraph-message-history-growth.md. state.ts's `messages` Annotation uses a pure concat reducer with no trim/window logic; ai.ts reuses the same thread_id across every human turn and re-appends a fresh, overlapping DB-fetched window on top of the already-checkpointed history every time, so it grows unboundedly. agentNode additionally lacks the CONTEXT_WINDOWS-based slicing its sibling nodes already use.
- **Fix:** Not yet applied — investigation only so far (diagnosis, not fix).
- **Files changed:** (none yet)
---
