# Phase 12: Graph Coherence + Extended Triggers - Research

**Researched:** 2026-07-15
**Domain:** LangGraph JS topology extension (detection-gate node) + local ONNX embedding inference + multi-tier LLM cost-escalation gating, inside an existing Node.js/Hono/Supabase codebase
**Confidence:** HIGH (topology/skill wiring, model routing, migration precedent — all verified directly against current source) / MEDIUM (exact cosine thresholds, ONNX cold-start latency in Vercel — no live measurement possible in this session)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Skill Architecture (core structural addition this phase)**
- **D-01:** Introduce a formal **Skill** abstraction: `{ id, detect(context) → { fires, confidence, meta }, buildPromptGuidance(context) → string }`. A Skill is a capability a Role can perform — decoupled from *when/how* it's invoked (delivery mechanism). Generalizes the Role/Personality split from Phase 11: Role = fixed behavioral discipline (code), Personality = voice/tone (data), Skill = a concrete capability the Role can exercise.
- **D-02:** Each Role declares an array of registered Skills. Phase 12 ships: Coach → `drift-redirect`, `moderation` (plus retrofitted `silence-break`); Analyst → `orphan-edge`, `fact-check`.
- **D-03:** Phase 11's silence-break trigger is retrofitted onto the Skill shape as Coach's first Skill. Its `detect()` wraps `checkSilenceGate()`; its `buildPromptGuidance()` wraps the existing content-aware question logic. Delivery mechanism is explicitly NOT changed — still fires via the Phase 11 `setInterval` scan loop + direct-DB-insert.

**Trigger Firing Mechanism**
- **D-04:** The 4 new Skills (drift-redirect, moderation, orphan-edge, fact-check) evaluate **synchronously**, as graph nodes — not via polling.
- **D-05:** All 4 new Skills' detection logic is consolidated into **one combined `TriggerGateNode`**, running after `ArgGraphBuilderNode`. Strictly detection — enforces the COST-02 three-tier escalation gate in one place.
- **D-06:** When `TriggerGateNode` confirms a firing Skill, it does NOT generate the bot response itself. It sets trigger/skill metadata and routes via a conditional edge into the existing `FacilitationAgentNode` (Coach) or `AnalyticsAgentNode` (Analyst). `bot-registration.ts`'s `analystScorer` gets extended to score based on which Skill's context is present.
- **D-07:** Role activation gating follows the exact pattern already used in `silence-scan.ts:190-191` (`session.bot_overrides?.coach ?? blueprint.bot_defaults?.coach ?? false`) — `TriggerGateNode` must check this before evaluating a Role's Skills at all.

**Domain Centroid (Semantic Drift Skill)**
- **D-08:** The domain centroid is a **static, per-Blueprint value**: Blueprint description text + `node_types`/`edge_types` labels, concatenated and embedded once at Blueprint-load time via the local ONNX model (`all-MiniLM-L6-v2`), then cached in memory. No new creator-facing Blueprint field for this.
- **D-09:** A new explicit Blueprint field `drift_detection_enabled: boolean` (default `true`) lets a Blueprint opt out of drift detection entirely.
- **D-10:** Dynamic, session-specific objective elicitation is out of scope for Phase 12 (Phase 13 candidate).

**Heuristic Pre-Filter Content (Spanish)**
- **D-11:** Moderation heuristic pre-filter (TRIGGER-06, zero LLM cost): a curated **Spanish insult/profanity keyword list** plus structural signals (ALL-CAPS ratio, excessive/repeated `!`/`?`). Deterministic.
- **D-12:** Fact-check heuristic pre-filter (TRIGGER-05, tier 1 of 3): **claim-shaped pattern matching** — numbers+units, dates/years, absolute qualifiers ("siempre", "nunca", "todos saben que"), named-entity-like capitalized phrases.

**Ghost-Edge Fallback (GRAPH-03)**
- **D-13:** The ghost-edge similarity fallback embeds **node `label` only** (not the originating message content).
- **D-14:** Only nodes with `status='committed'` are eligible targets for a proposed edge (both LLM-proposed and ghost-fallback).

**Fact-Check & Moderation Tone**
- **D-15:** The Analyst's fact-check challenge cites the specific claim and asks for a source — stays in uncertainty framing (never a confident counter-assertion).
- **D-16:** Moderation intervention tone **escalates after repeated triggers** on the same participant within a session. Requires a minimal `moderation_count` field (per participant, per branch) — explicitly narrow, folds into Phase 13's full profile model.

### Claude's Discretion
- Exact Skill TypeScript interface shape/location
- Exact escalation thresholds (N occurrences before tone shift) for moderation
- Exact Spanish insult/profanity keyword list contents and claim-shaped regex patterns
- Exact storage location/shape for `moderation_count` (new migration column vs. in-memory — must follow Postgres-backed-state precedent per "all bot state in PostgresSaver" constraint)
- Exact `TriggerGateNode` → Role-node conditional edge implementation, following `orchestrator.ts`'s existing conditional-routing pattern

### Deferred Ideas (OUT OF SCOPE)
- Dynamic, session-specific objective elicitation (agents proactively asking the group to state their goal) — Phase 13, overlaps TRIGGER-02/PROFILE-01/02
- Full per-participant profile/engagement-tracking system (PROFILE-01/02) — Phase 13
- Full TriggerEngine generalization (all 6 triggers under one persistent scan-loop) — Phase 14, TRIGGER-07
- A creator-facing editor for Skills or drift thresholds — no new UI surface implied by this phase
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GRAPH-03 | After the first 3 nodes, every new bot-proposed CanvasNode must include ≥1 edge proposal; ghost-edge fallback to most semantically similar node when no strong connection found | See "CRITICAL Architecture Finding" in Architecture Patterns — current `CanvasOpSchema`/`agentNode`/`analyticsAgentNode` emit exactly ONE op per LLM turn; GRAPH-03 is satisfied via the two-step `orphan-edge` Skill mechanism (node commits without edge → TriggerGateNode detects orphan on a later invocation → Analyst proposes edge or ghost-edge fallback fires), not by forcing a single tool call to emit two ops. See Don't Hand-Roll (cosine similarity) and Code Examples (ONNX embedding + orphan detection). |
| TRIGGER-03 | Semantic drift trigger — cosine similarity of last 3 messages vs. Blueprint domain centroid, ONNX-local, threshold default 0.6 | See Standard Stack (`@huggingface/transformers`), Architecture Patterns (Skill contract, singleton pipeline pattern), Common Pitfalls (singleton promise caching) |
| TRIGGER-04 | Unlinked assertion trigger — orphan CanvasNode (no edges) after first 3 nodes → Analyst proposes typed edge | See CRITICAL Architecture Finding; Don't Hand-Roll (cosine similarity ranking) |
| TRIGGER-05 | Fact-check trigger — heuristic → light-tier → capable-tier three-tier escalation, never skips the pre-filter | See Architecture Patterns (three-tier escalation gate pattern), Code Examples |
| TRIGGER-06 | Moderation trigger — heuristic pre-filter only, zero LLM cost, neutral non-accusatory intervention | See Common Pitfalls (moderation false-positive risk), D-16 escalation storage guidance |
| COST-01 | All proactive bot invocations use `TASK_MODELS` task-based routing; facilitation → light tier, analysis → capable tier | See Standard Stack (`TASK_MODELS` already has all needed tiers — verified in `model-config.ts`) |
| COST-02 | Three-tier escalation gate (heuristic → light-tier classifier → capable-tier); raw trigger evaluation never calls capable-tier directly | See Architecture Patterns (three-tier gate), Common Pitfalls (cost-tier routing regression is silent, no type error) |
</phase_requirements>

---

## Summary

Phase 12 is a **topology extension**, not a new subsystem: it inserts one new detection-only `TriggerGateNode` into the existing LangGraph graph (`apps/api/src/graph/graph.ts`, currently 7 nodes) and formalizes a `Skill` abstraction (`{id, detect, buildPromptGuidance}`) that both wraps the 4 new triggers and retrofits Phase 11's silence-break trigger. All routing, adapter-seam, fail-silent, and cost-tier conventions this phase needs already exist in the codebase from Phases 6–11 (`orchestrator.ts`'s conditional-edge pattern, `TASK_MODELS`'s `facilitation`/`classification`/`analysis` tiers, `config.configurable` test-injection seams, `[nodename]` fail-open logging). No new architectural pattern needs to be invented — this phase is disciplined reuse plus one genuinely new dependency (`@huggingface/transformers`, confirmed NOT yet installed).

Two things this research verified that are **not obvious from CONTEXT.md/AI-SPEC.md alone** and materially change what the planner must decide:

1. **`CanvasOpSchema` (`packages/types/src/canvas.ts`) is a single-operation discriminated union** (`ADD_NODE` XOR `ADD_EDGE` XOR `NO_ACTION`), and both `agentNode` and `analyticsAgentNode` `return` immediately on the **first** `tool_use` event from the model — meaning **today, one LLM turn can never emit both a node and its edge in the same `CanvasOp` output.** GRAPH-03's "every new bot-proposed CanvasNode must include at least one edge proposal in its CanvasOp output" cannot be satisfied by a single-call schema change alone without touching this early-return behavior and `mutation-gate.ts`'s single-op gating. The phase's own requirement text for TRIGGER-04 ("when a new canvas node **has been committed** with no edges... the Analyst detects the orphan and proposes...") confirms the intended design is a **two-step, cross-invocation mechanism**: a node commits without an edge on one turn, then the `orphan-edge` Skill detects it as orphaned on a subsequent `TriggerGateNode` evaluation and proposes an edge (or the ghost-edge cosine-similarity fallback fires) in a follow-up Analyst turn. This is good news — it means the planner does NOT need to redesign `canvasMutationTool`/`CanvasOpSchema` into a batch schema; it needs the `orphan-edge` Skill's detection + a follow-up Analyst edge-proposal call. See "CRITICAL Architecture Finding" below.

2. **`TriggerGateNode`'s proposed insertion point (`argGraphBuilder → analysis`) is on a trigger-only path, not the primary human-message path.** `ArgGraphBuilderNode` today is reached ONLY when `state.triggerType === 'analysis_request'` (a Phase 11 proactive path) — the primary human flow is `orchestrator → agent → mutationGate → END` and never touches `argGraphBuilder` or (as proposed) `triggerGate` at all. Since GRAPH-03/TRIGGER-04's orphan-edge detection needs visibility into CanvasNodes committed via the human path (the common case — most CanvasNodes originate from human messages via `agentNode`, not proactive Analyst turns), the planner must decide explicitly whether `TriggerGateNode` also needs to run on the human path (e.g., inserted after `mutationGate` before `END`) or whether orphan-edge detection is intentionally scoped to the `analysis_request`/proactive path only for Phase 12. This is flagged as an Open Question below — the AI-SPEC's wiring snippet does not address it.

The four new Skills split cleanly by **cost tier**: `drift-redirect` and `orphan-edge` are $0 local-ONNX-embedding checks; `moderation` is a $0 heuristic/regex check; `fact-check` is the only Skill that can reach a paid LLM call, gated behind a 3-tier escalation ladder (heuristic → `TASK_MODELS[provider].classification` → `TASK_MODELS[provider].analysis`) that the codebase's `TASK_MODELS` registry already supports without any new `TaskType` entries.

**Primary recommendation:** Follow `12-AI-SPEC.md` Sections 3–4 almost verbatim for the `Skill` contract, `TriggerGateNode` shape, and file layout (it was generated this session against the actual current codebase and its code snippets were cross-verified against the real files during this research — they match). The two deviations the planner MUST resolve beyond what AI-SPEC.md specifies are: (a) the CanvasOp single-op-per-call / two-step orphan-edge mechanism described above, and (b) explicitly deciding `TriggerGateNode`'s reachability on the primary human path, not just the trigger path.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Skill detection (drift/orphan/fact-check-tier1/moderation) | API / Backend (LangGraph node, in-process) | — | Detection must run inside the same graph invocation as the message that could trigger it, sharing `state.argGraph`/`state.messages` — no separate service needed |
| Local ONNX embedding inference | API / Backend (in-process, `@huggingface/transformers`) | — | Explicitly local/zero-network per COST-02; must run in the same Node.js process as the graph (both Vercel serverless `/invoke` and the standalone `server.ts` silence-scan loop) |
| Fact-check tier-2/tier-3 LLM calls | API / Backend (via `adapter-factory.ts` → provider API) | — | BYOK constraint: all LLM calls route through the creator's own provider key, never a platform-side model |
| Coach/Analyst response generation | API / Backend (existing `FacilitationAgentNode`/`AnalyticsAgentNode`) | — | Unchanged from Phase 11 — Skills only decide *whether* and *with what guidance* these nodes run, never replace them |
| `moderation_count` persistence | Database / Storage (Supabase Postgres) | — | Must survive across branches/sessions independent of any single LangGraph thread checkpoint — explicitly NOT `GraphState` (per AI-SPEC.md Section 4, "State Management") |
| Drift/orphan-edge cosine thresholds, Skill routing decisions | API / Backend | — | Pure computation, no UI surface this phase (CONTEXT.md: "no new UI surface implied") |
| Ghost-edge/orphan-edge visual rendering | Browser / Client (existing `@xyflow/react` ghost-node styling, Phase 9) | — | Unchanged — Phase 12 only produces the `CanvasOp`/`status:'ghost'` data; UI-02's dashed-border/60s-expiry rendering already exists and needs no changes |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@langchain/langgraph` | `1.4.7` (pinned, unchanged) | StateGraph topology, conditional edges, checkpointing | Already the project's locked framework since Phase 6/7; Phase 12 is a topology extension, not a new integration `[VERIFIED: apps/api/package.json]` |
| `@langchain/langgraph-checkpoint-postgres` | `1.0.4` (pinned, unchanged) | `PostgresSaver` — durable thread state across Vercel cold starts | No changes needed — `TriggerGateNode`'s new state fields are checkpointed automatically via the existing `Annotation.Root` mechanism `[VERIFIED: apps/api/package.json]` |
| `@huggingface/transformers` | `4.2.0` | Local ONNX inference (`all-MiniLM-L6-v2`) for drift-redirect and orphan-edge cosine similarity, $0 API cost | Genuinely NEW dependency — confirmed **NOT currently in `apps/api/package.json`** (grep found zero matches). Version `4.2.0` matches the exact version already recorded as a locked project decision in `.planning/STATE.md`'s 2026-07-09 decision log entry ("One new package: @huggingface/transformers 4.2.0 for local ONNX semantic drift scoring") `[VERIFIED: npm registry, cross-checked against STATE.md locked decision]` |

**Installation:**
```bash
npm install --workspace apps/api @huggingface/transformers
```

**Version verification performed this session:**
```bash
npm view @huggingface/transformers version   # → 4.2.0, published 2026-04-22
npm view @huggingface/transformers deprecated  # → (empty — not deprecated)
npm view @huggingface/transformers repository.url  # → git+https://github.com/huggingface/transformers.js.git
```
Confirmed current, not deprecated, official Hugging Face repository (not a typosquat/lookalike name).

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | `4.4.3` (pinned, unchanged) | `SkillDetectionResultSchema`, new Blueprint field validation | Same co-located-schema-plus-type convention as every existing type in `packages/types/src/*.ts` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@huggingface/transformers` (local ONNX) | An embedding API call (OpenAI `text-embedding-3-small`, Anthropic has none, Voyage AI, etc.) | Violates COST-02's "no LLM/API cost during detection" framing explicitly; also adds a 4th BYOK-adjacent cost surface the creator didn't sign up for. Locked out by CONTEXT.md D-08 and STATE.md's 2026-07-09 decision — not a live choice for the planner. |
| One combined `TriggerGateNode` (D-05) | 4 separate LangGraph nodes, one per Skill | Rejected by CONTEXT.md D-05 explicitly — would duplicate the COST-02 escalation-gate enforcement 4x and require 4x the conditional-edge wiring. Also loses the single `Promise.allSettled` fan-out pattern that isolates one throwing Skill from blocking the others. |

---

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@huggingface/transformers` | npm | Actively maintained since 2023 (transformers.js), latest `4.2.0` published 2026-04-22 | High (official Hugging Face package, millions of weekly downloads across the transformers.js line) | `github.com/huggingface/transformers.js` | `[OK]` | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

slopcheck was successfully installed and run this session (`slopcheck install @huggingface/transformers`) and returned `[OK]` with 1/1 packages scanned clean. No `postinstall` script check was needed via `npm view @huggingface/transformers scripts.postinstall` — transformers.js downloads ONNX model weights lazily at first `pipeline()` call (into `~/.cache` or a configurable `cacheDir`), not via a postinstall script, per its own documented architecture — verify this at implementation time if offline/sandboxed CI is a concern (model download requires network access on first run in each environment, including CI, unless weights are pre-cached or committed).

---

## Architecture Patterns

### CRITICAL Architecture Finding: CanvasOp is single-operation, GRAPH-03 requires a two-step mechanism

Verified by reading `packages/types/src/canvas.ts`, `apps/api/src/graph/nodes/agent.ts`, `apps/api/src/graph/nodes/analytics-agent.ts`, `apps/api/src/graph/nodes/mutation-gate.ts`, and `apps/api/src/routes/ai.ts` in full:

- `CanvasOpSchema` is `z.discriminatedUnion("op", [ADD_NODE, ADD_EDGE, NO_ACTION])` — **one operation per parse**, not a batch/array type.
- `agentNode` (line ~170-172) and `analyticsAgentNode`'s tool-use handler both `return` from inside the `for await` loop on the FIRST `tool_use` event with `name === 'canvas_mutation'` — even if the model theoretically emitted a second tool call in the same response, it is never read.
- `mutationGateNode` gates exactly one op: `const op = state.agentOutput` (singular, not an array) and appends `[gatedOp]` (one element) to the `canvasOps` reducer.
- **However**, `apps/api/src/routes/ai.ts`'s post-stream persistence logic (lines ~499-658) is already written generically over `allCanvasOps` (an array) and processes ALL `ADD_NODE` ops first (minting UUIDs into a `label → uuid` map), then ALL `ADD_EDGE` ops (resolving refs via that map) — this part of the pipeline is **already multi-op-ready**, it's just that no single graph invocation today produces more than one op.

**Conclusion for the planner:** GRAPH-03 ("every new bot-proposed CanvasNode must include at least one edge proposal in its `CanvasOp` output") is not literally satisfiable within a single `agentNode`/`analyticsAgentNode` tool call under the current schema without a nontrivial refactor (batch `CanvasOp[]` tool output + multi-op `mutation-gate.ts`). TRIGGER-04's own requirement wording — "when a new canvas node **has been committed** with no edges to existing nodes... the Analyst detects the orphan and proposes" — describes exactly the two-invocation design already implied by D-04/D-05/D-06: a `CanvasNode` commits via the normal path (unchanged), then on a LATER graph invocation `TriggerGateNode`'s `orphan-edge` Skill detects it has zero edges and fires a follow-up `AnalyticsAgentNode` turn that emits a single `ADD_EDGE` `CanvasOp` (LLM-proposed) or — if the LLM itself can't find a strong connection — the Skill's own D-13 cosine-similarity fallback computes the target directly and constructs the ghost `ADD_EDGE` op without an LLM call at all. **Recommend the planner adopt this two-step interpretation explicitly** (it requires zero changes to `CanvasOpSchema`/`mutation-gate.ts`) rather than attempting to make one tool call emit two ops.

### Open architecture question: does `TriggerGateNode` need to reach the primary human path?

Verified in `apps/api/src/graph/graph.ts`: the current topology is
```
START → routeFromStart → facilitation | argGraphBuilder→analysis | orchestrator
orchestrator → routeAfterOrchestrator → agent | driftReply | end
agent → mutationGate → END
argGraphBuilder → analysis → mutationGate → END
facilitation → END
```
`argGraphBuilder` (and therefore, per AI-SPEC.md's proposed insertion point, `triggerGate`) is reached ONLY via `routeFromStart` returning `'analysis'`, which requires `state.triggerType === 'analysis_request'` — a value set only by proactive/trigger-driven invocations (Phase 11's silence-scan and, in Phase 12, presumably the new Skills' own invocations). **The primary human-message path (`orchestrator → agent → mutationGate → END`) never touches `argGraphBuilder` or `triggerGate` at all.** Since most `CanvasNode`s in a real session originate from human messages via `agentNode` (not proactive Analyst turns), an orphan-edge Skill that only evaluates on the `analysis_request` path would miss the majority of orphan nodes it's meant to catch — the same applies to `drift-redirect` (should react to the actual flow of human messages, not just proactive scans) and `moderation` (must evaluate every incoming human message, not just proactive turns).

This is flagged in Open Questions below — the planner must decide EITHER (a) also insert `triggerGate` into the primary human path (e.g., `mutationGate → triggerGate → conditional(facilitation|analysis|end)` before `END`), or (b) explicitly scope Phase 12's 4 new Skills to evaluate only on a new dedicated `trigger_scan`-style invocation path analogous to `analysis_request`, accepting that human-message-triggered orphan nodes are caught on the NEXT proactive scan tick rather than immediately. AI-SPEC.md's wiring snippet (Section 3, "graph.ts — conditional edge...") only shows the fix for the `argGraphBuilder → analysis` fixed-edge hazard; it does not address this reachability gap.

### System Architecture Diagram

```
Human message arrives (SSE /invoke, Vercel)          Proactive scan tick (server.ts setInterval)
              │                                                    │
              ▼                                                    ▼
        [existing path]                              triggerType = 'analysis_request'
   orchestrator → agent → mutationGate                             │
              │         (commits CanvasNode,                       ▼
              │          possibly with NO edge)          ArgGraphBuilderNode
              │                                       (extracts argGraph nodes/edges
              │  ◄── OPEN QUESTION: does this path                  from recent messages)
              │      also need to reach triggerGate? ──┐            │
              │                                        │            ▼
              ▼                                        │    TriggerGateNode (NEW)
             END                                       │    ┌─────────────────────────┐
                                                         └──▶│ D-07: Role-gate check    │
                                                              │ (bot_overrides ??        │
                                                              │  bot_defaults ?? false)  │
                                                              │                          │
                                                              │ Coach Skills:            │
                                                              │  silence-break(retrofit) │
                                                              │  moderation (heuristic)  │
                                                              │  drift-redirect (ONNX)   │
                                                              │                          │
                                                              │ Analyst Skills:          │
                                                              │  orphan-edge (ONNX +     │
                                                              │    ghost-edge fallback)  │
                                                              │  fact-check (3-tier gate)│
                                                              │                          │
                                                              │ Promise.allSettled over  │
                                                              │ all candidate Skills'    │
                                                              │ detect() calls; first    │
                                                              │ fires wins (priority     │
                                                              │ order)                   │
                                                              └────────────┬─────────────┘
                                                                           │
                                                        routeAfterTriggerGate (conditional)
                                                          ┌────────────────┼────────────────┐
                                                          ▼                ▼                 ▼
                                                   'facilitation'    'analysis'            'end'
                                                          │                │                 │
                                                          ▼                ▼                 ▼
                                              FacilitationAgentNode  AnalyticsAgentNode    END
                                              (Coach — unchanged,    (Analyst — unchanged,  (no Skill
                                               buildPromptGuidance()  buildPromptGuidance()   fired —
                                               spliced into system    spliced into system     silent
                                               prompt slot)            prompt slot; may        exit)
                                                          │            emit ADD_EDGE
                                                          ▼            CanvasOp via
                                                         END            existing
                                                                        canvasMutationTool)
                                                                              │
                                                                              ▼
                                                                        mutationGate → END
```

### Recommended Project Structure

```
apps/api/src/graph/
├── graph.ts                       # createGraph() — add TriggerGateNode + routeAfterTriggerGate;
│                                   # replace argGraphBuilder's fixed .addEdge('argGraphBuilder','analysis')
│                                   # with a conditional edge (Pitfall: fixed + conditional edges from
│                                   # the same source node both fire — fan-out, not override)
├── nodes/
│   ├── trigger-gate.ts             # NEW — TriggerGateNode (consolidated Skill detection, D-05)
│   ├── arg-graph-builder.ts        # existing — unchanged
│   ├── facilitation-agent.ts       # existing Coach node — extend buildCoachSystemPrompt() with a
│   │                                # firing-Skill buildPromptGuidance() injection slot
│   └── analytics-agent.ts          # existing Analyst node — same injection slot; already has a
│                                    # factCheckFraming boolean seam ready to be wired live (see below)
apps/api/src/lib/
├── skills.ts                       # NEW — Skill interface, SkillContext, COACH_SKILLS/ANALYST_SKILLS
├── skills/
│   ├── drift-redirect.ts           # NEW — Coach: ONNX cosine-sim vs Blueprint domain centroid (D-08)
│   ├── moderation.ts               # NEW — Coach: heuristic pre-filter + escalation tone (D-11, D-16)
│   ├── orphan-edge.ts              # NEW — Analyst: orphan detection + ghost-edge cosine-sim fallback
│   ├── fact-check.ts               # NEW — Analyst: 3-tier escalation gate (D-12, COST-02)
│   └── silence-break.ts            # NEW — retrofits checkSilenceGate() onto the Skill contract (D-03)
├── embeddings.ts                   # NEW — ONNX pipeline singleton + cosine similarity helper
│                                    # (shared by drift-redirect.ts and orphan-edge.ts)
├── moderation-count.ts             # NEW — Postgres-backed moderation_count read/write (D-16)
├── bot-context.ts                  # existing — summarizeArgGraph(), CONTEXT_WINDOWS (add driftCheck:3)
├── bot-arbitrator.ts                # existing — unchanged mechanism
└── bot-registration.ts             # existing — analystScorer extension point (D-06)
packages/types/src/
├── skill.ts                        # NEW — SkillDetectionResultSchema (Zod) + inferred type
├── fact-check-tool.ts               # NEW — classify_fact_check_need ProviderTool (tier-2)
├── canvas.ts                       # existing — unchanged (no batch-op schema change needed, see above)
└── blueprint.ts                    # existing — add drift_detection_enabled: boolean (D-09)
supabase/migrations/
└── 0015_graph_coherence_triggers.sql  # NEW — see Migration Sequencing below (0014 already exists)
```

### Pattern 1: Skill contract + `TriggerGateNode` consolidated detection

Verified accurate against the current codebase (imports, `config.configurable` shape, fail-silent convention all match). Reproduced here in condensed form — see `12-AI-SPEC.md` Sections 3–4 for the full annotated version, which this research confirms is implementation-ready as written:

```typescript
// apps/api/src/lib/skills.ts
export interface SkillContext {
  state: GraphState
  blueprint: Blueprint
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config?: any  // same shape as every node's config.configurable — passed through explicitly,
                // never read from a module-level global (breaks the test-injection seam otherwise)
}

export interface Skill {
  id: string
  role: 'coach' | 'analyst'
  detect(context: SkillContext): Promise<SkillDetectionResult>
  buildPromptGuidance(context: SkillContext): string
}
```

```typescript
// apps/api/src/graph/nodes/trigger-gate.ts (skeleton — Promise.allSettled, first-fires-wins)
export async function triggerGateNode(state: GraphState, config?: any): Promise<Partial<GraphState>> {
  const blueprint = config?.configurable?.blueprint as Blueprint | undefined
  if (!blueprint) return { firingSkillId: null, firingSkillRole: null }

  const coachEnabled = config?.configurable?.botOverrides?.coach ?? blueprint.bot_defaults?.coach ?? false
  const analystEnabled = config?.configurable?.botOverrides?.analyst ?? blueprint.bot_defaults?.analyst ?? false
  const candidateSkills = [...(coachEnabled ? COACH_SKILLS : []), ...(analystEnabled ? ANALYST_SKILLS : [])]

  const results = await Promise.allSettled(
    candidateSkills.map(async (skill) => ({ skill, result: await skill.detect({ state, blueprint, config }) })),
  )
  for (const settled of results) {
    if (settled.status === 'rejected') { console.warn('[trigger-gate] skill.detect() threw', settled.reason); continue }
    if (settled.value.result.fires) {
      return { firingSkillId: settled.value.skill.id, firingSkillRole: settled.value.skill.role, skillMeta: settled.value.result.meta ?? null }
    }
  }
  return { firingSkillId: null, firingSkillRole: null, skillMeta: null }
}
```

`Promise.allSettled` (not `Promise.all`) is required here — a single throwing Skill (e.g., a malformed moderation regex) must not prevent `fact-check`/`orphan-edge` from being evaluated the same turn. This mirrors the existing scorer-isolation pattern already established in `bot-arbitrator.ts`.

### Pattern 2: Local ONNX embedding — singleton pipeline + cosine similarity

`[CITED: huggingface/transformers.js README + community examples]` — API shape cross-verified via WebSearch against the `pipeline('feature-extraction', ...)` usage documented for `@huggingface/transformers`:

```typescript
// apps/api/src/lib/embeddings.ts
import { pipeline } from '@huggingface/transformers'
import type { FeatureExtractionPipeline } from '@huggingface/transformers'

// CRITICAL: assign the PROMISE itself synchronously (before any await), not the resolved
// value — otherwise concurrent detect() calls (drift-redirect + orphan-edge, both racing
// inside the same TriggerGateNode Promise.allSettled batch) will each see the singleton as
// null and both call pipeline(), double-loading the ~90MB model.
let _extractorPromise: Promise<FeatureExtractionPipeline> | null = null

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (_extractorPromise === null) {
    _extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as Promise<FeatureExtractionPipeline>
  }
  return _extractorPromise
}

export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getExtractor()
  const output = await extractor(text, { pooling: 'mean', normalize: true })
  return output.data as Float32Array
}

// normalize:true already unit-normalizes the vectors — cosine similarity reduces to a plain
// dot product, no separate magnitude division needed.
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}
```

Model identifier note: the widely-used pre-converted ONNX checkpoint for this model on the Hugging Face Hub is `Xenova/all-MiniLM-L6-v2` (the `Xenova` org publishes transformers.js-compatible ONNX conversions of popular sentence-transformers models) — `[ASSUMED — confirm exact model-id string against transformers.js's own model-compatibility docs at implementation time; a bare `all-MiniLM-L6-v2` or `sentence-transformers/all-MiniLM-L6-v2` string will fail to resolve without an ONNX export]`.

### Pattern 3: Domain centroid caching (D-08)

```typescript
// Computed once per Blueprint LOAD (not per message) — cache keyed by blueprint.id.
const _centroidCache = new Map<string, Promise<Float32Array>>()

export function getDomainCentroid(blueprint: Blueprint): Promise<Float32Array> {
  let cached = _centroidCache.get(blueprint.id)
  if (!cached) {
    const text = [
      blueprint.name,
      ...blueprint.node_types.map((n) => n.label),
      ...blueprint.edge_types.map((e) => e.label),
    ].join('. ')
    cached = embed(text)
    _centroidCache.set(blueprint.id, cached)
  }
  return cached
}
```
Note: this in-memory cache is process-local — on Vercel serverless (`/invoke`) it is rebuilt on every cold start (acceptable, since it's a single cheap embed call), while on the standalone `server.ts` process (silence-scan) it persists for the process lifetime. No cross-process sharing needed since the computation is deterministic and cheap.

### Pattern 4: Three-tier fact-check escalation gate (COST-02)

```typescript
// apps/api/src/lib/skills/fact-check.ts — sequencing, not full implementation
async function detect(context: SkillContext): Promise<SkillDetectionResult> {
  const lastMessage = context.state.messages[context.state.messages.length - 1]
  if (!lastMessage) return { fires: false, confidence: 0 }

  // Tier 1 — heuristic pre-filter (D-12), $0, no adapter call at all.
  if (!looksLikeCheckableClaim(lastMessage.content)) {
    return { fires: false, confidence: 0 }
  }

  // Tier 2 — light classifier confirms/denies (COST-02: TASK_MODELS[provider].classification)
  const tier2 = await runTier2Classifier(context)  // adapter.stream() with factCheckClassificationTool,
                                                     // model: TASK_MODELS[providerName].classification, maxTokens: 64
  if (!tier2.needsFactCheck) return { fires: false, confidence: tier2.confidence }

  // Tier 3 — reuses the EXISTING analyticsAgentNode path unchanged, via config.configurable.factCheckFraming.
  // TriggerGateNode does NOT itself call tier-3 (D-06: detection-only) — it routes to AnalyticsAgentNode,
  // which already has a factCheckFraming boolean seam (analytics-agent.ts line 121) documented as
  // "no live trigger wires this in Phase 11; a future trigger (Phase 12) sets it." Phase 12 is that trigger.
  return { fires: true, confidence: tier2.confidence, meta: { claimMessageId: lastMessage.id } }
}
```
Verified: `TASK_MODELS` (`apps/api/src/lib/model-config.ts`) already has `classification` and `analysis` as `TaskType` entries for all three providers (`anthropic`/`openai`/`gemini`) — no new `TaskType` needs to be added for this phase, only `fact-check.ts`'s tier-2 call resolving to `.classification` and the tier-3 path (already `analyticsAgentNode`, already resolving to `.analysis`) needs to be exercised for the first time with `factCheckFraming: true` actually set by a real caller.

### Anti-Patterns to Avoid
- **Reimplementing the Role-activation gate inline in each Skill:** `TriggerGateNode` must check `bot_overrides ?? bot_defaults ?? false` ONCE, before building the candidate Skill list — not have each Skill re-check its own Role's enablement.
- **Skills reaching into a module-level config/global:** every Skill must receive its `SkillContext` explicitly from `TriggerGateNode` — reaching into a global breaks the `agentAdapter`/`classifierAdapter`-style test-injection seam this codebase relies on for `vitest`.
- **Awaiting the ONNX pipeline load without promise-caching:** re-calling `pipeline(...)` per invocation reloads the ~90MB model from disk/cache every message — hundreds of ms added latency per drift-redirect/orphan-edge check (see Common Pitfalls #2).
- **Adding a competing `arg-graph.ts` or a second ArgNode/ArgEdge-like type for orphan-edge detection:** orphan-edge detection operates on `CanvasNode`/`CanvasEdge` (Supabase tables, has a `status` field), NOT on `ArgNode`/`ArgEdge` (LangGraph state, no `status` field at all — verified in `packages/types/src/bot.ts`). Conflating the two is the single most likely implementation bug this phase risks; see Common Pitfalls #1.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sentence/label embedding | A custom TF-IDF or bag-of-words similarity scorer | `@huggingface/transformers`'s `pipeline('feature-extraction', ...)` with `all-MiniLM-L6-v2` | Locked project decision (STATE.md 2026-07-09); TF-IDF-style approaches fail on paraphrase/synonym drift, which is exactly what semantic-drift detection needs to catch |
| Cosine similarity | A generic npm similarity/vector-math package | A 5-line dot-product helper (vectors are already unit-normalized by `{normalize:true}`) | Adding a dependency for a 5-line dot-product is unjustified; `Don't Hand-Roll` here actually points the OTHER way — hand-roll the trivial math, don't hand-roll the embedding model |
| Multi-tier LLM cost gating | A custom middleware/interceptor around every adapter call | The existing `TASK_MODELS` registry + each Skill's own internal tier ladder (COST-02) | `TASK_MODELS` already resolves per-provider tier-to-model mapping; building a parallel gating layer risks the exact "silent regression, no type error" failure mode `12-AI-SPEC.md` flags as the highest-cost-risk guardrail |
| Structured LLM output validation/retry | A custom JSON-repair/retry loop | The existing Zod `.safeParse()` + bounded-retry-with-correction-message pattern already implemented in `arg-graph-builder.ts`'s `attemptExtraction()` | This exact pattern is already proven in this codebase for tool-use extraction; Phase 12's tier-2 fact-check classifier and any new Skill-meta shape should reuse it, not invent a new retry strategy |
| Role-activation / cooldown / arbitration / budget guard | New per-Skill gating logic | `checkSilenceGate()`, `runArbitration()`/`registerBot()`, `checkBotBudget()` (all Phase 10, unchanged) | These four primitives already form the complete "should a bot speak right now" gate; Phase 12 Skills feed INTO this existing chain (via routing to Coach/Analyst), they don't bypass or duplicate it |

**Key insight:** Every piece of genuinely new infrastructure this phase needs (Skill contract, ONNX singleton, 3-tier gate) is either explicitly locked by CONTEXT.md/STATE.md or a thin wrapper over an existing codebase primitive. The actual engineering risk in this phase is not "what library to use" — it's the two architecture findings above (single-op CanvasOp schema, TriggerGateNode reachability on the human path), which are project-topology decisions, not library choices.

---

## Common Pitfalls

### Pitfall 1: Conflating `ArgNode`/`ArgEdge` (argGraph) with `CanvasNode`/`CanvasEdge` (the rendered canvas)
**What goes wrong:** Implementing orphan-edge detection or the D-14 "committed-only" rule against `state.argGraph` (Phase 11's `ArgNode`/`ArgEdge`, populated by `ArgGraphBuilderNode`) instead of the `canvas_nodes`/`canvas_edges` Supabase tables (populated by `ai.ts`'s post-stream upsert logic from `CanvasOp`s).
**Why it happens:** Both are called "the graph" informally in conversation and both use similar node/edge language; `ArgGraphBuilderNode` runs immediately before the proposed `TriggerGateNode` insertion point, making it tempting to read `state.argGraph` directly.
**How to avoid:** `ArgNodeSchema` (verified in `packages/types/src/bot.ts`) has NO `status` field at all — it cannot represent "committed vs. ghost." `CanvasNodeSchema` (verified in `packages/types/src/canvas.ts`) DOES have `status: CanvasNodeStatusSchema` (`committed | ghost | silent`). Since GRAPH-03/D-14 explicitly reason about "committed" status, orphan-edge detection MUST query `canvas_nodes`/`canvas_edges` (via Supabase, using `config.configurable`'s service client or an injected seam), not `state.argGraph`.
**Warning signs:** A `Skill.detect()` implementation that only reads `context.state.argGraph` and never queries Supabase for `canvas_nodes`/`canvas_edges` is very likely implementing the wrong graph.

### Pitfall 2: ONNX pipeline singleton race under `Promise.allSettled`
**What goes wrong:** Two Skills (`drift-redirect` and `orphan-edge`) both call `getExtractor()` inside the same `TriggerGateNode` invocation's `Promise.allSettled` fan-out. If the singleton check-then-assign is not atomic (`if (instance === null) { instance = await pipeline(...) }` — awaiting BEFORE assignment), both calls race past the null-check before either resolves, loading the model twice.
**Why it happens:** The natural way to write a lazy-singleton getter in async code is to await inside the guard, but that reintroduces the exact race the singleton exists to prevent.
**How to avoid:** Assign the Promise itself synchronously (`instance = pipeline(...)`, not `instance = await pipeline(...)`) before the first `await` in the function body — see Pattern 2's code example above. This is also transformers.js's own documented singleton example shape.
**Warning signs:** Elevated p95 latency on `TriggerGateNode` correlating with sessions that have BOTH Coach and Analyst enabled (both Skill families active simultaneously, maximizing the chance of a concurrent race).

### Pitfall 3: Mixing a fixed `.addEdge()` and `.addConditionalEdges()` from the same graph source node
**What goes wrong:** `argGraphBuilder` currently has `.addEdge('argGraphBuilder', 'analysis')` (verified in `graph.ts` line 139). LangGraph does not let a newly-added conditional edge from the same source "override" this — both fire (fan-out), so `analysis` runs unconditionally on every path in addition to whatever the new conditional routing decides.
**Why it happens:** It's a natural (but wrong) instinct to "add" a conditional edge alongside an existing fixed edge rather than replacing it — `graph.ts`'s own header comment already documents this exact class of bug for the `START` edge from Phase 11 ("both cannot coexist; the fixed edge would silently win").
**How to avoid:** Remove the fixed `.addEdge('argGraphBuilder', 'analysis')` and replace it with `.addConditionalEdges('argGraphBuilder', routeAfterArgGraphBuilder, { analysis: 'analysis', triggerGate: 'triggerGate' })`, preserving the existing `analysis_request` behavior as one branch.
**Warning signs:** `analysis`/`AnalyticsAgentNode` firing on every message even when no Skill fired, or firing twice.

### Pitfall 4: `addConditionalEdges` pathsMap must enumerate every possible router return value
**What goes wrong:** LangGraph 1.4.7 has no compile-time exhaustiveness check on a router function's return type vs. its `pathsMap` — an unmapped return value produces a rejected `graph.invoke()` promise at runtime (per the existing `graph.test.ts` SPIKE block, already verified against this exact LangGraph version by the Phase 11 team).
**How to avoid:** `routeAfterTriggerGate`'s return type (`'facilitation' | 'analysis' | 'end'`) must have all three keys present in the `addConditionalEdges` call's `pathsMap`, with `'end'` mapped to the imported `END` sentinel.
**Warning signs:** A graph invocation silently hangs or rejects with no clear stack trace pointing at the router function.

### Pitfall 5: Overwrite-style `Annotation<T>()` needs an explicit reducer + default
**What goes wrong:** LangGraph's no-arg `Annotation<T>()` creates a LastValue (overwrite) channel but does NOT support a default value — reading it before any node has set it throws `undefined`-related errors inside a router function.
**How to avoid:** The 2-3 new `GraphState` fields this phase adds (`firingSkillId`, `firingSkillRole`, `skillMeta`) must follow the exact idiom already used for `guardrailResult`/`agentOutput`/`driftAction` in `state.ts`: `reducer: (_, v) => v, default: () => null`.
**Warning signs:** `routeAfterTriggerGate(state)` throwing on `state.firingSkillRole` being `undefined` rather than `null` on the very first invocation of a fresh thread.

### Pitfall 6: Moderation heuristic false positives on Spanish regional slang / emphatic punctuation
**What goes wrong:** A keyword/tone heuristic (D-11) tuned on a curated insult list plus ALL-CAPS/punctuation signals can false-positive on regional slang or enthusiastic (not abusive) punctuation, publicly flagging an innocent participant — this is a Critical-priority failure mode per `12-AI-SPEC.md` Section 1b.
**Why it happens:** Spanish profanity/insult vocabulary varies significantly by region (Spain vs. Latin American variants), and ALL-CAPS/exclamation-heavy messages are common in enthusiastic (not hostile) chat contexts.
**How to avoid:** Native Spanish-speaking pilot participant review of the keyword list before/shortly after ship (per AI-SPEC.md's evaluation strategy); D-16's first-offense-gentle-tone design already bounds the blast radius of a false positive somewhat (a wrongly-flagged first offense is a gentle nudge, not a public accusation) — but this does not eliminate the interpersonal-stakes risk, only reduces its severity.
**Warning signs:** Any moderation firing on a message containing only enthusiasm/emphasis with no actual hostile content.

### Pitfall 7: Cost-tier resolution regression is invisible without an explicit assertion
**What goes wrong:** A copy-paste error or refactor causes `fact-check.ts`'s tier-2 call to resolve `TASK_MODELS[providerName].analysis` (capable tier) instead of `.classification` (light tier), or vice versa for tier-3. This produces **no TypeScript compile error** — both resolve to valid `string` model IDs — and no runtime error either; it silently inflates the session creator's BYOK bill (tier-2 firing far more often than tier-3 by design) or silently degrades tier-3's quality (if `.classification`'s cheaper model is used for the final confirmed-positive fact-check response).
**How to avoid:** A deterministic unit test asserting the resolved model ID matches `TASK_MODELS[provider][expectedTaskType]` for all 3 providers × both classifier call sites — this is Dimension 5 in `12-AI-SPEC.md`'s evaluation strategy and should be treated as a required (not optional) test given it's flagged Critical/High priority there.
**Warning signs:** None observable without the explicit test — this is the textbook definition of a silent regression.

---

## Code Examples

### Blueprint field addition (D-09) — following the `drift_reply_probability` precedent
```typescript
// packages/types/src/blueprint.ts — additive field, same pattern as drift_reply_probability
// (line 67, existing: z.number().min(0).max(1).default(0.8))
drift_detection_enabled: z.boolean().default(true),
```
`[VERIFIED: packages/types/src/blueprint.ts, read in full this session]` — `BlueprintSchema` already has 3 precedents for exactly this additive-optional-field-with-default pattern (`drift_reply_probability`, `bot_defaults`, `role_personalities`), all following the same shape.

### Role-activation gate (D-07) — exact existing pattern to copy
```typescript
// silence-scan.ts line 191 (verified) — TriggerGateNode must use the identical shape
const coachEnabled = session.bot_overrides?.coach ?? blueprint.bot_defaults?.coach ?? false
```

### `TASK_MODELS` — confirmed current shape, no changes needed for Phase 12
```typescript
// apps/api/src/lib/model-config.ts (verified current file, includes Phase 11's 'facilitation' addition)
export type TaskType = 'analysis' | 'compression' | 'categorization' | 'classification' | 'facilitation'
export const TASK_MODELS: Record<ProviderName, Record<TaskType, string>> = {
  anthropic: { analysis: 'claude-sonnet-4-6', /*...*/ classification: 'claude-haiku-4-5-20251001', facilitation: 'claude-haiku-4-5-20251001' },
  openai:    { analysis: 'gpt-5.4', /*...*/ classification: 'gpt-5.4-mini', facilitation: 'gpt-5.4-mini' },
  gemini:    { analysis: 'gemini-2.5-flash', /*...*/ classification: 'gemini-2.5-flash', facilitation: 'gemini-2.5-flash' },
} as const
```
No new `TaskType` entry is needed — COST-01/02's tier requirements (heuristic/$0, light-classifier, capable-analysis) map exactly onto the existing `classification`/`analysis` entries already present for all 3 providers.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Analyst has no live trigger (registered with `analystScorer` hardcoded to `0`) | Analyst becomes reachable via 2 new Skills (`orphan-edge`, `fact-check`), `analystScorer` extended to score based on firing-Skill context | This phase (Phase 12), per D-06 and `bot-registration.ts`'s own comment anticipating this | `runArbitration()`'s non-empty-registry path (already exercised since Phase 11) now has a real chance of the Analyst actually winning arbitration for the first time |
| `factCheckFraming` boolean seam exists in `analytics-agent.ts` but is never set by any live caller | `fact-check.ts`'s tier-3 escalation sets `config.configurable.factCheckFraming = true` when routing to `AnalyticsAgentNode` | This phase | Realizes the "discretionary seam, no live trigger wires this in Phase 11" comment already present in the code |
| `ArgGraphBuilderNode`/`argGraphBuilder → analysis` only reached via the proactive `analysis_request` trigger path | Open question this phase whether it also needs reaching from the primary human path (see CRITICAL Architecture Finding above) | Decision pending — flagged for planner | Determines whether orphan-edge/drift/moderation Skills see human-message-originated `CanvasNode`s immediately or only on the next proactive scan tick |

**Deprecated/outdated:** None applicable — this phase extends actively-maintained project infrastructure, no library deprecations relevant to Phase 12's scope were found (verified `gpt-4o`/`gemini-2.0-flash` deprecation notes in `model-config.ts`'s own header comment are already handled by the existing `TASK_MODELS` matrix, unaffected by this phase).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The exact ONNX model identifier to pass to `pipeline('feature-extraction', ...)` is `'Xenova/all-MiniLM-L6-v2'` (not a bare `'all-MiniLM-L6-v2'` or `'sentence-transformers/all-MiniLM-L6-v2'`) | Architecture Patterns, Pattern 2 | Low — a wrong model-id string fails fast and loudly at the first `pipeline()` call (404/not-found from the Hugging Face Hub), easily caught in local dev before merge; does not risk silent incorrect behavior |
| A2 | `@huggingface/transformers` lazily downloads ONNX weights over the network on first `pipeline()` call rather than bundling them, meaning offline/sandboxed CI environments need either network access or a pre-cached model directory | Package Legitimacy Audit | Medium — if CI runs sandboxed with no network egress, the first drift-redirect/orphan-edge test will hang or fail on model download; needs a CI-specific mitigation (pre-warmed cache, `TRANSFORMERS_CACHE` env pointing at a committed/prebuilt directory, or mocking the `embeddings.ts` module in unit tests the same way `agentAdapter`/`classifierAdapter` are mocked for LLM calls) |
| A3 | The two-step orphan-edge mechanism (node commits without edge → later Skill detection → follow-up edge proposal) is the intended reading of GRAPH-03/TRIGGER-04, rather than requiring a single-call batch `CanvasOp[]` schema change | Architecture Patterns, CRITICAL Architecture Finding | High if wrong — if the planner/user actually intends same-turn node+edge emission, `CanvasOpSchema`, `canvasMutationTool`, `agentNode`, `analyticsAgentNode`, and `mutation-gate.ts` all need a batch-schema refactor that is significantly larger in scope than anything described in CONTEXT.md/AI-SPEC.md. Recommend confirming this interpretation explicitly during planning (see Open Questions). |
| A4 | Vercel's default serverless function memory (unconfigured in `vercel.json`, defaults to 1024MB per Vercel's standard tier) is sufficient to load the ~90MB `all-MiniLM-L6-v2` ONNX model alongside the rest of the Node.js runtime and existing dependencies, without needing an explicit `memory` config bump in `vercel.json` | Standard Stack, Common Pitfalls #2 | Medium — if insufficient, `/invoke`'s cold-start behavior degrades or OOMs specifically when `TriggerGateNode` is reached on the human path (ties directly into the Open Question about human-path reachability); worth a manual smoke test early in implementation |

**If this table is empty:** N/A — see entries above; none are Critical-stakes claims left unconfirmed for the compliance/security-relevant decisions (D-11/D-12 keyword lists and D-16 escalation counts are explicitly already scoped to Claude's Discretion in CONTEXT.md, not asserted as fact here).

---

## Open Questions

1. **Does `TriggerGateNode` need to be reachable from the primary human-message path, not just the `analysis_request` proactive path?**
   - What we know: Today, `argGraphBuilder` (and therefore the proposed `triggerGate` insertion point) is only reached via `state.triggerType === 'analysis_request'`. The primary human path (`orchestrator → agent → mutationGate → END`) never touches it. Most `CanvasNode`s in a real session are created via the human path.
   - What's unclear: Whether Phase 12's scope intends orphan-edge/drift/moderation detection to run on EVERY human message (requiring a graph topology change beyond what AI-SPEC.md's wiring snippet shows) or only on proactive scan-triggered turns (deferring immediate detection to the next scan tick, which may be acceptable given the `silence-scan.ts` interval is already only 15s by default).
   - Recommendation: Surface this explicitly to the user/planner before implementation — it changes the size and risk profile of the graph topology change substantially. If the human path also needs `triggerGate`, the natural insertion point (verified against current `graph.ts`) is `mutationGate → triggerGate → conditional(...)` replacing `mutationGate → END`, mirroring the same "detection gate after the mutation is finalized" idea already used for the `analysis_request` path.

2. **Does GRAPH-03 require same-turn node+edge emission, or is the two-step orphan-edge mechanism (Assumption A3) the intended design?**
   - What we know: The current `CanvasOpSchema`/tool-call architecture cannot emit both in one call without a nontrivial refactor. TRIGGER-04's own wording ("has been committed" — past tense) supports the two-step reading.
   - What's unclear: Whether "every new bot-proposed CanvasNode must include at least one edge proposal in its `CanvasOp` output" (GRAPH-03's exact wording) was written with the single-call architecture in mind, or descriptively (i.e., "eventually has an edge," achieved across two calls).
   - Recommendation: Confirm the two-step reading with the user before implementation (low-cost to confirm, high-cost if wrong — see Assumption A3).

3. **Exact `moderation_count` storage shape (new migration column vs. new table)**
   - What we know: CONTEXT.md explicitly requires Postgres-backed state (not JS memory), keyed per participant per branch, and explicitly scoped to fold into Phase 13's PROFILE-01 model later.
   - What's unclear: Whether a new standalone table (`moderation_counts`, `participant_id`+`branch_id` composite key) or a new column on an existing table (e.g., `branches` or a new lightweight join table) is the better near-term shape, given it needs to be easy to fold into Phase 13's richer profile model without a painful migration.
   - Recommendation: A small standalone table (`moderation_counts: branch_id uuid, participant_id uuid/text, count int, updated_at timestamptz`) is the lowest-regret choice — it can be dropped/absorbed into Phase 13's profile table via a straightforward `INSERT INTO ... SELECT` migration later, without touching `sessions`/`branches`' existing schema. This is Claude's Discretion per CONTEXT.md, not a locked decision — flagging the recommendation, not asserting it as settled.

4. **`participant_id` identity for `moderation_count` — is there a stable, non-guest-losing identifier?**
   - What we know: `messages.author_id` has "no FK to auth.users because guests use anon tokens" per `0001_initial_schema.sql`'s own comment (cited in `silence-scan.ts`'s `COACH_AUTHOR_ID` documentation).
   - What's unclear: Whether guest participants have a stable enough identifier across a session for `moderation_count` to track them correctly (a guest reconnecting with a new anon token would reset their count to 0, undermining D-16's escalation design).
   - Recommendation: Verify at implementation time which column (`author_id`, a session-scoped guest token, or `display_name`) is actually stable for a guest across a single session before choosing the `moderation_counts` table's participant key — this was not directly verifiable from the files read this session (guest identity/session model is outside this phase's canonical_refs).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@huggingface/transformers` (npm package) | drift-redirect, orphan-edge Skills (local ONNX embedding) | ✗ (not yet installed) | — (npm registry has `4.2.0`, confirmed installable) | None needed — `npm install --workspace apps/api @huggingface/transformers` is a standard, verified-clean install (slopcheck `[OK]`) |
| Network egress at model-download time (first `pipeline()` call, any environment including CI) | ONNX model weight download (~90MB, one-time per environment/cache) | Unverified in this sandboxed research session | — | If CI runs network-sandboxed: pre-warm/commit a `TRANSFORMERS_CACHE` directory, or mock `embeddings.ts` in unit tests (same seam pattern as `agentAdapter`) rather than hitting the real pipeline in CI |
| `slopcheck` CLI | Package legitimacy verification (this research session only, not a runtime dependency) | ✓ | installed via pip this session | N/A |

**Missing dependencies with no fallback:** None — `@huggingface/transformers` install is straightforward and already verified clean.

**Missing dependencies with fallback:** Network egress for the ONNX model download in CI — has a documented fallback (cache pre-warming or test-time mocking) if it turns out to be blocked.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^2.1.9` (existing, `apps/api/vitest.config.ts` confirmed present) |
| Config file | `apps/api/vitest.config.ts` |
| Quick run command | `pnpm --filter api test -- trigger-gate skills fact-check moderation drift-redirect orphan-edge` |
| Full suite command | `pnpm --filter api test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GRAPH-03 | Ghost-edge fallback targets only `status='committed'` nodes, ranked by cosine similarity | unit | `pnpm --filter api test -- orphan-edge` | ❌ Wave 0 — new file `apps/api/src/lib/skills/orphan-edge.test.ts` |
| TRIGGER-03 | Drift fires only on sustained 3-message trailing window vs. domain centroid, respects `drift_detection_enabled=false` | unit | `pnpm --filter api test -- drift-redirect` | ❌ Wave 0 — new file |
| TRIGGER-04 | Orphan detection fires only after first 3 committed nodes; correctly identifies zero-edge nodes | unit | `pnpm --filter api test -- orphan-edge` | ❌ Wave 0 — same new file as GRAPH-03 |
| TRIGGER-05 | Fact-check tier-1 heuristic never calls an adapter; tier-2/tier-3 escalation sequencing is correct | unit + integration | `pnpm --filter api test -- fact-check` | ❌ Wave 0 — new file |
| TRIGGER-06 | Moderation heuristic pre-filter never calls an adapter; escalation tone keyed by `moderation_count` | unit | `pnpm --filter api test -- moderation` | ❌ Wave 0 — new file |
| COST-01 / COST-02 | Resolved model ID matches `TASK_MODELS[provider][expectedTaskType]` for all 3 providers × both classifier call sites; tier-1 makes zero adapter calls | unit | `pnpm --filter api test -- fact-check model-config` | ❌ Wave 0 — extend existing `model-config` test coverage if present, else new |
| D-07 (Role-activation gating) | Disabled Role's Skills never get `detect()` called; a throwing Skill doesn't block siblings | unit | `pnpm --filter api test -- trigger-gate` | ❌ Wave 0 — new file `apps/api/src/graph/nodes/trigger-gate.test.ts` (or extend `graph.test.ts` per existing zero-per-node-test-file convention — see Pattern note below) |
| Graph topology (Pitfall 3/4) | `TriggerGateNode` → Role-node routing correctness, no fixed+conditional edge fan-out bug | integration | `pnpm --filter api test -- graph` | ✓ `apps/api/src/graph/graph.test.ts` exists — extend, per this codebase's established "zero per-node unit test files, extend `graph.test.ts`'s `describe` blocks instead" convention (11-PATTERNS.md, verified as the actual convention followed in Phase 11) |

### Sampling Rate
- **Per task commit:** `pnpm --filter api test -- <relevant-file-substring>`
- **Per wave merge:** `pnpm --filter api test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `apps/api/src/lib/skills/drift-redirect.test.ts` — covers TRIGGER-03
- [ ] `apps/api/src/lib/skills/orphan-edge.test.ts` — covers GRAPH-03, TRIGGER-04
- [ ] `apps/api/src/lib/skills/fact-check.test.ts` — covers TRIGGER-05, COST-01/02 (fact-check portion)
- [ ] `apps/api/src/lib/skills/moderation.test.ts` — covers TRIGGER-06
- [ ] `apps/api/src/lib/embeddings.test.ts` — singleton-caching behavior (Pitfall 2), cosine similarity correctness — consider mocking `pipeline()` to avoid a real ~90MB download in CI (see Environment Availability)
- [ ] Extend `apps/api/src/graph/graph.test.ts` with new `describe` blocks for `TriggerGateNode` routing (per this codebase's established convention of extending the one integration test file rather than creating per-node test files)
- [ ] `apps/api/src/lib/moderation-count.test.ts` — D-16 persistence read/write, mocked `SupabaseClient` per existing `bot-arbitrator.test.ts`/`auto-freeze.test.ts` convention

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Unchanged — Phase 12 adds no new auth surface |
| V3 Session Management | No | Unchanged |
| V4 Access Control | Partial — yes for any new route | If a new Role-toggle or Skill-config route is added, it MUST copy the verbatim `session.creator_id !== user.id → 403` check already established in `apps/api/src/routes/personas.ts` (verified pattern, flagged as "must-copy, not a design choice" by `11-PATTERNS.md`) |
| V5 Input Validation | Yes | Zod `.safeParse()` for `SkillDetectionResultSchema` and the new `factCheckClassificationTool` tool-output shape, following the exact `arg-graph-builder.ts` two-schema-split + bounded-retry pattern already proven in this codebase |
| V6 Cryptography | No | No new crypto surface this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via participant-authored content spliced into a Skill's `buildPromptGuidance()` output (fact-check claim citation, orphan-edge node label) | Tampering | The existing WR-06 pattern (`escapeUntrustedText()` + `<<<...DATA>>>`-delimited framing, verified present and in active use in `bot-context.ts`'s `summarizeArgGraph()`) is **mandatory, not optional**, for any Phase 12 `buildPromptGuidance()` that interpolates message/argGraph/node-label content — this is explicitly called out as Dimension 7 (Critical priority) in `12-AI-SPEC.md`'s evaluation strategy |
| Silent cost/billing regression via wrong `TASK_MODELS` tier resolution | Tampering (of cost/behavior, not data) | Explicit unit-test assertion per provider × task-type combination (see Common Pitfalls #7 and Validation Architecture's COST-01/02 row) — no type system protection exists for this, so it must be enforced by test |
| Moderation false-positive causing public embarrassment of an innocent participant | (Interpersonal harm — not a classic STRIDE category, but flagged Critical in AI-SPEC.md Section 1b) | D-16's first-offense-gentle-tone-lock (deterministic lookup keyed by `moderation_count`, not LLM-decided) bounds severity; native-speaker keyword-list review bounds frequency |
| Ambiguous bot message authorship (`author_id`) for a new Skill-fired message, repeating the Phase 11 "Open decision" already flagged in `11-PATTERNS.md`'s Shared Patterns section | Repudiation | Follow the exact precedent already set by `silence-scan.ts`'s `COACH_AUTHOR_ID` dedicated sentinel UUID (`'00000000-0000-0000-0000-000000000b01'`) — a Phase 12 message fired by the Analyst via a Skill should use an equivalent dedicated `ANALYST_AUTHOR_ID` sentinel, not `session.creator_id` or the generic `SYSTEM_AUTHOR_ID` |

---

## Sources

### Primary (HIGH confidence — direct codebase reads this session)
- `apps/api/src/graph/graph.ts`, `apps/api/src/graph/state.ts`, `apps/api/src/graph/nodes/{orchestrator,agent,arg-graph-builder,mutation-gate,facilitation-agent,analytics-agent}.ts` — read in full
- `apps/api/src/lib/{model-config,bot-context,bot-registration,silence-scan,silence-gate}.ts` — read in full
- `apps/api/src/routes/ai.ts` (lines 330-660, canvas persistence logic) — read in full for this range
- `packages/types/src/{canvas,canvas-tool,blueprint,bot,persona}.ts` — read in full
- `apps/api/package.json` — confirmed pinned versions, confirmed `@huggingface/transformers` absent
- `supabase/migrations/` directory listing — confirmed `0014_personalities.sql` is latest, not `0012` as CONTEXT.md's canonical_refs states (stale reference — see Migration Sequencing note below)
- `npm view @huggingface/transformers version|deprecated|repository.url` — confirmed `4.2.0`, not deprecated, official repo
- `slopcheck install @huggingface/transformers` — confirmed `[OK]`

### Secondary (MEDIUM confidence — WebSearch, cross-verified against general library behavior, not this project's exact usage)
- `@huggingface/transformers.js` `pipeline('feature-extraction', ...)` usage shape, `{pooling:'mean', normalize:true}` options, `Xenova/all-MiniLM-L6-v2` as the common ONNX-converted model id — [huggingface/skills EXAMPLES.md](https://github.com/huggingface/skills/blob/main/skills/transformers-js/references/EXAMPLES.md), [Xenova/all-MiniLM-L6-v2 model card](https://huggingface.co/Xenova/all-MiniLM-L6-v2), [philna.sh Node.js embeddings walkthrough](https://philna.sh/blog/2024/09/25/how-to-create-vector-embeddings-in-node-js/)

### Tertiary (LOW confidence — noted, not treated as authoritative)
- None used as a basis for a specific recommendation in this document — all WebSearch findings above were cross-checked against at least 2 independent sources agreeing on the same API shape.

### Prior phase artifacts (project-internal, treated as HIGH confidence for this project's own conventions)
- `.planning/phases/12-graph-coherence-extended-triggers/12-AI-SPEC.md` — full document read; code snippets cross-verified against the actual current source files this session and found accurate/implementation-ready, with the two exceptions flagged in "CRITICAL Architecture Finding" and "Open architecture question" above (both are genuine gaps in AI-SPEC.md's coverage, not contradictions of it)
- `.planning/phases/11-personality-basic-triggers/11-CONTEXT.md`, `11-PATTERNS.md` — full documents read
- `.planning/STATE.md`, `.planning/REQUIREMENTS.md` — full documents read

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@huggingface/transformers` version/legitimacy directly verified via npm + slopcheck; `TASK_MODELS`/LangGraph versions read directly from `package.json`
- Architecture (Skill contract, TriggerGateNode wiring): HIGH — cross-verified against actual current source, not just AI-SPEC.md's snippets
- Architecture (CanvasOp two-step mechanism, human-path reachability): MEDIUM — these are genuine open design questions this research surfaced, not settled facts; flagged explicitly for planner/user confirmation
- Pitfalls: HIGH — all sourced from either direct code reading (this session) or the AI-SPEC.md's own cross-verified pitfall list (which itself cites specific line numbers in real files)
- Exact cosine-similarity/escalation-count thresholds: LOW/Claude's Discretion per CONTEXT.md — intentionally not asserted as settled values in this document

**Research date:** 2026-07-15
**Valid until:** 2026-08-14 (30 days — stable internal codebase conventions; re-verify `@huggingface/transformers` version and npm registry state if implementation is delayed materially past this window)
