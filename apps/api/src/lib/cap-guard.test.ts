/**
 * cap-guard.test.ts — Unit tests for SESS-12 AI response cap guard.
 *
 * Tests the checkCap and incrementCount functions in isolation with
 * mocked Supabase client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// -----------------------------------------------------------------------
// Hoisted mocks BEFORE any imports that use vi.mock()
// -----------------------------------------------------------------------

const { mockFreezeSession } = vi.hoisted(() => {
  return { mockFreezeSession: vi.fn().mockResolvedValue(undefined) }
})

vi.mock('./sessions-helpers', () => ({
  freezeSession: mockFreezeSession,
  SYSTEM_AUTHOR_ID: '00000000-0000-0000-0000-000000000000',
  SYSTEM_DISPLAY_NAME: 'system',
}))

import { checkCap, incrementCount } from './cap-guard'

// -----------------------------------------------------------------------
// Build a flexible Supabase mock
// -----------------------------------------------------------------------

function buildSupabaseMock(state: { ai_response_count: number; ai_response_cap: number }) {
  const mockInsertSingle = vi.fn().mockResolvedValue({ data: {}, error: null })
  const mockInsert = vi.fn(() => ({
    select: () => ({ single: mockInsertSingle }),
  }))

  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { ...state },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'messages') {
        return { insert: mockInsert }
      }
      return {}
    }),
    rpc: vi.fn(),
    channel: vi.fn(() => ({ httpSend: vi.fn().mockResolvedValue({}) })),
  }

  return { mockSupabase, mockInsert, mockInsertSingle }
}

describe('cap-guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFreezeSession.mockResolvedValue(undefined)
  })

  it('Test 1: incrementCount from 0 -> 1 with cap=150 returns threshold_crossed: null', async () => {
    const { mockSupabase } = buildSupabaseMock({ ai_response_count: 0, ai_response_cap: 150 })
    mockSupabase.rpc.mockResolvedValue({
      data: [{ new_count: 1, cap: 150 }],
      error: null,
    })

    const result = await incrementCount(mockSupabase as never, 'session-1')

    expect(result.threshold_crossed).toBeNull()
    expect(result.count).toBe(1)
    expect(result.cap).toBe(150)
    expect(mockFreezeSession).not.toHaveBeenCalled()
  })

  it('Test 2: incrementCount from 134 -> 135 with cap=150 returns threshold_crossed: warning', async () => {
    const { mockSupabase } = buildSupabaseMock({ ai_response_count: 134, ai_response_cap: 150 })
    // 135 >= 0.9 * 150 = 135 (exactly at threshold)
    mockSupabase.rpc.mockResolvedValue({
      data: [{ new_count: 135, cap: 150 }],
      error: null,
    })

    const result = await incrementCount(mockSupabase as never, 'session-2')

    expect(result.threshold_crossed).toBe('warning')
    expect(result.count).toBe(135)
    // Should insert a system warning message
    expect(mockSupabase.from).toHaveBeenCalledWith('messages')
    expect(mockFreezeSession).not.toHaveBeenCalled()
  })

  it('Test 3: incrementCount from 149 -> 150 with cap=150 returns threshold_crossed: cap + freezes', async () => {
    const { mockSupabase } = buildSupabaseMock({ ai_response_count: 149, ai_response_cap: 150 })
    // 150 >= 150 (cap reached)
    mockSupabase.rpc.mockResolvedValue({
      data: [{ new_count: 150, cap: 150 }],
      error: null,
    })

    const result = await incrementCount(mockSupabase as never, 'session-3')

    expect(result.threshold_crossed).toBe('cap')
    expect(result.count).toBe(150)
    // Should insert a system cap message AND freeze
    expect(mockSupabase.from).toHaveBeenCalledWith('messages')
    expect(mockFreezeSession).toHaveBeenCalledWith(
      expect.anything(),
      'session-3',
      'cap_reached'
    )
  })

  it('Test 4: checkCap returns { ok: false, reason: cap_reached } when count >= cap', async () => {
    const { mockSupabase } = buildSupabaseMock({ ai_response_count: 150, ai_response_cap: 150 })

    const result = await checkCap(mockSupabase as never, 'session-4')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('cap_reached')
    }
  })
})
