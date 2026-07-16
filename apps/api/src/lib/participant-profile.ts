/**
 * participant-profile.ts — Postgres-backed per-participant, per-branch profile
 * repository (PROFILE-01/02, migration 0016).
 *
 * getParticipantProfile / upsertParticipantProfile read/write the
 * participant_profiles table (branch_id, participant_id, positions, assertions,
 * messages_sent, reactions_used, moderation_count, updated_at). Mirrors
 * moderation-count.ts's fail-closed shape (D-01: durable, cold-start-safe store,
 * no InMemoryStore) — never throws; ProfileBuilderNode (Plan 03) and other
 * callers treat a null/no-op result as "no profile data available yet."
 *
 * upsertParticipantProfile calls the upsert_participant_profile RPC, which
 * intentionally never overwrites moderation_count (owned exclusively by
 * increment_moderation_count / moderation-count.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParticipantProfile } from '@panelito/types'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * getParticipantProfile — reads the current profile row for a participant on
 * a branch. Returns null if no row exists yet, or on any Supabase error
 * (fail-closed) — never throws.
 */
export async function getParticipantProfile(
  supabase: SupabaseClient,
  branchId: string,
  participantId: string
): Promise<ParticipantProfile | null> {
  const { data, error } = await supabase
    .from('participant_profiles')
    .select('*')
    .eq('branch_id', branchId)
    .eq('participant_id', participantId)
    .maybeSingle()

  if (error) {
    console.error('[participant-profile] getParticipantProfile query error:', error.message)
    return null
  }

  return data as ParticipantProfile | null
}

export interface UpsertParticipantProfileInput {
  branchId: string
  participantId: string
  positions: string[]
  assertions: string[]
  messagesSent: number
  reactionsUsed: number
}

/**
 * upsertParticipantProfile — writes positions/assertions/messages_sent/
 * reactions_used via the upsert_participant_profile RPC (never touches
 * moderation_count). Logs and returns (never throws) on any RPC error.
 */
export async function upsertParticipantProfile(
  supabase: SupabaseClient,
  input: UpsertParticipantProfileInput
): Promise<void> {
  const { error } = await supabase.rpc('upsert_participant_profile', {
    p_branch_id: input.branchId,
    p_participant_id: input.participantId,
    p_positions: input.positions,
    p_assertions: input.assertions,
    p_messages_sent: input.messagesSent,
    p_reactions_used: input.reactionsUsed,
  })

  if (error) {
    console.error('[participant-profile] upsert_participant_profile RPC error:', error.message)
    return
  }
}
