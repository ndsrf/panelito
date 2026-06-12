/**
 * sessions-helpers.ts — Shared session mutation helpers.
 *
 * Both the manual freeze route (Plan 03) and auto-freeze tracker (Plan 07)
 * use `freezeSession` to ensure consistent status updates + broadcast.
 *
 * T-07-05: Each freeze writes a system message with the reason so the action
 * is auditable (CHAT-05 immutability makes messages non-deletable).
 * T-07-07: Auto-freeze and manual freeze both flow through this helper so the
 * audit trail is consistent.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** All-zeros UUID used as the system author sentinel (CHAT-05 / T-07-07). */
export const SYSTEM_AUTHOR_ID = '00000000-0000-0000-0000-000000000000'
export const SYSTEM_DISPLAY_NAME = 'system'

/**
 * freezeSession — updates session status to 'frozen', inserts a system
 * message with the reason, and broadcasts `session_status_change` on the
 * `session:${sessionId}` channel.
 *
 * @param supabase - Service-role Supabase client (bypasses RLS).
 * @param sessionId - The session to freeze.
 * @param reason - Why the session was frozen (e.g. 'auto_freeze_creator_absent', 'cap_reached').
 */
export async function freezeSession(
  supabase: SupabaseClient,
  sessionId: string,
  reason: string
): Promise<void> {
  // Update session status
  const { data: updated, error: updateError } = await supabase
    .from('sessions')
    .update({ status: 'frozen' })
    .eq('id', sessionId)
    .select('id, status, title')
    .single()

  if (updateError) {
    console.error('[sessions-helpers] freezeSession update error:', updateError.message)
    return
  }

  // Insert system message describing the freeze (T-07-07 audit trail)
  const systemContent = freezeReasonMessage(reason)
  const { error: msgError } = await supabase
    .from('messages')
    .insert({
      session_id: sessionId,
      author_id: SYSTEM_AUTHOR_ID,
      display_name: SYSTEM_DISPLAY_NAME,
      parent_id: null,
      path_id: 'main',
      content: systemContent,
      canvas_snapshot_state: null,
    })
    .select()
    .single()
  if (msgError) {
    console.error('[sessions-helpers] system message insert error:', msgError.message)
  }

  // Broadcast session_status_change to all clients
  supabase
    .channel(`session:${sessionId}`)
    .httpSend('session_status_change', {
      status: 'frozen',
      reason,
      title: updated?.title ?? null,
    })
    .catch((err: unknown) => console.error('[sessions-helpers] broadcast error:', err))
}

function freezeReasonMessage(reason: string): string {
  switch (reason) {
    case 'auto_freeze_creator_absent':
      return 'Esta sesion se congelo automaticamente por inactividad del creador.'
    case 'cap_reached':
      return 'Limite de respuestas AI alcanzado. La sesion ha sido congelada.'
    default:
      return `Sesion congelada (razon: ${reason}).`
  }
}
