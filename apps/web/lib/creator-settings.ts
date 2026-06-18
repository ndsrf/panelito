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
import type { CreatorSettings, MultiProviderStatus } from '@panelito/types'

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
 * Returns MultiProviderStatus from GET /api/keys/status.
 * Used by the settings page to display the three-provider selector with per-provider
 * masked key status, active provider indicator, and last4 display.
 *
 * The full key and encrypted blob are NEVER returned (AI-02).
 * Returns a safe 3-provider default (all keys absent, anthropic active) on error.
 */
export async function getKeyStatus(): Promise<MultiProviderStatus> {
  const supabase = await createServerClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const accessToken = session?.access_token

  try {
    return await apiFetch<MultiProviderStatus>('/api/keys/status', {}, accessToken)
  } catch (err) {
    console.error('[getKeyStatus] fetch failed:', err)
    // Safe default: all keys absent, anthropic active (D-05 fallback)
    return {
      active_provider: 'anthropic',
      providers: [
        { provider: 'anthropic', has_key: false, last4: null, is_active: true },
        { provider: 'openai', has_key: false, last4: null, is_active: false },
        { provider: 'gemini', has_key: false, last4: null, is_active: false },
      ],
    }
  }
}
