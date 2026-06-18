import 'server-only'

/**
 * creator-settings.ts — server-only helper for reading creator settings.
 *
 * T-06-08: The `import 'server-only'` directive on line 1 causes a build error
 * if this module is imported in any 'use client' component — preventing
 * accidental exposure of server-side logic to the browser bundle.
 *
 * D-04: Used by (protected)/layout.tsx to gate the workspace routes.
 * D-05/06: Used by /settings to display current key status and cap.
 */

import { createServerClient } from '@/lib/supabase/server'
import { apiFetch } from '@/lib/api'
import type { CreatorSettings } from '@panelito/types'

/**
 * getCreatorSettings — server-only.
 *
 * Fetches the public-safe creator settings from the Hono /api/settings endpoint.
 * Uses the user's JWT from cookies for authentication.
 *
 * Returns default values (has_api_key: false, api_response_cap: 150) if no
 * settings row exists yet.
 */
export async function getCreatorSettings(): Promise<CreatorSettings> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const {
    data: { session },
  } = await supabase.auth.getSession()

  const accessToken = session?.access_token

  try {
    return await apiFetch<CreatorSettings>('/api/settings', {}, accessToken)
  } catch (err) {
    // Log the error for server-side debugging
    console.error('[getCreatorSettings] fetch failed:', err)
    
    // If settings fetch fails (e.g., no row yet), return safe defaults
    return {
      user_id: user?.id ?? '',
      has_api_key: false,
      api_response_cap: 150,
      active_provider: 'anthropic' as const,
      updated_at: null as unknown as string,
    }
  }
}

/**
 * getKeyStatus — server-only.
 *
 * Returns { has_api_key, last4 } from GET /api/keys/status.
 * Used by the settings page to display the masked key (sk-ant-••••[last4]).
 * The full key and encrypted blob are NEVER returned (AI-02).
 */
export async function getKeyStatus(): Promise<{ has_api_key: boolean; last4: string | null }> {
  const supabase = await createServerClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const accessToken = session?.access_token

  try {
    return await apiFetch<{ has_api_key: boolean; last4: string | null }>(
      '/api/keys/status',
      {},
      accessToken
    )
  } catch (err) {
    console.error('[getKeyStatus] fetch failed:', err)
    return { has_api_key: false, last4: null }
  }
}
