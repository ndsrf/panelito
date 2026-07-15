/**
 * skills.ts — Skill / SkillContext interfaces + empty Role registries (Phase 12 Task 2, D-01, D-02)
 *
 * A Skill is a capability a Role (Coach/Analyst) can perform — decoupled from *when/how*
 * it is invoked (delivery mechanism). This generalizes the Role/Personality split from
 * Phase 11 (11-CONTEXT.md D-01/D-02): Role = fixed behavioral discipline (code),
 * Personality = voice/tone (data), Skill = a concrete capability the Role can exercise.
 *
 * Skill stays a plain TypeScript interface (has async function members) — NOT a Zod
 * schema, mirroring how AIProvider (also has method members) is a plain interface in
 * packages/types rather than a Zod object. Only its detect() return value
 * (SkillDetectionResult) is a Zod-validated data shape.
 *
 * COACH_SKILLS / ANALYST_SKILLS are plain fixed arrays, not a mutable Map-based
 * registry — Skills are assembled once per Role (D-02), no dynamic (de)registration
 * is needed in this phase. Populated by Plan 05.
 */

import type { SkillDetectionResult, Blueprint } from '@panelito/types'
import type { GraphState } from '../graph/state'

/**
 * Context passed to every Skill's detect()/buildPromptGuidance(). Mirrors the
 * config.configurable test-injection seam already established in orchestrator.ts /
 * facilitation-agent.ts / analytics-agent.ts (classifierAdapter, facilitationAdapter,
 * analyticsAdapter) — every adapter/DB-client dependency a Skill needs must be
 * threaded through `config`, never read from a module-level global.
 */
export interface SkillContext {
  state: GraphState
  blueprint: Blueprint
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config?: any
}

/**
 * A capability a Role can perform. id is a stable string (e.g. 'drift-redirect',
 * 'orphan-edge', 'fact-check', 'moderation', 'silence-break'). role determines which
 * Role node (FacilitationAgentNode / AnalyticsAgentNode) the firing Skill routes into.
 * detect() is the cheap, synchronous-or-async check TriggerGateNode runs per candidate
 * Skill; buildPromptGuidance() produces the prompt-injection text spliced into the
 * owning Role node's system prompt AFTER argGraph context and BEFORE Personality voice.
 */
export interface Skill {
  id: string
  role: 'coach' | 'analyst'
  detect(context: SkillContext): Promise<SkillDetectionResult>
  buildPromptGuidance(context: SkillContext): string
}

/** Coach's registered Skills. Empty in Task 2 — populated in Plan 05. */
export const COACH_SKILLS: Skill[] = []

/** Analyst's registered Skills. Empty in Task 2 — populated in Plan 05. */
export const ANALYST_SKILLS: Skill[] = []
