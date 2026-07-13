import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./lib/env";
import sessionsRouter from "./routes/sessions";
import messagesRouter from "./routes/messages";
import branchesRouter from "./routes/branches";
import keysRouter from "./routes/keys";
import settingsRouter from "./routes/settings";
import aiRouter from "./routes/ai";
import reactionsRouter from "./routes/reactions";
import personasRouter from "./routes/personas";
import { canvasSessionRouter, canvasNodesRouter } from "./routes/canvas";
import { createServiceClient } from "./lib/supabase";
import { setupLangfuseOtel } from "./lib/langfuse-otel";

// Initialize Langfuse OTel at module load time so traces work in both
// standalone (server.ts) and Next.js bridge (app/api/[[...route]]/route.ts) contexts.
// Safe to call from server.ts again — the guard prevents double-initialization.
setupLangfuseOtel();

// -----------------------------------------------------------------------
// Unified Hono App
// Uses .basePath("/api") to ensure routes are consistent across 
// standalone (Node) and unified (Next.js) deployments.
// -----------------------------------------------------------------------
const app = new Hono().basePath("/api");

// -------------------------------------------------------
// CORS middleware (lazy origins parsing for Vercel build compatibility)
// -------------------------------------------------------
let cachedAllowedOrigins: string[] | null = null;

const getAllowedOrigins = () => {
  if (cachedAllowedOrigins === null) {
    cachedAllowedOrigins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  }
  return cachedAllowedOrigins;
};

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return null;
      return getAllowedOrigins().includes(origin) ? origin : null;
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
app.route("/sessions/:id/branches", branchesRouter);
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

// -------------------------------------------------------
// Canvas routes (CANVAS-03, Phase 9)
// GET  /api/sessions/:id/canvas?branch_id=  — committed nodes/edges for branch
// PATCH /api/canvas_nodes/:id               — confirm or dismiss ghost node
// -------------------------------------------------------
app.route("/sessions", canvasSessionRouter);
app.route("/canvas_nodes", canvasNodesRouter);

export default app;
