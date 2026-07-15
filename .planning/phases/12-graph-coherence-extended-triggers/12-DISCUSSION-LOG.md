# Phase 12: Graph Coherence + Extended Triggers - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-15
**Phase:** 12-Graph Coherence + Extended Triggers
**Areas discussed:** Trigger firing mechanism / Skills architecture, Domain centroid & heuristic content (Spanish), Ghost-edge similarity scope, Fact-check & moderation tone

---

## Trigger firing mechanism / Skills architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Synchronous graph nodes | All 4 triggers are event-driven, evaluated inline during graph invocation | ✓ |
| Extend Phase 11's scan-loop | Generalize the silence D-15 setInterval scanner to poll for all conditions | |
| Split: 3 synchronous + drift on scan-loop | Only drift treated as a rolling-window health-check | |

**User's choice:** Synchronous graph nodes.
**Notes:** All 4 new triggers react to a discrete event (message arrival / node commit); only silence is genuinely absence-based and needs polling.

| Option | Description | Selected |
|--------|-------------|----------|
| One combined gate node | TriggerGateNode runs all 4 checks after ArgGraphBuilderNode | ✓ |
| 4 separate nodes | One node per trigger type, own conditional edge each | |

**User's choice:** One combined gate node (TriggerGateNode).

| Option | Description | Selected |
|--------|-------------|----------|
| Routes into existing Role nodes | TriggerGateNode only detects; FacilitationAgentNode/AnalyticsAgentNode generate the response | ✓ |
| TriggerGateNode writes messages directly | Bypasses Role/Personality architecture and arbitration lock | |

**User's choice:** Interrupted — user redirected with a conceptual question about how Blueprints affect this (see below), which led to the Skills discussion superseding this specific option set. Final architecture (D-06 in CONTEXT.md) still routes into existing Role nodes.
**Notes:** User asked how Blueprint variation (different active Roles, different node/edge vocabularies) affects routing. Claude explained the existing `bot_overrides ?? bot_defaults` gate pattern (`silence-scan.ts`) and `bot-registration.ts`'s already-anticipated `analystScorer` extension point for Phase 12.

**User-raised structural insight:** Triggers are "Skills" a Role can have — Role is fixed code, Personality is dynamic voice data, and Skills are the concrete capabilities a Role performs (e.g. a future comical Role with a "joke about anything" skill, personality-tuned as "Chiquito de la Calzada"). This became the core structural addition for the phase.

| Option | Description | Selected |
|--------|-------------|----------|
| Real Skill registry | `{id, detect, buildPromptGuidance}` per Role; TriggerGateNode iterates active Role's skills | ✓ |
| Grouped functions, no formal interface yet | 4 functions colocated by Role, no shared type | |

**User's choice:** Real Skill registry.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — silence-break becomes Coach's first Skill | detect() wraps checkSilenceGate(), delivery mechanism stays the scan-loop | ✓ |
| No — leave silence-break as-is | Only new triggers use the Skill shape | |

**User's choice:** Yes.
**Notes:** User gave a second future example — a "Reminders" skill firing via a scheduled callback — reinforcing that Skill is purely the detect+prompt-guidance contract, independent of delivery mechanism.

---

## Domain centroid & heuristic content (Spanish)

**User's clarifying question:** "What is ONNX? I don't want to add overhead when creating sessions... I think the goal needs to be proactively asked by the agents if needed... it depends on the blueprint."

Claude explained ONNX = local in-process embedding model (`all-MiniLM-L6-v2` via `@huggingface/transformers`), no network call, sub-30ms, negligible per-session cost (the real cost is one-time model cold-start, already a flagged ROADMAP risk).

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 12: static + on/off; Phase 13: dynamic elicitation | Static Blueprint centroid + per-Blueprint toggle now; proactive goal-asking becomes a Phase 13 candidate | ✓ |
| Pull objective-elicitation into Phase 12 now | Expands Phase 12 beyond ROADMAP wording | |

**User's choice:** Phase 12: static + on/off; Phase 13: dynamic elicitation.
**Notes:** Dynamic elicitation overlaps with TRIGGER-02 (phase-signal trigger) and PROFILE-01/02, both Phase 13 scope.

| Option | Description | Selected |
|--------|-------------|----------|
| Blueprint description + vocabulary | Embedded once at Blueprint-load, cached, zero new fields | ✓ (by proxy) |
| New creator-authored 'on-topic scope' field | More precise, but new required authoring surface | |

**User's choice:** "Whatever is easier to make changes in phase 13" — resolved to Blueprint description + vocabulary, since it requires no new Blueprint field and lets Phase 13 layer a session-level override on top without touching this phase's schema.

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit boolean flag | `blueprint.drift_detection_enabled` | ✓ |
| Threshold-as-off sentinel | Reuse threshold field, 0/null = off | |

**User's choice:** Explicit boolean flag.

| Option | Description | Selected |
|--------|-------------|----------|
| Insult/profanity keyword list + shouting signals | Spanish list + ALL-CAPS/punctuation heuristics | ✓ |
| Keyword list only | No structural signals | |

**User's choice:** Insult/profanity keyword list + shouting signals.

| Option | Description | Selected |
|--------|-------------|----------|
| Claim-shaped pattern matching | Numbers, dates, absolutes, named entities gate tier-1 | ✓ |
| Escalate every substantive message to light-tier | Skip pattern-matching, push volume to tier-2 | |

**User's choice:** Claim-shaped pattern matching.

---

## Ghost-edge similarity scope

| Option | Description | Selected |
|--------|-------------|----------|
| Node label only | Reuses drift-detection embedding pipeline | ✓ |
| Label + originating message content | Richer but needs extra join, longer embedding input | |

**User's choice:** Node label only.

| Option | Description | Selected |
|--------|-------------|----------|
| Committed nodes only | Ghost nodes excluded as edge targets to avoid uncertainty chains | ✓ |
| Committed + ghost nodes | Maximizes connectivity, risks unconfirmed chains | |

**User's choice:** Committed nodes only.

---

## Fact-check & moderation tone

| Option | Description | Selected |
|--------|-------------|----------|
| Cite the specific claim + ask for a source | Names the assertion via argGraph context, stays in uncertainty framing | ✓ |
| Flag uncertainty without demanding a source | Softer, less aligned with Analyst's fact-checking discipline | |

**User's choice:** Cite the specific claim + ask for a source.

| Option | Description | Selected |
|--------|-------------|----------|
| Always stateless, single intervention | No per-participant tracking | |
| Escalate after repeated triggers | Tone shifts after N occurrences | ✓ |

**User's choice:** Escalate after repeated triggers.
**Notes:** This creates a dependency on per-participant state that overlaps with Phase 13's PROFILE-01 — resolved in the next question.

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal counter now, Phase 13 absorbs it | Narrow `moderation_count` field, folds into future profile model | ✓ |
| Defer escalation to Phase 13, ship stateless in Phase 12 | Avoids a throwaway counter | |

**User's choice:** Minimal counter now, Phase 13 absorbs it.

---

## Claude's Discretion

- Exact Skill TypeScript interface shape/location
- Exact escalation thresholds (N occurrences) for moderation tone shift
- Exact Spanish insult/profanity keyword list contents and claim-shaped regex patterns
- Exact storage location/shape for the minimal `moderation_count` field (DB column vs. other, following the project's Postgres-backed-state constraint)
- Exact `TriggerGateNode` → Role-node conditional edge implementation

## Deferred Ideas

- Dynamic, session-specific objective elicitation (agents proactively asking the group's goal, timing varying by Blueprint type) — Phase 13 candidate, overlaps with TRIGGER-02 and PROFILE-01/02.
- Full per-participant profile/engagement-tracking system (PROFILE-01/02) — Phase 13.
- Full TriggerEngine generalization (all 6 triggers under one persistent scan-loop) — Phase 14, TRIGGER-07.
