/**
 * langfuse-otel.ts — Langfuse OTel span processor bootstrap (OBS-01, OBS-02).
 *
 * Sets up the Langfuse OTel span processor at server startup so that
 * CallbackHandler (from @langfuse/langchain) can export traces to Langfuse cloud.
 *
 * Why this is required:
 *   @langfuse/langchain v5 is an OTel-based integration. CallbackHandler writes
 *   spans via @langfuse/tracing, which routes to the isolated TracerProvider set
 *   via setLangfuseTracerProvider(). Without this setup, the tracer is a no-op
 *   and zero traces reach Langfuse. See RESEARCH.md Pitfall 1.
 *
 * ContextManager registration (OBS-USER-01 fix — debug session
 * langfuse-traces-missing-userid): a TracerProvider alone is NOT enough.
 * @opentelemetry/api defaults to a NoopContextManager when no context manager is
 * registered — its with(ctx, fn) DISCARDS ctx and just calls fn() directly, and its
 * active() always returns ROOT_CONTEXT. @langfuse/core's propagateAttributes()
 * (used by CallbackHandler.handleChainStart to inject userId/sessionId/tags onto
 * root traces, and relied on by any nested @langfuse/tracing startObservation()
 * call to inherit the active trace context) depends entirely on context.with()/
 * context.active() actually propagating values across the async call chain. Without
 * registering AsyncLocalStorageContextManager (the standard Node.js OTel context
 * manager, backed by node:async_hooks' AsyncLocalStorage), every userId/sessionId/
 * tag propagated via context is silently dropped — confirmed by direct source
 * inspection of NoopContextManager plus an executable reproduction showing
 * context.active().getValue(key) returns undefined even synchronously inside
 * with(). This is why userId was previously invisible on every Langfuse trace.
 *
 * Initialization pattern:
 *   - LangfuseSpanProcessor reads LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY
 *     automatically from process.env (no explicit constructor params needed).
 *   - BasicTracerProvider wraps the processor; setLangfuseTracerProvider() sets
 *     it as the isolated tracer provider for all @langfuse/tracing calls.
 *   - AsyncLocalStorageContextManager is registered as the global OTel context
 *     manager so context.with()/context.active() (used by propagateAttributes for
 *     userId/sessionId/tags, and by nested startObservation() calls to inherit the
 *     active trace) actually propagate across awaits.
 *   - If credentials are absent, setupLangfuseOtel() warns and returns early —
 *     allowing unit tests to pass without a Langfuse account.
 *
 * T-06-05: Key values are never logged. Only a warning about their absence is emitted.
 *
 * Server wiring (plan 06-04): setupLangfuseOtel() is called in server.ts at startup,
 * following the same pattern as startAutoFreezeTracker().
 *
 * Usage (plan 06-04 will call this in server.ts):
 *   setupLangfuseOtel()
 *
 * Flush pattern (after every graph.invoke() call):
 *   await flushLangfuse()
 */

import { LangfuseSpanProcessor } from '@langfuse/otel'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { setLangfuseTracerProvider } from '@langfuse/tracing'
import * as otelApi from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'

// Use globalThis so the guard survives hot-reloads (tsx watch / Next.js HMR re-evaluate
// module-level variables, but globalThis persists for the lifetime of the process).
const _GLOBAL_KEY = Symbol.for('panelito:langfuse-otel')
interface _LangfuseOtelState { processor: LangfuseSpanProcessor }

function _getState(): _LangfuseOtelState | undefined {
  return (globalThis as Record<symbol, unknown>)[_GLOBAL_KEY] as _LangfuseOtelState | undefined
}

/**
 * setupLangfuseOtel — initializes the Langfuse OTel span processor.
 *
 * Safe to call multiple times (guard prevents re-init). Called from index.ts at module
 * load so it runs in both the standalone server and the Next.js bridge.
 *
 * T-06-05: Never logs key values. Warns only about their absence.
 */
export function setupLangfuseOtel(): void {
  if (_getState()) return

  // Require both keys — LangfuseSpanProcessor reads them from process.env automatically.
  // T-06-05: Never log the actual key values.
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    console.warn(
      '[langfuse-otel] LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not set — tracing disabled'
    )
    return
  }

  // D-13: environment is Langfuse's native first-class field (LangfuseSpanProcessor
  // constructor option — confirmed against installed @langfuse/otel@5.9.1 .d.ts), set
  // once at processor-level bootstrap here, NOT as a per-request CallbackHandler tag.
  // LANGFUSE_TRACING_ENVIRONMENT (if set) is honored automatically by the SDK as a
  // fallback when this option is omitted; we resolve explicitly so local/dev runs
  // default sensibly without requiring deployment config.
  const environment =
    process.env.LANGFUSE_TRACING_ENVIRONMENT ??
    (process.env.NODE_ENV === 'production' ? 'production' : 'development')
  const processor = new LangfuseSpanProcessor({ environment })
  const provider = new BasicTracerProvider({ spanProcessors: [processor] })
  otelApi.trace.setGlobalTracerProvider(provider)
  setLangfuseTracerProvider(provider)

  // OBS-USER-01 fix: register the AsyncLocalStorage-backed ContextManager. Without
  // this, @opentelemetry/api's default NoopContextManager makes context.with()/
  // context.active() a no-op, silently dropping the userId/sessionId/tags that
  // @langfuse/core's propagateAttributes() (via CallbackHandler) attaches to
  // context — see the module doc comment above for the full mechanism.
  otelApi.context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())

  ;(globalThis as Record<symbol, unknown>)[_GLOBAL_KEY] = { processor }
}

export function getLangfuseSpanProcessor(): LangfuseSpanProcessor | null {
  return _getState()?.processor ?? null
}

/**
 * flushLangfuse — null-safe flush of the Langfuse span processor (OBS-02).
 * Reads the processor from globalThis so it works after hot-reloads.
 * Never throws — callers never need a try/catch.
 */
export async function flushLangfuse(): Promise<void> {
  const processor = _getState()?.processor
  if (!processor) return
  try {
    await processor.forceFlush()
  } catch (err) {
    console.warn('[langfuse-otel] forceFlush error (non-fatal):', (err as Error).message)
  }
}
