/**
 * silence-gate.test.ts — Unit tests for BOT-03 two-signal silence gate.
 *
 * Tests checkSilenceGate in isolation with mocked Supabase client and injected
 * getPresenceTyping callback. Covers all 5 behavior cases from the plan.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkSilenceGate } from './silence-gate'

// -----------------------------------------------------------------------
// Build a flexible Supabase mock for the messages table query
// -----------------------------------------------------------------------

function buildMessagesMock(lastCreatedAt: string | null, error: unknown = null) {
  const orderResult = { data: lastCreatedAt ? [{ created_at: lastCreatedAt }] : [], error }
  return {
    rpc: vi.fn(),
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(orderResult),
          }),
        }),
      }),
    }),
  }
}

// Helper: create an ISO timestamp N milliseconds in the past
function msAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

describe('silence-gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Test 1: elapsed >= threshold AND no typing — gate passes (passed: true)', async () => {
    const mockSupabase = buildMessagesMock(msAgo(10_000))
    const getPresenceTyping = vi.fn().mockResolvedValue(false)

    const result = await checkSilenceGate({
      supabase: mockSupabase as never,
      branchId: 'branch-1',
      thresholdMs: 5_000,
      getPresenceTyping,
    })

    expect(result.passed).toBe(true)
    expect(result.presence_fallback).toBe(false)
    expect(result.reason).toBeUndefined()
  })

  it('Test 2: participant is_typing — gate blocks with reason: typing (even when threshold met)', async () => {
    const mockSupabase = buildMessagesMock(msAgo(10_000))
    const getPresenceTyping = vi.fn().mockResolvedValue(true)

    const result = await checkSilenceGate({
      supabase: mockSupabase as never,
      branchId: 'branch-2',
      thresholdMs: 5_000,
      getPresenceTyping,
    })

    expect(result.passed).toBe(false)
    expect(result.reason).toBe('typing')
    expect(result.presence_fallback).toBe(false)
  })

  it('Test 3: elapsed < threshold — gate blocks with reason: too_soon', async () => {
    const mockSupabase = buildMessagesMock(msAgo(2_000))
    const getPresenceTyping = vi.fn().mockResolvedValue(false)

    const result = await checkSilenceGate({
      supabase: mockSupabase as never,
      branchId: 'branch-3',
      thresholdMs: 5_000,
      getPresenceTyping,
    })

    expect(result.passed).toBe(false)
    expect(result.reason).toBe('too_soon')
    expect(result.presence_fallback).toBe(false)
  })

  it('Test 4: getPresenceTyping rejects (WSL2) — fallback assumes not typing, presence_fallback: true, still enforces threshold', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Elapsed exceeds threshold — gate should pass if presence falls back
    const mockSupabase = buildMessagesMock(msAgo(10_000))
    const getPresenceTyping = vi.fn().mockRejectedValue(new Error('WebSocket closed'))

    const result = await checkSilenceGate({
      supabase: mockSupabase as never,
      branchId: 'branch-4',
      thresholdMs: 5_000,
      getPresenceTyping,
    })

    // WSL2 fallback: presence check failed → assume not typing → gate passes
    expect(result.passed).toBe(true)
    expect(result.presence_fallback).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[silence-gate]'),
      expect.anything()
    )
    warnSpy.mockRestore()
  })

  it('Test 4b: WSL2 fallback with elapsed < threshold — gate still blocks (reason: too_soon, presence_fallback: false)', async () => {
    // Elapsed is LESS than threshold — too_soon short-circuits before presence check
    // Per plan step 2: too_soon return has presence_fallback:false (presence never called)
    const mockSupabase = buildMessagesMock(msAgo(2_000))
    const getPresenceTyping = vi.fn().mockRejectedValue(new Error('WebSocket closed'))

    const result = await checkSilenceGate({
      supabase: mockSupabase as never,
      branchId: 'branch-4b',
      thresholdMs: 5_000,
      getPresenceTyping,
    })

    expect(result.passed).toBe(false)
    expect(result.reason).toBe('too_soon')
    // too_soon fires before presence is checked, so presence_fallback is false
    expect(result.presence_fallback).toBe(false)
    // Presence fn should not have been called since we short-circuited
    expect(getPresenceTyping).not.toHaveBeenCalled()
  })

  it('Test 5: messages table error — gate blocks (fail-safe) and logs error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockSupabase = buildMessagesMock(null, { message: 'DB error' })
    const getPresenceTyping = vi.fn().mockResolvedValue(false)

    const result = await checkSilenceGate({
      supabase: mockSupabase as never,
      branchId: 'branch-5',
      thresholdMs: 5_000,
      getPresenceTyping,
    })

    expect(result.passed).toBe(false)
    expect(result.reason).toBe('too_soon')
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[silence-gate]'),
      expect.anything()
    )
    errorSpy.mockRestore()
  })
})
