/**
 * skill.test.ts — Tests for SkillDetectionResultSchema (12-01-PLAN.md Task 1 behavior,
 * D-01/TRIGGER-03/TRIGGER-05) and the additive Blueprint drift_detection_enabled field (D-09).
 *
 * Behavior assertions (12-01-PLAN.md <behavior>):
 *   - SkillDetectionResultSchema.safeParse({ fires: true, confidence: 0.8 }) succeeds
 *   - SkillDetectionResultSchema.safeParse({ fires: true, confidence: 1.5 }) fails (confidence max 1)
 *   - SkillDetectionResultSchema.safeParse({ fires: false, confidence: 0, meta: { claimMessageId: 'x' } }) succeeds
 *   - BlueprintSchema.parse on a definition object WITHOUT drift_detection_enabled yields
 *     drift_detection_enabled === true (Zod default)
 *   - BlueprintSchema.parse with drift_detection_enabled: false yields false
 */

import { describe, it, expect } from 'vitest'
import { SkillDetectionResultSchema } from './skill'
import { BlueprintSchema } from './blueprint'

describe('SkillDetectionResultSchema', () => {
  it('parses a valid firing result with confidence 0.8', () => {
    const result = SkillDetectionResultSchema.safeParse({ fires: true, confidence: 0.8 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.fires).toBe(true)
      expect(result.data.confidence).toBe(0.8)
    }
  })

  it('rejects confidence above 1', () => {
    const result = SkillDetectionResultSchema.safeParse({ fires: true, confidence: 1.5 })
    expect(result.success).toBe(false)
  })

  it('parses a non-firing result with meta payload', () => {
    const result = SkillDetectionResultSchema.safeParse({
      fires: false,
      confidence: 0,
      meta: { claimMessageId: 'x' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.fires).toBe(false)
      expect(result.data.meta).toEqual({ claimMessageId: 'x' })
    }
  })
})

const BASE_BLUEPRINT_DEFINITION = {
  id: 'debate-strategy-v1',
  name: 'Debate & Strategy',
  canvas_view_mode: 'graph' as const,
  node_types: [{ id: 'claim', label: 'Claim', color: '#000000', description: 'A claim.' }],
  edge_types: [{ id: 'SUPPORTS', label: 'Supports', color: '#000000' }],
  phase_sequence: [{ id: 'phase1', label: 'Phase 1', llm_instructions: 'Go.', allowed_node_types: ['claim'] }],
  active_persona_ids: [],
}

describe('BlueprintSchema drift_detection_enabled (D-09)', () => {
  it('defaults drift_detection_enabled to true when absent from the definition', () => {
    const result = BlueprintSchema.parse(BASE_BLUEPRINT_DEFINITION)
    expect(result.drift_detection_enabled).toBe(true)
  })

  it('honors drift_detection_enabled: false when explicitly set', () => {
    const result = BlueprintSchema.parse({ ...BASE_BLUEPRINT_DEFINITION, drift_detection_enabled: false })
    expect(result.drift_detection_enabled).toBe(false)
  })
})
