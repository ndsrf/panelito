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

  // Landing page (/) is public — authenticated users land at /sessions instead.
  if (pathname === "/") {
    if (user) {
      return NextResponse.redirect(new URL("/sessions", request.url));
    }
    return response;
  }

  // Auth gate: if not authenticated AND not on an /auth/*, /join/*, or /api/* path, redirect to sign-in
  // /api/* is handled by the Hono API's internal requireAuth middleware.
  if (!user && !pathname.startsWith("/auth/") && !pathname.startsWith("/join/") && !pathname.startsWith("/api/")) {
    const signInUrl = new URL("/auth/sign-in", request.url);
    return NextResponse.redirect(signInUrl);
  }

  // Set x-pathname header so Server Components can read the current path
  // without importing next/headers cookies() — used by (protected)/layout.tsx
  // to detect /settings and skip the BYOK gate for that route (D-04).
  response.headers.set("x-pathname", pathname);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico
     * - *.svg and *.png files (Open Graph images)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png)$|opengraph-image).*)",
  ],
};
