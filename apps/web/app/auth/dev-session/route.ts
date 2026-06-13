import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// DEV-ONLY: sets a session from tokens passed as query params.
// Remove before deploying to production.
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  const { searchParams } = request.nextUrl
  const access_token = searchParams.get('access_token')
  const refresh_token = searchParams.get('refresh_token')

  if (!access_token || !refresh_token) {
    return NextResponse.json({ error: 'Missing access_token or refresh_token' }, { status: 400 })
  }

  try {
    const supabase = await createServerClient()
    const { error } = await supabase.auth.setSession({ access_token, refresh_token })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }

    return NextResponse.redirect(new URL('/', request.url))
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
