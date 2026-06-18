'use server'

import { createServerClient } from '@/lib/supabase/server'

/**
 * Server action: joinSession
 *
 * Calls the Hono API's guest endpoint to mint an anonymous Supabase token
 * for the guest. This is a public endpoint (no auth required).
 *
 * SESS-04: Guest joins with display name only — no registration, no password.
 * SESS-10: The returned tokens are persisted to localStorage by the client
 *          immediately after this action completes.
 *
 * Returns the join response on success, or { error: string } on failure.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787'

export interface JoinSessionResult {
  session_id: string
  guest_user_id: string
  access_token: string
  refresh_token: string
  display_name: string
}

export type JoinSessionResponse =
  | JoinSessionResult
  | { error: string }

export async function joinSession({
  code,
  display_name,
}: {
  code: string
  display_name: string
}): Promise<JoinSessionResponse> {
  try {
    const res = await fetch(`${API_URL}/api/sessions/by-code/${code}/guests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name }),
      cache: 'no-store',
    })

    if (!res.ok) {
      if (res.status === 404) {
        return { error: 'Session not found. The link may have expired.' }
      }
      if (res.status === 429) {
        return { error: 'Too many requests. Please wait a moment and try again.' }
      }
      return { error: 'Failed to join session. Please try again.' }
    }

    const data: JoinSessionResult = await res.json()

    // SESS-10: Set the session on the server so cookies are sent to the client.
    // This ensures that the subsequent redirect to /sessions/[id] is authenticated.
    const supabase = await createServerClient()
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    })

    if (sessionError) {
      console.error('[join-action] setSession error:', sessionError.message)
      // We still return data because the client can try to set session as fallback
    }

    return data
  } catch (error) {
    console.error('[join-action] fetch error:', error)
    return { error: 'Network error. Check your connection and try again.' }
  }
}
