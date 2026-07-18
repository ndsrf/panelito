/**
 * silence-break.ts — Coach silence-break Skill: retrofit of checkSilenceGate() onto
 * the Skill contract (D-03, TRIGGER-01 carryover from Phase 11).
 *
 * detect() wraps the existing checkSilenceGate() (apps/api/src/lib/silence-gate.ts)
 * verbatim — it does NOT reimplement the two-signal (elapsed-time + Presence is_typing)
 * gate logic, which is already exhaustively tested in silence-gate.test.ts.
 *
 * Per D-03, this Skill's delivery mechanism is explicitly NOT changed by this wrapper:
 * silence-break still fires via trigger-engine.ts's setInterval loop + direct-DB-insert.
 * This module is purely the detect()/buildPromptGuidance() contract adapter that lets
 * silence-break be listed alongside the other Coach Skills (drift-redirect, moderation)
 * in COACH_SKILLS — it is not a new call site for checkSilenceGate().
 *
 * config.configurable seam (mirrors orchestrator.ts/facilitation-agent.ts): the caller
 * (trigger-engine.ts, or a future TriggerGateNode-driven caller) supplies supabase,
 * branchId, silenceThresholdMs, and an optional getPresenceTyping callback — this Skill
 * never reaches into a module-level global.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SkillDetectionResult } from '@panelito/types'
import type { Skill, SkillContext } from '../skills'
import { checkSilenceGate } from '../silence-gate'

export const silenceBreakSkill: Skill = {
  id: 'silence-break',
  role: 'coach',

  async detect(context: SkillContext): Promise<SkillDetectionResult> {
    const supabase = context.config?.configurable?.supabase as SupabaseClient | undefined
    const branchId = context.config?.configurable?.branchId as string | undefined
    const thresholdMs = context.config?.configurable?.silenceThresholdMs as number | undefined
    const getPresenceTyping = context.config?.configurable?.getPresenceTyping as
      | (() => Promise<boolean>)
      | undefined

    if (!supabase || !branchId || typeof thresholdMs !== 'number') {
      console.error(
        '[silence-break] missing supabase/branchId/silenceThresholdMs in config.configurable — returning no-fire'
      )
      return { fires: false, confidence: 0 }
    }

    const result = await checkSilenceGate({
      supabase,
      branchId,
      thresholdMs,
      getPresenceTyping,
    })

    return { fires: result.passed, confidence: result.passed ? 1 : 0 }
  },

  buildPromptGuidance(_context: SkillContext): string {
    // Short, trigger-specific addition — the Coach's full behavioral contract
    // (question-only, 1-3 sentences, Spanish BAD/GOOD few-shot pairs) already lives
    // in facilitation-agent.ts's buildCoachSystemPrompt() Step 1 and is ALWAYS present
    // in the system prompt ahead of this text; duplicating the few-shot block here
    // would be redundant, so this guidance only names the trigger and points back at
    // the contract already in force.
    return [
      'Trigger: sustained silence — no human message for the configured threshold, and',
      'nobody is currently typing.',
      'Ask a specific, content-aware question that references something concrete already',
      'discussed to re-engage the group (per the behavioral contract above) — never a',
      'generic "¿alguien quiere opinar?" prompt.',
    ].join('\n')
  },
}
