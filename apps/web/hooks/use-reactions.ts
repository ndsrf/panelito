'use client'

/**
 * useReactions — optimistic reaction state, Realtime sync, and AI trigger relay.
 *
 * REACT-01 through REACT-05:
 * - applyOptimistic(messageId, emoji): increments count + marks isOwn before server confirmation
 * - revert(messageId, emoji): restores pre-apply snapshot on server failure (Pitfall 6, silent)
 * - getReactionCounts(messageId): returns entries with count > 0 only (zero-count hidden)
 * - ingest(reactionRow): handles Realtime INSERT events — dedupes own-echo to prevent double-count
 * - postReaction(messageId, emoji): applyOptimistic → POST /reactions → revert on failure
 *   Returns triggersAI boolean so caller can open the AI invoke SSE stream.
 *
 * T-02-15: Rate limiting enforced on the server (60/min). Client does not throttle.
 * T-02-16: author_id is set by the server from authed user — client cannot spoof.
 * T-02-17: revert() restores snapshot on POST failure; ingest() dedupes own-echo.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { apiFetch, ApiError } from '@/lib/api'
import type { Reaction, ReactionCount } from '@panelito/types'

// Snapshot of a single emoji count for a message — used for revert
type ReactionSnapshot = ReactionCount | undefined

// In-memory state map: messageId → emoji → ReactionCount
type ReactionsMap = Map<string, Map<string, ReactionCount>>

// Tracked optimistic "own" reactions: Set of "messageId:emoji" strings
// Used for own-echo deduplication in ingest()
type OwnPendingSet = Set<string>

interface UseReactionsReturn {
  /**
   * Returns only reaction count entries with count > 0 for a message.
   * Zero-count entries are hidden (Surface 3 spec).
   */
  getReactionCounts: (messageId: string) => ReactionCount[]

  /**
   * Optimistically increments the reaction count for a message + emoji immediately.
   * Snapshots the previous state to enable revert().
   * Sets isOwn = true on the entry.
   */
  applyOptimistic: (messageId: string, emoji: string) => void

  /**
   * Restores the pre-apply snapshot for a message + emoji.
   * Called silently on server error — no toast (REACT-05 / Pitfall 6).
   */
  revert: (messageId: string, emoji: string) => void

  /**
   * Handles a Realtime INSERT event for a reaction row.
   * - If author_id === currentUserId AND we have an own-pending entry → skip (dedupe echo)
   * - Otherwise increment count, set isOwn only for own rows.
   */
  ingest: (reaction: Reaction) => void

  /**
   * Applies optimistic badge, POSTs to /api/sessions/:id/reactions.
   * On ApiError, silently reverts. Returns triggersAI from the server response.
   */
  postReaction: (messageId: string, emoji: string) => Promise<boolean>
}

export function useReactions(
  sessionId: string,
  currentUserId: string
): UseReactionsReturn {
  // Main reactions map — messageId → emoji → ReactionCount
  const [reactionsMap, setReactionsMap] = useState<ReactionsMap>(new Map())

  // Snapshots for revert — messageId:emoji → snapshot
  const snapshotRef = useRef<Map<string, ReactionSnapshot>>(new Map())

  // Own-pending set — tracks "messageId:emoji" pairs already applied optimistically
  // Used to dedupe Realtime echo of our own reaction
  const ownPendingRef = useRef<OwnPendingSet>(new Set())

  // Load initial reaction counts on mount and poll every 2 seconds
  useEffect(() => {
    const fetchReactions = () => {
      apiFetch<any[]>(`/api/sessions/${sessionId}/reactions`)
        .then((rows) => {
          setReactionsMap(() => {
            const next = new Map()
            for (const row of rows) {
              const emojiMap = getOrCreateEmojiMap(next, row.message_id)
              const existing = emojiMap.get(row.emoji)
              const isOwn = row.author_id === currentUserId

              if (existing) {
                emojiMap.set(row.emoji, {
                  ...existing,
                  count: existing.count + 1,
                  isOwn: existing.isOwn || isOwn,
                })
              } else {
                emojiMap.set(row.emoji, {
                  emoji: row.emoji,
                  count: 1,
                  isOwn,
                })
              }
            }
            return next
          })
        })
        .catch((err) => console.error('[useReactions] fetch failed', err))
    }

    fetchReactions()

    const intervalId = setInterval(fetchReactions, 2000)
    return () => clearInterval(intervalId)
  }, [sessionId, currentUserId])

  // -----------------------------------------------------------------------
  // Helpers — pure mutations on a ReactionsMap clone
  // -----------------------------------------------------------------------

  const cloneMap = (map: ReactionsMap): ReactionsMap => {
    const clone = new Map<string, Map<string, ReactionCount>>()
    for (const [msgId, emojiMap] of map) {
      clone.set(msgId, new Map(emojiMap))
    }
    return clone
  }

  const getOrCreateEmojiMap = (
    map: ReactionsMap,
    messageId: string
  ): Map<string, ReactionCount> => {
    if (!map.has(messageId)) {
      map.set(messageId, new Map())
    }
    return map.get(messageId)!
  }

  // -----------------------------------------------------------------------
  // getReactionCounts — filter out zero-count entries
  // -----------------------------------------------------------------------

  const getReactionCounts = useCallback(
    (messageId: string): ReactionCount[] => {
      const emojiMap = reactionsMap.get(messageId)
      if (!emojiMap) return []
      return Array.from(emojiMap.values()).filter((r) => r.count > 0)
    },
    [reactionsMap]
  )

  // -----------------------------------------------------------------------
  // applyOptimistic — snapshot + increment
  // -----------------------------------------------------------------------

  const applyOptimistic = useCallback(
    (messageId: string, emoji: string) => {
      const key = `${messageId}:${emoji}`

      setReactionsMap((prev) => {
        const next = cloneMap(prev)
        const emojiMap = getOrCreateEmojiMap(next, messageId)
        const existing = emojiMap.get(emoji)

        // Save snapshot BEFORE mutating (only snapshot once per key per optimistic cycle)
        if (!snapshotRef.current.has(key)) {
          snapshotRef.current.set(key, existing ? { ...existing } : undefined)
        }

        if (existing) {
          emojiMap.set(emoji, { ...existing, count: existing.count + 1, isOwn: true })
        } else {
          emojiMap.set(emoji, {
            emoji: emoji as ReactionCount['emoji'],
            count: 1,
            isOwn: true,
          })
        }

        return next
      })

      // Mark as own-pending for deduplication
      ownPendingRef.current.add(key)
    },
    []
  )

  // -----------------------------------------------------------------------
  // revert — restore snapshot
  // -----------------------------------------------------------------------

  const revert = useCallback(
    (messageId: string, emoji: string) => {
      const key = `${messageId}:${emoji}`
      const snapshot = snapshotRef.current.get(key)

      setReactionsMap((prev) => {
        const next = cloneMap(prev)
        const emojiMap = getOrCreateEmojiMap(next, messageId)

        if (snapshot === undefined) {
          // No pre-apply state — remove the entry entirely
          emojiMap.delete(emoji)
        } else {
          emojiMap.set(emoji, { ...snapshot })
        }

        return next
      })

      // Clean up snapshot and own-pending
      snapshotRef.current.delete(key)
      ownPendingRef.current.delete(key)
    },
    []
  )

  // -----------------------------------------------------------------------
  // ingest — Realtime INSERT handler
  // -----------------------------------------------------------------------

  const ingest = useCallback(
    (reaction: Reaction) => {
      console.log('[useReactions] Ingesting reaction broadcast:', reaction, 'CurrentUserId:', currentUserId)
      const key = `${reaction.message_id}:${reaction.emoji}`
      const isOwn = reaction.author_id === currentUserId

      // Dedupe: if this is an echo of our own optimistic apply, skip it
      if (isOwn && ownPendingRef.current.has(key)) {
        console.log('[useReactions] Deduplicating local echo for:', key)
        // We already counted it optimistically — remove from pending so future
        // ingests for the same key are not skipped
        ownPendingRef.current.delete(key)
        // Also clean up the snapshot since the server confirmed it
        snapshotRef.current.delete(key)
        return
      }

      setReactionsMap((prev) => {
        const next = cloneMap(prev)
        const emojiMap = getOrCreateEmojiMap(next, reaction.message_id)
        const existing = emojiMap.get(reaction.emoji)

        if (existing) {
          emojiMap.set(reaction.emoji, {
            ...existing,
            count: existing.count + 1,
            // Preserve isOwn if it was already true
            isOwn: existing.isOwn || isOwn,
          })
        } else {
          emojiMap.set(reaction.emoji, {
            emoji: reaction.emoji,
            count: 1,
            isOwn,
          })
        }

        return next
      })
    },
    [currentUserId]
  )

  // -----------------------------------------------------------------------
  // postReaction — optimistic apply → POST → revert on failure
  // -----------------------------------------------------------------------

  const postReaction = useCallback(
    async (messageId: string, emoji: string): Promise<boolean> => {
      // Note: applyOptimistic is already called by the caller (QuickReactionPopover onOptimisticReaction)
      // to render the UI badge instantly. Do not call it again here to avoid double-counting.

      try {
        const response = await apiFetch<{ id: string; triggersAI: boolean }>(
          `/api/sessions/${sessionId}/reactions`,
          {
            method: 'POST',
            body: JSON.stringify({ messageId, emoji }),
          }
        )

        // Server confirmed — clean up snapshot (don't need to revert)
        const key = `${messageId}:${emoji}`
        snapshotRef.current.delete(key)
        // Note: ownPendingRef entry will be cleaned up by ingest() when the Realtime broadcast echo arrives.

        // D-09: return triggersAI so caller can open /invoke SSE stream
        return response.triggersAI ?? false
      } catch (err) {
        // REACT-05 / Pitfall 6: silent revert on any error — no toast
        if (err instanceof ApiError || err instanceof Error) {
          revert(messageId, emoji)
        }
        return false
      }
    },
    [sessionId, applyOptimistic, revert]
  )

  return {
    getReactionCounts,
    applyOptimistic,
    revert,
    ingest,
    postReaction,
  }
}
