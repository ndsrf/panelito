/**
 * panel.test.ts — Tests for PanelWidget Zod schemas (AI-05 foundation).
 *
 * All behavior cases from 02-01-PLAN.md Task 1:
 *   - PanelWidgetSchema validates all 4 widget types via a discriminated union
 *   - Malformed/unknown payloads are rejected without throwing (safeParse)
 *   - ReactionSchema rejects emojis not in the 4 power emojis
 *   - PERSONA_LIBRARY has exactly one entry with id 'analista_cientifico'
 */

import { describe, it, expect } from 'vitest'
import { PanelWidgetSchema } from './panel'
import { ReactionSchema } from './reaction'
import { PERSONA_LIBRARY } from './persona'

describe('PanelWidgetSchema', () => {
  // -----------------------------------------------------------------------
  // bento variant
  // -----------------------------------------------------------------------
  it('safeParse a radar payload with 3 axes succeeds', () => {
    const result = PanelWidgetSchema.safeParse({
      widget_type: 'radar',
      axes: [
        { axis: 'Innovation', value: 85 },
        { axis: 'Cost', value: 60 },
        { axis: 'Speed', value: 75 },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('safeParse a radar payload with 1 axis fails (min 3 axes)', () => {
    const result = PanelWidgetSchema.safeParse({
      widget_type: 'radar',
      axes: [{ axis: 'Innovation', value: 85 }],
    })
    expect(result.success).toBe(false)
  })

  it('safeParse a bento payload with 1 card succeeds', () => {
    const result = PanelWidgetSchema.safeParse({
      widget_type: 'bento',
      cards: [{ category: 'Tech', concept: 'AI-driven analytics' }],
    })
    expect(result.success).toBe(true)
  })

  it('safeParse an unknown widget_type fails (discriminated union rejects)', () => {
    const result = PanelWidgetSchema.safeParse({
      widget_type: 'unknown_type',
      data: {},
    })
    expect(result.success).toBe(false)
  })

  it('safeParse a pie payload with 1 segment fails (min 2 segments)', () => {
    const result = PanelWidgetSchema.safeParse({
      widget_type: 'pie',
      segments: [{ label: 'Only one', value: 100 }],
    })
    expect(result.success).toBe(false)
  })

  it('safeParse(null) returns success false and does not throw', () => {
    expect(() => {
      const result = PanelWidgetSchema.safeParse(null)
      expect(result.success).toBe(false)
    }).not.toThrow()
  })
})

describe('ReactionSchema', () => {
  it('rejects an emoji not in the 4 power emojis', () => {
    const result = ReactionSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      message_id: '00000000-0000-0000-0000-000000000002',
      session_id: '00000000-0000-0000-0000-000000000003',
      author_id: '00000000-0000-0000-0000-000000000004',
      emoji: '😀', // not a power emoji
      created_at: '2026-06-13T00:00:00Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('PERSONA_LIBRARY', () => {
  it('has exactly one entry with id analista_cientifico', () => {
    expect(PERSONA_LIBRARY).toHaveLength(1)
    expect(PERSONA_LIBRARY[0]?.id).toBe('analista_cientifico')
  })
})
