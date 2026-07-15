/**
 * silence-break.test.ts — Unit tests for the silence-break Skill (D-03 retrofit).
 *
 * Covers the four behaviors from 12-03-PLAN.md Task 1:
 *   1. detect() fires when the wrapped checkSilenceGate() reports passed:true
 *   2. detect() does not fire when checkSilenceGate() reports passed:false (typing/too_soon)
 *   3. buildPromptGuidance() returns the Coach content-aware facilitation-question guidance
 *   4. the Skill's id is 'silence-break' and role is 'coach'
 *
 * checkSilenceGate is mocked via vi.mock('../silence-gate') — silence-break.ts's detect()
 * must delegate to it, not reimplement the gate logic (silence-gate.test.ts already covers
 * checkSilenceGate's own five behavior cases exhaustively).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Blueprint } from '@panelito/types'
import type { GraphState } from '../../graph/state'

const checkSilenceGateMock = vi.fn()

vi.mock('../silence-gate', () => ({
  checkSilenceGate: (...args: unknown[]) => checkSilenceGateMock(...args),
}))

import { silenceBreakSkill } from './silence-break'

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

describe('silenceBreakSkill', () => {
  beforeEach(() => {
    checkSilenceGateMock.mockReset()
  })

  it('has id "silence-break" and role "coach"', () => {
    expect(silenceBreakSkill.id).toBe('silence-break')
    expect(silenceBreakSkill.role).toBe('coach')
  })

  it('detect() fires when checkSilenceGate() reports passed:true', async () => {
    checkSilenceGateMock.mockResolvedValue({ passed: true, presence_fallback: false })

    const result = await silenceBreakSkill.detect({
      state: stateStub,
      blueprint: blueprintStub,
      config: {
        configurable: {
          supabase: {},
          branchId: 'branch-1',
          silenceThresholdMs: 5_000,
        },
      },
    })

    expect(result.fires).toBe(true)
    expect(checkSilenceGateMock).toHaveBeenCalledTimes(1)
    expect(checkSilenceGateMock).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'branch-1', thresholdMs: 5_000 })
    )
  })

  it('detect() does not fire when checkSilenceGate() reports passed:false (typing)', async () => {
    checkSilenceGateMock.mockResolvedValue({ passed: false, reason: 'typing', presence_fallback: false })

    const result = await silenceBreakSkill.detect({
      state: stateStub,
      blueprint: blueprintStub,
      config: {
        configurable: {
          supabase: {},
          branchId: 'branch-2',
          silenceThresholdMs: 5_000,
        },
      },
    })

    expect(result.fires).toBe(false)
  })

  it('detect() does not fire when checkSilenceGate() reports passed:false (too_soon)', async () => {
    checkSilenceGateMock.mockResolvedValue({ passed: false, reason: 'too_soon', presence_fallback: false })

    const result = await silenceBreakSkill.detect({
      state: stateStub,
      blueprint: blueprintStub,
      config: {
        configurable: {
          supabase: {},
          branchId: 'branch-3',
          silenceThresholdMs: 5_000,
        },
      },
    })

    expect(result.fires).toBe(false)
  })

  it('buildPromptGuidance() returns the Coach content-aware facilitation-question guidance', () => {
    const guidance = silenceBreakSkill.buildPromptGuidance({
      state: stateStub,
      blueprint: blueprintStub,
      config: {},
    })

    expect(typeof guidance).toBe('string')
    expect(guidance.length).toBeGreaterThan(0)
    // Must reference the silence trigger and content-aware questioning, without
    // duplicating the Spanish BAD/GOOD few-shot block already in buildCoachSystemPrompt.
    expect(guidance.toLowerCase()).toContain('silen')
  })
})
