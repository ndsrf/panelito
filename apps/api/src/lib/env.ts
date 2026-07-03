import { z } from "zod";

/**
 * env — validated environment variables for the Hono API.
 *
 * Validates all required env vars at startup and throws if any are missing.
 * Fail loud: a missing env var at startup is better than a silent failure
 * at request time.
 *
 * T-01-08: The service role key is read once into memory here; it is never
 * logged and never returned in any response body.
 */
const EnvSchema = z.object({
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  // T-05-01: Direct Postgres connection string for PostgresSaver (LangGraph checkpointer).
  // Must be a postgresql:// connection string, NOT the REST API URL (SUPABASE_URL).
  // Never logged and never returned in any response body — same security pattern as
  // SUPABASE_SERVICE_ROLE_KEY (T-01-08).
  SUPABASE_DIRECT_URL: z
    .string()
    .url("SUPABASE_DIRECT_URL must be a valid URL")
    .refine(
      (v) => v.startsWith("postgres://") || v.startsWith("postgresql://"),
      "SUPABASE_DIRECT_URL must be a postgresql:// connection string, not a REST API URL"
    ),
  KEY_ENCRYPTION_SECRET: z
    .string()
    .length(64, "KEY_ENCRYPTION_SECRET must be 64 hex chars (32 bytes)"),
  API_PORT: z
    .string()
    .default("8787")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1024).max(65535)),
  ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:3000"),
  // D-15: Langfuse trace detail level.
  // 'graph' (default): per-request CallbackHandler on graph.astream() only.
  // 'full': wrap entire route handler in a Langfuse parent span (debugging tool).
  LANGFUSE_TRACE_LEVEL: z
    .enum(['graph', 'full'])
    .default('graph'),
});

export const env = (() => {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `[panelito/api] Missing or invalid environment variables:\n${issues}\n\nCopy .env.example to apps/api/.env and fill in the values.`
    );
  }

  return result.data;
})();
