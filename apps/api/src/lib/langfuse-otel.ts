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
 * Initialization pattern:
 *   - LangfuseSpanProcessor reads LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY
 *     automatically from process.env (no explicit constructor params needed).
 *   - BasicTracerProvider wraps the processor; setLangfuseTracerProvider() sets
 *     it as the isolated tracer provider for all @langfuse/tracing calls.
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

/** Module-level span processor — null until setupLangfuseOtel() is called. */
let _langfuseSpanProcessor: LangfuseSpanProcessor | null = null

/**
 * setupLangfuseOtel — initializes the Langfuse OTel span processor.
 *
 * Must be called once at server startup before any graph invocation.
 * Safe to call multiple times — returns early if already initialized or if
 * credentials are absent.
 *
 * T-06-05: Never logs key values. Warns only about their absence.
 */
export function setupLangfuseOtel(): void {
  // Guard: skip if already initialized
  if (_langfuseSpanProcessor !== null) {
    return
  }

  // Require both keys — LangfuseSpanProcessor reads them from process.env automatically.
  // T-06-05: Never log the actual key values.
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    console.warn(
      '[langfuse-otel] LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not set — tracing disabled'
    )
    return
  }

  // LangfuseSpanProcessor reads credentials from process.env automatically.
  // It can also accept { publicKey, secretKey } constructor params if needed.
  _langfuseSpanProcessor = new LangfuseSpanProcessor()

  // Wrap in a BasicTracerProvider with the span processor.
  // BasicTracerProvider is the base class from @opentelemetry/sdk-trace-base;
  // it accepts spanProcessors[] in its constructor config.
  const provider = new BasicTracerProvider({
    spanProcessors: [_langfuseSpanProcessor],
  })

  // Set as Langfuse's isolated TracerProvider. This routes all @langfuse/tracing
  // startActiveObservation() calls through this provider instead of the global
  // OTel provider. Langfuse v5 uses this isolated pattern to avoid interfering
  // with any other OTel instrumentation in the app.
  setLangfuseTracerProvider(provider)

  console.log('[langfuse-otel] Langfuse OTel span processor initialized')
}

/**
 * getLangfuseSpanProcessor — returns the active span processor, or null if not initialized.
 *
 * Returns null if setupLangfuseOtel() has not been called or if credentials were absent.
 * Callers should check for null before using.
 */
export function getLangfuseSpanProcessor(): LangfuseSpanProcessor | null {
  return _langfuseSpanProcessor
}

/**
 * flushLangfuse — null-safe flush of the Langfuse span processor (OBS-02).
 *
 * Replaces the `(getLangfuseTracerProvider() as any).forceFlush()` anti-pattern.
 * Why the processor-direct approach is safe:
 *   - `getLangfuseTracerProvider()` returns the OTel global no-op TracerProvider when
 *     `setupLangfuseOtel()` never ran (e.g. LANGFUSE_*_KEY absent). The global provider
 *     does NOT have `forceFlush()`, so casting it as `any` and calling forceFlush() throws
 *     at runtime ("forceFlush is not a function").
 *   - `_langfuseSpanProcessor` is the module-held LangfuseSpanProcessor instance. Its
 *     `forceFlush()` method IS defined by `@langfuse/otel`. We call it directly and skip
 *     entirely when the processor is null (keys absent → tracing disabled → nothing to flush).
 *   - Errors during flush are warned but never re-thrown — callers never need a try/catch.
 *
 * @returns Promise<void> — always resolves, never rejects.
 */
export async function flushLangfuse(): Promise<void> {
  if (_langfuseSpanProcessor === null) {
    // Tracing disabled (keys absent or setupLangfuseOtel() not called) — nothing to flush.
    return
  }
  try {
    await _langfuseSpanProcessor.forceFlush()
  } catch (err) {
    console.warn('[langfuse-otel] forceFlush error (non-fatal):', (err as Error).message)
  }
}
