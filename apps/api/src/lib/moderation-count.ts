/**
 * moderation-count.ts — Postgres-backed per-participant moderation escalation counter (D-16).
 *
 * getModerationCount / incrementModerationCount read/write the moderation_counts table
 * (migration 0015). Escalation tone (D-16: "moderation intervention tone escalates after
 * repeated triggers on the same participant within a session") reads this counter to decide
 * gentle-vs-direct tone.
 *
 * Fail-closed on any Supabase error (T-12-05): return 0 — the GENTLEST tier, never throw.
 * A false negative here is a gentle nudge, never a wrongful escalation. This mirrors
 * bot-budget.ts's FAIL_CLOSED / "unknown state -> least-privileged behavior" posture.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Fail-closed sentinel — returned when a query/RPC errors or returns no rows (T-12-05)
// ---------------------------------------------------------------------------

const FAIL_CLOSED_COUNT = 0

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * getModerationCount — reads the current moderation escalation count for a
 * participant on a branch. Returns 0 if no row exists yet (first offense) or
 * on any Supabase error (fail-closed, T-12-05) — never throws.
 */
export async function getModerationCount(
  supabase: SupabaseClient,
  branchId: string,
  participantId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('moderation_counts')
    .select('count')
    .eq('branch_id', branchId)
    .eq('participant_id', participantId)
    .maybeSingle()

  if (error) {
    console.error('[moderation-count] getModerationCount query error:', error.message)
    return FAIL_CLOSED_COUNT
  }

  if (!data) {
    // No row yet — first offense, gentlest tier.
    return FAIL_CLOSED_COUNT
  }

  const row = data as Record<string, unknown>
  return typeof row.count === 'number' ? row.count : FAIL_CLOSED_COUNT
}

/**
 * incrementModerationCount — atomically increments and returns the new moderation
 * escalation count for a participant on a branch, via the increment_moderation_count
 * RPC (atomic upsert-returning-count, migration 0015 — protects against two
 * concurrent moderation triggers racing on the same participant/branch).
 * On any Supabase error or empty-row response, returns 0 (fail-closed, T-12-05) —
 * never throws.
 */
export async function incrementModerationCount(
  supabase: SupabaseClient,
  branchId: string,
  participantId: string
): Promise<number> {
  const { data, error } = await supabase.rpc('increment_moderation_count', {
    p_branch_id: branchId,
    p_participant_id: participantId,
  })

  if (error || !data || !Array.isArray(data) || data.length === 0) {
    console.error(
      '[moderation-count] increment_moderation_count error:',
      error?.message ?? 'no rows returned'
    )
    return FAIL_CLOSED_COUNT
  }

  // Explicit field extraction — avoids a blind cast, mirrors bot-budget.ts's posture.
  const row = data[0] as Record<string, unknown>
  return typeof row.count === 'number' ? row.count : FAIL_CLOSED_COUNT
}
