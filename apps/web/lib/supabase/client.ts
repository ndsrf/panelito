"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * createClient — browser-side Supabase client.
 *
 * Uses @supabase/ssr createBrowserClient which handles:
 * - Cookie-based auth (works with Next.js 15 App Router)
 * - Automatic token refresh
 * - Realtime subscriptions
 *
 * Usage: always call this inside a Client Component or hook.
 * Never import in Server Components — use lib/supabase/server.ts instead.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
