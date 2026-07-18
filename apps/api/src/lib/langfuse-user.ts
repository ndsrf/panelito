/**
 * langfuse-user.ts — resolves the Langfuse `userId` for a session's creator (OBS-USER-01).
 *
 * Why this exists:
 *   Langfuse's Users feature (https://langfuse.com/docs/observability/features/users)
 *   groups every trace/generation sharing a `userId` under one person, enabling per-user
 *   cost/usage attribution. Every AI trace this codebase creates (human-reactive /invoke
 *   in ai.ts, proactive silence-gate in trigger-engine.ts) belongs to a session; the
 *   session's creator is the person to attribute that cost to.
 *
 * Resolution priority (per explicit user instruction — INTENTIONALLY REVERSES the
 * precedent in sessions.ts's GET /by-code/:code, which orders full_name BEFORE email):
 *   1. auth email       — the creator's Supabase Auth email, when present
 *   2. full_name        — user_metadata.full_name, when email is absent
 *   3. creatorId (UUID) — stable last-resort so userId is NEVER null/empty
 *
 * Never-throw contract (mirrors langfuse-generation.ts / langfuse-otel.ts):
 *   A Langfuse-identity lookup failure (auth.admin.getUserById throws, or returns no
 *   data) must NEVER abort or degrade the AI turn — this resolver always resolves to a
 *   non-empty string, falling back to the caller-supplied creatorId on any error.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Returns the trimmed value, or undefined if it's absent/empty/whitespace-only. */
function normalize(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * resolveCreatorLangfuseUserId — email-first Langfuse `userId` resolver for a session
 * creator. Never throws; always resolves to a non-empty string.
 */
export async function resolveCreatorLangfuseUserId(
  supabase: SupabaseClient,
  creatorId: string
): Promise<string> {
  try {
    const { data } = await supabase.auth.admin.getUserById(creatorId)
    const email = normalize(data?.user?.email)
    if (email) return email

    const fullName = normalize(data?.user?.user_metadata?.full_name)
    if (fullName) return fullName

    return creatorId
  } catch (err) {
    console.error('[langfuse-user] identity lookup failed for creator', creatorId, (err as Error).message)
    return creatorId
  }
}
