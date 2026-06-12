import { z } from "zod";

// -------------------------------------------------------
// Message — matches public.messages table exactly
// CHAT-04: every message stores parent_id, path_id, session_id,
//           author_id, content, canvas_snapshot_state
// CHAT-05: immutable — no edits, no deletes (enforced by RLS)
// -------------------------------------------------------

export const MessageSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  author_id: z.string().uuid(),
  display_name: z.string().min(1).max(60),
  /** NULL for root messages; references messages.id for replies / branches */
  parent_id: z.string().uuid().nullable(),
  /** Materialized path — "main" in Phase 1; branch paths added in Phase 3 */
  path_id: z.string().default("main"),
  content: z.string().min(1).max(4000),
  /** NULL in Phase 1; full canvas schema added in Phase 2 */
  canvas_snapshot_state: z.unknown().nullable(),
  created_at: z.string(),
});

export type Message = z.infer<typeof MessageSchema>;

// -------------------------------------------------------
// MessageInsertInput — fields the client sends on insert
// -------------------------------------------------------

export const MessageInsertInputSchema = z.object({
  /** Optional — server overrides with the :id route param */
  session_id: z.string().uuid().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  /** Defaults to "main" — Phase 3 will set the active branch path */
  path_id: z.string().optional().default("main"),
  content: z.string().min(1).max(4000),
  /** Required for anonymous/guest users; ignored for authenticated creators */
  display_name: z.string().min(1).max(60).optional(),
});

export type MessageInsertInput = z.infer<typeof MessageInsertInputSchema>;
