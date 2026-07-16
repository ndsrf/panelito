/**
 * participant-profile.test.ts — Unit tests for PROFILE-01/02 participant-profile.ts.
 *
 * Covers: getParticipantProfile happy-path row read, null on no-row, fail-closed
 * null (never throw) on query error; upsertParticipantProfile happy-path RPC call
 * shape, and no-throw/log-only on RPC error. Mocked SupabaseClient follows the
 * moderation-count.test.ts chain-mock convention (13-02-PLAN.md Task 2 <behavior>).
 */

import { describe, it, expect, vi } from 'vitest'
import { getParticipantProfile, upsertParticipantProfile } from './participant-profile'

// -----------------------------------------------------------------------
// Mock builders (mirrors moderation-count.test.ts)
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

const SAMPLE_ROW = {
  branch_id: 'branch-1',
  participant_id: 'participant-1',
  positions: ['We should ship v1 first'],
  assertions: ['The API is REST, not GraphQL'],
  messages_sent: 5,
  reactions_used: 2,
  moderation_count: 0,
  updated_at: '2026-07-16T00:00:00.000Z',
}

describe('participant-profile', () => {
  describe('getParticipantProfile', () => {
    it('happy path: returns the stored profile row', async () => {
      const { from } = buildSelectMock({ data: SAMPLE_ROW, error: null })
      const supabase = { from } as never

      const result = await getParticipantProfile(supabase, 'branch-1', 'participant-1')

      expect(result).toEqual(SAMPLE_ROW)
      expect(from).toHaveBeenCalledWith('participant_profiles')
    })

    it('no row yet: returns null (not throw)', async () => {
      const { from } = buildSelectMock({ data: null, error: null })
      const supabase = { from } as never

      const result = await getParticipantProfile(supabase, 'branch-1', 'participant-1')

      expect(result).toBeNull()
    })

    it('query error: returns null and does not throw (fail-closed)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { from } = buildSelectMock({ data: null, error: { message: 'DB error' } })
      const supabase = { from } as never

      const result = await getParticipantProfile(supabase, 'branch-1', 'participant-1')

      expect(result).toBeNull()
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[participant-profile]'),
        expect.any(String)
      )
      errorSpy.mockRestore()
    })
  })

  describe('upsertParticipantProfile', () => {
    it('happy path: calls upsert_participant_profile RPC with the six params', async () => {
      const { rpc } = buildRpcMock({ data: [SAMPLE_ROW], error: null })
      const supabase = { rpc } as never

      await upsertParticipantProfile(supabase, {
        branchId: 'branch-1',
        participantId: 'participant-1',
        positions: ['pos-1'],
        assertions: ['assert-1'],
        messagesSent: 3,
        reactionsUsed: 1,
      })

      expect(rpc).toHaveBeenCalledWith('upsert_participant_profile', {
        p_branch_id: 'branch-1',
        p_participant_id: 'participant-1',
        p_positions: ['pos-1'],
        p_assertions: ['assert-1'],
        p_messages_sent: 3,
        p_reactions_used: 1,
      })
    })

    it('RPC error: does not throw (logs and returns)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { rpc } = buildRpcMock({ data: null, error: { message: 'DB error' } })
      const supabase = { rpc } as never

      await expect(
        upsertParticipantProfile(supabase, {
          branchId: 'branch-1',
          participantId: 'participant-1',
          positions: [],
          assertions: [],
          messagesSent: 0,
          reactionsUsed: 0,
        })
      ).resolves.toBeUndefined()

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[participant-profile]'),
        expect.any(String)
      )
      errorSpy.mockRestore()
    })
  })
})
