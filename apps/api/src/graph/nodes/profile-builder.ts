/**
 * profile-builder.ts — ProfileBuilderNode (PROFILE-01/02, D-03/D-04/D-05/D-06)
 *
 * Follows arg-graph-builder.ts's whole-file fail-open node skeleton (`[profile-builder]`
 * log prefix, never throws — always returns `{}`), but with orphan-edge.ts's Supabase
 * client seam (`config.configurable.serviceClient ?? createServiceClient()`) instead of
 * arg-graph-builder.ts's AIProvider adapter seam — D-06 requires ZERO new LLM calls;
 * positions/assertions are derived purely by filtering `state.argGraph.nodes` that
 * ArgGraphBuilderNode already extracted.
 *
 * Groups `state.argGraph.nodes` by `speaker`, resolves each speaker's `author_id` via a
 * `messages` lookup keyed by the group's first node's `message_id` (ArgNode carries no
 * `author_id` of its own — RESEARCH.md interfaces note). Skips (never attributes) any
 * speaker whose resolved message has `role !== 'user'` — Pitfall 1: the AI's own message
 * insert uses `author_id: session.creator_id` on the human path (ai.ts), so a naive
 * author_id-only resolution would silently attribute bot-authored content to a human
 * participant's profile.
 *
 * Returns `{}` unconditionally — the profile lives in Postgres (participant_profiles,
 * upsertParticipantProfile), not in checkpointed GraphState.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ArgNode } from '@panelito/types'
import { createServiceClient } from '../../lib/supabase'
import { upsertParticipantProfile } from '../../lib/participant-profile'
import type { GraphState } from '../state'

/** positions/assertions cap — Claude's Discretion default (13-PLAN.md Task 2 action). */
const MAX_ITEMS = 20

/** Node types whose label counts as a "stated position" (vs. a raw assertion). */
const POSITION_NODE_TYPES = new Set(['hypothesis', 'claim'])

// ---------------------------------------------------------------------------
// Per-query helpers — each fails closed (returns null / logs) on its own Supabase
// error, matching orphan-edge.ts's findCommittedOrphan()/rankGhostTarget() granularity
// (never throws; the caller decides whether a null result means "skip this speaker").
// ---------------------------------------------------------------------------

interface ResolvedAuthor {
  authorId: string
  role: string
}

/**
 * resolveAuthorId — looks up the author_id + role of the message a given ArgNode group's
 * first node cites. Returns null on any Supabase error or a missing row (caller treats
 * null as "cannot resolve, skip this speaker" — never attributes to a synthesized id).
 */
async function resolveAuthorId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  messageId: string,
): Promise<ResolvedAuthor | null> {
  const { data, error } = await supabase
    .from('messages')
    .select('author_id, role')
    .eq('id', messageId)
    .maybeSingle()

  if (error) {
    console.error('[profile-builder] messages lookup error:', error.message)
    return null
  }
  if (!data) {
    return null
  }
  return { authorId: data.author_id as string, role: data.role as string }
}

/**
 * countMessagesSent — COUNT of `messages` rows for this branch/author where role='user'
 * (Pitfall 1 — never counts the AI's own messages as this participant's activity).
 * Returns null on any Supabase error (caller treats null as 0 — see profileBuilderNode).
 */
async function countMessagesSent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  branchId: string,
  authorId: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', branchId)
    .eq('author_id', authorId)
    .eq('role', 'user')

  if (error) {
    console.error('[profile-builder] messages_sent count error:', error.message)
    return null
  }
  return count ?? 0
}

/**
 * countReactionsUsed — COUNT of `reactions` rows by this author scoped to the branch.
 * `reactions` has no `branch_id` column (schema fact, interfaces block) — joins the
 * embedded `messages` resource via the PostgREST `messages!inner(branch_id)` filter
 * syntax to scope the count to the branch. Returns null on any Supabase error.
 */
async function countReactionsUsed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  branchId: string,
  authorId: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from('reactions')
    .select('id, messages!inner(branch_id)', { count: 'exact', head: true })
    .eq('author_id', authorId)
    .eq('messages.branch_id', branchId)

  if (error) {
    console.error('[profile-builder] reactions_used count error:', error.message)
    return null
  }
  return count ?? 0
}

/** Groups argGraph nodes by speaker, preserving insertion order within each group. */
function groupBySpeaker(nodes: ArgNode[]): Map<string, ArgNode[]> {
  const bySpeaker = new Map<string, ArgNode[]>()
  for (const node of nodes) {
    const group = bySpeaker.get(node.speaker)
    if (group) {
      group.push(node)
    } else {
      bySpeaker.set(node.speaker, [node])
    }
  }
  return bySpeaker
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function profileBuilderNode(state: GraphState, config?: any): Promise<Partial<GraphState>> {
  try {
    const branchId = config?.configurable?.branchId as string | undefined
    if (!branchId) {
      console.error('[profile-builder] branchId missing from config.configurable — returning no output')
      return {}
    }

    const injectedClient = config?.configurable?.serviceClient as SupabaseClient | undefined
    const supabase = injectedClient ?? createServiceClient()

    const bySpeaker = groupBySpeaker(state.argGraph.nodes)

    // Phase 1 — resolve each speaker-label group to its real author_id (messages-table
    // lookup, role='user' only — Pitfall 1) and union all groups that resolve to the SAME
    // author_id. CR-01: identity is NEVER the freeform `speaker` label, so label drift
    // (nicknames, capitalization) across a single invocation cannot cause one group's
    // upsert to silently discard another's (the RPC is a full-replace, not a merge).
    const byAuthor = new Map<string, ArgNode[]>()

    for (const [, nodes] of bySpeaker) {
      const firstNode = nodes[0]
      if (!firstNode) {
        continue
      }

      const resolved = await resolveAuthorId(supabase, firstNode.message_id)
      if (!resolved || resolved.role !== 'user') {
        // Pitfall 1: no row, or the citing message was AI-authored — never attribute.
        continue
      }

      byAuthor.set(resolved.authorId, (byAuthor.get(resolved.authorId) ?? []).concat(nodes))
    }

    // Phase 2 — one upsert (and one count-pair) per resolved author, computed from the
    // complete union of every speaker-label group that resolved to that author.
    for (const [authorId, nodes] of byAuthor) {
      try {
        const positions = nodes
          .filter((n) => POSITION_NODE_TYPES.has(n.type))
          .map((n) => n.label)
          .slice(-MAX_ITEMS)
        const assertions = nodes.map((n) => n.label).slice(-MAX_ITEMS)

        const messagesSent = await countMessagesSent(supabase, branchId, authorId)
        const reactionsUsed = await countReactionsUsed(supabase, branchId, authorId)

        await upsertParticipantProfile(supabase, {
          branchId,
          participantId: authorId,
          positions,
          assertions,
          messagesSent: messagesSent ?? 0,
          reactionsUsed: reactionsUsed ?? 0,
        })
      } catch (err) {
        console.error('[profile-builder] error processing author', authorId, err)
        continue
      }
    }

    return {}
  } catch (err) {
    console.error('[profile-builder] unexpected error — returning no output', err)
    return {}
  }
}

// Exported for direct unit testing.
export { resolveAuthorId, countMessagesSent, countReactionsUsed, groupBySpeaker }
