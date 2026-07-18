import { serve } from "@hono/node-server";
import app from "./index";
import { env } from "./lib/env";
import { startAutoFreezeTracker, clearAllTrackers } from "./lib/auto-freeze";
import { startTriggerEngine } from "./lib/trigger-engine";
import { createServiceClient } from "./lib/supabase";
import { setupLangfuseOtel } from "./lib/langfuse-otel";

// Populated once startTriggerEngine resolves (below) — captured at module scope so the
// SIGTERM/SIGINT handlers can call it regardless of exactly when server boot finishes.
let stopTriggerEngine: (() => void) | null = null;

/**
 * shutdown — graceful SIGTERM/SIGINT handler (Phase 14, TRIGGER-07, RESEARCH Pattern 2).
 * Stops the TriggerEngine loop and clears all in-memory auto-freeze trackers BEFORE exiting,
 * preventing orphaned timers from accumulating spend across restarts (T-14-04d).
 */
function shutdown(signal: string): void {
  console.log(`[panelito/api] received ${signal}, shutting down`);
  stopTriggerEngine?.();
  clearAllTrackers();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

serve(
  {
    fetch: app.fetch,
    port: env.API_PORT,
  },
  (info) => {
    console.log(`[panelito/api] Standalone server listening on port ${info.port}`);

    // Register the Langfuse OTel span processor so CallbackHandler traces reach Langfuse.
    // Must run before any graph invocation. Safe to call unconditionally: warns and returns
    // early when LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY are absent (OBS-01, OBS-02).
    setupLangfuseOtel();

    startAutoFreezeTracker(createServiceClient()).catch((err) =>
      console.error("[panelito/api] auto-freeze tracker startup error:", err)
    );

    // Phase 14 (TRIGGER-07): persistent, drift-aware TriggerEngine loop, alongside auto-freeze.
    // No graph arg passed — startTriggerEngine resolves its own default via
    // createGraph(await getCheckpointer()) when omitted, keeping server-boot wiring minimal.
    // Captures the returned stop function for the graceful shutdown handlers above.
    startTriggerEngine(createServiceClient())
      .then((stop) => {
        stopTriggerEngine = stop;
      })
      .catch((err) =>
        console.error("[panelito/api] trigger-engine startup error:", err)
      );
  }
);
