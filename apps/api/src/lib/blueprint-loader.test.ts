/**
 * blueprint-loader.test.ts — Tests for Blueprint Zod schema and Ajv meta-schema (06-01-PLAN.md Task 2).
 *
 * Behavior assertions:
 *   (a) loadBlueprint('debate-strategy-v1') resolves without throwing
 *       — the seeded Blueprint lacks drift_reply_probability but must still validate (BLUE-02)
 *       — Zod default(0.8) fills in the missing field
 *   (b) A Blueprint object with drift_reply_probability: 0.3 validates through Ajv and Zod
 *       — yields 0.3 (not the default)
 *   (c) drift_reply_probability: 1.5 is rejected by Zod (.max(1) constraint)
 *       — BlueprintSchema.parse() throws ZodError
 *   (d) BlueprintSchema.parse(blueprintWithoutDriftField) yields drift_reply_probability === 0.8
 *       — Zod default applies when field is absent
 */

import { describe, it, expect } from 'vitest'
import { loadBlueprint } from './blueprint-loader'
import { BlueprintSchema } from '@panelito/types'

// ---------------------------------------------------------------------------
// Minimal valid blueprint definition (mirrors the seeded debate-strategy-v1
// structure but using a synthetic payload to avoid DB dependency in unit tests)
// ---------------------------------------------------------------------------
const MINIMAL_VALID_BLUEPRINT_DEF = {
  id: 'test-v1',
  name: 'Test Blueprint',
  canvas_view_mode: 'graph' as const,
  node_types: [
    { id: 'hypothesis', label: 'Hypothesis', color: '#6366f1', description: 'A hypothesis node' },
  ],
  edge_types: [
    { id: 'SUPPORTS', label: 'Supports', color: '#22c55e' },
  ],
  phase_sequence: [
    { id: 'opening', label: 'Opening', llm_instructions: 'Begin the debate.', allowed_node_types: ['hypothesis'] },
  ],
  active_persona_ids: ['analyst'],
}

// ---------------------------------------------------------------------------
// (a) Integration: loadBlueprint resolves for the seeded debate-strategy-v1
// This test requires a live Supabase instance and the seeded Blueprint row.
// ---------------------------------------------------------------------------
describe('loadBlueprint (integration)', () => {
  it('resolves for debate-strategy-v1 (seeded blueprint, no drift field)', async () => {
    const blueprint = await loadBlueprint('debate-strategy-v1')
    expect(blueprint).toBeDefined()
    expect(blueprint.id).toBe('debate-strategy-v1')
    // Zod default(0.8) must supply the drift field since the seed has no drift_reply_probability
    expect(blueprint.drift_reply_probability).toBe(0.8)
  })
})

// ---------------------------------------------------------------------------
// (b) BlueprintSchema: drift_reply_probability: 0.3 yields 0.3
// ---------------------------------------------------------------------------
describe('BlueprintSchema drift_reply_probability', () => {
  it('yields 0.3 when drift_reply_probability is explicitly 0.3', () => {
    const result = BlueprintSchema.parse({
      ...MINIMAL_VALID_BLUEPRINT_DEF,
      drift_reply_probability: 0.3,
    })
    expect(result.drift_reply_probability).toBe(0.3)
  })

  // ---------------------------------------------------------------------------
  // (d) drift_reply_probability defaults to 0.8 when absent
  // ---------------------------------------------------------------------------
  it('defaults to 0.8 when drift_reply_probability is absent', () => {
    const result = BlueprintSchema.parse(MINIMAL_VALID_BLUEPRINT_DEF)
    expect(result.drift_reply_probability).toBe(0.8)
  })

  // ---------------------------------------------------------------------------
  // (c) drift_reply_probability: 1.5 is rejected by Zod
  // ---------------------------------------------------------------------------
  it('throws ZodError when drift_reply_probability is 1.5 (out of [0,1] range)', () => {
    expect(() =>
      BlueprintSchema.parse({
        ...MINIMAL_VALID_BLUEPRINT_DEF,
        drift_reply_probability: 1.5,
      })
    ).toThrow()
  })

  it('throws ZodError when drift_reply_probability is -0.1 (below 0)', () => {
    expect(() =>
      BlueprintSchema.parse({
        ...MINIMAL_VALID_BLUEPRINT_DEF,
        drift_reply_probability: -0.1,
      })
    ).toThrow()
  })

  it('accepts 0.0 (lower boundary)', () => {
    const result = BlueprintSchema.parse({
      ...MINIMAL_VALID_BLUEPRINT_DEF,
      drift_reply_probability: 0.0,
    })
    expect(result.drift_reply_probability).toBe(0.0)
  })

  it('accepts 1.0 (upper boundary)', () => {
    const result = BlueprintSchema.parse({
      ...MINIMAL_VALID_BLUEPRINT_DEF,
      drift_reply_probability: 1.0,
    })
    expect(result.drift_reply_probability).toBe(1.0)
  })
})
