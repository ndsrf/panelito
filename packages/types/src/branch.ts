import { z } from "zod";

// -------------------------------------------------------
// Branch — Phase 1 placeholder (only "Main" exists)
// Phase 3 will expand this with fork logic, DB storage,
// and per-branch color assignment.
// -------------------------------------------------------

export const BranchSchema = z.object({
  id: z.string(),
  label: z.string(),
  color_hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  path_id: z.string(),
});

export type Branch = z.infer<typeof BranchSchema>;

/**
 * MAIN_BRANCH — the single static branch in Phase 1.
 * The Branch Navigator renders this constant directly so it works
 * without any DB read in Phase 1.
 */
export const MAIN_BRANCH: Branch = {
  id: "main",
  label: "Main",
  color_hex: "#6366f1",
  path_id: "main",
};
