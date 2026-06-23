import { z } from "zod";

// -------------------------------------------------------
// Branch — Phase 1 placeholder (only "Main" exists)
// Phase 3 will expand this with fork logic, DB storage,
// and per-branch color assignment.
// -------------------------------------------------------

export const BranchSchema = z.object({
  id: z.string(),
  session_id: z.string().uuid().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  path_id: z.string(),
  label: z.string(),
  color: z.string(),
  fork_message_id: z.string().uuid().nullable().optional(),
  is_archived: z.boolean().optional(),
  created_at: z.string().optional(),
});

export type Branch = z.infer<typeof BranchSchema>;

/**
 * MAIN_BRANCH — the default main branch
 */
export const MAIN_BRANCH: Branch = {
  id: "main",
  label: "Principal",
  color: "#6366f1",
  path_id: "main",
  is_archived: false,
};
