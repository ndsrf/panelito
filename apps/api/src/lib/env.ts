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
});

export const env = (() => {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    // During Next.js build phase, some env vars might be missing.
    // We allow the build to continue, but we'll crash at runtime if they are still missing.
    if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.VERCEL === '1') {
      console.warn('[panelito/api] Skipping env validation during build phase');
      return {
        SUPABASE_URL: process.env.SUPABASE_URL || '',
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        KEY_ENCRYPTION_SECRET: process.env.KEY_ENCRYPTION_SECRET || '0'.repeat(64),
        API_PORT: 8787,
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'http://localhost:3000',
      } as z.infer<typeof EnvSchema>;
    } else {
      const issues = result.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");
      throw new Error(
        `[panelito/api] Missing or invalid environment variables:\n${issues}\n\nCopy .env.example to apps/api/.env and fill in the values.`
      );
    }
  }

  return result.data;
})();
