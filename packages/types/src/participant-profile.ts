import { z } from "zod";

// -------------------------------------------------------
// ParticipantProfile — per-participant, per-branch rollup (Phase 13, PROFILE-01/02, D-01/D-04/D-05)
//
// Populated by ProfileBuilderNode (Plan 03) from message activity within a branch. `participant_id`
// is the message author id (D-04) — NOT the session-level user id — so a participant's profile is
// scoped to a single branch's fork of the conversation, matching the multiverse branching model.
// positions/assertions are free-text extractions (LLM-derived, not yet enum-constrained); the
// numeric counters are monotonically-increasing activity tallies persisted across invocations.
// Co-located schema+type convention — mirrors TriggerMetadataEntrySchema (bot.ts).
// -------------------------------------------------------

export const ParticipantProfileSchema = z.object({
  branch_id: z.string().uuid(),
  participant_id: z.string().uuid(), // author_id (D-04)
  positions: z.array(z.string()),
  assertions: z.array(z.string()),
  messages_sent: z.number().int().min(0),
  reactions_used: z.number().int().min(0),
  moderation_count: z.number().int().min(0),
  updated_at: z.string(),
});

export type ParticipantProfile = z.infer<typeof ParticipantProfileSchema>;
