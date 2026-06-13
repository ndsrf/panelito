/**
 * auto-freeze.test.ts — Unit tests for SESS-07 + SESS-11 auto-freeze tracker.
 *
 * Uses vi.useFakeTimers() to simulate 30s grace + 15min freeze timers without
 * waiting real time.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// -----------------------------------------------------------------------
// Hoisted mock for Supabase and freeze helper BEFORE importing module
// -----------------------------------------------------------------------

const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'session-1', status: 'frozen' }, error: null })
const mockSelect = vi.fn(() => ({ single: mockSingle }))
const mockEq = vi.fn(() => ({ select: mockSelect }))
const mockUpdate = vi.fn(() => ({ eq: mockEq }))
const mockInsert = vi.fn(() => ({ select: mockSelect }))
const mockHttpSend = vi.fn().mockResolvedValue({})
const mockChannel = vi.fn(() => ({ httpSend: mockHttpSend }))
const mockFrom = vi.fn((table: string) => {
  if (table === 'sessions') return { update: mockUpdate }
  if (table === 'messages') return { insert: mockInsert }
  return {}
})

const mockSupabase = {
  from: mockFrom,
  channel: mockChannel,
}

// We test onCreatorPresenceChange directly, passing the mock supabase
import { onCreatorPresenceChange } from './auto-freeze'

describe('auto-freeze tracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockFrom.mockClear()
    mockUpdate.mockClear()
    mockInsert.mockClear()
    mockEq.mockClear()
    mockSelect.mockClear()
    mockSingle.mockClear()
    mockHttpSend.mockClear()
    mockUpdate.mockImplementation(() => ({ eq: mockEq }))
    mockEq.mockImplementation(() => ({ select: mockSelect }))
    mockInsert.mockImplementation(() => ({ select: mockSelect }))
    mockSelect.mockImplementation(() => ({ single: mockSingle }))
    mockSingle.mockResolvedValue({ data: { id: 'session-1', status: 'frozen' }, error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('Test 1: presence drop -> after 30s grace + 15min freeze fires', async () => {
    const sessionId = 'session-1'
    const creatorId = 'creator-1'

    onCreatorPresenceChange(sessionId, creatorId, false, mockSupabase as never)

    // Before grace period ends — should NOT have called freeze yet
    vi.advanceTimersByTime(29_000)
    await Promise.resolve()
    expect(mockUpdate).not.toHaveBeenCalled()

    // Advance past 30s grace boundary
    vi.advanceTimersByTime(2_000) // total 31s
    await Promise.resolve()
    // Still in 15-min countdown, no freeze yet
    expect(mockUpdate).not.toHaveBeenCalled()

    // Advance past the 15-min countdown
    vi.advanceTimersByTime(15 * 60_000 + 1_000)
    await Promise.resolve()
    // Flush microtasks from the async freeze
    await vi.runAllTimersAsync()

    // Now freeze should have fired (twice: once for session status update, once for system message insert)
    expect(mockFrom).toHaveBeenCalledTimes(2)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'frozen' })
    )
  })

  it('Test 2: presence drop -> reconnect within 30s grace -> NO freeze fires', async () => {
    const sessionId = 'session-2'
    const creatorId = 'creator-2'

    onCreatorPresenceChange(sessionId, creatorId, false, mockSupabase as never)

    // Reconnect at 15s — within 30s grace window
    vi.advanceTimersByTime(15_000)
    onCreatorPresenceChange(sessionId, creatorId, true, mockSupabase as never)

    // Advance way past freeze window
    vi.advanceTimersByTime(20 * 60_000)
    await vi.runAllTimersAsync()

    // No freeze should have fired
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('Test 3: presence drop -> 60s absence -> reconnect at 5-min mark -> NO freeze fires', async () => {
    const sessionId = 'session-3'
    const creatorId = 'creator-3'

    onCreatorPresenceChange(sessionId, creatorId, false, mockSupabase as never)

    // Advance past 30s grace — real absence starts (15min countdown begins)
    vi.advanceTimersByTime(31_000)
    await Promise.resolve()

    // Reconnect at 5-min mark of the 15-min countdown
    vi.advanceTimersByTime(5 * 60_000)
    onCreatorPresenceChange(sessionId, creatorId, true, mockSupabase as never)

    // Advance past where freeze would have fired if not canceled
    vi.advanceTimersByTime(15 * 60_000)
    await vi.runAllTimersAsync()

    // No freeze should have fired
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('Test 4: two presence drops in quick succession do NOT stack timers — only one fires', async () => {
    const sessionId = 'session-4'
    const creatorId = 'creator-4'

    onCreatorPresenceChange(sessionId, creatorId, false, mockSupabase as never)
    vi.advanceTimersByTime(5_000)

    // Second drop while still in grace window — should reset single timer, not stack
    onCreatorPresenceChange(sessionId, creatorId, false, mockSupabase as never)

    // Advance past total time needed for both potential freezes
    vi.advanceTimersByTime(30_000 + 15 * 60_000 + 1_000)
    await vi.runAllTimersAsync()

    // freeze should fire exactly once (but calls from() twice internally: session update + system message)
    expect(mockFrom).toHaveBeenCalledTimes(2)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })
})
