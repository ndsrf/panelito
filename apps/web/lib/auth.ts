import 'server-only'
import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'

/**
 * getUser — server-only helper to retrieve the authenticated user.
 *
 * Calls supabase.auth.getUser() which validates the JWT server-side.
 * Never use getSession() in server code — it does not validate the JWT.
 *
 * Returns the User object or null if unauthenticated.
 */
export async function getUser(): Promise<User | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

/**
 * requireUser — server-only gate for protected pages.
 *
 * Calls getUser() and redirects to /auth/sign-in if the user is null.
 * Uses Next.js redirect() which throws internally — callers do not need
 * a null check after calling requireUser().
 *
 * Usage: call at the top of any Server Component for a protected route.
 */
export async function requireUser(): Promise<User> {
  const user = await getUser()
  if (!user) {
    redirect('/auth/sign-in')
  }
  return user
}

/**
 * signOut — server action to sign out the current user.
 *
 * Signs out via Supabase and redirects to /auth/sign-in.
 * Mark the calling component with 'use server' or call from a Server Action.
 */
export async function signOut(): Promise<void> {
  const supabase = await createServerClient()
  await supabase.auth.signOut()
  redirect('/auth/sign-in')
}
