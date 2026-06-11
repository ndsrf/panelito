/**
 * apiFetch — typed fetch wrapper for Hono API calls.
 *
 * Attaches the Supabase JWT as Authorization: Bearer <token> on every request.
 * On the browser: reads the session from createClient().auth.getSession().
 * On the server: caller must pass an accessToken explicitly (from createServerClient).
 *
 * T-03-07: Surfaces typed ApiError for non-2xx responses so callers can
 * handle auth/validation errors without catching raw fetch errors.
 *
 * Usage (browser component):
 *   const session = await apiFetch<Session>('/api/sessions', { method: 'POST', body: ... })
 *
 * Usage (server component):
 *   const supabase = await createServerClient()
 *   const { data: { session } } = await supabase.auth.getSession()
 *   const data = await apiFetch<Session>('/api/sessions/xyz', {}, session?.access_token)
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(`API error ${status}`)
    this.name = 'ApiError'
  }
}

/**
 * apiFetch<T> — wraps fetch against the Hono API.
 *
 * @param path - API path, e.g. '/api/sessions'
 * @param init - Optional fetch RequestInit (method, body, headers, etc.)
 * @param accessToken - Optional Supabase JWT. If omitted, reads from browser session.
 *                      Pass explicitly from server components.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string
): Promise<T> {
  let token = accessToken

  // On the browser side, auto-read the current Supabase session
  if (!token && typeof window !== 'undefined') {
    // Dynamic import to avoid bundling server-only code on the client
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    token = session?.access_token
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> ?? {}),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = { error: 'unknown' }
    }
    throw new ApiError(response.status, body)
  }

  return response.json() as Promise<T>
}
