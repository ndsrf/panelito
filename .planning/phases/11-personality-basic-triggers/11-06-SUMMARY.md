---
phase: 11-personality-basic-triggers
plan: 06
subsystem: api
tags: [langgraph, setinterval, trigger-engine, silence-gate, arbitration, cron-like-loop]

# Dependency graph
requires:
  - phase: 11-personality-basic-triggers
    plan: 02
    provides: personalities table, debate-strategy-v1 Blueprint bot_defaults/role_personalities/bot_cooldowns, sessions.bot_overrides
  - phase: 11-personality-basic-triggers
    plan: 05
    provides: routeFromStart conditional START edge (triggerType 'silence_gate' -> facilitation), createGraph() extended with facilitation/analysis nodes
  - phase: 10-infrastructure-foundation
    provides: checkSilenceGate, registerBot/runArbitration/releaseBotLock, checkBotBudget, dual thread_id (:human/:bot), PostgresSaver checkpointer
provides:
  - "startSilenceScanLoop(supabase, graph?) — async setInterval registered at server boot (server.ts), alongside startAutoFreezeTracker"
  - "runSilenceScan(supabase, graph) — per-tick: for every active session's non-archived branches, runs checkSilenceGate -> bot-thread cooldown check -> runArbitration -> checkBotBudget -> graph.invoke on the :bot thread -> message insert -> cooldown record"
  - "registerBots() (bot-registration.ts) — Coach/Analyst registered with the Phase 10 arbitrator; Coach always wins the only live trigger this phase (silence-gate)"
  - "Fixed a latent Phase 10 bug in bot-arbitrator.ts: cooldown resolution now reads the real Blueprint.bot_cooldowns[id].window_minutes shape instead of a stale Record<string, number> assumption that threw RangeError on every real arbitration call"
affects: [12-graph-coherence-extended-triggers, 14-polish-triggerengine-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bot registration centralized in a dedicated module (bot-registration.ts), invoked explicitly by the caller (startSilenceScanLoop) rather than as an import-time side effect inside node modules — avoids polluting the shared arbitration registry when graph.test.ts imports node modules directly"
    - "Async setInterval with an awaited call inside try/catch (never fire-and-forget) — prevents overlapping scan ticks from racing the cooldown check"
    - "Cooldown state lives on the bot thread's own LangGraph checkpoint (triggerMetadata.silence_gate.cooldown_until via graph.getState/graph.updateState), not in application memory — survives server restarts (BOT-05)"
    - "Overwrite-style Annotation channels (argGraph, triggerMetadata) are omitted from the invoke() input entirely rather than re-passed, so the existing bot-thread checkpoint value carries over automatically instead of being wiped every tick"

key-files:
  created:
    - apps/api/src/lib/bot-registration.ts
    - apps/api/src/lib/silence-scan.ts
    - apps/api/src/lib/silence-scan.test.ts
  modified:
    - apps/api/src/server.ts
    - apps/api/src/lib/bot-arbitrator.ts
    - apps/api/src/lib/bot-arbitrator.test.ts
    - .planning/phases/11-personality-basic-triggers/deferred-items.md

key-decisions:
  - "Task 4's live-browser checkpoint was accepted via code-review acceptance instead of an actual browser session, per explicit user instruction — same precedent as Plan 07 (no browser automation tool available in this execution environment). This is a documented deviation from the plan's <how-to-verify> live-observation steps, not a claim the live behavior was observed."
  - "config.configurable uses `personality` (not `facilityPersonality`) when invoking the graph, matching the field name facilitationAgentNode actually reads (built in Plan 04) rather than 11-AI-SPEC.md's illustrative sample name — same precedent as Plan 05's triggerType vs triggerMetadata.trigger_type resolution."
  - "argGraph and triggerMetadata are deliberately NOT included in the graph.invoke() input. Both are overwrite-style Annotation channels; LangGraph only invokes a channel's reducer for keys present in the invoke input, so omitting them lets the bot thread's existing checkpoint value carry over automatically. Passing a hardcoded empty argGraph on every tick (a literal reading of the plan's illustrative invoke shape) would silently wipe previously-extracted argument structure — avoided as a correctness fix, not just a simplification."
  - "Dedicated COACH_AUTHOR_ID sentinel ('00000000-0000-0000-0000-000000000b01') for bot-authored messages — distinct from session.creator_id and from sessions-helpers.ts's SYSTEM_AUTHOR_ID, resolving the plan's open Assumption A3 (messages.author_id has no FK constraint, confirmed safe)."
  - "display_name is hardcoded to 'Facilitador' for all Coach silence-gate fires in this interim implementation, independent of which Personality voice is attached — matches D-08 and the plan's literal acceptance criteria; Personality only affects voice/tone text, not the presented display name."
  - "checkSilenceGate() is called without a getPresenceTyping callback in this interim loop (no live Presence-channel wiring from a server-side scan tick) — the function's own documented WSL2 fallback (assume not typing) makes this a safe, minimal default rather than a gap; a future Phase 14 TriggerEngine iteration can wire real Presence lookups if needed."
  - "checkBotBudget() is guarded with a fixed a priori token estimate (400) rather than actual usage, since the budget guard must run BEFORE the LLM call by design (BOT-01 fail-closed contract) — documented as a Phase 14 TODO to replace with real adapter usage figures."

patterns-established:
  - "Rule 1 bug fix bundled into a task commit when it directly blocks that task's own behavior (bot-arbitrator.ts cooldown-shape fix bundled into Task 1's commit, since Task 1's registerBots() is what first exercises the non-empty-registry path with a real Blueprint)."

requirements-completed: [TRIGGER-01, PERSONA-01]

# Metrics
duration: ~30min (context loading + Tasks 1-3 execution to the Task 4 checkpoint) + orchestrator/user code-review acceptance
completed: 2026-07-15
---

# Phase 11 Plan 06: Silence-Scan Interim Trigger Loop Summary

**Shipped the phase's only live proactive behavior: an async setInterval loop that, per active branch, runs the Phase 10 silence-gate → arbitration → budget chain and inserts a content-aware "Facilitador" Coach message into chat after real silence — plus a bundled fix for a latent Phase 10 bug in the arbitration lock's cooldown-duration calculation that would have thrown on every real fire.**

## Performance

- **Duration:** ~30 min (context loading, TDD RED→GREEN cycle, Tasks 1-3) + orchestrator/user code-review acceptance for the Task 4 checkpoint (no live browser session available in this execution environment)
- **Started:** 2026-07-15T00:32:00+02:00 (approx, after Plan 07 wave tracking commit)
- **Completed:** 2026-07-15T00:47:50+02:00 (Tasks 1-3 + deferred-items log); checkpoint resolved via code-review acceptance thereafter
- **Tasks:** 4 (3 auto tasks fully executed and green; Task 4 accepted via documented code-review deviation, not a live pass)
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments

- **Task 1:** `bot-registration.ts` centralizes `registerBot('coach', ...)` / `registerBot('analyst', ...)` — Coach always wins the only live trigger this phase (silence-gate); Analyst stays registered at 0 affinity until the fact-check trigger (Phase 12). No `registerBot` calls inside any graph node module (verified via grep).
- **Task 1 (bundled Rule 1 fix):** Found and fixed a latent Phase 10 bug in `bot-arbitrator.ts`: the arbitration lock's cooldown-duration calculation read `blueprint.bot_cooldowns[winnerId]` as a raw seconds number via a stale `BlueprintWithCooldowns` intersection type, but Plan 02 had already changed the real `Blueprint.bot_cooldowns` field to `{max, window_minutes}`. Multiplying an object by 1000 produces `NaN`, and `new Date(Date.now() + NaN).toISOString()` throws `RangeError: Invalid time value` — reproduced and confirmed against the real seeded `debate-strategy-v1` Blueprint shape. This would have broken **every** successful Coach fire (thrown uncaught inside `runArbitration`, before the try/catch that only wraps scorer calls). Fixed to read `window_minutes * 60`; updated the one existing test (`bot-arbitrator.test.ts` Test 5) that encoded the stale `Record<string, number>` shape.
- **Task 2 (TDD RED→GREEN):** `silence-scan.ts` implements `startSilenceScanLoop`/`runSilenceScan` — per active branch of every active session: frozen-session guard (query-level `.eq('status','active')` + defensive in-code recheck), `checkSilenceGate()`, cooldown check against the bot thread's own LangGraph checkpoint, `runArbitration()` (proceed only if Coach wins), `checkBotBudget()`, `graph.invoke()` on the `${branchId}:bot` thread (never `:human`), message insert (role `assistant`, `display_name: 'Facilitador'`, dedicated `COACH_AUTHOR_ID` sentinel — not `session.creator_id`), fire-and-forget broadcast, and cooldown recording via `graph.updateState()` using the Blueprint's `bot_cooldowns.coach.window_minutes`. `releaseBotLock()` always runs in a `finally` block. `silence-scan.test.ts` covers all 6 required behaviors (7 tests) with a genuine RED phase (all 7 failed against a throwing stub) confirmed before GREEN.
- **Task 3:** `server.ts` registers `startSilenceScanLoop(createServiceClient())` inside the same `serve(...)` callback as `startAutoFreezeTracker`, wrapped in `.catch(...)`. No graph argument passed from `server.ts` — `startSilenceScanLoop` resolves its own default (`createGraph(await getCheckpointer())`) internally when omitted, keeping server-boot wiring minimal per the plan's instruction.
- **Task 4 (checkpoint):** Live browser verification was **not** performed — no browser automation tool is available in this execution environment. Accepted via code-review acceptance per explicit user/orchestrator instruction (same precedent as Plan 07). See "Known Issues / Not Verified" below for exactly what was and wasn't confirmed.

## Task Commits

1. **Task 1: Coach/Analyst bot registration (+ bundled bot-arbitrator.ts cooldown-shape fix)** - `7fb0269` (feat)
2. **Task 2 (RED): silence-scan.test.ts — 7 failing tests against a throwing stub** - `edab203` (test)
3. **Task 2 (GREEN): silence-scan.ts full implementation — all 7 tests pass** - `29e1809` (feat)
4. **Task 3: Register the scan loop in server.ts** - `9d8cf43` (feat)
5. **Deferred-items log (pre-existing unrelated test failures found during full-suite run)** - `a6fc380` (docs)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `apps/api/src/lib/bot-registration.ts` (new) - `registerBots()`, Coach/Analyst scorers
- `apps/api/src/lib/silence-scan.ts` (new) - `startSilenceScanLoop`, `runSilenceScan`, `COACH_AUTHOR_ID`
- `apps/api/src/lib/silence-scan.test.ts` (new) - 7 tests covering all required behaviors
- `apps/api/src/server.ts` - registers `startSilenceScanLoop` alongside `startAutoFreezeTracker`
- `apps/api/src/lib/bot-arbitrator.ts` - fixed cooldown-duration calculation to read the real `{max, window_minutes}` Blueprint field shape
- `apps/api/src/lib/bot-arbitrator.test.ts` - Test 5 updated to the real Blueprint field shape
- `.planning/phases/11-personality-basic-triggers/deferred-items.md` - logged 2 pre-existing `ai.test.ts` failures + 1 pre-existing `keys.test.ts` setup failure found during full-suite verification (unrelated to this plan)

## Decisions Made

See `key-decisions` in frontmatter for the full list. Highlights:
- `config.configurable.personality` (not `facilityPersonality`) — matches the field name the already-built `facilitationAgentNode` actually reads.
- `argGraph`/`triggerMetadata` omitted from the `graph.invoke()` input so the bot thread's checkpoint carries them forward automatically instead of being reset every tick.
- Dedicated `COACH_AUTHOR_ID` sentinel UUID for bot-authored messages, resolving the plan's open Assumption A3.
- `display_name` hardcoded to `'Facilitador'` for all Coach fires in this interim implementation (Personality only affects voice/tone text).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed bot-arbitrator.ts cooldown-duration RangeError**
- **Found during:** Task 1 (bot registration) — while designing Task 2's test fixtures with the real seeded `debate-strategy-v1` Blueprint shape
- **Issue:** `bot-arbitrator.ts` read `blueprint.bot_cooldowns[winnerId]` as a raw seconds number (a Phase 10 assumption), but the real `Blueprint.bot_cooldowns` field (added in Plan 02) is shaped `{max, window_minutes}`. `cooldownSeconds * 1000` produced `NaN`; `new Date(Date.now() + NaN).toISOString()` throws `RangeError: Invalid time value`, uncaught by `runArbitration`'s try/catch (which only wraps scorer calls). This would break every real Coach fire once bots were registered against the real Blueprint.
- **Fix:** Read `blueprint.bot_cooldowns[winnerId]?.window_minutes`, convert to seconds (`* 60`), removed the stale `BlueprintWithCooldowns` intersection type (no longer needed — `Blueprint` already has the real field).
- **Files modified:** `apps/api/src/lib/bot-arbitrator.ts`, `apps/api/src/lib/bot-arbitrator.test.ts`
- **Verification:** Reproduced the crash with `node -e` before fixing; `bot-arbitrator.test.ts` (5/5) and `silence-scan.test.ts` (7/7) pass after the fix; full `apps/api/src/lib` suite green (70/70).
- **Committed in:** `7fb0269` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug), plus 1 user-approved checkpoint-acceptance deviation (Task 4, see below).
**Impact on plan:** The bot-arbitrator.ts fix was essential — without it, no Coach fire could ever succeed once real bots were registered. No scope creep: the fix is narrowly scoped to the exact broken calculation and its one dependent test.

### Checkpoint deviation (user-approved, not an auto-fix)

**Task 4 (live silence trigger, `checkpoint:human-verify gate="blocking"`)** was resolved via **code-review acceptance** instead of an actual live browser session, per explicit orchestrator/user instruction — the same precedent set by Plan 07's Task 4. No browser automation tool is available in this execution environment. This is a documented deviation from the plan's `<how-to-verify>` live-observation steps (posting messages, waiting for real silence, observing a live Coach message, waiting out a real cooldown window, freezing a session and observing no fire) — **not** a claim that this live behavior was actually observed. See "Known Issues / Not Verified" below for the precise boundary between what was and wasn't confirmed.

## Issues Encountered

**Full `pnpm test` run (apps/api) surfaced 3 pre-existing, unrelated failures**, all verified pre-existing at commit `8572745` (the commit immediately before Phase 11 execution started) per Plan 07's own summary documentation:
- `ai.test.ts` — 2 failures (`expected 404 to be 200`) in the SSE-stream and abort-propagation tests.
- `keys.test.ts` — suite setup failure (`null value in column "blueprint_id" of relation "sessions" violates not-null constraint`), a live-DB-dependent integration test issue.

Neither touches any file this plan modified. Logged to `.planning/phases/11-personality-basic-triggers/deferred-items.md` per the scope-boundary rule; not investigated further or fixed.

## Known Issues / Not Verified

Per the user-approved code-review acceptance path for Task 4, the following were **not** observed live and remain genuinely unverified (distinct from what code review + automated tests DID confirm):

- **Real content-aware question wording/quality has not been eyeballed.** The Coach's system prompt (built in Plan 04's `facilitation-agent.ts`, unchanged by this plan) is designed to end every response in `?` and reference specific recent content, but no actual LLM output from a live silence-scan fire has been read by a human.
- **Real cooldown persistence across actual wall-clock time (the default 15-minute Coach cooldown window) has not been observed end-to-end.** The unit tests assert the cooldown-check/cooldown-record code paths are called correctly with mocked `graph.getState`/`graph.updateState`, and the underlying LangGraph `PostgresSaver` checkpointer is Phase 6/10 infrastructure already used elsewhere — but no live process has actually run the scan loop for 15+ real minutes and confirmed a second Coach message does not appear.
- **Real frozen-session non-firing has not been observed live.** Confirmed via (a) the `.eq('status','active')` query filter, (b) the defensive in-code `session.status !== 'active'` recheck, and (c) a unit test (Behavior 1) asserting no gate/arbitration/invoke call occurs for a `status: 'frozen'` session row — but no live session has actually been frozen mid-conversation and observed to stay silent.
- **What WAS verified:** all 3 auto tasks (bot registration, silence-scan loop RED+GREEN, server.ts wiring) committed and green; 70/70 `apps/api/src/lib` tests pass including the 7 new `silence-scan.test.ts` behaviors (silence-gate skip, cooldown skip, arbitration-loss skip, budget-guard skip, successful fire + message insert + cooldown write, frozen-session skip via status filter, scan-loop registration); the bundled `bot-arbitrator.ts` cooldown-shape bug fix (which would have broken every real fire with a thrown `RangeError`) was caught and fixed; `pnpm exec tsc --noEmit` is clean apart from the pre-existing, already-documented Phase 10 `bot-arbitrator.test.ts:138` issue.

**Recommended follow-up (not blocking):** the next time the workspace is opened with a running API server and a configured creator API key, do a real end-to-end pass through the plan's original `<how-to-verify>` steps (post messages, wait ~60-75s past the default silence threshold, confirm a content-aware "Facilitador" question appears, wait out the cooldown, freeze and confirm silence) to close this gap.

## User Setup Required

None — no external service configuration required beyond what's already needed to run the API server (Supabase project + a creator's own AI provider API key), which is pre-existing project setup, not new to this plan.

## Next Phase Readiness

- The interim silence-scan loop is live-registered at server boot; Phase 12 (Graph Coherence + Extended Triggers) can extend `bot-registration.ts`'s `analystScorer` once a real fact-check trigger context exists, and Phase 14's TriggerEngine can generalize `silence-scan.ts`'s single-trigger loop into the full 6-trigger engine (D-15 always anticipated this rework).
- The `bot-arbitrator.ts` cooldown fix is a durable correctness fix, not phase-scoped — any future caller of `runArbitration()` with a real Blueprint now gets a correct lock duration instead of a crash.
- **Recommended before considering Phase 11 fully validated in production-like conditions:** the live end-to-end pass described above (Known Issues / Not Verified section) — this is the only phase-11 requirement (TRIGGER-01) whose live behavior has not been directly observed by a human, across all 7 plans in this phase.

---
*Phase: 11-personality-basic-triggers*
*Completed: 2026-07-15*

## Self-Check: PASSED

All created/modified files verified present on disk (`bot-registration.ts`, `silence-scan.ts`, `silence-scan.test.ts`, `server.ts`, `bot-arbitrator.ts`, `bot-arbitrator.test.ts`, `deferred-items.md`, this SUMMARY.md); all 5 commits (`7fb0269`, `edab203`, `29e1809`, `9d8cf43`, `a6fc380`) verified in git log on `main`.
