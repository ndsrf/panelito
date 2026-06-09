'use client'

import { Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

/**
 * GoogleSignInButton — initiates the Supabase Google OAuth flow.
 *
 * Uses the browser Supabase client (createClient) to call signInWithOAuth.
 * The redirectTo points to our callback route which exchanges the code for a session.
 *
 * Styled per UI-SPEC Screen 1:
 * - variant="outline": Secondary surface + Border (NOT primary/accent)
 * - h-12: 48px tall touch target
 * - w-full: full width within the centered column
 */
export function GoogleSignInButton() {
  const handleSignIn = async () => {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  return (
    <Button
      variant="outline"
      className="w-full h-12 gap-2"
      onClick={handleSignIn}
    >
      <Mail className="h-4 w-4" />
      Continue with Google
    </Button>
  )
}
