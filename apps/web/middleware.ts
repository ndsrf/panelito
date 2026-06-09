import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Supabase session refresh middleware.
 *
 * Refreshes the Supabase auth token on every request so that:
 * - Session cookies stay valid across page reloads
 * - Server Components receive a fresh token
 *
 * This is the canonical Next.js 15 + Supabase SSR pattern:
 * https://supabase.com/docs/guides/auth/server-side/nextjs
 *
 * IMPORTANT: Uses getUser() not getSession() — getSession() does not
 * validate the JWT server-side; getUser() does.
 *
 * Plan 02 will add:
 * - Route protection for /sessions/* (redirect to /auth/sign-in)
 * - Onboarding gate for first-time creators (redirect to /onboarding/api-key)
 */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // parseCookieHeader returns { name, value? }[] — filter out undefined values
          return parseCookieHeader(request.headers.get("cookie") ?? "")
            .filter((c): c is { name: string; value: string } => c.value !== undefined);
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Refresh session — MUST use getUser() not getSession()
  // This keeps the session alive across page reloads.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico
     * - *.svg files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)",
  ],
};
