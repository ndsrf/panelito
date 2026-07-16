/**
 * moderation-count.test.ts — Unit tests for D-16 moderation-count.ts.
 *
 * Covers: happy-path read returns the stored count; increment returns count+1;
 * a query/RPC error returns 0 (fail-closed, T-12-05) and does not throw.
 * Mocked SupabaseClient follows the bot-arbitrator.test.ts / silence-scan.test.ts
 * chain-mock convention.
 *
 * Phase 13 (D-02, 13-02-PLAN.md Task 2): getModerationCount now reads
 * participant_profiles.moderation_count (moderation_counts folded in +
 * dropped by migration 0016) — table name and selected column updated below.
 */

import { describe, it, expect, vi } from 'vitest'
import { getModerationCount, incrementModerationCount } from './moderation-count'

// -----------------------------------------------------------------------
// Mock builders
// -----------------------------------------------------------------------

function buildSelectMock(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const eq2 = vi.fn().mockReturnValue({ maybeSingle })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  const from = vi.fn().mockReturnValue({ select })
  return { from, select, eq1, eq2, maybeSingle }
}

function buildRpcMock(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) }
}

describe('moderation-count', () => {
  describe('getModerationCount', () => {
    it('happy path: returns the stored count', async () => {
      const { from } = buildSelectMock({ data: { moderation_count: 3 }, error: null })
      const supabase = { from } as never

      const result = await getModerationCount(supabase, 'branch-1', 'participant-1')

      expect(result).toBe(3)
      expect(from).toHaveBeenCalledWith('participant_profiles')
    })

    it('no row yet (first offense): returns 0', async () => {
      const { from } = buildSelectMock({ data: null, error: null })
      const supabase = { from } as never

      const result = await getModerationCount(supabase, 'branch-1', 'participant-1')

      expect(result).toBe(0)
    })

    it('query error: returns 0 and does not throw', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { from } = buildSelectMock({ data: null, error: { message: 'DB error' } })
      const supabase = { from } as never

      const result = await getModerationCount(supabase, 'branch-1', 'participant-1')

      expect(result).toBe(0)
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[moderation-count]'),
        expect.any(String)
      )
      errorSpy.mockRestore()
    })
  })

  describe('incrementModerationCount', () => {
    it('happy path: returns count+1 via the atomic RPC', async () => {
      const { rpc } = buildRpcMock({ data: [{ count: 4 }], error: null })
      const supabase = { rpc } as never

      const result = await incrementModerationCount(supabase, 'branch-1', 'participant-1')

      expect(result).toBe(4)
      expect(rpc).toHaveBeenCalledWith('increment_moderation_count', {
        p_branch_id: 'branch-1',
        p_participant_id: 'participant-1',
      })
    })

    it('RPC error: returns 0 and does not throw', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { rpc } = buildRpcMock({ data: null, error: { message: 'DB error' } })
      const supabase = { rpc } as never

      const result = await incrementModerationCount(supabase, 'branch-1', 'participant-1')

      expect(result).toBe(0)
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it('empty-row RPC response: returns 0 and does not throw', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { rpc } = buildRpcMock({ data: [], error: null })
      const supabase = { rpc } as never

      const result = await incrementModerationCount(supabase, 'branch-1', 'participant-1')

      expect(result).toBe(0)
      errorSpy.mockRestore()
    })
  })
})
