import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * createServiceClient — Hono-side Supabase client using the service role key.
 *
 * This client BYPASSES Row Level Security — it can read and write any row.
 * Use it ONLY in server-side Hono routes where full access is required.
 *
 * NEVER expose this client or the service role key to the browser.
 * T-01-08: Key is read from validated env; never logged; never returned in responses.
 *
 * Usage:
 *   const supabase = createServiceClient()
 *   const { data } = await supabase.from('sessions').select('*')
 */
export function createServiceClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      // Service role clients should not persist sessions
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
