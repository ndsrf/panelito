'use server'

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
    return data
  } catch {
    return { error: 'Network error. Check your connection and try again.' }
  }
}
