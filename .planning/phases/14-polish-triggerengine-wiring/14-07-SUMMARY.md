---
phase: 14-polish-triggerengine-wiring
plan: 07
subsystem: testing
tags: [langgraph, langfuse, tsx, synthetic-session, verification, speech-artifacts, trigger-engine]

# Dependency graph
requires:
  - phase: 14-01
    provides: containsSpeechArtifact matcher (@panelito/types)
  - phase: 14-02
    provides: trigger-tagged human-reactive Langfuse calls, removal of '[canvas updated]' fallback text
  - phase: 14-03
    provides: streamWithGeneration() Langfuse Generation helper + adapter usage events
  - phase: 14-04
    provides: TriggerEngine setInterval scan loop + graceful SIGTERM/SIGINT shutdown
  - phase: 14-05
    provides: frontend speech-artifact filtering (MessageBubble drop + MessageList row suppression)
  - phase: 14-06
    provides: persona re-anchor counter + Generation wrap + SPEECH-01 prompt discipline in Role nodes
provides:
  - "scripts/synthetic-session.ts: runnable 100-turn synthetic session harness (tsx-invokable, dry-invokable without a key)"
  - "Human-verified confirmation (or explicitly documented gap) for all 5 ROADMAP Phase 14 success criteria"
  - "Phase 14 marked complete — closes out v3.0 milestone plan set"
affects: [15-*, any future phase touching TriggerEngine, Langfuse cost dashboards, or bot speech filtering]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Standalone verification harness scripts live in /scripts, never imported by production runtime (grep-enforced in acceptance criteria)"
    - "Live/dashboard verification criteria accepted via code-review evidence when no browser-automation tool is available in the execution environment (Phase 11 precedent, now also applied here)"

key-files:
  created:
    - scripts/synthetic-session.ts
  modified: []

key-decisions:
  - "Synthetic harness cycles firingSkillId through all 6 real Skill ids (silence-break/moderation/drift-redirect for Coach, fact-check/phase-readiness/orphan-edge for Analyst) instead of fabricating unrecognized triggerType values, because routeFromStart throws by design on any triggerType outside silence_gate/analysis_request/null."
  - "Analyst turns route via analysis_request (the only real START-reachable path to AnalyticsAgentNode), which also runs one extra argGraph-extraction LLM call per turn (~1.5x total LLM calls vs a naive count) — documented in-file rather than treated as a bug."
  - "Live-without-refresh Coach delivery (Criterion 1's real-time leg) could not be confirmed in this WSL2 dev environment — pre-existing, already-documented Realtime limitation (see project memory feedback_wsl2_realtime.md, originally surfaced in Phase 9). Recorded as a Known Issue rather than blocking phase completion, since the underlying fire-and-insert mechanism (the actual Phase 14 deliverable) is confirmed working."
  - "Langfuse dashboard cost-attribution and frontend speech-artifact injection (Criteria 4 and 5) accepted via code-review evidence rather than live browser verification, per the Phase 11 precedent (no browser-automation tool available in this execution environment)."
  - "A real, separate BYOK onboarding bug (verifying a non-default provider key never activated it as active_provider) was discovered while attempting to verify Criterion 1 live and blocked verification until fixed. It was NOT part of 14-07's scope and was fixed and merged as an independent GSD quick task (260718-cto, commits ad992e9/b3675eb, merged cb9fcfd, docs 3633f93) — tracked in .planning/quick/260718-cto-fix-byok-onboarding-verifying-an-api-key/, not claimed as a 14-07 deliverable."

patterns-established:
  - "Verification-only checkpoint plans (no source changes in Task 2) still get a full SUMMARY.md documenting exactly which criteria were live-confirmed vs. accepted via code-review vs. left as an explicitly scoped-out known gap."

requirements-completed: [PERSONA-04, TRIGGER-07, COST-03, SPEECH-01, SPEECH-02, SPEECH-03]

# Metrics
duration: ~2h (spans harness build + checkpoint pause awaiting user + verification session)
completed: 2026-07-18
---

# Phase 14 Plan 07: TriggerEngine + Synthetic Session Verification Summary

**Built a 100-turn synthetic-session harness exercising all 6 trigger Skills against a real BYOK provider, and closed out Phase 14's live-verification checkpoint — confirming the TriggerEngine fires end-to-end, persona discipline holds with zero speech-artifact leaks, and Langfuse cost attribution is wired, with the one unverifiable gap (live-without-refresh delivery) traced to a pre-existing WSL2 Realtime limitation rather than a Phase 14 regression.**

## Performance

- **Duration:** ~2h across two sessions (harness build, then a checkpoint pause awaiting the user, then the live verification pass)
- **Tasks:** 2/2 complete
- **Files modified:** 1 (scripts/synthetic-session.ts)

## Accomplishments

- `scripts/synthetic-session.ts` — a standalone, tsx-runnable harness that drives real `graph.invoke()` calls against a live BYOK provider key, cycling through all 6 Skill ids, and asserts Coach trailing-`?` discipline, Analyst citation discipline, zero `containsSpeechArtifact` hits, and logs persona re-anchor firing invocation numbers. Exits cleanly with a diagnostic message when no provider key is configured, so it's dry-invokable in CI without spend.
- Live TriggerEngine confirmed running (`[trigger-engine] scan loop started (interval: 60000ms)`) and confirmed to actually fire and insert a real Coach message into the DB/chat after a silence window — closing the core mechanism of Success Criterion 1.
- A real, unrelated BYOK onboarding bug that was silently blocking any non-Anthropic creator from ever having the TriggerEngine find their provider key was discovered and fixed (as an independent quick task, not part of this plan's deliverables) — see Deviations below.
- Synthetic harness run by the user (20 turns, OpenAI): 10/10 Coach trailing-`?` PASS, 4/4 Analyst citation PASS, 14/14 clean of artifact strings across all 6 trigger types, OVERALL: PASS.
- Langfuse cost attribution (Criterion 5) and frontend speech-artifact defense-in-depth (Criterion 4) both accepted via code-review evidence, consistent with the Phase 11 precedent for this execution environment.

## Task Commits

Each task was committed atomically:

1. **Task 1: Build the 100-turn synthetic-session harness** - `1a6b144` (feat)
2. **Task 2: Phase verification checkpoint** - verification-only (no source changes); resolved via human confirmation in conversation, documented here

**Plan metadata:** (this commit) `docs(14-07): complete plan`

## Files Created/Modified

- `scripts/synthetic-session.ts` - 100-turn (run at 20 turns by the user) synthetic Coach/Analyst session harness; asserts trailing-`?` discipline, citation discipline, artifact-string absence across all 6 Skill ids, and logs re-anchor firing invocation numbers. Not imported by any production runtime module.

## Decisions Made

- Synthetic harness routes Analyst turns via `analysis_request` (the only real START-reachable path to AnalyticsAgentNode) rather than fabricating a raw `triggerType`, since `routeFromStart` intentionally throws on any value outside `silence_gate`/`analysis_request`/null. This means Analyst turns cost ~1.5x the naive LLM-call estimate (one extra argGraph-extraction call per turn) — documented in-file, not a bug.
- The live-without-refresh leg of Criterion 1 (proactive Coach message appearing without a manual page refresh) is recorded as a Known Issue, not a blocker — root-caused to the pre-existing WSL2 Supabase Realtime limitation (Phase 9 memory: `feedback_wsl2_realtime.md`), which affects all proactive/background-inserted messages (no SSE stream to ride, since SSE only covers the invoking client's own request). This is out of Phase 14's scope to fix; would require extending SSE-fallback to cover proactive inserts for all connected participants — a nontrivial architecture change appropriately deferred.
- Criteria 4 and 5 (Langfuse dashboard inspection, frontend artifact-injection test) accepted via code-review evidence rather than live browser verification, per the Phase 11 precedent (no browser-automation tool available in this execution environment).

## Deviations from Plan

### Auto-fixed Issues

None directly within 14-07's own file scope — `scripts/synthetic-session.ts` was built and executed exactly as specified in Task 1.

### Out-of-scope bug found and fixed separately (not a 14-07 deviation, but blocking context)

While attempting to live-verify Success Criterion 1 (the live TriggerEngine fire), the user discovered a pre-existing BYOK onboarding bug: verifying a non-default provider key (e.g. OpenAI) never activated it as `active_provider`, silently defeating the TriggerEngine's provider-key lookup for any creator not using Anthropic as their first-verified provider. This bug predates Phase 14 and is unrelated to any of 14-01 through 14-06's changes.

- **Found during:** Task 2 verification (attempting to trigger a live Coach fire with an OpenAI key)
- **Issue:** BYOK key-verification flow never set `active_provider` on first non-Anthropic key verification
- **Fix:** Auto-activate the verified provider on first-ever key; regression tests added
- **Scope:** Fixed and merged as an independent GSD quick task — `260718-cto`, commits `ad992e9` (feat), `b3675eb` (test), merged to main at `cb9fcfd`, docs at `3633f93`. Tracked in `.planning/quick/260718-cto-fix-byok-onboarding-verifying-an-api-key/`.
- **Not claimed as a 14-07 deliverable** — mentioned here only as context for why verification took the path it did.

---

**Total deviations within 14-07 scope:** 0
**Impact on plan:** None — the out-of-scope BYOK fix was necessary to unblock live verification but is fully documented and committed independently.

## Issues Encountered

None beyond the out-of-scope BYOK bug documented above, which was resolved outside this plan's scope before verification could proceed.

## Known Issues / Not Verified

The following gaps were explicitly identified during the Task 2 checkpoint and are recorded here rather than silently accepted:

1. **Live-without-refresh Coach delivery (Criterion 1, partial).** The TriggerEngine scan loop is confirmed running and DOES fire and insert a real Coach message into the DB/chat after a silence window — the core mechanism works. However, the message only became visible after a manual page refresh, not live/in real time. Root cause: a pre-existing, already-documented WSL2 limitation (project memory `feedback_wsl2_realtime.md`, Phase 9) — Supabase Realtime WebSocket/long-poll connections don't route between a Windows browser and Supabase running inside WSL2 Docker. Proactive/background-inserted messages have no SSE stream to ride (SSE only covers the invoking client's own request), so they depend entirely on Realtime broadcast, which is broken in this specific local dev environment. This is NOT a Phase 14 regression and is out of Phase 14's scope to fix (would require extending the SSE-fallback pattern to cover proactive/background inserts for all connected participants — a nontrivial architecture change).

2. **SIGINT graceful shutdown (Criterion 1, partial).** `[panelito/api] received SIGINT, shutting down` was NOT explicitly live-tested by the user in this session. It is covered by existing unit tests from 14-04 (`trigger-engine.test.ts` / server.ts SIGTERM/SIGINT wiring), confirmed via grep + `tsc` clean in 14-04's own SUMMARY. Recorded as not manually verified live this session, but unit-test-covered.

3. **Re-anchor firing count (Criterion 2, partial).** The synthetic harness run (20 turns: 10 Coach, remainder Analyst/setup) logged 0 re-anchor firings. This is expected, not a failure — re-anchor cadence is every 15th invocation per role, and only 10 Coach turns ran (never reached the 15th). The `shouldReanchor` cadence-boundary logic itself is directly unit-tested in 14-06 (`facilitation-agent.test.ts` / `analytics-agent.test.ts`). Recorded as "not exercised at this turn count" rather than a gap — a full 100-turn run (as originally scoped) would exercise this; the user ran a reduced 20-turn pass for cost/time reasons.

4. **Langfuse dashboard inspection (Criterion 5).** Accepted via code-review evidence rather than live dashboard inspection (Phase 11 precedent — no browser-automation tool available in this execution environment). Code-review basis: 14-03 built `streamWithGeneration()` (`apps/api/src/lib/langfuse-generation.ts`, unit-tested in `langfuse-generation.test.ts`, 7 passing tests) which constructs a manual Generation observation with real `usageDetails`; all three provider adapters emit a `usage` AIStreamEvent (`anthropic.ts`, `openai.ts`, `gemini.ts`, each unit-tested); Langfuse `environment` is set at the processor level (`langfuse-otel.ts`, D-13); 14-02 tagged human-reactive CallbackHandler calls with `trigger:human-reactive`; 14-06 wired the Generation-wrap helper into both Role nodes (Coach/Analyst) so trigger+tier+real usageDetails populate per-generation.

5. **Speech-artifact injection test (Criterion 4).** Accepted via code-review evidence rather than live-testing an injected `[canvas updated]` message against the running frontend. Code-review basis: 14-01 built the shared blocklist + matcher (`packages/types/src/speech-artifacts.ts`, unit-tested); 14-05 applied it at both `MessageBubble.tsx` (drops matching content at all three render sites including streaming text) and `MessageList.tsx` (suppresses the entire row for canvas-only assistant messages matching an artifact pattern), both unit-tested; 14-02 already removed the `'[canvas updated]'` fallback-text write path entirely at the source (`apps/api/src/routes/ai.ts`), so the string shouldn't even be produced server-side anymore, with the frontend filter as pure defense-in-depth; 14-06 added SPEECH-01 prompt-level discipline to both Role node system prompts (unit-tested).

**Recommendation:** Before treating the live-without-refresh gap (#1) as fully resolved, a follow-up phase extending the SSE-fallback pattern to cover proactive/background inserts for all connected participants (not just the invoking client) would close this permanently — independent of the WSL2-specific symptom, since production deployment (not WSL2) is unaffected by this particular limitation but the underlying "proactive inserts have no SSE path" architecture gap is real. Not scoped for v3.0.

## User Setup Required

None - no external service configuration required for this plan. (The BYOK onboarding fix from the out-of-scope bug is already merged and requires no further user action.)

## Next Phase Readiness

- Phase 14 is complete — all 7 plans done, all 6 requirements (PERSONA-04, TRIGGER-07, COST-03, SPEECH-01, SPEECH-02, SPEECH-03) satisfied.
- This closes out the v3.0 milestone's full phase set (Phases 10-14).
- Recommended before next milestone: address the live-without-refresh proactive-message gap (#1 above) if production deployment will also run into partial-WSL2-like Realtime delivery gaps for proactive inserts — worth a quick production smoke test outside WSL2 to confirm the gap is purely a local-dev artifact.
- `/gsd:transition` is the appropriate next step to close the v3.0 milestone.

---
*Phase: 14-polish-triggerengine-wiring*
*Completed: 2026-07-18*
