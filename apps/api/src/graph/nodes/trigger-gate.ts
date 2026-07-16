/**
 * trigger-gate.ts — TriggerGateNode: detection-only, role-gated, fail-isolated Skill gate
 * (Phase 12 Plan 06 Task 1 — D-05/D-06/D-07).
 *
 * Consolidates ALL 4 new Skills' detect() calls (plus the retrofitted silence-break Skill,
 * D-03) into ONE LangGraph node, following the exact skeleton pre-verified in
 * 12-AI-SPEC.md Section 3 / 12-RESEARCH.md Pattern 1. TriggerGateNode is inserted into BOTH
 * the primary human-message path (after mutationGate) AND the proactive analysis_request
 * path (Plan 06 Task 2, graph.ts) per the locked human-path reachability decision.
 *
 * D-06: detection-only — never streams, never calls streamWriter, never writes to
 * `messages`, never generates a bot response itself. It only decides WHICH Skill fired (if
 * any) and sets routing metadata for routeAfterTriggerGate (graph.ts) to read.
 *
 * D-07: Role-activation gate (`bot_overrides ?? bot_defaults ?? false`, the exact pattern
 * already used in silence-scan.ts:191) runs ONCE, BEFORE candidateSkills is assembled — a
 * disabled Role's Skills are never detect()-ed at all (asserted with spies in
 * trigger-gate.test.ts).
 *
 * Fail-open contract (mirrors orchestrator.ts's `[nodename]` console.error convention):
 * a missing blueprint never throws — it logs `[trigger-gate]` and returns an all-null result.
 *
 * Fail-isolation (D-05, mirrors bot-arbitrator.ts's CR-02 scorer-isolation precedent):
 * Promise.allSettled — a single throwing Skill.detect() must never block sibling Skills and
 * must never make TriggerGateNode itself throw. A rejected settlement is console.warn'd and
 * skipped, never treated as a reason to abort the whole node.
 *
 * Priority order: registration order in COACH_SKILLS/ANALYST_SKILLS (skills.ts) IS priority
 * order — the first Skill (array order) whose result.fires === true wins; its
 * firingSkillId/firingSkillRole/skillMeta populate the return value.
 *
 * triggerGateComplete (state.ts, Plan 06 Task 2 loop guard): TriggerGateNode ALWAYS sets this
 * to true on every return path (fired, not-fired, AND the fail-open missing-blueprint path) —
 * routeAfterMutationGate (graph.ts) reads this to decide whether the human-path mutationGate
 * hop should re-enter triggerGate (first pass) or terminate at END (second pass). Omitting it
 * on the fail-open path would let mutationGate loop back into triggerGate on every subsequent
 * invocation of the same thread when blueprint is perpetually missing — always setting it here
 * closes that hazard.
 *
 * phaseGateProgress (Phase 13 Plan 04, TRIGGER-02): the phase-readiness Skill's sequential
 * N/M gate counter (D-09) must persist across invocations even when phase-readiness does NOT
 * win arbitration this turn (e.g. fact-check or orphan-edge fires instead) or does not fire at
 * all. TriggerGateNode scans every settled candidate result (not just the winner) for a
 * `meta.phaseGateProgress` key and copies it into a top-level `phaseGateProgress` field on
 * EVERY return path — this keeps TriggerGateNode the single place GraphState routing/metadata
 * fields are set (Pattern 2, option (a)), rather than having phase-readiness write directly to
 * GraphState via a side-channel.
 */

import type { Blueprint } from '@panelito/types'
import type { GraphState } from '../state'
import { COACH_SKILLS, ANALYST_SKILLS } from '../../lib/skills'
import type { Skill, SkillContext } from '../../lib/skills'

export async function triggerGateNode(
  state: GraphState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config?: any,
): Promise<Partial<GraphState>> {
  const blueprint = config?.configurable?.blueprint as Blueprint | undefined

  if (!blueprint) {
    console.error('[trigger-gate] blueprint missing from config.configurable — no skill fires')
    return {
      firingSkillId: null,
      firingSkillRole: null,
      skillMeta: null,
      triggerGateComplete: true,
      phaseGateProgress: null,
    }
  }

  const sessionBotOverrides = config?.configurable?.botOverrides as Record<string, boolean> | undefined

  // D-07: Role-activation gate — runs ONCE, before candidateSkills is assembled. A disabled
  // Role's Skills are never included in the candidate list, so they are never detect()-ed.
  const coachEnabled = sessionBotOverrides?.coach ?? blueprint.bot_defaults?.coach ?? false
  const analystEnabled = sessionBotOverrides?.analyst ?? blueprint.bot_defaults?.analyst ?? false

  const candidateSkills: Skill[] = [
    ...(coachEnabled ? COACH_SKILLS : []),
    ...(analystEnabled ? ANALYST_SKILLS : []),
  ]

  const context: SkillContext = { state, blueprint, config }

  // D-05: Promise.allSettled — a throwing Skill.detect() must not block sibling Skills and
  // must never make TriggerGateNode itself throw (mirrors bot-arbitrator.ts CR-02).
  const results = await Promise.allSettled(
    candidateSkills.map(async (skill) => ({ skill, result: await skill.detect(context) })),
  )

  // Phase 13 Plan 04: surface phaseGateProgress from whichever candidate result carried it
  // (the phase-readiness Skill's own detect() meta) — independent of which Skill ultimately
  // wins arbitration below, so the N/M counter persists across invocations even when the
  // gate has not yet fired, OR a different Skill fires instead this turn.
  let phaseGateProgress: GraphState['phaseGateProgress'] = null
  for (const settled of results) {
    if (settled.status === 'fulfilled' && settled.value.result.meta && 'phaseGateProgress' in settled.value.result.meta) {
      phaseGateProgress = settled.value.result.meta.phaseGateProgress as GraphState['phaseGateProgress']
      break
    }
  }

  for (const settled of results) {
    if (settled.status === 'rejected') {
      console.warn('[trigger-gate] skill.detect() threw — skipping', settled.reason)
      continue
    }
    const { skill, result } = settled.value
    if (result.fires) {
      console.info('[trigger-gate] skill fired', { id: skill.id, confidence: result.confidence })
      return {
        firingSkillId: skill.id,
        firingSkillRole: skill.role,
        skillMeta: result.meta ?? null,
        triggerGateComplete: true,
        phaseGateProgress,
      }
    }
  }

  return {
    firingSkillId: null,
    firingSkillRole: null,
    skillMeta: null,
    triggerGateComplete: true,
    phaseGateProgress,
  }
}
