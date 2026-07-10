/**
 * bot.test.ts — Tests for bot infrastructure types (10-01-PLAN.md Task 1 behavior).
 *
 * Behavior assertions:
 *   - ArgNodeSchema parses a valid node with id, type, label, branch_id
 *   - ArgNodeSchema rejects a node with a missing label
 *   - ArgEdgeSchema parses a valid edge with id, source_id, target_id, relation
 *   - BotBudgetResultSchema parses { allowed, circuit_open, tokens_used_window }
 *   - TriggerMetadataEntrySchema accepts last_fired_at/cooldown_until as string or null
 *   - TriggerMetadataSchema parses a keyed record and an empty object
 */

import { describe, it, expect } from 'vitest'
import {
  ArgNodeSchema,
  ArgEdgeSchema,
  BotBudgetResultSchema,
  TriggerMetadataEntrySchema,
  TriggerMetadataSchema,
} from './bot'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'
const OTHER_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

describe('ArgNodeSchema', () => {
  it('parses a valid ArgNode', () => {
    const result = ArgNodeSchema.parse({
      id: VALID_UUID,
      type: 'claim',
      label: 'AI will replace jobs',
      branch_id: OTHER_UUID,
    })
    expect(result.id).toBe(VALID_UUID)
    expect(result.type).toBe('claim')
    expect(result.label).toBe('AI will replace jobs')
    expect(result.branch_id).toBe(OTHER_UUID)
  })

  it('rejects a node with missing label', () => {
    expect(() =>
      ArgNodeSchema.parse({
        id: VALID_UUID,
        type: 'claim',
        branch_id: OTHER_UUID,
        // label intentionally omitted
      })
    ).toThrow()
  })

  it('rejects a node with invalid uuid for id', () => {
    expect(() =>
      ArgNodeSchema.parse({
        id: 'not-a-uuid',
        type: 'claim',
        label: 'Some claim',
        branch_id: OTHER_UUID,
      })
    ).toThrow()
  })
})

describe('ArgEdgeSchema', () => {
  it('parses a valid ArgEdge', () => {
    const result = ArgEdgeSchema.parse({
      id: VALID_UUID,
      source_id: OTHER_UUID,
      target_id: VALID_UUID,
      relation: 'SUPPORTS',
    })
    expect(result.id).toBe(VALID_UUID)
    expect(result.source_id).toBe(OTHER_UUID)
    expect(result.target_id).toBe(VALID_UUID)
    expect(result.relation).toBe('SUPPORTS')
  })
})

describe('BotBudgetResultSchema', () => {
  it('parses a valid BotBudgetResult', () => {
    const result = BotBudgetResultSchema.parse({
      allowed: true,
      circuit_open: false,
      tokens_used_window: 1500,
    })
    expect(result.allowed).toBe(true)
    expect(result.circuit_open).toBe(false)
    expect(result.tokens_used_window).toBe(1500)
  })
})

describe('TriggerMetadataEntrySchema', () => {
  it('accepts string values for last_fired_at and cooldown_until', () => {
    const result = TriggerMetadataEntrySchema.parse({
      last_fired_at: '2026-07-09T12:00:00Z',
      cooldown_until: '2026-07-09T12:05:00Z',
    })
    expect(result.last_fired_at).toBe('2026-07-09T12:00:00Z')
    expect(result.cooldown_until).toBe('2026-07-09T12:05:00Z')
  })

  it('accepts null values for last_fired_at and cooldown_until', () => {
    const result = TriggerMetadataEntrySchema.parse({
      last_fired_at: null,
      cooldown_until: null,
    })
    expect(result.last_fired_at).toBeNull()
    expect(result.cooldown_until).toBeNull()
  })
})

describe('TriggerMetadataSchema', () => {
  it('parses a record with trigger entries', () => {
    const result = TriggerMetadataSchema.parse({
      silence_gate: { last_fired_at: null, cooldown_until: null },
    })
    expect(result['silence_gate']).toEqual({ last_fired_at: null, cooldown_until: null })
  })

  it('accepts an empty object', () => {
    const result = TriggerMetadataSchema.parse({})
    expect(result).toEqual({})
  })
})
