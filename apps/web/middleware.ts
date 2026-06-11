import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Supabase session refresh + auth gate middleware.
 *
 * On every matched request:
 * 1. Refreshes the Supabase auth token cookie so sessions stay valid.
 * 2. If the user is not authenticated AND the path is not under /auth/...,
 *    redirects to /auth/sign-in (fail-closed, T-02-05).
 *
 * This is the canonical Next.js 15 + Supabase SSR pattern:
 * https://supabase.com/docs/guides/auth/server-side/nextjs
 *
 * IMPORTANT: Uses getUser() not getSession() — getSession() does not
 * validate the JWT server-side; getUser() does.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  let user = null;

  try {
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
              request.cookies.set(name, value);
              response = NextResponse.next({ request });
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    // Refresh session — MUST use getUser() not getSession()
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Fail closed (T-02-05): on any error, treat user as unauthenticated
    user = null;
  }

  const { pathname } = request.nextUrl;

  // Auth gate: if not authenticated AND not on an /auth/* or /join/* path, redirect to sign-in
  // /join/* is the public guest entry point — guests do not have a Supabase session
  // until after they submit the join form (D-01, SESS-04).
  if (!user && !pathname.startsWith("/auth/") && !pathname.startsWith("/join/")) {
    const signInUrl = new URL("/auth/sign-in", request.url);
    return NextResponse.redirect(signInUrl);
  }

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
