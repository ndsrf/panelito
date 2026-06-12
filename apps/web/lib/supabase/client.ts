"use client";

import { createBrowserClient } from "@supabase/ssr";
import { LongPoll } from "@supabase/phoenix";

/**
 * createClient — browser-side Supabase client.
 *
 * Uses @supabase/ssr createBrowserClient which handles:
 * - Cookie-based auth (works with Next.js 15 App Router)
 * - Automatic token refresh
 * - Realtime subscriptions
 *
 * LongPoll transport: used for Realtime when running against localhost, because
 * WSL2 Docker containers don't get automatic Windows port forwarding for
 * WebSocket upgrades. LongPoll uses plain HTTP, which does forward correctly.
 * In production (HTTPS), WebSocket is used natively by Supabase Realtime.
 *
 * Usage: always call this inside a Client Component or hook.
 * Never import in Server Components — use lib/supabase/server.ts instead.
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const isLocalhost = supabaseUrl.includes("localhost") || supabaseUrl.includes("127.0.0.1");

  return createBrowserClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    isLocalhost
      ? { realtime: { transport: LongPoll as never } }
      : undefined
  );
}
