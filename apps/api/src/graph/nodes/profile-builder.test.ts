/**
 * profile-builder.test.ts — Unit tests for profileBuilderNode (Phase 13 Task 2, D-03/D-04/D-05/D-06).
 *
 * Mocks the injected Supabase service client (chain-mock convention from
 * orphan-edge.test.ts / moderation-count.test.ts) — '../../lib/supabase' is not touched
 * since config.configurable.serviceClient is always injected in these tests.
 *
 * Covers the plan's <behavior> block:
 *   1. missing branchId -> logs + returns {} (never throws)
 *   2. two speakers, two distinct message_ids/author_ids -> two profile upserts
 *   3. positions/assertions sliced to at most 20 most-recent items each
 *   4. messages_sent/reactions_used COUNT queries filter role='user'
 *   5. AI-attribution skip: a resolved message with role='assistant' is never attributed
 *   6. a thrown I/O error inside the loop is caught — the node still returns {}
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ArgNode } from '@panelito/types'
import { profileBuilderNode } from './profile-builder'
import type { GraphState } from '../state'

// ---------------------------------------------------------------------------
// Supabase chain-mock builder
// ---------------------------------------------------------------------------

/** A chainable-and-thenable mock query builder — mirrors supabase-js's PostgrestFilterBuilder,
 * which is itself awaitable after any number of .eq() calls (no terminal method required for
 * a head:true count query). Captures the LAST 'author_id'-keyed .eq() call to select the
 * resolveByAuthorId entry keyed by that value. */
function makeCountChain(resolveByAuthorId: Record<string, { count: number | null; error: unknown }>) {
  let capturedAuthorId: string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    eq: vi.fn((col: string, val: string) => {
      if (col === 'author_id') capturedAuthorId = val
      return chain
    }),
  }
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    const result = capturedAuthorId
      ? (resolveByAuthorId[capturedAuthorId] ?? { count: 0, error: null })
      : { count: null, error: { message: 'no author_id captured' } }
    return Promise.resolve(result).then(resolve, reject)
  }
  return chain
}

function buildSupabaseMock(opts: {
  messagesLookupByMessageId: Record<string, { data: unknown; error: unknown }>
  messagesSentCountByAuthor?: Record<string, { count: number | null; error: unknown }>
  reactionsUsedCountByAuthor?: Record<string, { count: number | null; error: unknown }>
  throwOnMessagesLookup?: boolean
}) {
  const rpc = vi.fn().mockResolvedValue({ data: [{}], error: null })

  const messagesSelect = vi.fn((_cols: string, options?: { count?: string; head?: boolean }) => {
    if (options?.count) {
      return makeCountChain(opts.messagesSentCountByAuthor ?? {})
    }
    return {
      eq: vi.fn((_col: string, messageId: string) => ({
        maybeSingle: vi.fn().mockImplementation(async () => {
          if (opts.throwOnMessagesLookup) {
            throw new Error('simulated I/O error')
          }
          return opts.messagesLookupByMessageId[messageId] ?? { data: null, error: null }
        }),
      })),
    }
  })

  const reactionsSelect = vi.fn(() => makeCountChain(opts.reactionsUsedCountByAuthor ?? {}))

  const from = vi.fn((table: string) => {
    if (table === 'messages') return { select: messagesSelect }
    if (table === 'reactions') return { select: reactionsSelect }
    throw new Error(`unexpected table: ${table}`)
  })

  return { from, rpc, messagesSelect, reactionsSelect }
}

function baseGraphState(overrides: Partial<GraphState> = {}): GraphState {
  return {
    blueprintId: 'debate-strategy-v1',
    currentPhaseId: 'opening',
    messages: [],
    canvasOps: [],
    guardrailResult: null,
    agentConfidence: null,
    driftAction: null,
    agentOutput: null,
    steeringTextEnabled: null,
    phase_signal: null,
    argGraph: { nodes: [], edges: [] },
    triggerMetadata: {},
    triggerType: null,
    firingSkillId: null,
    firingSkillRole: null,
    skillMeta: null,
    triggerGateComplete: null,
    phaseGateProgress: null,
    ...overrides,
  }
}

function makeArgNode(overrides: Partial<ArgNode> = {}): ArgNode {
  return {
    id: 'arg-1',
    type: 'claim',
    label: 'Water is essential for life',
    branch_id: 'branch-1',
    message_id: 'msg-1',
    speaker: 'Miguel',
    ...overrides,
  }
}

describe('profileBuilderNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('missing branchId logs and returns {} without throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rpc } = buildSupabaseMock({ messagesLookupByMessageId: {} })

    const result = await profileBuilderNode(
      baseGraphState({ argGraph: { nodes: [makeArgNode()], edges: [] } }),
      { configurable: {} }
    )

    expect(result).toEqual({})
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[profile-builder] branchId missing'))
    expect(rpc).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('upserts two profile rows for two speakers resolving to two distinct author_ids', async () => {
    const { from, rpc } = buildSupabaseMock({
      messagesLookupByMessageId: {
        'msg-1': { data: { author_id: 'author-a', role: 'user' }, error: null },
        'msg-2': { data: { author_id: 'author-b', role: 'user' }, error: null },
      },
      messagesSentCountByAuthor: {
        'author-a': { count: 5, error: null },
        'author-b': { count: 3, error: null },
      },
      reactionsUsedCountByAuthor: {
        'author-a': { count: 2, error: null },
        'author-b': { count: 0, error: null },
      },
    })

    const nodes: ArgNode[] = [
      makeArgNode({ id: 'n1', speaker: 'Miguel', message_id: 'msg-1', type: 'hypothesis', label: 'Claim A' }),
      makeArgNode({ id: 'n2', speaker: 'Ana', message_id: 'msg-2', type: 'evidence', label: 'Claim B' }),
    ]

    const result = await profileBuilderNode(
      baseGraphState({ argGraph: { nodes, edges: [] } }),
      { configurable: { branchId: 'branch-1', serviceClient: { from, rpc } } }
    )

    expect(result).toEqual({})
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith(
      'upsert_participant_profile',
      expect.objectContaining({ p_participant_id: 'author-a', p_messages_sent: 5, p_reactions_used: 2 })
    )
    expect(rpc).toHaveBeenCalledWith(
      'upsert_participant_profile',
      expect.objectContaining({ p_participant_id: 'author-b', p_messages_sent: 3, p_reactions_used: 0 })
    )
  })

  it('positions/assertions are sliced to at most 20 most-recent items', async () => {
    const { from, rpc } = buildSupabaseMock({
      messagesLookupByMessageId: {
        'msg-1': { data: { author_id: 'author-a', role: 'user' }, error: null },
      },
      messagesSentCountByAuthor: { 'author-a': { count: 30, error: null } },
      reactionsUsedCountByAuthor: { 'author-a': { count: 0, error: null } },
    })

    const nodes: ArgNode[] = Array.from({ length: 30 }, (_, i) =>
      makeArgNode({ id: `n${i}`, speaker: 'Miguel', message_id: 'msg-1', type: 'hypothesis', label: `Claim ${i}` })
    )

    await profileBuilderNode(
      baseGraphState({ argGraph: { nodes, edges: [] } }),
      { configurable: { branchId: 'branch-1', serviceClient: { from, rpc } } }
    )

    const call = rpc.mock.calls.find((c) => c[0] === 'upsert_participant_profile')
    expect(call).toBeDefined()
    const input = call?.[1] as { p_positions: string[]; p_assertions: string[] }
    expect(input.p_positions).toHaveLength(20)
    expect(input.p_assertions).toHaveLength(20)
    // Most-recent 20 — the last node (Claim 29) must be present, the first (Claim 0) must not.
    expect(input.p_positions).toContain('Claim 29')
    expect(input.p_positions).not.toContain('Claim 0')
  })

  it('skips AI-attributed content: a resolved message with role=assistant is never attributed to a profile', async () => {
    const { from, rpc } = buildSupabaseMock({
      messagesLookupByMessageId: {
        'msg-1': { data: { author_id: 'author-a', role: 'assistant' }, error: null },
      },
    })

    const result = await profileBuilderNode(
      baseGraphState({
        argGraph: { nodes: [makeArgNode({ message_id: 'msg-1', speaker: 'BotSpeaker' })], edges: [] },
      }),
      { configurable: { branchId: 'branch-1', serviceClient: { from, rpc } } }
    )

    expect(result).toEqual({})
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a resolved user with messages_sent count 0 (all their real messages are role=assistant) still upserts with messagesSent 0', async () => {
    const { from, rpc } = buildSupabaseMock({
      messagesLookupByMessageId: {
        'msg-1': { data: { author_id: 'author-a', role: 'user' }, error: null },
      },
      messagesSentCountByAuthor: { 'author-a': { count: 0, error: null } },
      reactionsUsedCountByAuthor: { 'author-a': { count: 0, error: null } },
    })

    await profileBuilderNode(
      baseGraphState({ argGraph: { nodes: [makeArgNode({ message_id: 'msg-1' })], edges: [] } }),
      { configurable: { branchId: 'branch-1', serviceClient: { from, rpc } } }
    )

    expect(rpc).toHaveBeenCalledWith(
      'upsert_participant_profile',
      expect.objectContaining({ p_messages_sent: 0 })
    )
  })

  it('a thrown I/O error inside the per-speaker loop is caught — the node still returns {}', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { from, rpc } = buildSupabaseMock({
      messagesLookupByMessageId: {},
      throwOnMessagesLookup: true,
    })

    const result = await profileBuilderNode(
      baseGraphState({ argGraph: { nodes: [makeArgNode({ message_id: 'msg-1' })], edges: [] } }),
      { configurable: { branchId: 'branch-1', serviceClient: { from, rpc } } }
    )

    expect(result).toEqual({})
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('never writes a GraphState field — always returns {}', async () => {
    const { from, rpc } = buildSupabaseMock({
      messagesLookupByMessageId: {
        'msg-1': { data: { author_id: 'author-a', role: 'user' }, error: null },
      },
      messagesSentCountByAuthor: { 'author-a': { count: 1, error: null } },
      reactionsUsedCountByAuthor: { 'author-a': { count: 1, error: null } },
    })

    const result = await profileBuilderNode(
      baseGraphState({ argGraph: { nodes: [makeArgNode({ message_id: 'msg-1' })], edges: [] } }),
      { configurable: { branchId: 'branch-1', serviceClient: { from, rpc } } }
    )

    expect(Object.keys(result)).toHaveLength(0)
  })
})
