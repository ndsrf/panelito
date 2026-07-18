/**
 * bot-arbitrator.ts — Central bot arbitration module (BOT-02).
 *
 * Plugin registry: bots self-register via registerBot(botId, scorerFn).
 * runArbitration: scores all registered bots, acquires the arbitration lock for
 * the winner, returns the winner bot ID or null (no bots registered / lock denied / error).
 *
 * In Phase 10, the registry is empty — runArbitration short-circuits to null (D-03).
 *
 * Cooldown duration (D-02): resolved from blueprint.bot_cooldowns?.[winnerId] at lock time.
 * If the map or key is absent, falls back to DEFAULT_COOLDOWN_SECONDS (30s).
 *
 * T-10-09: Winner only fires if try_acquire_bot_lock (atomic DB compare-and-set) grants
 * the lock — scoring alone cannot bypass the lock.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Blueprint } from '@panelito/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArbContext {
  branchId: string
  blueprint: Blueprint
  supabase: SupabaseClient
  /** Phase 12 (D-06) additive extension point: role of the Skill that fired via
   *  TriggerGateNode, when arbitration is invoked in response to a live Skill firing rather
   *  than the Phase 11 trigger-engine loop (which never sets this field — runArbitration's own
   *  context construction below omits it, so every EXISTING call site's behavior is
   *  unchanged). Optional and additive: bot-registration.ts's analystScorer is the only
   *  reader in this phase; a future Phase 14 TriggerEngine caller can thread a real value in
   *  by passing an ArbContext-shaped object directly to a scorer, without any signature
   *  change to runArbitration itself. */
  firingSkillRole?: 'coach' | 'analyst' | null
}

type ScorerFn = (context: ArbContext) => number

// ---------------------------------------------------------------------------
// Module-level plugin registry
// ---------------------------------------------------------------------------

/**
 * Module-level plugin registry — populated by bot module imports in Phase 11+.
 * In Phase 10, this map is always empty (D-03: short-circuit path).
 */
const _registry = new Map<string, ScorerFn>()

/** Default cooldown in seconds when blueprint.bot_cooldowns is absent for a bot (D-02). */
const DEFAULT_COOLDOWN_SECONDS = 30

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * registerBot — add a bot scorer to the arbitration registry.
 *
 * Called at module import time by each bot module (Phase 11+).
 * In Phase 10, no bot modules are imported so the registry remains empty.
 *
 * @param botId - Unique identifier for the bot (e.g. 'silence-responder').
 * @param scorer - Function that returns a score for this bot in the given context.
 *                 Higher scores win the arbitration.
 */
export function registerBot(botId: string, scorer: ScorerFn): void {
  _registry.set(botId, scorer)
}

/**
 * runArbitration — scores all registered bots, acquires the lock for the winner.
 *
 * Phase 10 short-circuit (D-03): if the registry is empty, returns null immediately
 * without calling supabase.rpc — no DB round-trip.
 *
 * @returns The winning bot ID, or null if: empty registry / lock not acquired / rpc error.
 */
export async function runArbitration(
  branchId: string,
  blueprint: Blueprint,
  supabase: SupabaseClient
): Promise<string | null> {
  // D-03: Phase 10 short-circuit — no bots registered yet
  if (_registry.size === 0) return null

  const context: ArbContext = { branchId, blueprint, supabase }

  // Score all registered bots, pick the highest
  let winnerId: string | null = null
  let highScore = -Infinity

  for (const [botId, scorer] of _registry) {
    let score: number
    try {
      score = scorer(context)
    } catch (err) {
      // CR-02: Isolate faulty scorers — one bad scorer must not crash arbitration for all bots
      console.warn('[bot-arbitrator] scorer threw for bot:', botId, (err as Error).message)
      continue
    }
    if (score > highScore) {
      highScore = score
      winnerId = botId
    }
  }

  if (!winnerId) return null

  // D-02: resolve cooldown from blueprint.bot_cooldowns?.[winnerId].window_minutes.
  // Phase 11 Plan 02 bug fix: this used to read blueprint.bot_cooldowns?.[winnerId] as a
  // raw Record<string, number> (seconds) via a local BlueprintWithCooldowns intersection
  // type — a Phase 10 assumption written before Plan 02 added the REAL bot_cooldowns field
  // to BlueprintSchema (packages/types/src/blueprint.ts), which is shaped
  // Record<string, { max: number; window_minutes: number }>, not Record<string, number>.
  // The old code silently produced `{max,window_minutes} * 1000` = NaN, and
  // `new Date(Date.now() + NaN).toISOString()` throws "RangeError: Invalid time value" —
  // reproduced and confirmed against the real seeded debate-strategy-v1 Blueprint shape.
  // window_minutes (PERSONA-03: Coach 3/15, Analyst 2/15) is converted to seconds here;
  // this is also the correct semantic for Phase 11's interim trigger-engine loop, which
  // treats the arbitration lock window as "fire at most once per cooldown window"
  // (TRIGGER-01 success criterion 3), not a fine-grained N-per-window rate limiter.
  const windowMinutes = blueprint.bot_cooldowns?.[winnerId]?.window_minutes
  const cooldownSeconds = typeof windowMinutes === 'number' ? windowMinutes * 60 : DEFAULT_COOLDOWN_SECONDS
  const lockedUntil = new Date(Date.now() + cooldownSeconds * 1000).toISOString()

  // T-10-09: acquire the atomic lock — only the DB compare-and-set grants permission
  const { data, error } = await supabase.rpc('try_acquire_bot_lock', {
    p_branch_id: branchId,
    p_bot_id: winnerId,
    p_locked_until: lockedUntil,
  })

  if (error || !data?.[0]?.acquired) {
    console.warn('[bot-arbitrator] lock not acquired for winner:', winnerId, error?.message)
    return null
  }

  return winnerId
}

/**
 * releaseBotLock — explicitly releases the arbitration lock for a branch.
 *
 * MUST be called in a finally block after bot execution completes or fails.
 * Mirrors the release_mic pattern used in ai.ts for the human invoke path.
 * Failure to call this leaves the lock held until locked_until expires
 * (up to blueprint.bot_cooldowns seconds, default 30s per DEFAULT_COOLDOWN_SECONDS).
 *
 * CR-03: This function ensures Phase 11 bot callers have a documented contract
 * and a concrete finally-block pattern to copy. Without it, bot arbitration
 * locks leak until the cooldown expires on every invocation.
 *
 * @param branchId - Branch UUID whose lock should be released.
 * @param supabase - Supabase client (service role).
 */
export async function releaseBotLock(
  branchId: string,
  supabase: SupabaseClient
): Promise<void> {
  const { error } = await supabase.rpc('release_bot_lock', { p_branch_id: branchId })
  if (error) {
    console.warn('[bot-arbitrator] release_bot_lock error (non-fatal):', error.message)
  }
}
