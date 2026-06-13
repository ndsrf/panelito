import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./lib/env";
import sessionsRouter from "./routes/sessions";
import messagesRouter from "./routes/messages";
import keysRouter from "./routes/keys";
import settingsRouter from "./routes/settings";
import aiRouter from "./routes/ai";
import { startAutoFreezeTracker, clearAllTrackers } from "./lib/auto-freeze";
import { createServiceClient } from "./lib/supabase";

const app = new Hono();

// -------------------------------------------------------
// CORS middleware
// T-01-01 / T-01-08: Only allow configured origins.
// Defaults to http://localhost:3000 in development.
// -------------------------------------------------------
const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return null; // Server-to-server requests
      return allowedOrigins.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// -------------------------------------------------------
// Health check
// -------------------------------------------------------
app.get("/health", (c) => {
  return c.json({ ok: true, ts: new Date().toISOString() });
});

// -------------------------------------------------------
// Session CRUD routes (SESS-02..06, SESS-08, SESS-10)
// -------------------------------------------------------
app.route("/api/sessions", sessionsRouter);

// -------------------------------------------------------
// Message routes (CHAT-01, CHAT-04, CHAT-05)
// POST + GET /api/sessions/:id/messages
// -------------------------------------------------------
app.route("/api/sessions/:id/messages", messagesRouter);

// -------------------------------------------------------
// BYOK API key routes (AI-01, AI-02, AI-10)
// POST /api/keys/verify, GET /api/keys/status, DELETE /api/keys
// -------------------------------------------------------
app.route("/api/keys", keysRouter);

// -------------------------------------------------------
// Creator settings routes (D-05, D-06)
// GET/PUT /api/settings
// -------------------------------------------------------
app.route("/api/settings", settingsRouter);

// -------------------------------------------------------
// AI prompt-assembly scaffold (AI-11)
// POST /api/sessions/:id/invoke
// -------------------------------------------------------
app.route("/api/sessions", aiRouter);

// -------------------------------------------------------
// Activity tracking middleware
// Updates last_creator_activity_at in Supabase whenever
// the creator makes a request to a session route.
// -------------------------------------------------------
app.use("/api/sessions/:id/*", async (c, next) => {
  await next();
  
  const user = c.get("user") as { id: string } | undefined;
  const sessionId = c.req.param("id");

  if (user && sessionId && c.req.method !== "GET") {
    const supabase = createServiceClient();
    // We don't await this to keep the response fast
    supabase.rpc("update_session_activity", { session_id: sessionId }).catch(() => {});
  }
});

// -------------------------------------------------------
// Start server (only if not running on Vercel)
// -------------------------------------------------------
if (process.env.VERCEL !== "1") {
  serve(
    {
      fetch: app.fetch,
      port: env.API_PORT,
    },
    (info) => {
      console.log(`[panelito/api] Server listening on port ${info.port}`);
      console.log(`[panelito/api] Health: http://localhost:${info.port}/health`);

      // SESS-07: Start auto-freeze tracker after server is ready
      startAutoFreezeTracker(createServiceClient()).catch((err) =>
        console.error("[panelito/api] auto-freeze tracker startup error:", err)
      );
    }
  );
}

// Clean up all timers on graceful shutdown (SIGTERM)
process.on("SIGTERM", () => {
  console.log("[panelito/api] SIGTERM received — clearing auto-freeze timers");
  clearAllTrackers();
  process.exit(0);
});

export default app;
