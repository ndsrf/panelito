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
 * Scoring model (Phase 11 D-15, extended Phase 12 D-06): Phase 11's silence-scan loop is the
 * only caller of runArbitration() that never sets ArbContext.firingSkillRole — coachScorer's
 * fixed affinity (7) guarantees Coach always wins that call site, exactly as before.
 *
 * Phase 12 (D-06) extends analystScorer: it now scores based on which Skill's context is
 * present — a positive affinity (10, deliberately > coachScorer's fixed 7) when
 * context.firingSkillRole === 'analyst' (i.e. TriggerGateNode's orphan-edge or fact-check
 * Analyst Skill fired), 0 otherwise. This is the first mechanism by which the Analyst can
 * actually outscore the Coach in arbitration — but only when an Analyst Skill's own context
 * is threaded in; the existing silence-scan.ts call site never sets firingSkillRole, so its
 * behavior is byte-for-byte unchanged (analystScorer still returns 0 there).
 *
 * Phase 14's TriggerEngine will generalize this into a richer, trigger-type-aware scoring
 * model once every runArbitration() call site threads ArbContext.firingSkillRole (or a
 * successor field) consistently.
 */

import { registerBot } from './bot-arbitrator'
import type { ArbContext } from './bot-arbitrator'

/** Coach affinity — silence-gate is exclusively the Coach's domain in Phase 11; unchanged
 *  by Phase 12 — context-aware Coach scoring is not required by D-06. */
function coachScorer(_context: ArbContext): number {
  return 7
}

/**
 * Analyst affinity (Phase 12, D-06) — returns a positive affinity (10) when the arbitration
 * context indicates a firing Analyst Skill (context.firingSkillRole === 'analyst' — set by a
 * caller in response to TriggerGateNode's orphan-edge/fact-check Skill firing), 0 otherwise.
 * 10 is deliberately greater than coachScorer's fixed 7 so the Analyst can actually win
 * arbitration for the first time when its own Skill context is present.
 */
function analystScorer(context: ArbContext): number {
  return context.firingSkillRole === 'analyst' ? 10 : 0
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

// Exported for direct unit testing (mirrors orphan-edge.ts's "Exported for direct unit
// testing" convention) — bot-registration.test.ts asserts analystScorer's D-06 behavior
// directly rather than only indirectly through registerBots()/runArbitration().
export { coachScorer, analystScorer }
