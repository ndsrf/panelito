/**
 * bot-budget.test.ts — Unit tests for BOT-01 token budget guard wrapper.
 *
 * Tests checkBotBudget in isolation with mocked Supabase client.
 * Covers the 4 behavior cases from the plan.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkBotBudget } from './bot-budget'

// -----------------------------------------------------------------------
// Build a flexible Supabase mock
// -----------------------------------------------------------------------

function buildRpcMock(result: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
    from: vi.fn(),
  }
}

describe('bot-budget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Test 1: RPC returns allowed row — checkBotBudget returns typed BotBudgetResult', async () => {
    const mockSupabase = buildRpcMock({
      data: [{ allowed: true, circuit_open: false, tokens_used_window: 120 }],
      error: null,
    })

    const result = await checkBotBudget(mockSupabase as never, 'branch-1', 50)

    expect(result).toEqual({
      allowed: true,
      circuit_open: false,
      tokens_used_window: 120,
    })
    expect(mockSupabase.rpc).toHaveBeenCalledWith('check_and_record_bot_budget', {
      p_branch_id: 'branch-1',
      p_tokens_used: 50,
    })
  })

  it('Test 2: circuit tripped (allowed: false, circuit_open: true) — returns correct shape', async () => {
    const mockSupabase = buildRpcMock({
      data: [{ allowed: false, circuit_open: true, tokens_used_window: 0 }],
      error: null,
    })

    const result = await checkBotBudget(mockSupabase as never, 'branch-2', 0)

    expect(result.allowed).toBe(false)
    expect(result.circuit_open).toBe(true)
    expect(result.tokens_used_window).toBe(0)
  })

  it('Test 3: supabase.rpc errors — returns fail-closed result and logs error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockSupabase = buildRpcMock({
      data: null,
      error: { message: 'Connection error' },
    })

    const result = await checkBotBudget(mockSupabase as never, 'branch-3', 100)

    expect(result).toEqual({ allowed: false, circuit_open: false, tokens_used_window: 0 })
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[bot-budget]'),
      expect.anything()
    )
    errorSpy.mockRestore()
  })

  it('Test 4: supabase.rpc returns empty rows — returns fail-closed result (T-10-07)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockSupabase = buildRpcMock({
      data: [],
      error: null,
    })

    const result = await checkBotBudget(mockSupabase as never, 'branch-4', 100)

    expect(result.allowed).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[bot-budget]'),
      expect.anything()
    )
    errorSpy.mockRestore()
  })
})
