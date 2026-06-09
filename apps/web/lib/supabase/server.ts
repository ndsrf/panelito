import { createServerClient as createSSRServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * createServerClient — server-side Supabase client for Server Components,
 * Server Actions, and Route Handlers.
 *
 * Uses @supabase/ssr createServerClient with the Next.js cookies() adapter.
 * This pattern is the canonical Supabase SSR recommendation for Next.js 15:
 * https://supabase.com/docs/guides/auth/server-side/nextjs
 *
 * IMPORTANT: Always use supabase.auth.getUser() in server code, NOT
 * getSession(). getSession() does not validate the JWT against Supabase auth;
 * getUser() does a server round-trip to validate the token.
 *
 * Usage: call in Server Components, Route Handlers, Server Actions only.
 * For Client Components: use lib/supabase/client.ts instead.
 */
export async function createServerClient() {
  const cookieStore = await cookies();

  return createSSRServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // The setAll method is called from a Server Component.
            // This can be ignored if you have middleware refreshing the session.
          }
        },
      },
    }
  );
}
