import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./lib/env";
import sessionsRouter from "./routes/sessions";

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
// Start server
// -------------------------------------------------------
serve(
  {
    fetch: app.fetch,
    port: env.API_PORT,
  },
  (info) => {
    console.log(`[panelito/api] Server listening on port ${info.port}`);
    console.log(`[panelito/api] Health: http://localhost:${info.port}/health`);
  }
);

export default app;
