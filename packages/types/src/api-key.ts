import { z } from "zod";
import { ProviderSchema } from "./ai";
import type { ProviderName } from "./ai";

// Re-export for convenience
export type { ProviderName };

// -------------------------------------------------------
// API Key Verification — multi-provider (D-10, D-11)
// -------------------------------------------------------

/**
 * POST /api/keys/verify request body.
 * provider selects which provider to verify and which column to write.
 * Per-provider prefix validation (sk-ant- / sk- / AI) is enforced in the
 * route before calling the provider SDK — keys differ too much for a single
 * schema refine here.
 */
export const ApiKeyVerifyRequestSchema = z.object({
  provider: ProviderSchema,
  key: z.string().min(10, "Key must be at least 10 characters"),
});

export type ApiKeyVerifyRequest = z.infer<typeof ApiKeyVerifyRequestSchema>;

export const ApiKeyVerifyResponseSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true) }),
  z.object({
    success: z.literal(false),
    error: z.enum(["invalid_key", "network_error", "rate_limited"]),
  }),
]);

export type ApiKeyVerifyResponse = z.infer<typeof ApiKeyVerifyResponseSchema>;

// -------------------------------------------------------
// Multi-provider status (D-11, D-13)
// -------------------------------------------------------

/**
 * Status for a single provider's stored key.
 */
export const ProviderKeyStatusSchema = z.object({
  provider: ProviderSchema,
  has_key: z.boolean(),
  /** Last 4 chars of the plaintext key. null if no key stored. */
  last4: z.string().nullable(),
  /** Whether this is the currently active provider. */
  is_active: z.boolean(),
});

export type ProviderKeyStatus = z.infer<typeof ProviderKeyStatusSchema>;

/**
 * GET /api/keys/status response shape.
 * Returns status for all 3 providers and the currently active provider.
 */
export const MultiProviderStatusSchema = z.object({
  active_provider: ProviderSchema,
  providers: z.array(ProviderKeyStatusSchema),
});

export type MultiProviderStatus = z.infer<typeof MultiProviderStatusSchema>;

// -------------------------------------------------------
// Creator Settings — server-to-client projection
// NOTE: anthropic_api_key, openai_api_key, gemini_api_key are NEVER returned
//       to the client. The Hono service-role client is the only reader.
// -------------------------------------------------------

export const CreatorSettingsSchema = z.object({
  user_id: z.string().uuid(),
  /** true if an encrypted Anthropic API key is stored; the key itself is never returned */
  has_api_key: z.boolean(),
  api_response_cap: z.number().int().positive().max(10000),
  /** Currently selected AI provider (D-13). */
  active_provider: ProviderSchema,
  updated_at: z.string(),
});

export type CreatorSettings = z.infer<typeof CreatorSettingsSchema>;
