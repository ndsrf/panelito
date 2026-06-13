'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

const DEV_EMAIL = 'dev@local.test'
const DEV_PASSWORD = 'localdev123'

export async function devSignIn() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('devSignIn not available in production')
  }

  const admin = createAdminClient()

  // Create dev user if not exists (ignore "already registered" error)
  await admin.auth.admin.createUser({
    email: DEV_EMAIL,
    password: DEV_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Dev User' },
  })

  // Sign in to get a real session with SSR cookies
  const supabase = await createServerClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: DEV_EMAIL,
    password: DEV_PASSWORD,
  })

  if (error) throw new Error(`Dev sign-in failed: ${error.message}`)

  redirect('/')
}
