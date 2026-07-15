/**
 * skill.ts — SkillDetectionResult schema + type (Phase 12 Task 1, D-01, TRIGGER-03/05, GRAPH-03)
 *
 * A Skill is a capability a Role (Coach/Analyst) can perform — decoupled from *when/how*
 * it is invoked (delivery mechanism). Every Skill's detect() returns a SkillDetectionResult,
 * validated against this single shared Zod schema so TriggerGateNode (Plan 06) can treat all
 * Skill outputs uniformly regardless of which Skill produced them.
 *
 * Co-located schema+type convention — mirrors TriggerMetadataEntrySchema (bot.ts).
 *
 * T-12-02 (threat model): any model-generated classifier output (e.g. the tier-2 fact-check
 * classifier tool result) crossing into typed graph state MUST be SkillDetectionResultSchema
 * .safeParse()'d before use — confidence is bounded to [0,1] here so a malformed/adversarial
 * model output cannot smuggle an out-of-range value into GraphState.skillMeta.
 */

import { z } from "zod";

export const SkillDetectionResultSchema = z.object({
  fires: z.boolean(),
  confidence: z.number().min(0).max(1),
  meta: z.record(z.string(), z.unknown()).optional().nullable(),
});

export type SkillDetectionResult = z.infer<typeof SkillDetectionResultSchema>;
