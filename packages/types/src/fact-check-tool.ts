/**
 * fact-check-tool.ts — factCheckClassificationTool ProviderTool definition
 * (Phase 12 Task 1, TRIGGER-05, COST-02 tier-2 classifier)
 *
 * Tier 2 of the fact-check Skill's three-tier escalation gate (D-12): tier 1 is a
 * zero-LLM-cost heuristic pre-filter (claim-shaped pattern matching); this tool is
 * invoked ONLY for messages that already passed tier 1, using TASK_MODELS[provider]
 * .classification (the light model tier). It decides whether the flagged message
 * actually contains a verifiable factual claim worth escalating to tier 3 (the full
 * Analyst fact-check response), or whether tier 1 produced a false positive.
 *
 * Follows arg-graph-tool.ts's exact ProviderTool/raw-JSON-schema shape:
 *   - Uses `parameters` key (NOT `input_schema`) — adapters convert at call time
 *   - Flat top-level properties block (no oneOf at root — Anthropic API requirement)
 *
 * Tool output MUST be validated via SkillDetectionResultSchema.safeParse() (T-12-02)
 * before being written into GraphState — needs_fact_check maps to `fires`, confidence
 * maps directly to `confidence`.
 */

import type { ProviderTool } from './ai'

export const factCheckClassificationTool: ProviderTool = {
  name: 'classify_fact_check_need',
  description:
    'Decide whether the flagged message contains a verifiable factual claim worth fact-checking, ' +
    'or whether it is a tier-1 heuristic false positive (e.g. an opinion, a rhetorical exaggeration, ' +
    'or a claim too vague to verify). Only escalate (needs_fact_check=true) for claims that are ' +
    'concrete, specific, and checkable against real-world facts.',
  parameters: {
    type: 'object',
    properties: {
      needs_fact_check: {
        type: 'boolean',
        description: 'True if the message contains a concrete, verifiable factual claim worth escalating.',
      },
      confidence: {
        type: 'number',
        description: 'Confidence in this classification, 0.0 to 1.0.',
      },
    },
    required: ['needs_fact_check', 'confidence'],
  },
}
