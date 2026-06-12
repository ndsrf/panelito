/**
 * cap-guard.ts — AI response cap check + warning thresholds (SESS-12).
 *
 * checkCap: reads sessions.ai_response_count + .ai_response_cap.
 *           Returns { ok: false, reason: 'cap_reached' } when count >= cap.
 *
 * incrementCount: atomic increment via Postgres RPC function `increment_ai_count`.
 *                 Determines threshold:
 *                 - 'warning'  → count just crossed 90% of cap.
 *                 - 'cap'      → count just reached 100% of cap → freeze + system message.
 *                 - null       → normal increment, no threshold crossed.
 *
 * T-07-02: Uses a Postgres function for atomic increment to prevent race conditions
 * in concurrent invocations.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { freezeSession, SYSTEM_AUTHOR_ID, SYSTEM_DISPLAY_NAME } from './sessions-helpers'

// ---------------------------------------------------------------------------
// checkCap
// ---------------------------------------------------------------------------

export type CapCheckResult =
  | { ok: true }
  | { ok: false; reason: 'cap_reached' }

/**
 * checkCap — checks whether the session has reached its AI response cap.
 *
 * @returns { ok: true } if invocation is allowed, or { ok: false, reason: 'cap_reached' } otherwise.
 */
export async function checkCap(
  supabase: SupabaseClient,
  sessionId: string
): Promise<CapCheckResult> {
  const { data: session, error } = await supabase
    .from('sessions')
    .select('ai_response_count, ai_response_cap')
    .eq('id', sessionId)
    .single()

  if (error || !session) {
    // Fail-open: if we can't read the session, allow the invocation
    console.error('[cap-guard] checkCap read error:', error?.message)
    return { ok: true }
  }

  if (session.ai_response_count >= session.ai_response_cap) {
    return { ok: false, reason: 'cap_reached' }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// incrementCount
// ---------------------------------------------------------------------------

export interface IncrementResult {
  count: number
  cap: number
  threshold_crossed: 'warning' | 'cap' | null
}

/**
 * incrementCount — atomically increments the AI response count for a session.
 *
 * Uses the Postgres function `increment_ai_count(session_id)` for atomic update.
 *
 * Side effects:
 * - On 'warning': inserts a system message at 90% threshold.
 * - On 'cap': inserts a system message + calls freezeSession.
 *
 * @returns The new count, cap, and whether a threshold was crossed.
 */
export async function incrementCount(
  supabase: SupabaseClient,
  sessionId: string
): Promise<IncrementResult> {
  const { data, error } = await supabase.rpc('increment_ai_count', { s_id: sessionId })

  if (error || !data || !Array.isArray(data) || data.length === 0) {
    console.error('[cap-guard] incrementCount rpc error:', error?.message)
    // Fallback: read current state without incrementing
    const { data: session } = await supabase
      .from('sessions')
      .select('ai_response_count, ai_response_cap')
      .eq('id', sessionId)
      .single()
    return {
      count: session?.ai_response_count ?? 0,
      cap: session?.ai_response_cap ?? 150,
      threshold_crossed: null,
    }
  }

  const { new_count: newCount, cap } = data[0] as { new_count: number; cap: number }
  const prevCount = newCount - 1
  const warningThreshold = Math.ceil(0.9 * cap)

  let thresholdCrossed: 'warning' | 'cap' | null = null

  if (newCount >= cap) {
    // Cap reached — insert system message + freeze
    thresholdCrossed = 'cap'
    const capMessage = `Limite de respuestas AI alcanzado (${newCount} / ${cap}). La sesion ha sido congelada.`
    await insertSystemMessage(supabase, sessionId, capMessage)
    await freezeSession(supabase, sessionId, 'cap_reached')
  } else if (prevCount < warningThreshold && newCount >= warningThreshold) {
    // Just crossed the 90% warning threshold
    thresholdCrossed = 'warning'
    const remaining = cap - newCount
    const warningMessage =
      `Actividad AI al 90% del limite de la sesion (${newCount} / ${cap}). ` +
      `${remaining} respuesta${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}.`
    await insertSystemMessage(supabase, sessionId, warningMessage)
  }

  return { count: newCount, cap, threshold_crossed: thresholdCrossed }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function insertSystemMessage(
  supabase: SupabaseClient,
  sessionId: string,
  content: string
): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .insert({
      session_id: sessionId,
      author_id: SYSTEM_AUTHOR_ID,
      display_name: SYSTEM_DISPLAY_NAME,
      parent_id: null,
      path_id: 'main',
      content,
      canvas_snapshot_state: null,
    })
    .select()
    .single()

  if (error) {
    console.error('[cap-guard] system message insert error:', error.message)
  }
}
