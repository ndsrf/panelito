/**
 * bot-registration.ts — Coach/Analyst bot registration with the Phase 10 arbitrator (BOT-02).
 *
 * Centralizes registerBot() calls for the two Phase 11 Roles. The registry was intentionally
 * left empty in Phase 10 (D-03 short-circuit); this module is the first thing that populates
 * it, exercising the non-empty registry path of runArbitration() for the first time.
 *
 * Deliberately NOT called from inside facilitation-agent.ts/analytics-agent.ts module scope
 * (11-PATTERNS.md "Shared Patterns — registration at module load"): those node modules are
 * imported directly by graph.test.ts, and an import-time registerBot() side effect there would
 * silently pollute the shared arbitration registry for unrelated tests. Registration is
 * centralized here and invoked explicitly by the caller (silence-scan.ts's
 * startSilenceScanLoop) instead.
 *
 * Scoring model (deliberately minimal, D-15): Phase 11's silence-scan loop is the only caller
 * of runArbitration() this phase, and silence-gate is exclusively the Coach's domain — the
 * Analyst has no live trigger yet (TRIGGER-05 / fact-check trigger ships in Phase 12). So
 * coachScorer returns a fixed positive affinity and analystScorer returns 0, guaranteeing
 * Coach always wins whenever arbitration actually runs in this phase. Analyst is still
 * registered (not omitted) so the registry-non-empty path stays exercised end-to-end and so
 * Phase 12 only needs to change analystScorer's logic (e.g. score higher when a fact-check
 * trigger context is present), not add a new registration call site.
 *
 * Phase 14's TriggerEngine will generalize this into a richer, trigger-type-aware scoring
 * model once ArbContext carries trigger-type/content signals beyond { branchId, blueprint,
 * supabase }.
 */

import { registerBot } from './bot-arbitrator'
import type { ArbContext } from './bot-arbitrator'

/** Coach affinity — silence-gate is exclusively the Coach's domain in Phase 11. */
function coachScorer(_context: ArbContext): number {
  return 7
}

/**
 * Analyst affinity — always 0 in Phase 11: no live trigger reaches the Analyst via the
 * arbitrator yet (fact-check trigger, TRIGGER-05, ships in Phase 12). Registered so the
 * arbitrator's registry is non-empty and multi-bot scoring is exercised, without ever
 * actually winning arbitration this phase.
 */
function analystScorer(_context: ArbContext): number {
  return 0
}

let _registered = false

/**
 * registerBots — registers 'coach' and 'analyst' scorers with the arbitrator.
 *
 * Idempotent: safe to call more than once (e.g. from repeated startSilenceScanLoop calls
 * in tests) — registerBot() itself is a Map.set(), so re-registration would just overwrite
 * with the same scorer, but the _registered guard avoids redundant registry writes.
 */
export function registerBots(): void {
  if (_registered) return
  registerBot('coach', coachScorer)
  registerBot('analyst', analystScorer)
  _registered = true
}
