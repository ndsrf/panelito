import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

/**
 * OAuth callback route handler.
 *
 * Supabase redirects here after Google OAuth completes.
 * Exchanges the one-time code for a session cookie via exchangeCodeForSession().
 *
 * Security (T-02-01): Supabase validates the code against GoTrue's internal
 * PKCE/state store — forged codes are rejected automatically.
 * Security (T-02-03): ?code is stripped from URL via redirect to clean path
 * — no Referer leak.
 *
 * On success: redirects to / (protected layout handles routing from there)
 * On error: redirects to /auth/sign-in?error=oauth_failed
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(new URL('/auth/sign-in?error=oauth_failed', request.url))
  }

  try {
    const supabase = await createServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error('[auth/callback] exchangeCodeForSession error:', error.message)
      return NextResponse.redirect(new URL('/auth/sign-in?error=oauth_failed', request.url))
    }

    // Success — redirect to protected home (middleware will verify session)
    return NextResponse.redirect(new URL('/', request.url))
  } catch (err) {
    // Fail closed (T-02-05): any unexpected error → redirect to sign-in
    console.error('[auth/callback] unexpected error:', err)
    return NextResponse.redirect(new URL('/auth/sign-in?error=oauth_failed', request.url))
  }
}
