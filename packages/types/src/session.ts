import { z } from "zod";

// -------------------------------------------------------
// Session status and mode enums
// -------------------------------------------------------

export type SessionStatus = "active" | "frozen" | "closed";
export type SessionMode = "strategy" | "debate" | "red_team";

// -------------------------------------------------------
// Session — matches public.sessions table exactly
// -------------------------------------------------------

export const SessionSchema = z.object({
  id: z.string().uuid(),
  creator_id: z.string().uuid(),
  /** 6-character Crockford base32 code — no ambiguous chars (0, O, I, 1) */
  short_code: z
    .string()
    .regex(/^[A-HJ-NP-Z2-9]{6}$/, "short_code must be 6-char Crockford base32"),
  title: z.string().nullable(),
  mode: z.enum(["strategy", "debate", "red_team"]).nullable(),
  status: z.enum(["active", "frozen", "closed"]),
  ai_response_count: z.number().int().nonnegative(),
  ai_response_cap: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Session = z.infer<typeof SessionSchema>;

// -------------------------------------------------------
// SessionCreateInput — user-supplied fields only
// -------------------------------------------------------

export const SessionCreateInputSchema = z.object({
  title: z.string().min(1).max(120).nullable().optional(),
  mode: z.enum(["strategy", "debate", "red_team"]).nullable().optional(),
});

export type SessionCreateInput = z.infer<typeof SessionCreateInputSchema>;
