/**
 * langfuse-user.test.ts — Unit tests for resolveCreatorLangfuseUserId (OBS-USER-01).
 *
 * Covers:
 *   - Email wins even when full_name is also present (email-first priority)
 *   - full_name fallback when email is absent
 *   - creatorId (UUID) as the stable last-resort when neither is present
 *   - Never-throw contract: admin lookup throwing OR returning { data: null } still
 *     resolves to creatorId, never rejects
 */

import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveCreatorLangfuseUserId } from './langfuse-user'

function makeSupabase(getUserById: (id: string) => Promise<unknown>): SupabaseClient {
  return {
    auth: {
      admin: {
        getUserById,
      },
    },
  } as unknown as SupabaseClient
}

const CREATOR_ID = '11111111-1111-1111-1111-111111111111'

describe('resolveCreatorLangfuseUserId', () => {
  it('resolves to email when present, even when full_name is also present', async () => {
    const getUserById = vi.fn().mockResolvedValue({
      data: { user: { email: 'creator@example.com', user_metadata: { full_name: 'Creator Name' } } },
    })
    const supabase = makeSupabase(getUserById)

    const result = await resolveCreatorLangfuseUserId(supabase, CREATOR_ID)

    expect(result).toBe('creator@example.com')
    expect(getUserById).toHaveBeenCalledWith(CREATOR_ID)
  })

  it('resolves to full_name when email is absent', async () => {
    const getUserById = vi.fn().mockResolvedValue({
      data: { user: { email: null, user_metadata: { full_name: 'Creator Name' } } },
    })
    const supabase = makeSupabase(getUserById)

    const result = await resolveCreatorLangfuseUserId(supabase, CREATOR_ID)

    expect(result).toBe('Creator Name')
  })

  it('resolves to creatorId UUID when neither email nor full_name is present', async () => {
    const getUserById = vi.fn().mockResolvedValue({
      data: { user: { email: null, user_metadata: {} } },
    })
    const supabase = makeSupabase(getUserById)

    const result = await resolveCreatorLangfuseUserId(supabase, CREATOR_ID)

    expect(result).toBe(CREATOR_ID)
  })

  it('resolves to creatorId UUID when getUserById throws or returns no data (never-throw)', async () => {
    const throwingGetUserById = vi.fn().mockRejectedValue(new Error('admin API unreachable'))
    const throwingSupabase = makeSupabase(throwingGetUserById)

    await expect(resolveCreatorLangfuseUserId(throwingSupabase, CREATOR_ID)).resolves.toBe(CREATOR_ID)

    const nullDataGetUserById = vi.fn().mockResolvedValue({ data: null })
    const nullDataSupabase = makeSupabase(nullDataGetUserById)

    const result = await resolveCreatorLangfuseUserId(nullDataSupabase, CREATOR_ID)
    expect(result).toBe(CREATOR_ID)
  })
})
