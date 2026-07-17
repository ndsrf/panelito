---
phase: 13-user-profiles-phase-signal
verified: 2026-07-17T08:45:00Z
status: gaps_found
score: 1/3 roadmap truths verified
overrides_applied: 0
gaps:
  - truth: "After a participant makes 3+ assertions, thread state contains a profile with reliable stated positions/key assertions/engagement level (ROADMAP SC1 / PROFILE-01)"
    status: failed
    reason: "CR-01 (code review, Critical): profileBuilderNode groups argGraph nodes by the LLM-extracted freeform `speaker` string (not the resolved `author_id`), then issues one full-replace upsert per speaker-group via upsert_participant_profile. Two speaker labels that resolve to the same real participant within a single node invocation (plausible: nicknames, capitalization/spelling drift across a 100-message extraction window) cause the second upsert to silently overwrite (discard) the first group's positions/assertions — no error, no log, no test. profile-builder.test.ts's 'two speakers' test only covers two DISTINCT author_ids, never the collision case; graph.integration.test.ts also only exercises a single speaker ('Miguel'). Confirmed independently by reading profile-builder.ts:122-185 and the migration's DO UPDATE SET positions=EXCLUDED.positions (full replace, not merge)."
    artifacts:
      - path: "apps/api/src/graph/nodes/profile-builder.ts"
        issue: "groupBySpeaker() (lines 122-134) buckets by node.speaker; the per-group loop (148-185) resolves author_id independently per group and upserts per group — no merge-by-author_id step exists anywhere in the file."
      - path: "supabase/migrations/0016_participant_profiles.sql"
        issue: "upsert_participant_profile (lines 154-165) is a full-replace ON CONFLICT ... DO UPDATE SET positions = EXCLUDED.positions, assertions = EXCLUDED.assertions — a second upsert for the same (branch_id, participant_id) within one node invocation destroys the first group's data."
    missing:
      - "Resolve author_id first, then group/merge argGraph nodes by the RESOLVED author_id (not the raw speaker string) before upserting — one upsert per resolved author per node invocation, unioning positions/assertions across all speaker-label groups that resolved to that author."
      - "A regression test covering two distinct speaker labels resolving to the SAME author_id, asserting the resulting profile row retains BOTH groups' positions/assertions (not just the last-processed group's)."
  - truth: "The Coach's prompt context includes a summary of each active participant's profile; a Coach invocation references a specific prior assertion by a named participant, verifiable in the Langfuse trace payload (ROADMAP SC2 / PROFILE-02)"
    status: failed
    reason: "The D-11 personalization splice (summarizeParticipant() appended to Coach/Analyst prompt guidance) only fires when the WINNING Skill's skillMeta.participantId is set. Among COACH_SKILLS = [silenceBreakSkill, moderationSkill, driftRedirectSkill], only moderationSkill ever sets skillMeta.participantId (confirmed via grep across apps/api/src/lib/skills/*.ts — silence-break.ts and drift-redirect.ts never set it). Per code review WR-04, moderation's participantId is always config.configurable.participantId = user.id, which per the /invoke ownership gate (ai.ts, session.creator_id !== user.id -> 403) is ALWAYS the session creator, never the actual author of the flagged message. So for any non-creator participant, personalization is never correctly targeted, and even for the creator it only fires incidentally when moderation escalates (not on ordinary facilitation turns). No Skill/mechanism splices 'each active participant's' profile — at most ONE participant's summary is ever appended, and only via a narrow, largely-misattributed trigger path. WR-03 additionally notes this splice path has zero test coverage in facilitation-agent.test.ts/analytics-agent.test.ts. As built, the ROADMAP's example scenario ('Earlier you mentioned X — does this new point support or challenge that?') cannot manifest correctly for group participants other than the session creator, and has no dedicated test proving it manifests at all."
    artifacts:
      - path: "apps/api/src/graph/nodes/facilitation-agent.ts"
        issue: "Personalization (lines ~136-156) is gated entirely behind state.skillMeta?.participantId, which only moderationSkill ever populates."
      - path: "apps/api/src/graph/nodes/analytics-agent.ts"
        issue: "Same gating (lines ~164-186) — symmetric gap."
      - path: "apps/api/src/lib/skills/moderation.ts"
        issue: "meta.participantId (line 134) is threaded from config.configurable.participantId, which ai.ts always sets to the invoking user.id (session creator), not the flagged message's actual author (WR-04)."
      - path: "apps/api/src/routes/ai.ts"
        issue: "participantId: user.id (line ~368) — always the session creator per the ownership gate; there is no per-message-author resolution."
    missing:
      - "Thread the actual last-message author's resolved id (not the invoking user's id) into moderation's / any personalizing Skill's participant targeting, mirroring how profileBuilderNode already correctly resolves author_id per message."
      - "A mechanism (or at least one additional Skill) that sets skillMeta.participantId for ordinary facilitation moments (not only moderation escalation), so PROFILE-02's stated value — the Coach referencing a specific participant's prior assertion during normal facilitation — is actually reachable."
      - "At least one test in facilitation-agent.test.ts / analytics-agent.test.ts exercising the participantId-set branch end-to-end (WR-03)."
---

# Phase 13: User Profiles + Phase Signal — Verification Report

**Phase Goal:** The ArgGraphBuilderNode maintains a per-participant profile in LangGraph thread state, and the Coach uses those profiles to personalize facilitation moves. The Blueprint phase signal trigger completes: when the Analyst determines the argGraph has sufficient coverage of the current phase's required topics, a phase-readiness signal is emitted and the Coach asks the group if they are ready to advance.

**Verified:** 2026-07-17T08:45:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Profile with reliable stated positions/assertions/engagement exists after 3+ assertions (PROFILE-01) | ✗ FAILED | `profileBuilderNode` (apps/api/src/graph/nodes/profile-builder.ts:122-185) groups by freeform `speaker` label and issues one full-replace upsert per group; CR-01 (code review) demonstrates silent data loss when two labels resolve to the same `author_id`. Also: profile persists in Postgres (`participant_profiles`), not "the LangGraph checkpointer state" as SC1 literally specifies (`profileBuilderNode` returns `{}` unconditionally) — a deliberate, documented D-01 decision (durability across cold starts) but a literal deviation from the ROADMAP wording; flagged as an override candidate below, secondary to CR-01. |
| 2 | Coach prompt context includes each active participant's profile summary; references a named participant's prior assertion (PROFILE-02) | ✗ FAILED | Personalization only fires via `state.skillMeta?.participantId`, which only `moderationSkill` ever sets among `COACH_SKILLS`, and moderation's `participantId` is always the session creator (WR-04), never the actual message author. No Skill splices "each active participant's" profile. Zero test coverage of the splice branch (WR-03). |
| 3 | Analyst judges argGraph+message coverage; phase-readiness signal emitted; Coach asks group; human click required to advance (TRIGGER-02) | ✓ VERIFIED | `phaseReadinessSkill.detect()` enforces the sequential N-then-M gate against `canvas_nodes.status='committed'` then human messages (apps/api/src/lib/skills/phase-readiness.ts:148-245); `analyticsAgentNode` derives `phase_signal: true` strictly from `state.firingSkillId === 'phase-readiness'` (analytics-agent.ts:250-255); `ai.ts`'s unchanged SSE block emits the event; `graph.integration.test.ts` proves emission + misattribution guard (fact-check firing yields `phase_signal===null`) + `.analysis`-tier resolution end-to-end with real (unmocked) Skills. HUMAN-02 (PATCH-only phase advance) untouched. Minor non-blocking issues: WR-01 (gate counter incremented on proactive `analysis_request` invocations too, not just genuine human messages) and WR-02 (`ai.ts`'s next-phase lookup silently falls back to `phase_sequence[0]` on an unresolved current-phase id) — both Warning-severity per code review, do not break the core signal-emission behavior. |

**Score:** 1/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/types/src/participant-profile.ts` | ParticipantProfileSchema + type | ✓ VERIFIED | Exists, exported via index.ts, Zod-validated (uuid fields, non-negative ints); `tsc --noEmit` clean. |
| `packages/types/src/phase-readiness-tool.ts` | phaseReadinessJudgmentTool ProviderTool | ✓ VERIFIED | `name: 'judge_phase_readiness'`, flat `parameters`, required `sufficient`/`confidence`. |
| `packages/types/src/blueprint.ts` | `phase_readiness_gate` on PhaseSequenceSchema | ✓ VERIFIED | `.default({min_nodes:3,min_messages_after:5})`, nested correctly, not top-level. |
| `apps/api/src/graph/state.ts` | `phaseGateProgress` channel | ✓ VERIFIED | Overwrite-style Annotation, `reducer:(_,v)=>v`, `default:()=>null`. |
| `supabase/migrations/0016_participant_profiles.sql` | participant_profiles table + RLS + RPCs + fold-in | ✓ VERIFIED (structurally) — ⚠️ contains the CR-01-enabling full-replace upsert | Table/RLS/fold-in/drop all present and verified against local Supabase per 13-02-SUMMARY; `upsert_participant_profile` is a genuine full-replace (no merge), which is the mechanism CR-01 exploits. |
| `apps/api/src/lib/participant-profile.ts` | getParticipantProfile/upsertParticipantProfile | ✓ VERIFIED | Fail-closed, never throws; tested. |
| `apps/api/src/lib/blueprint-loader.ts` | Ajv fix for drift_detection_enabled + phase_readiness_gate | ✓ VERIFIED | Both declared; `pnpm test -- blueprint-loader` passes; F4 bug fixed. |
| `apps/api/src/graph/nodes/profile-builder.ts` | profileBuilderNode | ⚠️ STUB-ADJACENT (CR-01) | Node exists, is wired, is exercised by tests — but its core attribution algorithm has a demonstrated data-loss defect (CR-01). Existence/wiring criteria pass; correctness criterion fails. |
| `apps/api/src/lib/bot-context.ts` | summarizeParticipant() | ✓ VERIFIED | Escaped, delimiter-framed, reuses escapeUntrustedText; tested (WR-06 delimiter-injection case covered). |
| `apps/api/src/graph/graph.ts` | profileBuilder node + human-path reachability | ✓ VERIFIED | `addNode('profileBuilder', ...)`, routing fix confirmed correct (routeAfterMutationGate branches on triggerType to avoid re-entering argGraphBuilder on the analysis_request path — a bug the plan's literal recipe would have introduced, caught and fixed during execution); graph.test.ts proves visitation order + termination + analysis_request path unchanged. |
| `apps/api/src/lib/skills/phase-readiness.ts` | phaseReadinessSkill | ✓ VERIFIED | Sequential N/M gate, capable-tier judgment, fail-closed on malformed output; 16 tests. |
| `apps/api/src/lib/skills.ts` | phase-readiness registered in ANALYST_SKILLS | ✓ VERIFIED | `ANALYST_SKILLS = [factCheckSkill, phaseReadinessSkill, orphanEdgeSkill]`. |
| `apps/api/src/graph/nodes/trigger-gate.ts` | phaseGateProgress threading | ✓ VERIFIED | Scans all settled results, surfaces on every return path. |
| `apps/api/src/routes/ai.ts` | supabase/branchId/participantId/botOverrides in graphConfig.configurable | ✓ VERIFIED | All four keys present; existing SSE block/keys unchanged; confirmed via grep + code read (targeted `pnpm test -- ai` blocked by a pre-existing, unrelated test-environment issue — see Behavioral Spot-Checks). |
| `apps/api/src/graph/nodes/analytics-agent.ts` | phase_signal derivation + D-11 splice | ✓ VERIFIED (derivation) / ⚠️ narrow (splice, see Truth 2) | Strict `=== 'phase-readiness'` equality confirmed; personalization splice exists but is practically unreachable for the general case (Truth 2). |
| `apps/api/src/graph/nodes/facilitation-agent.ts` | D-11 splice via summarizeParticipant | ⚠️ narrow (see Truth 2) | Same gap as analytics-agent.ts. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `packages/types/src/index.ts` | participant-profile.ts / phase-readiness-tool.ts | re-export | ✓ WIRED | Confirmed via grep + runtime tsx assertions in 13-01-SUMMARY. |
| `apps/api/src/graph/graph.ts` | profileBuilderNode | addNode + conditional edges | ✓ WIRED | Human path: `mutationGate → argGraphBuilder → profileBuilder → triggerGate`; analysis_request path unchanged (verified by dedicated test). |
| `apps/api/src/graph/nodes/profile-builder.ts` | `participant_profiles` | upsertParticipantProfile | ✓ WIRED (but see CR-01) | Calls are made; per-call correctness is what CR-01 breaks. |
| `apps/api/src/lib/skills.ts` | phaseReadinessSkill | ANALYST_SKILLS array | ✓ WIRED | Confirmed. |
| `apps/api/src/lib/skills/phase-readiness.ts` | `TASK_MODELS[provider].analysis` | coverage-judgment adapter.stream | ✓ WIRED | Per-provider tier assertion in phase-readiness.test.ts. |
| `apps/api/src/graph/nodes/analytics-agent.ts` | `GraphState.phase_signal` | `state.firingSkillId === 'phase-readiness'` | ✓ WIRED | Strict equality confirmed at analytics-agent.ts:250; integration test proves misattribution guard. |
| `apps/api/src/routes/ai.ts` | graph config | `configurable.branchId/supabase/participantId/botOverrides` | ✓ WIRED | Confirmed present; existing keys/SSE unchanged. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `profile-builder.ts` | `positions`/`assertions` | `state.argGraph.nodes` filtered by resolved speaker group | Real argGraph-derived data, BUT lossy across same-turn speaker-label collisions (CR-01) | ⚠️ HOLLOW (partial — correct data computed, then silently discarded on collision) |
| `profile-builder.ts` | `messagesSent`/`reactionsUsed` | live `COUNT` queries on `messages`/`reactions`, `role='user'` filtered | Yes | ✓ FLOWING |
| `facilitation-agent.ts` / `analytics-agent.ts` | `participantSummary` | `getParticipantProfile()` gated by `state.skillMeta?.participantId` | Real data when reached, but the gate is reached almost never for non-creator participants (WR-04) and never for ordinary facilitation turns (no non-moderation Skill sets participantId) | ⚠️ STATIC (mechanism correct, trigger condition effectively unreachable for the intended general case) |
| `phase-readiness.ts` | `committedCount` | `canvas_nodes.status='committed'` COUNT query | Yes | ✓ FLOWING |
| `analytics-agent.ts` | `phase_signal` | `state.firingSkillId` | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `apps/api` type-checks cleanly | `pnpm exec tsc --noEmit` | Exit 0, no errors | ✓ PASS |
| Phase-13 unit/integration suites pass | `pnpm test -- profile-builder trigger-gate phase-readiness analytics-agent facilitation-agent graph.test bot-context participant-profile moderation-count blueprint-loader` | 269 passed, 9 skipped; only pre-existing unrelated failures remain (see below) | ✓ PASS |
| `ai.test.ts` SSE/abort tests | `pnpm test -- src/routes/ai.test.ts` | 2 tests fail with 404 (route not matched under the mocked harness) | ✗ FAIL — but confirmed **pre-existing**: reproduced identically at commit `2feee69` (pre-Phase-13 HEAD for ai.ts, verified via a temporary `git worktree` at that commit with a fresh install) — not a Phase 13 regression. Logged here for visibility since it blocks a clean automated confirmation of ai.ts's own route-handler behavior beyond static/grep review. |
| `keys.test.ts` suite collection | (same run) | Fails to seed a session (`blueprint_id` NOT NULL violation) | ✗ FAIL — pre-existing local-DB seed-data gap, unrelated to any file this phase modifies (`keys.test.ts` was not touched by any Phase 13 plan). |
| No debt markers (TBD/FIXME/XXX) in phase-13-modified files | grep across all 17 files_modified | No matches | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` conventional probes exist in this repository and none were declared by any Phase 13 plan. SKIPPED (no runnable probes for this phase).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|-------------|--------|----------|
| PROFILE-01 | 13-01, 13-02, 13-03 | Per-participant profile (positions, assertions, engagement) maintained after each turn | ✗ BLOCKED | CR-01 data-loss bug (see Truth 1) makes "stated positions, key assertions made" unreliable for a realistic class of same-turn speaker-label collisions. REQUIREMENTS.md currently marks this `[x]` complete — this verification disputes that marking. |
| PROFILE-02 | 13-03, 13-05 | Coach receives participant profile summary for personalized facilitation | ✗ BLOCKED | Personalization mechanism exists and is unit-wired, but is practically unreachable for the ROADMAP's stated scenario due to WR-03 (no test coverage) + WR-04 (participant misattribution — always the session creator, never the actual author). REQUIREMENTS.md currently marks this `[x]` complete — this verification disputes that marking. |
| TRIGGER-02 | 13-01, 13-02, 13-04, 13-05 | Blueprint phase-signal trigger: Analyst judges coverage, Coach asks group to advance | ✓ SATISFIED | Verified end-to-end (sequential gate, capable-tier judgment, strict phase_signal derivation, SSE plumbing, human-click-only advance, integration test). WR-01/WR-02 are non-blocking Warnings. REQUIREMENTS.md currently marks this Pending — this verification confirms it should move to Complete once WR-01/WR-02 are triaged (optional) since the core truth already holds. |

### Anti-Patterns Found

| File | Line(s) | Pattern | Severity | Impact |
|------|---------|---------|----------|--------|
| `apps/api/src/graph/nodes/profile-builder.ts` | 122-185 | Full-replace upsert keyed by freeform LLM-extracted label, not resolved identity (CR-01) | 🛑 Blocker | Silent, undetectable loss of a participant's stated positions/assertions within a single turn whenever two speaker labels resolve to the same author_id. |
| `apps/api/src/lib/skills/phase-readiness.ts` | 182-190 | `messagesSinceGateOpen` incremented on every `triggerGate` invocation reaching this Skill, including the proactive `analysis_request` path, not just genuine human messages | ⚠️ Warning | Gate can open faster than the "M subsequent human messages" contract intends. |
| `apps/api/src/routes/ai.ts` | 486-501 | `phase_signal` next-phase lookup silently defaults to `phase_sequence[0]` when current phase id doesn't resolve (`findIndex` -1 -> `+1` = `0`) | ⚠️ Warning | Could offer "advance to phase 0" instead of suppressing the signal on a stale/corrupted `current_phase`. |
| `apps/api/src/graph/nodes/facilitation-agent.ts` / `analytics-agent.ts` | 136-156 / 164-186 | New live-DB-touching personalization branch with zero test coverage | ⚠️ Warning | Regressions in this path (wrong scoping, silent prompt-composition break) would not be caught by the existing suite. |
| `apps/api/src/routes/ai.ts` | 355-369 | `participantId: user.id` always the session creator, never the flagged message's actual author | ⚠️ Warning | Misattributes moderation escalation AND (per this verification's Truth 2 finding) breaks the only live trigger path for D-11 personalization for non-creator participants. |
| `apps/api/src/graph/nodes/profile-builder.ts` | 148-185 | Redundant per-speaker-group COUNT queries when groups collide on author_id (WR-05, same root cause as CR-01) | ⚠️ Warning | Resolved by the same fix as CR-01. |
| `apps/api/src/graph/state.ts` / `phase-readiness.ts` | 164-176 / 65,155,159 | `nodeCountAtGateOpen` declared, threaded, always `0`, never read | ℹ️ Info | Dead state field; harmless but confusing. |

No TBD/FIXME/XXX debt markers found in any file this phase modified.

### Human Verification Required

None required to resolve the classification above — the gaps identified (CR-01, WR-04-driven Truth-2 gap) are demonstrable directly from source (full-replace SQL + grouping-by-freeform-label logic; grep-confirmed absence of any non-moderation participantId setter) without needing a live session. Once the gaps are closed, the following would benefit from a live-session human/Langfuse check (not required to close THIS verification's gaps, but recommended before the requirement rows are marked complete in REQUIREMENTS.md):

### 1. Live Langfuse trace shows a named-participant reference

**Test:** Run a real multi-participant session (creator + at least one guest), have the guest state a distinct position twice under plausibly different display-name variants, then trigger a Coach facilitation turn.
**Expected:** The Coach's system prompt (visible in the Langfuse trace payload) contains that participant's accumulated positions, and the Coach's chat output references a specific prior assertion by name.
**Why human:** Requires a live LLM call, a live Langfuse trace inspection, and multi-participant session orchestration — not derivable from static source alone.

## Gaps Summary

Two of Phase 13's three ROADMAP-level truths are not genuinely satisfied by the current codebase, despite all five plans' own must_haves passing their local acceptance criteria and all automated tests (except pre-existing, unrelated environment failures) passing:

1. **PROFILE-01** — `ProfileBuilderNode`'s core attribution algorithm (CR-01, already flagged Critical in the phase's own code review) groups by a freeform LLM-extracted display-name string instead of the resolved participant identity, so the "stated positions, key assertions made" data is silently lossy whenever the same person is cited under two different labels within one turn — a scenario the review characterizes as "very plausible," not a theoretical edge case. No test (unit or integration) exercises this collision, so the defect would ship undetected.

2. **PROFILE-02** — The D-11 personalization mechanism (summarizeParticipant splice into Coach/Analyst prompts) is correctly built and unit-tested for its own narrow contract, but the only Skill that ever sets the `skillMeta.participantId` needed to trigger it (`moderationSkill`) always attributes to the session creator rather than the actual message author (WR-04) — meaning the feature is unreachable, as designed, for any non-creator participant, and even for the creator only fires during a moderation escalation, not general facilitation. The ROADMAP's example ("Earlier you mentioned X...") has no code path that reliably produces it.

3. **TRIGGER-02** is genuinely satisfied — the sequential N/M gate, capable-tier coverage judgment, strict `phase_signal` derivation, and human-click-only advance are all real, tested, and correctly wired, with only two Warning-level (non-blocking) timing/fallback issues (WR-01, WR-02).

REQUIREMENTS.md currently marks PROFILE-01 and PROFILE-02 as `[x]` complete; this verification disputes both markings and recommends they remain open pending closure plans for CR-01 and the participant-attribution gap (WR-04) underlying Truth 2.

---

*Verified: 2026-07-17T08:45:00Z*
*Verifier: Claude (gsd-verifier)*
