import { serve } from "@hono/node-server";
import app from "./index";
import { env } from "./lib/env";
import { startAutoFreezeTracker } from "./lib/auto-freeze";
import { createServiceClient } from "./lib/supabase";

serve(
  {
    fetch: app.fetch,
    port: env.API_PORT,
  },
  (info) => {
    console.log(`[panelito/api] Standalone server listening on port ${info.port}`);
    
    startAutoFreezeTracker(createServiceClient()).catch((err) =>
      console.error("[panelito/api] auto-freeze tracker startup error:", err)
    );
  }
);
