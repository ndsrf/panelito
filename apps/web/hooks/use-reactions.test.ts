'use client'

/**
 * use-reactions.test.ts — unit tests for useReactions hook
 *
 * Tests cover:
 * - applyOptimistic: increments count + sets isOwn
 * - revert: restores pre-apply snapshot
 * - getReactionCounts: hides zero-count entries
 * - foreign-user ingest: increments count without isOwn
 * - own-echo dedupe: does not double-count when ingest sees own reaction
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase client before importing the hook
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: () => ({
      on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
      subscribe: () => ({ unsubscribe: () => {} }),
    }),
    removeChannel: () => Promise.resolve(),
  }),
}))

// Mock apiFetch so network calls never fire during tests
vi.mock('@/lib/api', () => {
  const mockFetch = vi.fn().mockImplementation((url: string, options?: any) => {
    console.log('[test apiFetch mock] URL:', url, 'Options:', options)
    if (url.includes('/reactions') && (!options || options.method === 'GET' || !options.method)) {
      return Promise.resolve([])
    }
    if (options && options.method === 'POST') {
      if ((mockFetch as any).__shouldFail) {
        return Promise.reject(new (mockFetch as any).ApiError(500, { error: 'insert_failed' }))
      }
      const body = JSON.parse(options.body)
      const res = { id: 'r-post', triggersAI: ['🔥', '📌', '🎯'].includes(body.emoji) }
      console.log('[test apiFetch mock] POST returning:', res)
      return Promise.resolve(res)
    }
    return Promise.resolve([])
  })
  const ApiError = class ApiError extends Error {
    constructor(public status: number, public body: unknown) {
      super(`API error ${status}`)
      this.name = 'ApiError'
    }
  }
  ;(mockFetch as any).ApiError = ApiError
  return {
    apiFetch: mockFetch,
    ApiError,
  }
})

// We test the internal logic of the hook by pulling out the pure functions.
// The hook itself uses React (useState + useEffect) which requires renderHook.
// For the core state-machine logic we test the helper functions directly.
// A thin "renderHook" integration test is included to verify exports.

import { renderHook, act } from '@testing-library/react'
import { useReactions } from './use-reactions'
import { apiFetch } from '@/lib/api'

const SESSION_ID = 'session-1'
const CURRENT_USER = 'user-abc'
const OTHER_USER = 'user-xyz'
const MSG_1 = 'msg-1'

describe('useReactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports useReactions', () => {
    expect(useReactions).toBeDefined()
  })

  describe('getReactionCounts — zero-count hiding', () => {
    it('returns empty array when no reactions applied', () => {
      const { result } = renderHook(() => useReactions(SESSION_ID, CURRENT_USER))
      const counts = result.current.getReactionCounts(MSG_1)
      expect(counts).toHaveLength(0)
    })

    it('hides badges with count === 0 after revert', async () => {
      const { result } = renderHook(() => useReactions(SESSION_ID, CURRENT_USER))

      act(() => {
        result.current.applyOptimistic(MSG_1, '🔥')
      })
      expect(result.current.getReactionCounts(MSG_1)).toHaveLength(1)

      act(() => {
        result.current.revert(MSG_1, '🔥')
      })
      // After revert the entry should be gone (count 0 hidden)
      const counts = result.current.getReactionCounts(MSG_1)
      expect(counts.every((r) => r.count > 0)).toBe(true)
      // And the 🔥 entry is not present
      expect(counts.find((r) => r.emoji === '🔥')).toBeUndefined()
    })
  })

  describe('applyOptimistic', () => {
    it('creates a new reaction entry with count 1 and isOwn true', () => {
      const { result } = renderHook(() => useReactions(SESSION_ID, CURRENT_USER))

      act(() => {
        result.current.applyOptimistic(MSG_1, '🧠')
      })

      const counts = result.current.getReactionCounts(MSG_1)
      expect(counts).toHaveLength(1)
      expect(counts[0]).toMatchObject({ emoji: '🧠', count: 1, isOwn: true })
    })

    it('increments an existing count when same emoji applied again', () => {
      const { result } = renderHook(() => useReactions(SESSION_ID, CURRENT_USER))

      act(() => {
        result.current.applyOptimistic(MSG_1, '🔥')
        result.current.applyOptimistic(MSG_1, '🔥')
      })

      const counts = result.current.getReactionCounts(MSG_1)
      const fire = counts.find((r) => r.emoji === '🔥')
      expect(fire?.count).toBe(2)
    })

    it('handles multiple distinct emojis independently', () => {
      const { result } = renderHook(() => useReactions(SESSION_ID, CURRENT_USER))

      act(() => {
        result.current.applyOptimistic(MSG_1, '🧠')
        result.current.applyOptimistic(MSG_1, '🔥')
      })

      const counts = result.current.getReactionCounts(MSG_1)
      expect(counts).toHaveLength(2)
    })
  })

  describe('revert', () => {
    it('restores the pre-apply snapshot (count returns to 0, entry hidden)', () => {
      const { result } = renderHook(() => useReactions(SESSION_ID, CURRENT_USER))

      act(() => {
        result.current.applyOptimistic(MSG_1, '📌')
      })

      expect(result.current.getReactionCounts(MSG_1)).toHaveLength(1)

      act(() => {
        result.current.revert(MSG_1, '📌')
      })

      expect(result.current.getReactionCounts(MSG_1)).toHaveLength(0)
    })

    it('does not affect other emojis on the same message when reverting one', () => {
      const { result } = renderHook(() => useReactions(SESSION_ID, CURRENT_USER))

      act(() => {
        result.current.applyOptimistic(MSG_1, '🧠')
        result.current.applyOptimistic(MSG_1, '🎯')
      })

      act(() => {
        result.current.revert(MSG_1, '🧠')
      })

      const counts = result.current.getReactionCounts(MSG_1)
      expect(counts).toHaveLength(1)
      expect(counts[0]?.emoji).toBe('🎯')
    })
  })

  describe('ingest — Realtime INSERT from foreign user', () => {
    it('increments count without setting isOwn when another user reacts', () => {
      const { result } = renderHook(() => useReactions(SESSION_ID, CURRENT_USER))

      act(() => {
        result.current.ingest({
          id: 'r1',
          message_id: MSG_1,
          session_id: SESSION_ID,
          author_id: OTHER_USER,
          emoji: '🔥',
          created_at: new Date().toISOString(),
        })
      })

      const counts = result.current.getReactionCounts(MSG_1)
      const fire = counts.find((r) => r.emoji === '🔥')
      expect(fire?.count).toBe(1)
      expect(fire?.isOwn).toBe(false)
    })

    it('sets isOwn when the current user is the author of the INSERT', () => {
      const { result } = renderHook(() => useReactions(SESSION_ID, CURRENT_USER))

      act(() => {
        result.current.ingest({
          id: 'r2',
          message_id: MSG_1,
          session_id: SESSION_ID,
          author_id: CURRENT_USER,
          emoji: '🧠',
          created_at: new Date().toISOString(),
        })
      })

      const counts = result.current.getReactionCounts(MSG_1)
      const brain = counts.find((r) => r.emoji === '🧠')
      expect(brain?.isOwn).toBe(true)
    })

    it('does NOT double-count when ingest echoes an already-applied optimistic reaction', () => {
      const { result } = renderHook(() => useReactions(SESSION_ID, CURRENT_USER))

      // User applied optimistic reaction
      act(() => {
        result.current.applyOptimistic(MSG_1, '🔥')
      })

      // Server echo arrives (same message_id + emoji + author_id)
      act(() => {
        result.current.ingest({
          id: 'r3',
          message_id: MSG_1,
          session_id: SESSION_ID,
          author_id: CURRENT_USER,
          emoji: '🔥',
          created_at: new Date().toISOString(),
        })
      })

      // Count must remain 1, not become 2
      const counts = result.current.getReactionCounts(MSG_1)
      const fire = counts.find((r) => r.emoji === '🔥')
      expect(fire?.count).toBe(1)
    })
  })

  describe('postReaction', () => {
    it('calls applyOptimistic then apiFetch, returns triggersAI signal', async () => {
      const { result } = renderHook(() => useReactions(SESSION_ID, CURRENT_USER))

      // Wait for mount fetch to settle
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      act(() => {
        result.current.applyOptimistic(MSG_1, '🔥')
      })

      let triggersAI: boolean | undefined
      await act(async () => {
        triggersAI = await result.current.postReaction(MSG_1, '🔥')
      })

      // Optimistic count should be 1 after the POST
      const counts = result.current.getReactionCounts(MSG_1)
      const fire = counts.find((r) => r.emoji === '🔥')
      expect(fire?.count).toBe(1)
      expect(triggersAI).toBe(true)
    })

    it('silently reverts on ApiError — no thrown error, count returns to 0', async () => {
      ;(apiFetch as any).__shouldFail = true
      const { result } = renderHook(() => useReactions(SESSION_ID, CURRENT_USER))

      // Wait for mount fetch to settle
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      act(() => {
        result.current.applyOptimistic(MSG_1, '📌')
      })

      await act(async () => {
        // Should not throw
        await result.current.postReaction(MSG_1, '📌')
      })

      // Badge should have been reverted — count back to 0, entry hidden
      const counts = result.current.getReactionCounts(MSG_1)
      expect(counts.find((r) => r.emoji === '📌')).toBeUndefined()
      ;(apiFetch as any).__shouldFail = false
    })

    it('returns false for triggersAI when emoji is 🧠', async () => {
      const { result } = renderHook(() => useReactions(SESSION_ID, CURRENT_USER))

      // Wait for mount fetch to settle
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      let triggersAI: boolean | undefined
      await act(async () => {
        triggersAI = await result.current.postReaction(MSG_1, '🧠')
      })

      expect(triggersAI).toBe(false)
    })
  })
})
