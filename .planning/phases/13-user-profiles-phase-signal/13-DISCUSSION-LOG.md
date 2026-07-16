# Phase 13: User Profiles + Phase Signal - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-16
**Phase:** 13-User Profiles + Phase Signal
**Areas discussed:** Profile storage mechanism, Participant identity & profile content, Phase-readiness coverage check, Coach personalization delivery

---

## Profile Storage Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Postgres table (like moderation_count) | Same pattern as Phase 12's moderation_counts table + RLS + upsert RPC. Survives cold starts, folds moderation_count in naturally. | ✓ |
| LangGraph Store with a Postgres-backed implementation | Matches PROFILE-01's literal wording/namespacing idiom but backed by a custom persisted Store. | |
| True in-memory Store, accept the data loss | Takes PROFILE-01 literally; resets on cold start. | |

**User's choice:** Postgres table (like moderation_count)
**Notes:** PROFILE-01's literal wording names LangGraph InMemoryStore, but that conflicts with the project's own "all bot state in Postgres, never JS process memory" rule.

**Follow-up:** Should moderation_counts fold into the new profile table now?
| Option | Selected |
|--------|----------|
| Fold in — migrate moderation_count into the new table | ✓ |
| Keep separate — two tables, joined when needed | |

**Follow-up:** Where does the profile-update logic live?
| Option | Selected |
|--------|----------|
| Inside ArgGraphBuilderNode (as written) | |
| New dedicated node after ArgGraphBuilderNode | ✓ |

---

## Participant Identity & Profile Content

| Option | Description | Selected |
|--------|-------------|----------|
| author_id (stable UUID) | Matches messages.author_id and moderation_count's participant_id. | ✓ (with clarification) |
| speaker display name | Reuses argGraph's existing field; breaks on mid-session renames. | |

**User's choice:** author_id — with the clarification that registered users should eventually get cross-session profiles (v4.0), while non-registered/guest users stay linked only to the current session. Both use author_id as the key in v3.0; the distinction only matters for future persistence scope, not storage shape now.

**Follow-up:** What counts as "engagement level"?
| Option | Selected |
|--------|----------|
| Message count + reaction count only | ✓ |
| Message + reaction count, plus a derived activity tier | |

**Follow-up:** How should "stated positions"/"key assertions" be populated?
| Option | Selected |
|--------|----------|
| Derive from argGraph nodes filtered by speaker→author_id | ✓ |
| Dedicated LLM extraction pass per participant | |

---

## Phase-Readiness Coverage Check

**Initial framing rejected by user:** The first question assumed Blueprint would define a "required topics per phase" list. User corrected: "The blueprint will be a general way of describing how the session can and should operate, but it will not dictate what topics will be covered."

**Reframed question:** What should the Analyst compare the argGraph against to judge "ready to advance"?
| Option | Description | Selected |
|--------|-------------|----------|
| LLM judgment against the phase's existing llm_instructions | No new Blueprint field; holistic judgment call using existing PhaseSequenceSchema.llm_instructions. | ✓ |
| Session-specific stated goal, elicited once, checked against it | More precise but requires building an elicitation flow deferred from Phase 12 (D-10), not yet scoped. | |

**Follow-up:** How should phase-readiness be wired into the trigger architecture?
| Option | Selected |
|--------|----------|
| New Analyst Skill (`phase-readiness`) in TriggerGateNode | ✓ |
| Keep the existing AgentNode phase_signal path, add coverage judgment inline | |

**Notes:** The existing ad-hoc path (general AgentNode emits phase_signal during a canvas-op tool call, agent.ts:150-181) is deprecated/removed in favor of the new Skill-driven path. Downstream SSE/UI/PATCH plumbing is unchanged.

**Follow-up:** What cheap gate runs before the capable-tier judgment call?
| Option | Selected |
|--------|----------|
| Every N new committed argGraph nodes since last check | (refined, see below) |
| Every N human messages since last check | (refined, see below) |

**User's refinement:** "I would use N committed nodes AND AFTER that, after N human messages. That means that eventually after adding N nodes, the conversation might not evolve. BUT that means the check to move phases must also take into account some of the last messages, not just the nodes of the graph, right?"

**Confirmed:** Sequential gate — N committed nodes accumulate first, then M human messages since that point trigger the check. The Analyst's judgment context includes the phase's llm_instructions + argGraph summary + the last M raw messages (not argGraph alone), so topics discussed but never formalized into nodes are still visible to the judgment call.

---

## Coach Personalization Delivery

| Option | Description | Selected |
|--------|-------------|----------|
| Always-on context injection (every Coach invocation) | A summarizeParticipant() helper adds profile context to every Coach prompt regardless of which Skill fired. | |
| New dedicated 'personalize' Skill | A distinct Skill with its own detect()/buildPromptGuidance(), following the Phase 12 Skill contract. | ✓ (reconciled, see below) |

**Follow-up:** Whose profile does it reference, and what triggers it (given silence-break has no single "current speaker")?
| Option | Description | Selected |
|--------|-------------|----------|
| Most recently active participant, fires alongside other Skills | Competes independently in arbitration. | |
| Only fires for the participant a Coach Skill is already about to respond to | Not an independently-firing Skill — enriches whichever Skill wins. | ✓ |

**Reconciliation:** The two answers above are in tension (first names it a "Skill," second describes something that isn't independently competing in arbitration). Final resolution: personalization is a shared `summarizeParticipant()` enrichment function, invoked by whichever Coach Skill already won arbitration, appending that Skill's target participant's profile summary to its own buildPromptGuidance() output. It is not a competing/firing Skill in the TriggerGateNode arbitration sense.

---

## Claude's Discretion

- Exact `participant_profiles` table schema/migration shape and RPC naming
- Exact new Blueprint field name/shape for the sequential N/M phase-readiness gate
- Cap/recency window for retained positions/assertions per participant profile
- Exact `speaker` → `author_id` resolution mechanism in ProfileBuilderNode
- Removal/deprecation mechanics for the existing ad-hoc phase_signal emission path in agent.ts

## Deferred Ideas

- Session-specific stated-goal elicitation (upfront for coaching Blueprints, reactive-after-N-messages for debate, unneeded for others) — still unscoped; deferred again past Phase 13.
- v4.0 MEM-01/MEM-02 cross-session profile continuity for registered users.
- Full TriggerEngine generalization (Phase 14, TRIGGER-07).
