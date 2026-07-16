---
phase: 13-user-profiles-phase-signal
plan: 04
subsystem: langgraph-skills
tags: [langgraph, skill, trigger-gate, phase-signal, tdd]

# Dependency graph
requires:
  - phase: 13-01
    provides: ParticipantProfileSchema (unused by this plan), phaseReadinessJudgmentTool, PhaseSequenceSchema.phase_readiness_gate, GraphStateAnnotation.phaseGateProgress
  - phase: 13-02
    provides: participant_profiles persistence (unused by this plan — this plan reads canvas_nodes directly, not participant_profiles)
provides:
  - "phaseReadinessSkill (apps/api/src/lib/skills/phase-readiness.ts) — sequential N/M gate + capable-tier coverage judgment"
  - "ANALYST_SKILLS registration (skills.ts) — [factCheckSkill, phaseReadinessSkill, orphanEdgeSkill]"
  - "TriggerGateNode phaseGateProgress threading — surfaces the N/M counter on every return path regardless of which Skill wins arbitration"
  - "agentNode with the deprecated ad-hoc phase-advance signal extraction removed (D-08)"
affects: [13-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sequential pre-LLM gate (N committed nodes, THEN M human messages) before any capable-tier LLM call — mirrors fact-check.ts's tier-1/tier-2 cost gate, but two sequential quantitative counters instead of one heuristic"
    - "TriggerGateNode scans ALL settled Promise.allSettled results (not just the winner) for a reserved meta.<field> key and surfaces it as a top-level GraphState field on every return path — generalizes the existing skillMeta pattern to a cross-Skill-independent persistence channel"

key-files:
  created:
    - apps/api/src/lib/skills/phase-readiness.ts
    - apps/api/src/lib/skills/phase-readiness.test.ts
  modified:
    - apps/api/src/lib/skills.ts
    - apps/api/src/graph/nodes/trigger-gate.ts
    - apps/api/src/graph/nodes/trigger-gate.test.ts
    - apps/api/src/graph/nodes/agent.ts

key-decisions:
  - "ANALYST_SKILLS order: [factCheckSkill, phaseReadinessSkill, orphanEdgeSkill] — time-sensitive misinformation correction outranks a phase-advance prompt, which in turn outranks orphan-edge's graph-housekeeping nudge. Documented inline in skills.ts; not load-bearing for correctness since phaseGateProgress persistence is independent of which Skill wins."
  - "phaseGateProgress persistence decoupled from arbitration winner: TriggerGateNode scans every settled candidate result for meta.phaseGateProgress (not just the fired Skill's meta), so the N/M counter survives even when fact-check or orphan-edge wins instead of phase-readiness."
  - "Coverage-judgment adapter seam named phaseReadinessAdapter (config.configurable), mirroring fact-check.ts's factCheckClassifierAdapter naming convention."
  - "canvas-tool.ts's raw ready-to-advance boolean field is left on the schema per plan's explicit Claude's-Discretion instruction — only agentNode's reading/emission of it was removed."

requirements-completed: [TRIGGER-02]

# Metrics
duration: 55min
completed: 2026-07-16
---

# Phase 13 Plan 04: Phase-Readiness Detection (TRIGGER-02) Summary

**New `phase-readiness` Analyst Skill enforcing a sequential N-then-M pre-LLM gate (committed canvas nodes, then human messages) before a single capable-tier coverage-judgment call against the phase's `llm_instructions`; registered in `ANALYST_SKILLS`, its N/M counter threaded through `TriggerGateNode` into `GraphState` independent of arbitration outcome; the deprecated ad-hoc phase-advance emission in `agent.ts` is removed.**

## What Was Built

**Task 1 (TDD) — `phase-readiness` Skill: sequential N/M gate + coverage judgment**
- `apps/api/src/lib/skills/phase-readiness.ts`: exports `phaseReadinessSkill: Skill = { id: 'phase-readiness', role: 'analyst', detect, buildPromptGuidance }`.
- `detect()`: resets `state.phaseGateProgress` to a fresh object when null or its `phaseId` no longer matches `state.currentPhaseId`. Queries `canvas_nodes` (`status='committed'`, `.eq('branch_id', ...)`) via a Supabase count-only query (`{ count: 'exact', head: true }`) — never `state.argGraph.nodes.length` (verified by both a source-level regex test and a runtime test with a 50-node poisoned `argGraph`). If committed count `< min_nodes`, returns `fires:false` with zero adapter calls. Once open, increments `messagesSinceGateOpen`; if still `< min_messages_after`, again zero adapter calls. Only once BOTH thresholds cross does the coverage-judgment LLM call fire — exactly once per crossing — resolving `TASK_MODELS[provider].analysis` (capable tier, COST-01), asserted per-provider (anthropic + openai) in tests (T-13-10 tier-regression guard).
- Coverage-judgment call: system prompt built from the active phase's `llm_instructions` + `summarizeArgGraph()`; user message carries the last `min_messages_after` human (`role==='user'`) messages, WR-06-escaped (D-10 — raw messages included since topics can surface in conversation before being formalized into a canvas node). Tool output Zod-`.safeParse()`'d against `{ sufficient: boolean, confidence: number.min(0).max(1) }` with a bounded `MAX_ATTEMPTS=2` retry, failing CLOSED (`{fires:false, confidence:0}`) on exhaustion (T-13-09).
- `sufficient:true` → `{fires:true, confidence, meta:{phaseGateProgress:null}}` (gate resets for the next phase). `sufficient:false` → retains progress so the next human message re-triggers judgment without re-accumulating N/M from scratch.
- `buildPromptGuidance()` asks the group (in the Coach's voice) whether they're ready to advance, grounded in specific discussed points; explicitly does NOT call `summarizeParticipant()` — phase-readiness addresses the whole group, not a single participant (D-11/Pattern 3).
- Fail-open on any thrown error, missing `branchId`, missing adapter, or Supabase query error — never throws (mirrors orphan-edge.ts/fact-check.ts conventions).

**Task 2 — Registration + `phaseGateProgress` threading**
- `skills.ts`: `ANALYST_SKILLS = [factCheckSkill, phaseReadinessSkill, orphanEdgeSkill]` — order and rationale documented inline.
- `trigger-gate.ts`: after the existing `Promise.allSettled` fan-out, a new scan over ALL settled results (not just the winner) looks for a `meta.phaseGateProgress` key and copies it into a top-level `phaseGateProgress` field, added to every one of the node's three return paths (fired, no-fire, fail-open missing-blueprint). This decouples counter persistence from arbitration outcome — the N/M gate keeps advancing even when fact-check or orphan-edge wins instead of phase-readiness. `triggerGateComplete: true` and the existing fail-isolation/role-gate semantics are unchanged.

**Task 3 — Remove the deprecated ad-hoc phase-advance emission from `agent.ts` (D-08)**
- Removed the raw-tool-input boolean extraction and its inclusion in `agentNode`'s `Partial<GraphState>` return (both the tool-use return path and the fallback non-tool-use return path). `agentNode` now only ever returns `{ agentOutput, agentConfidence }`.
- Confirmed via grep that the only production consumers of the field are `ai.ts`'s SSE emission block and `GraphState` itself — `agentNode` was the sole setter — safe to remove now that the Skill-driven path exists.
- `packages/types/src/canvas-tool.ts`'s schema field is left in place (Claude's Discretion, per plan instruction — removing it is a larger fixture-touching schema change out of scope for this plan).
- `agentOutput`/`agentConfidence`/canvas-mutation extraction behavior is otherwise unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1 (TDD)** — `test(13-04)` RED: `4f6a23e`; `feat(13-04)` GREEN: `d07b4ab`
2. **Task 2** — `feat(13-04): register phase-readiness Skill + thread phaseGateProgress through TriggerGateNode` — `b016c8a`
3. **Task 3** — `fix(13-04): remove deprecated ad-hoc phase-advance signal emission from agent.ts (D-08)` — `afa5229`

## TDD Gate Compliance

Task 1 is `tdd="true"`. Gate sequence verified in git log:
- RED (`test(13-04): add failing tests for phase-readiness Skill (RED)`) — `4f6a23e` — confirmed failing before implementation (module-load error: `phase-readiness.ts` did not exist).
- GREEN (`feat(13-04): implement phase-readiness Skill — N/M gate + coverage judgment (GREEN)`) — `d07b4ab` — confirmed all 16 new tests + full suite passing after implementation.
- No separate REFACTOR commit — implementation required no post-GREEN cleanup beyond the two test-regex fixes made during the same GREEN pass (see Deviations).

## Verification

- `cd apps/api && pnpm exec tsc --noEmit` — passes clean (run after every task).
- `pnpm test -- phase-readiness` — 16/16 new tests pass.
- `pnpm test -- trigger-gate` — all trigger-gate tests pass (5 existing behaviors updated with `phaseGateProgress: null`, 2 new behaviors added for persistence).
- `pnpm test -- agent` and full `pnpm test` — 251/251 individual tests pass; only 2 pre-existing failing suites remain (`src/routes/ai.test.ts`, `src/routes/keys.test.ts` — `Cannot find module 'hono/streaming'`, documented in `deferred-items.md` from Plan 01, unrelated to this plan's changes, reproduced identically before any Plan 04 edit).
- `grep -n "phase_signal" apps/api/src/graph/nodes/agent.ts` — zero matches (confirmed empty, including comments).
- `grep -q "phaseReadinessSkill" apps/api/src/lib/skills.ts` — match.
- `grep -q "phaseGateProgress" apps/api/src/graph/nodes/trigger-gate.ts` — match.
- `grep -n "phase_signal" packages/types/src/canvas-tool.ts` — still present (intentionally retained).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fresh worktree missing `node_modules` and `.env`**
- **Found during:** Task 1 verification (`pnpm test` reported `vitest: not found`)
- **Issue:** This worktree checkout had no `node_modules` and no `apps/api/.env` (both gitignored), matching the exact same environment gap documented in 13-02-SUMMARY.md's Deviation #2.
- **Fix:** `pnpm install --frozen-lockfile` (restores from the committed lockfile — no new/unpinned packages, not a package-legitimacy concern under Rule 3's exclusion). Copied `apps/api/.env` from the main repo checkout (local dev Supabase config only, no secrets beyond local dev keys).
- **Files modified:** none tracked (`node_modules`/`.env` are gitignored).
- **Committed in:** N/A (local dev environment setup only).

**2. [Rule 1 - Bug] Two of my own new test assertions were over-broad and matched doc-comment prose, not actual code**
- **Found during:** Task 1, first GREEN test run.
- **Issue:** Two source-level regex checks in `phase-readiness.test.ts` (`argGraph.nodes.length` never used; `summarizeParticipant` never imported) accidentally matched the implementation file's OWN doc comments explaining, in prose, why those anti-patterns are avoided (e.g. "NEVER `state.argGraph.nodes.length`" and "does NOT call `summarizeParticipant()`") — a false-positive failure, not a real regression.
- **Fix:** Tightened both regexes to check the actual code shape (`committedCount = ...argGraph` assignment pattern; `import { ... summarizeParticipant ... } from` statement) rather than any occurrence of the identifier string anywhere in the file, so explanatory comments no longer trip the assertion.
- **Files modified:** `apps/api/src/lib/skills/phase-readiness.test.ts`.
- **Committed in:** `d07b4ab` (same GREEN commit — found and fixed before the GREEN commit was made).

### Process Notes

- The plan's verify command for Task 3 (`! grep -n "phase_signal" src/graph/nodes/agent.ts`) requires literally zero occurrences of the string anywhere in the file, including comments. My first draft of the replacement doc comment (explaining the D-08 removal) itself contained the string "phase_signal" and would have failed this check — reworded to describe the field generically ("ready-to-advance flag" / "advisory-signal plumbing") before committing.

**Total deviations:** 2 (1 environment setup, 1 self-caught test-assertion bug) — both resolved within Task 1's own scope before its GREEN commit; no scope creep.

## Issues Encountered

None beyond the auto-fixed items above.

## User Setup Required

None. All infrastructure this plan needs (Supabase local dev instance, `canvas_nodes` table, `TASK_MODELS.analysis`, `phaseReadinessJudgmentTool`, `GraphState.phaseGateProgress`) was already verified live by Plans 01–02.

## Next Phase Readiness

- `phaseReadinessSkill` is fully wired into `TriggerGateNode`/`ANALYST_SKILLS` and will be detect()-ed on every human-message invocation once the Analyst Role is enabled for a session.
- **Not yet reachable end-to-end**: `analyticsAgentNode` does not yet set `GraphState.phase_signal` when `state.firingSkillId === 'phase-readiness'` (RESEARCH.md CRITICAL Finding 3) — this plan intentionally did NOT touch `analytics-agent.ts` (out of this plan's file scope; explicitly deferred to Plan 05 per the plan's own task list and 13-RESEARCH.md's System Architecture Diagram). Until Plan 05 wires that derivation, `phase-readiness` firing sets `firingSkillId`/`skillMeta` and routes into `analyticsAgentNode`, but the SSE `phase_signal` event and the "Advance Phase" UI affordance will not yet light up from this Skill's firing.
- `config.configurable.branchId`/`supabase`/`providerName`/`plaintextKey` must be present on the live invocation path for `phase-readiness` to do real work (same Finding 2 wiring gap Plan 02/05 address elsewhere in this phase) — this plan's Skill fails closed (silently) if they are absent, consistent with `orphan-edge.ts`'s existing posture.

## Known Stubs

None — no stub/placeholder data introduced by this plan. `phase-readiness` performs real Supabase queries and real LLM calls when its config seams are populated; it fails closed (not stubbed) when they are not.

## Threat Flags

None — all new surface this plan introduces (the `judge_phase_readiness` coverage-judgment call, the `canvas_nodes` committed-count query, the `phaseGateProgress` GraphState field) was already anticipated and dispositioned in this plan's own `<threat_model>` (T-13-09, T-13-10, T-13-11), all `mitigate` and directly tested (bounded-retry-then-fail-closed schema validation; per-provider tier-resolution assertion; the human-only PATCH-phase invariant left completely untouched by this plan).

---
*Phase: 13-user-profiles-phase-signal*
*Completed: 2026-07-16*
