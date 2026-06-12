/**
 * auto-freeze.ts — Creator presence tracker + auto-freeze timer (SESS-07, SESS-11).
 *
 * How it works:
 * 1. `startAutoFreezeTracker(supabase)` runs once at API boot. Subscribes to all
 *    active sessions' `presence:${id}` channels and watches for creator presence drops.
 * 2. `onCreatorPresenceChange(sessionId, creatorId, isOnline, supabase)` manages
 *    the two-stage timer:
 *    - Presence drop -> wait GRACE_MS (default 30s) for reconnect.
 *    - If still absent after grace -> start FREEZE_AFTER_MS (default 15min) countdown.
 *    - Any reconnect at ANY point resets both timers silently (SESS-11 anti-flicker).
 *
 * Timer overrides (test-only):
 * - `AUTO_FREEZE_GRACE_MS` env var — default 30_000 (30s). Set to 200 in E2E tests.
 * - `AUTO_FREEZE_AFTER_MS` env var — default 900_000 (15min). Set to 500 in E2E tests.
 *
 * CAUTION: Production must NEVER set these below their defaults.
 * T-07-03: A startup warning is emitted if values are below production minimums.
 *
 * Limitation: In-memory state does not survive API process restarts. A server restart
 * will reset all timers. For Phase 1's solo-developer demo scale this is acceptable.
 * Post-MVP migrates to a Redis-backed scheduler or Supabase pg_cron.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { freezeSession } from './sessions-helpers'

// -----------------------------------------------------------------------
// Timer constants — read from env at module load (test-only overrides)
// -----------------------------------------------------------------------

const GRACE_MS = parseInt(process.env.AUTO_FREEZE_GRACE_MS ?? '30000', 10)
const FREEZE_AFTER_MS = parseInt(process.env.AUTO_FREEZE_AFTER_MS ?? '900000', 10)

// T-07-03: Warn if env overrides are suspiciously low (someone set them in prod)
if (GRACE_MS < 30_000) {
  console.warn(
    `[auto-freeze] WARNING: AUTO_FREEZE_GRACE_MS=${GRACE_MS} is below the production minimum of 30000. ` +
    'This should only be set in test environments.'
  )
}
if (FREEZE_AFTER_MS < 900_000) {
  console.warn(
    `[auto-freeze] WARNING: AUTO_FREEZE_AFTER_MS=${FREEZE_AFTER_MS} is below the production minimum of 900000. ` +
    'This should only be set in test environments.'
  )
}

// -----------------------------------------------------------------------
// In-memory tracker state
// -----------------------------------------------------------------------

interface TrackerEntry {
  creatorId: string
  lastSeenAt: number
  graceTimer: ReturnType<typeof setTimeout> | null
  freezeTimer: ReturnType<typeof setTimeout> | null
  supabase: SupabaseClient
}

/** In-memory map of sessionId -> tracker state. */
const trackerMap = new Map<string, TrackerEntry>()

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

/**
 * startAutoFreezeTracker — run once at API boot.
 *
 * Fetches all active sessions and subscribes to their presence channels.
 * Also subscribes to session-create events so newly created sessions are tracked.
 *
 * @param supabase - Service-role Supabase client.
 */
export async function startAutoFreezeTracker(supabase: SupabaseClient): Promise<void> {
  // Fetch all currently active sessions
  const { data: activeSessions, error } = await supabase
    .from('sessions')
    .select('id, creator_id')
    .eq('status', 'active')

  if (error) {
    console.error('[auto-freeze] Failed to load active sessions:', error.message)
    return
  }

  for (const session of activeSessions ?? []) {
    subscribeToSessionPresence(supabase, session.id, session.creator_id)
  }

  console.log(`[auto-freeze] Tracking ${activeSessions?.length ?? 0} active sessions`)
}

/**
 * onCreatorPresenceChange — called when presence state changes for a session.
 *
 * If `isOnline = false`: starts the 30s grace timer. If still absent after grace,
 * starts the 15min freeze countdown.
 * If `isOnline = true`: cancels both timers silently (SESS-11 anti-flicker).
 *
 * @param sessionId - The session being tracked.
 * @param creatorId - The creator's user ID.
 * @param isOnline - Whether the creator is currently online.
 * @param supabase - Service-role client for the freeze action.
 */
export function onCreatorPresenceChange(
  sessionId: string,
  creatorId: string,
  isOnline: boolean,
  supabase: SupabaseClient
): void {
  if (isOnline) {
    // Creator came back online — cancel both timers silently (SESS-11)
    cancelTimers(sessionId)
    return
  }

  // Creator went offline — cancel any existing timers before starting new ones
  // (prevents stacking from multiple rapid drops — Test 4)
  cancelTimers(sessionId)

  const entry: TrackerEntry = {
    creatorId,
    lastSeenAt: Date.now(),
    graceTimer: null,
    freezeTimer: null,
    supabase,
  }

  // Stage 1: 30s grace timer
  entry.graceTimer = setTimeout(() => {
    // Grace expired — start the 15min freeze countdown
    const currentEntry = trackerMap.get(sessionId)
    if (!currentEntry) return // was canceled

    currentEntry.graceTimer = null

    // Stage 2: 15min freeze timer
    currentEntry.freezeTimer = setTimeout(() => {
      const freezeEntry = trackerMap.get(sessionId)
      if (!freezeEntry) return // was canceled

      freezeEntry.freezeTimer = null
      trackerMap.delete(sessionId)

      // Fire the freeze
      freezeSession(supabase, sessionId, 'auto_freeze_creator_absent').catch((err: unknown) =>
        console.error('[auto-freeze] freezeSession error:', err)
      )
    }, FREEZE_AFTER_MS)

    currentEntry.freezeTimer = currentEntry.freezeTimer
  }, GRACE_MS)

  entry.graceTimer = entry.graceTimer
  trackerMap.set(sessionId, entry)
}

/**
 * clearAllTrackers — called on server shutdown (SIGTERM) to clean up all timers.
 */
export function clearAllTrackers(): void {
  for (const [sessionId] of trackerMap) {
    cancelTimers(sessionId)
  }
  trackerMap.clear()
}

// -----------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------

function cancelTimers(sessionId: string): void {
  const entry = trackerMap.get(sessionId)
  if (!entry) return

  if (entry.graceTimer !== null) {
    clearTimeout(entry.graceTimer)
    entry.graceTimer = null
  }
  if (entry.freezeTimer !== null) {
    clearTimeout(entry.freezeTimer)
    entry.freezeTimer = null
  }
  trackerMap.delete(sessionId)
}

function subscribeToSessionPresence(
  supabase: SupabaseClient,
  sessionId: string,
  creatorId: string
): void {
  const channel = supabase.channel(`presence:${sessionId}`, {
    config: { presence: { key: 'tracker' } },
  })

  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState()
    // Check if ANY presence entry has role: 'creator' from this creator
    const creatorOnline = Object.values(state).some((presences) =>
      (presences as Array<{ role?: string; user_id?: string }>).some(
        (p) => p.role === 'creator' || p.user_id === creatorId
      )
    )
    onCreatorPresenceChange(sessionId, creatorId, creatorOnline, supabase)
  })

  channel.subscribe()
}
