import { serve } from "@hono/node-server";
import app from "./index";
import { env } from "./lib/env";
import { startAutoFreezeTracker } from "./lib/auto-freeze";
import { createServiceClient } from "./lib/supabase";
import { setupLangfuseOtel } from "./lib/langfuse-otel";

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
  }
);
