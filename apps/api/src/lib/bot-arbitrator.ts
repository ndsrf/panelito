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
}

type ScorerFn = (context: ArbContext) => number

/**
 * Blueprint extended with optional bot_cooldowns map (Phase 11+ feature).
 * Accessed via optional chaining to remain backward-compatible with current Blueprint type.
 */
type BlueprintWithCooldowns = Blueprint & {
  bot_cooldowns?: Record<string, number>
}

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
    const score = scorer(context)
    if (score > highScore) {
      highScore = score
      winnerId = botId
    }
  }

  if (!winnerId) return null

  // D-02: resolve cooldown from blueprint.bot_cooldowns?.[winnerId]
  const bp = blueprint as BlueprintWithCooldowns
  const cooldownSeconds = bp.bot_cooldowns?.[winnerId] ?? DEFAULT_COOLDOWN_SECONDS
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
