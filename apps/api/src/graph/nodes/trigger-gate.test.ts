/**
 * trigger-gate.test.ts — Unit tests for TriggerGateNode (Phase 12 Plan 06 Task 1).
 *
 * Covers the six behaviors from 12-06-PLAN.md Task 1:
 *   1. Coach disabled + Analyst disabled → zero Skills evaluated, all-null result
 *   2. a disabled Role's Skills never get detect() called (role-gate before candidate assembly)
 *   3. the first firing Skill (array/priority order) wins
 *   4. a throwing Skill.detect() does not block sibling Skills and does not throw
 *   5. a missing blueprint fails open: console.error + all-null, never throws
 *   6. blueprint.bot_defaults fallback is honored when botOverrides is absent
 *
 * COACH_SKILLS/ANALYST_SKILLS are mocked via vi.mock('../../lib/skills') so every Skill's
 * detect() is a directly-observable spy — this is the ONLY way to assert "zero detect() calls"
 * for a disabled Role deterministically (the real Skill modules do real ONNX/Supabase/heuristic
 * work that would make call-count assertions unreliable and slow).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Blueprint } from '@panelito/types'
import type { GraphState } from '../state'

// ---------------------------------------------------------------------------
// Mock skills.ts — fixed COACH_SKILLS (2 entries, priority order) / ANALYST_SKILLS (1 entry)
// Suffix-Mock naming (not prefix) matches this codebase's existing convention
// (silence-break.test.ts's checkSilenceGateMock) for vi.mock hoisting safety.
// ---------------------------------------------------------------------------

const coachSkillADetectMock = vi.fn()
const coachSkillBDetectMock = vi.fn()
const analystSkillADetectMock = vi.fn()

vi.mock('../../lib/skills', () => ({
  COACH_SKILLS: [
    {
      id: 'coach-a',
      role: 'coach',
      detect: (...args: unknown[]) => coachSkillADetectMock(...args),
      buildPromptGuidance: () => '',
    },
    {
      id: 'coach-b',
      role: 'coach',
      detect: (...args: unknown[]) => coachSkillBDetectMock(...args),
      buildPromptGuidance: () => '',
    },
  ],
  ANALYST_SKILLS: [
    {
      id: 'analyst-a',
      role: 'analyst',
      detect: (...args: unknown[]) => analystSkillADetectMock(...args),
      buildPromptGuidance: () => '',
    },
  ],
}))

import { triggerGateNode } from './trigger-gate'

const blueprintStub = {
  id: 'bp-1',
  name: 'Test Blueprint',
  canvas_view_mode: 'graph',
  node_types: [],
  edge_types: [],
  phase_sequence: [],
  active_persona_ids: [],
  drift_reply_probability: 0.8,
  drift_detection_enabled: true,
  bot_defaults: {},
  role_personalities: {},
} as unknown as Blueprint

const stateStub = {
  messages: [],
  canvasOps: [],
  argGraph: { nodes: [], edges: [] },
} as unknown as GraphState

function makeConfig(overrides: {
  blueprint?: Blueprint | undefined
  botOverrides?: Record<string, boolean>
}) {
  return {
    configurable: {
      blueprint: 'blueprint' in overrides ? overrides.blueprint : blueprintStub,
      botOverrides: overrides.botOverrides,
    },
  }
}

describe('triggerGateNode', () => {
  beforeEach(() => {
    coachSkillADetectMock.mockReset()
    coachSkillBDetectMock.mockReset()
    analystSkillADetectMock.mockReset()
  })

  it('Behavior 1: Coach disabled + Analyst disabled → zero Skills evaluated, all-null result', async () => {
    const result = await triggerGateNode(
      stateStub,
      makeConfig({ botOverrides: { coach: false, analyst: false } })
    )

    expect(coachSkillADetectMock).not.toHaveBeenCalled()
    expect(coachSkillBDetectMock).not.toHaveBeenCalled()
    expect(analystSkillADetectMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      firingSkillId: null,
      firingSkillRole: null,
      skillMeta: null,
      triggerGateComplete: true,
    })
  })

  it('Behavior 2: a disabled Role\'s Skills never get detect() called (role-gate before candidate assembly)', async () => {
    coachSkillADetectMock.mockResolvedValue({ fires: false, confidence: 0 })
    coachSkillBDetectMock.mockResolvedValue({ fires: false, confidence: 0 })

    const result = await triggerGateNode(
      stateStub,
      makeConfig({ botOverrides: { coach: true, analyst: false } })
    )

    expect(coachSkillADetectMock).toHaveBeenCalledTimes(1)
    expect(coachSkillBDetectMock).toHaveBeenCalledTimes(1)
    // Analyst is disabled — its Skill must receive ZERO detect() calls.
    expect(analystSkillADetectMock).not.toHaveBeenCalled()
    expect(result.firingSkillId).toBeNull()
  })

  it('Behavior 3: the first firing Skill (array/priority order) wins', async () => {
    coachSkillADetectMock.mockResolvedValue({ fires: true, confidence: 0.9, meta: { foo: 'bar' } })
    coachSkillBDetectMock.mockResolvedValue({ fires: true, confidence: 0.95 })
    analystSkillADetectMock.mockResolvedValue({ fires: false, confidence: 0 })

    const result = await triggerGateNode(
      stateStub,
      makeConfig({ botOverrides: { coach: true, analyst: true } })
    )

    // Both coach Skills evaluated (Promise.allSettled fans out to all candidates)...
    expect(coachSkillADetectMock).toHaveBeenCalledTimes(1)
    expect(coachSkillBDetectMock).toHaveBeenCalledTimes(1)
    // ...but coach-a (array order first) wins, not coach-b, even though both fire.
    expect(result).toEqual({
      firingSkillId: 'coach-a',
      firingSkillRole: 'coach',
      skillMeta: { foo: 'bar' },
      triggerGateComplete: true,
    })
  })

  it('Behavior 4: a throwing Skill.detect() does not block sibling Skills and does not throw', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    coachSkillADetectMock.mockRejectedValue(new Error('boom — malformed regex'))
    coachSkillBDetectMock.mockResolvedValue({ fires: true, confidence: 0.8 })
    analystSkillADetectMock.mockResolvedValue({ fires: false, confidence: 0 })

    const result = await triggerGateNode(
      stateStub,
      makeConfig({ botOverrides: { coach: true, analyst: true } })
    )

    // TriggerGateNode never throws despite coach-a rejecting.
    expect(result).toEqual({
      firingSkillId: 'coach-b',
      firingSkillRole: 'coach',
      skillMeta: null,
      triggerGateComplete: true,
    })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[trigger-gate]'),
      expect.any(Error)
    )
    warnSpy.mockRestore()
  })

  it('Behavior 5: a missing blueprint fails open — console.error + all-null, never throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await triggerGateNode(stateStub, makeConfig({ blueprint: undefined }))

    expect(coachSkillADetectMock).not.toHaveBeenCalled()
    expect(analystSkillADetectMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      firingSkillId: null,
      firingSkillRole: null,
      skillMeta: null,
      triggerGateComplete: true,
    })
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[trigger-gate]'))
    errorSpy.mockRestore()
  })

  it('Behavior 6: blueprint.bot_defaults fallback is honored when botOverrides is absent (D-07)', async () => {
    coachSkillADetectMock.mockResolvedValue({ fires: false, confidence: 0 })
    coachSkillBDetectMock.mockResolvedValue({ fires: false, confidence: 0 })
    analystSkillADetectMock.mockResolvedValue({ fires: true, confidence: 0.7, meta: { claimMessageId: 'm1' } })

    const blueprintWithDefaults = {
      ...blueprintStub,
      bot_defaults: { coach: false, analyst: true },
    } as unknown as Blueprint

    const result = await triggerGateNode(stateStub, {
      configurable: { blueprint: blueprintWithDefaults },
    })

    expect(coachSkillADetectMock).not.toHaveBeenCalled()
    expect(coachSkillBDetectMock).not.toHaveBeenCalled()
    expect(analystSkillADetectMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      firingSkillId: 'analyst-a',
      firingSkillRole: 'analyst',
      skillMeta: { claimMessageId: 'm1' },
      triggerGateComplete: true,
    })
  })
})
