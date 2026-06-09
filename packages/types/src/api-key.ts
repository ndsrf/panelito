import { z } from "zod";

// -------------------------------------------------------
// API Key Verification
// -------------------------------------------------------

export const ApiKeyVerifyRequestSchema = z.object({
  /**
   * Anthropic API key.
   * Cheap client-side guard before the server handshake:
   * - Must start with "sk-ant-"
   * - Must be at least 50 characters long
   */
  key: z
    .string()
    .min(50, "Key must be at least 50 characters")
    .refine((k) => k.startsWith("sk-ant-"), {
      message: 'Key must start with "sk-ant-"',
    }),
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
// Creator Settings — server-to-client projection
// NOTE: encrypted_api_key is NEVER returned to the client.
//       The Hono service-role client is the only reader.
// -------------------------------------------------------

export const CreatorSettingsSchema = z.object({
  user_id: z.string().uuid(),
  /** true if an encrypted API key is stored; the key itself is never returned */
  has_api_key: z.boolean(),
  api_response_cap: z.number().int().positive().max(10000),
  updated_at: z.string(),
});

export type CreatorSettings = z.infer<typeof CreatorSettingsSchema>;
