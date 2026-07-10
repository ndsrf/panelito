/**
 * silence-gate.ts — Two-signal silence gate (BOT-03).
 *
 * checkSilenceGate: combines two signals to determine if enough silence has elapsed
 * for a bot to safely respond:
 *   1. Elapsed time since last human message in the branch (D-10).
 *      Read from MAX(created_at) of messages via Supabase — not from LangGraph checkpoint.
 *   2. Supabase Presence is_typing check (D-09).
 *      Injected via the getPresenceTyping callback for testability and WSL2 fallback.
 *
 * WSL2 fallback (D-09, T-10-08): If getPresenceTyping throws or rejects (Presence
 * channel dead in WSL2), the gate assumes no participant is typing and logs the fallback.
 * The returned result carries presence_fallback:true for Langfuse observability
 * (silence_gate_presence_fallback). Worst case: a bot fires while someone types,
 * bounded by the arbitration lock + budget guard.
 *
 * Gate passes only when:
 *   elapsed >= thresholdMs AND is_typing === false
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SilenceGateArgs {
  supabase: SupabaseClient
  branchId: string
  thresholdMs: number
  /** Injected presence check — wraps Supabase Presence is_typing in production. */
  getPresenceTyping?: () => Promise<boolean>
}

export interface SilenceGateResult {
  passed: boolean
  reason?: 'typing' | 'too_soon'
  /** True when the Presence check failed and fell back to assume-not-typing (D-09). */
  presence_fallback: boolean
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * checkSilenceGate — evaluates the two-signal silence condition.
 *
 * Steps:
 * 1. Query messages for latest created_at (D-10, MAX via order+limit).
 * 2. Compute elapsed. If < thresholdMs → { passed:false, reason:'too_soon' }.
 * 3. Determine is_typing from the injected getPresenceTyping callback.
 *    On throw/rejection: WSL2 fallback — assume false, set presence_fallback:true.
 * 4. If is_typing → { passed:false, reason:'typing' }.
 * 5. Else → { passed:true }.
 */
export async function checkSilenceGate(args: SilenceGateArgs): Promise<SilenceGateResult> {
  const { supabase, branchId, thresholdMs, getPresenceTyping } = args

  // -------------------------------------------------------------------------
  // Step 1: Read MAX(created_at) from messages for this branch (D-10)
  // -------------------------------------------------------------------------

  const { data: rows, error: msgsError } = await supabase
    .from('messages')
    .select('created_at')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (msgsError) {
    console.error('[silence-gate] messages query error:', msgsError.message)
    // Fail-safe: treat elapsed as 0 (too_soon) — don't let bots fire on DB error
    return { passed: false, reason: 'too_soon', presence_fallback: false }
  }

  // -------------------------------------------------------------------------
  // Step 2: Compute elapsed and check threshold
  // -------------------------------------------------------------------------

  const lastCreatedAt =
    rows && rows.length > 0 && rows[0]?.created_at ? new Date(rows[0].created_at).getTime() : 0
  const elapsedMs = Date.now() - lastCreatedAt

  if (elapsedMs < thresholdMs) {
    return { passed: false, reason: 'too_soon', presence_fallback: false }
  }

  // -------------------------------------------------------------------------
  // Step 3: Check Presence is_typing with WSL2 fallback (D-09)
  // -------------------------------------------------------------------------

  let isTyping = false
  let presenceFallback = false

  if (getPresenceTyping) {
    try {
      isTyping = await getPresenceTyping()
    } catch (err) {
      // WSL2: Presence channel failed — assume not typing and log for observability
      presenceFallback = true
      console.warn(
        '[silence-gate] presence check failed — assuming not typing',
        { silence_gate_presence_fallback: true, error: (err as Error).message }
      )
    }
  }

  // -------------------------------------------------------------------------
  // Step 4-5: Evaluate typing signal
  // -------------------------------------------------------------------------

  if (isTyping) {
    return { passed: false, reason: 'typing', presence_fallback: presenceFallback }
  }

  return { passed: true, presence_fallback: presenceFallback }
}
