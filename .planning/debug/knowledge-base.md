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
