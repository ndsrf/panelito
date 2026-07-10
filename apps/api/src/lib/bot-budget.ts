/**
 * bot-budget.ts — Token budget guard wrapper (BOT-01).
 *
 * checkBotBudget: wraps the check_and_record_bot_budget RPC.
 *                 Returns a typed BotBudgetResult from the RPC row.
 *
 * T-10-07 (Denial of Service): Fail-closed on error or no-rows — returns
 * { allowed:false } so bots do NOT fire when budget state is unknown.
 * This prevents unbounded token spend if the DB is unreachable.
 *
 * D-07: The RPC atomically checks circuit state, sums the 5-minute window,
 * records usage, and trips the circuit if over threshold. Single round-trip.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BotBudgetResult } from '@panelito/types'

// ---------------------------------------------------------------------------
// Fail-closed sentinel — returned when RPC errors or returns no rows (T-10-07)
// ---------------------------------------------------------------------------

const FAIL_CLOSED: BotBudgetResult = {
  allowed: false,
  circuit_open: false,
  tokens_used_window: 0,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * checkBotBudget — checks and records token budget consumption for a branch.
 *
 * Calls check_and_record_bot_budget RPC with the branch id and token count.
 * Returns a typed BotBudgetResult. On any error or empty-row response, returns
 * the fail-closed sentinel (allowed:false) per T-10-07.
 *
 * @param supabase - Supabase client (service role).
 * @param branchId - Branch UUID.
 * @param tokensUsed - Tokens consumed by this invocation.
 */
export async function checkBotBudget(
  supabase: SupabaseClient,
  branchId: string,
  tokensUsed: number
): Promise<BotBudgetResult> {
  const { data, error } = await supabase.rpc('check_and_record_bot_budget', {
    p_branch_id: branchId,
    p_tokens_used: tokensUsed,
  })

  if (error || !data || !Array.isArray(data) || data.length === 0) {
    console.error('[bot-budget] check_and_record_bot_budget error:', error?.message ?? 'no rows returned')
    return FAIL_CLOSED
  }

  // Explicit field extraction — keeps the type-guard in TS, avoids Zod runtime dep here
  const row = data[0] as Record<string, unknown>
  const allowed = typeof row.allowed === 'boolean' ? row.allowed : false
  const circuit_open = typeof row.circuit_open === 'boolean' ? row.circuit_open : false
  // CR-01: Supabase-js serialises PostgreSQL bigint as string when > 2^53.
  // Handle both number (small values) and string (large bigint) serializations.
  const tokens_used_window =
    typeof row.tokens_used_window === 'number'
      ? row.tokens_used_window
      : typeof row.tokens_used_window === 'string'
      ? Number(row.tokens_used_window)
      : 0

  return { allowed, circuit_open, tokens_used_window }
}
