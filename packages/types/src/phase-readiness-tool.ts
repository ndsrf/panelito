/**
 * phase-readiness-tool.ts — phaseReadinessJudgmentTool ProviderTool definition
 * (Phase 13, TRIGGER-02, D-10)
 *
 * Judges whether the group has sufficiently covered the current Blueprint phase's purpose
 * (its llm_instructions) before the phase_readiness Skill (Plan 04) allows an advisory
 * phase_signal to fire. This tool is invoked ONLY after the per-phase N/M gate
 * (phase_readiness_gate: min_nodes / min_messages_after) has already opened — it is the
 * qualitative judgment layer on top of the quantitative counters (D-09).
 *
 * Follows fact-check-tool.ts's exact ProviderTool/raw-JSON-schema shape:
 *   - Uses `parameters` key (NOT `input_schema`) — adapters convert at call time
 *   - Flat top-level properties block (no oneOf at root — Anthropic API requirement)
 *
 * Tool output MUST be validated (e.g. via a bounded confidence schema, mirroring
 * SkillDetectionResultSchema) before being written into GraphState (T-13-01).
 */

import type { ProviderTool } from "./ai";

export const phaseReadinessJudgmentTool: ProviderTool = {
  name: "judge_phase_readiness",
  description:
    "Decide whether the group has sufficiently covered the current phase's purpose " +
    "(per its llm_instructions) and is ready to advance to the next phase. This is an " +
    "advisory judgment only — it does not itself advance the phase; a human must confirm " +
    "phase advancement (HUMAN-02, D-09).",
  parameters: {
    type: "object",
    properties: {
      sufficient: {
        type: "boolean",
        description: "True if the group has sufficiently covered the current phase's purpose.",
      },
      confidence: {
        type: "number",
        description: "Confidence in this judgment, 0.0 to 1.0.",
      },
    },
    required: ["sufficient", "confidence"],
  },
};
