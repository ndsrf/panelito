import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./lib/env";
import sessionsRouter from "./routes/sessions";
import messagesRouter from "./routes/messages";
import keysRouter from "./routes/keys";
import settingsRouter from "./routes/settings";
import aiRouter from "./routes/ai";
import reactionsRouter from "./routes/reactions";
import personasRouter from "./routes/personas";
import { createServiceClient } from "./lib/supabase";

// -----------------------------------------------------------------------
// Unified Hono App
// Uses .basePath("/api") to ensure routes are consistent across 
// standalone (Node) and unified (Next.js) deployments.
// -----------------------------------------------------------------------
const app = new Hono().basePath("/api");

// -------------------------------------------------------
// CORS middleware
// -------------------------------------------------------
const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return null;
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
// Activity tracking middleware (Supabase pg_cron support)
// -------------------------------------------------------
app.use("/sessions/:id/*", async (c, next) => {
  await next();

  const sessionId = c.req.param("id");
  const hasAuth = c.req.header("Authorization")?.startsWith("Bearer ");

  if (hasAuth && sessionId && c.req.method !== "GET") {
    const supabase = createServiceClient();
    void (async () => {
      try {
        await supabase.rpc("update_session_activity", { session_id: sessionId });
      } catch {}
    })();
  }
});

// -------------------------------------------------------
// API Routes (basePath "/api" is automatically prepended)
// -------------------------------------------------------
app.route("/sessions", sessionsRouter);
app.route("/sessions/:id/messages", messagesRouter);
app.route("/keys", keysRouter);
app.route("/settings", settingsRouter);
app.route("/sessions", aiRouter); // aiRouter has internal /:id/invoke
// -------------------------------------------------------
// Reactions route (REACT-01 through REACT-05)
// POST /api/sessions/:id/reactions
// -------------------------------------------------------
app.route("/sessions/:id/reactions", reactionsRouter);

// -------------------------------------------------------
// Personas route (PERSONA-02)
// POST /api/sessions/:id/personas
// -------------------------------------------------------
app.route("/sessions/:id/personas", personasRouter);

export default app;
