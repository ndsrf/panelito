/**
 * bot-arbitrator.test.ts — Unit tests for BOT-02 BotArbitrator plugin registry.
 *
 * Tests registerBot + runArbitration in isolation with mocked Supabase client.
 * Covers the 5 behavior cases from the plan.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// We re-import fresh module state each describe block via vi.resetModules()
// to reset the module-level _registry between test groups.
// (Same pattern as cap-guard tests using vi.clearAllMocks)

// -----------------------------------------------------------------------
// Build a flexible Supabase mock
// -----------------------------------------------------------------------

function buildRpcMock(rpcResult: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
    from: vi.fn(),
    channel: vi.fn(),
  }
}

// -----------------------------------------------------------------------
// Test helpers — import after vi.resetModules() to get fresh module
// -----------------------------------------------------------------------

async function importFresh() {
  const mod = await import('./bot-arbitrator')
  return mod
}

// Blueprint stub matching the Blueprint type shape
const blueprintStub = {
  id: 'bp-1',
  name: 'Test Blueprint',
  canvas_view_mode: 'graph' as const,
  node_types: [{ id: 'claim', label: 'Claim', color: '#fff', description: 'A claim' }],
  edge_types: [{ id: 'supports', label: 'Supports', color: '#000' }],
  phase_sequence: [{ id: 'p1', label: 'Phase 1', llm_instructions: '...', allowed_node_types: ['claim'], phase_readiness_gate: { min_nodes: 3, min_messages_after: 5 } }],
  active_persona_ids: [],
  drift_reply_probability: 0.8,
  drift_detection_enabled: true,
  bot_defaults: {},
  role_personalities: {},
}

describe('bot-arbitrator', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('Test 1: empty registry — runArbitration returns null without calling supabase.rpc', async () => {
    const { runArbitration } = await importFresh()
    const mockSupabase = buildRpcMock({ data: [{ acquired: true }], error: null })

    const result = await runArbitration('branch-1', blueprintStub, mockSupabase as never)

    expect(result).toBeNull()
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('Test 2: two scorers registered — picks highest score, acquires lock, returns winner', async () => {
    const { registerBot, runArbitration } = await importFresh()
    const mockSupabase = buildRpcMock({ data: [{ acquired: true }], error: null })

    registerBot('botA', () => 3)
    registerBot('botB', () => 7)

    const result = await runArbitration('branch-2', blueprintStub, mockSupabase as never)

    expect(result).toBe('botB')
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1)
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'try_acquire_bot_lock',
      expect.objectContaining({ p_bot_id: 'botB' })
    )
  })

  it('Test 3: lock not granted (acquired: false) — runArbitration returns null', async () => {
    const { registerBot, runArbitration } = await importFresh()
    const mockSupabase = buildRpcMock({ data: [{ acquired: false }], error: null })

    registerBot('botA', () => 5)

    const result = await runArbitration('branch-3', blueprintStub, mockSupabase as never)

    expect(result).toBeNull()
  })

  it('Test 4: supabase.rpc returns error — runArbitration returns null and logs warning', async () => {
    const { registerBot, runArbitration } = await importFresh()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mockSupabase = buildRpcMock({ data: null, error: { message: 'DB error' } })

    registerBot('botA', () => 5)

    const result = await runArbitration('branch-4', blueprintStub, mockSupabase as never)

    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[bot-arbitrator]'),
      expect.any(String),
      expect.anything()
    )
    warnSpy.mockRestore()
  })

  it('Test 5: locked_until derived from blueprint.bot_cooldowns[winner].window_minutes (or default if absent)', async () => {
    const { registerBot, runArbitration } = await importFresh()
    const mockSupabase = buildRpcMock({ data: [{ acquired: true }], error: null })

    // Blueprint with bot_cooldowns map — REAL shape (Plan 02): Record<string, {max, window_minutes}>,
    // not the stale Record<string, number> (seconds) shape this test used to encode.
    // 1 minute window_minutes -> 60s cooldown, matching the original test's ~60s assertion.
    const blueprintWithCooldown = {
      ...blueprintStub,
      bot_cooldowns: { botA: { max: 3, window_minutes: 1 } },
    }

    registerBot('botA', () => 5)

    const beforeTime = Date.now()
    await runArbitration('branch-5', blueprintWithCooldown as never, mockSupabase as never)
    const afterTime = Date.now()

    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'try_acquire_bot_lock',
      expect.objectContaining({
        p_bot_id: 'botA',
        p_branch_id: 'branch-5',
        p_locked_until: expect.any(String),
      })
    )

    // Verify p_locked_until is approximately now + 60s
    const call = mockSupabase.rpc.mock.calls[0]![1] as { p_locked_until: string }
    const lockedUntil = new Date(call.p_locked_until).getTime()
    expect(lockedUntil).toBeGreaterThanOrEqual(beforeTime + 59_000)
    expect(lockedUntil).toBeLessThanOrEqual(afterTime + 61_000)
  })
})
