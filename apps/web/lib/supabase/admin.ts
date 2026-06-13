import { createClient } from '@supabase/supabase-js'

// Server-only admin client — uses service role key, never exposed to browser.
// Call only from Server Actions and Route Handlers.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase admin env vars')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}
