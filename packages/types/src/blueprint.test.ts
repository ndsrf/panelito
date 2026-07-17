/**
 * blueprint.test.ts — Tests for the D-04 silence↔phase-readiness coupling
 * toggle on BlueprintSchema (14-01-PLAN.md Task 3 behavior, TRIGGER-07).
 *
 * Behavior assertions:
 *   - BlueprintSchema.parse(blueprintWithoutField).silence_phase_readiness_coupling_enabled === false
 *     (Zod default applies when field is absent — existing seeded Blueprints still parse)
 *   - BlueprintSchema.parse({ ...blueprint, silence_phase_readiness_coupling_enabled: true })
 *     yields true (explicit opt-in is respected, not overridden by the default)
 *
 * Fixture mirrors MINIMAL_VALID_BLUEPRINT_DEF in
 * apps/api/src/lib/blueprint-loader.test.ts (drift_reply_probability precedent).
 */

import { describe, it, expect } from 'vitest'
import { BlueprintSchema } from './blueprint'

const MINIMAL_VALID_BLUEPRINT_DEF = {
  id: 'test-v1',
  name: 'Test Blueprint',
  canvas_view_mode: 'graph' as const,
  node_types: [
    { id: 'hypothesis', label: 'Hypothesis', color: '#6366f1', description: 'A hypothesis node' },
  ],
  edge_types: [{ id: 'SUPPORTS', label: 'Supports', color: '#22c55e' }],
  phase_sequence: [
    { id: 'opening', label: 'Opening', llm_instructions: 'Begin the debate.', allowed_node_types: ['hypothesis'] },
  ],
  active_persona_ids: ['analyst'],
}

describe('BlueprintSchema silence_phase_readiness_coupling_enabled', () => {
  it('defaults to false when absent (existing seeded Blueprints still parse)', () => {
    const result = BlueprintSchema.parse(MINIMAL_VALID_BLUEPRINT_DEF)
    expect(result.silence_phase_readiness_coupling_enabled).toBe(false)
  })

  it('respects an explicit true opt-in', () => {
    const result = BlueprintSchema.parse({
      ...MINIMAL_VALID_BLUEPRINT_DEF,
      silence_phase_readiness_coupling_enabled: true,
    })
    expect(result.silence_phase_readiness_coupling_enabled).toBe(true)
  })
})
