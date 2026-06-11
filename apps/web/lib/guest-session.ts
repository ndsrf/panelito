/**
 * Guest session persistence — localStorage helpers.
 *
 * SESS-10: Guest tokens are persisted to localStorage so guests can re-enter
 * a session without re-submitting their display name on reload.
 *
 * Storage key: panelito:guest:<shortCode>
 * Schema: { guest_user_id, access_token, refresh_token, display_name, session_id, saved_at }
 *
 * T-03-04: The access_token is a signed Supabase JWT; tampering invalidates
 * the signature and Supabase Auth rejects it. Display name tampering is moot —
 * it appears on the user's own bubbles only.
 *
 * Usage:
 *   saveGuestSession(shortCode, { guest_user_id, access_token, refresh_token, display_name, session_id })
 *   const saved = loadGuestSession(shortCode)
 *   if (saved) { ...restore session... }
 *   clearGuestSession(shortCode) // called on session close
 */

/** Key prefix — exported for debugging/inspection */
export const LOCAL_STORAGE_KEY_PREFIX = 'panelito:guest:'

export interface GuestSession {
  guest_user_id: string
  access_token: string
  refresh_token: string
  display_name: string
  session_id: string
  saved_at: string
}

type GuestSessionInput = Omit<GuestSession, 'saved_at'>

/**
 * saveGuestSession — persists the guest session to localStorage.
 *
 * Caller MUST await before router.push to prevent the SSR pitfall (RESEARCH.md Pitfall 8):
 * `await saveGuestSession(shortCode, sessionData)` then `router.push(...)`.
 */
export function saveGuestSession(shortCode: string, session: GuestSessionInput): void {
  if (typeof localStorage === 'undefined') return

  const key = `${LOCAL_STORAGE_KEY_PREFIX}${shortCode}`
  const value: GuestSession = {
    ...session,
    saved_at: new Date().toISOString(),
  }
  localStorage.setItem(key, JSON.stringify(value))
}

/**
 * loadGuestSession — reads and parses a guest session from localStorage.
 *
 * Returns null if no session is found or if the stored value is corrupt.
 */
export function loadGuestSession(shortCode: string): GuestSession | null {
  if (typeof localStorage === 'undefined') return null

  const key = `${LOCAL_STORAGE_KEY_PREFIX}${shortCode}`
  const raw = localStorage.getItem(key)
  if (!raw) return null

  try {
    return JSON.parse(raw) as GuestSession
  } catch {
    // Corrupt value — treat as no saved session
    return null
  }
}

/**
 * clearGuestSession — removes the guest session from localStorage.
 *
 * Called when a guest explicitly leaves a session or when the session is closed.
 */
export function clearGuestSession(shortCode: string): void {
  if (typeof localStorage === 'undefined') return

  const key = `${LOCAL_STORAGE_KEY_PREFIX}${shortCode}`
  localStorage.removeItem(key)
}
