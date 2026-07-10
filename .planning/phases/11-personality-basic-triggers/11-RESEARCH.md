# Phase 11: Personality + Basic Triggers - Research

**Researched:** 2026-07-10
**Domain:** LangGraph multi-agent routing (TypeScript), Supabase-backed persona data model, proactive bot triggers
**Confidence:** HIGH (mechanics, existing-code integration) / MEDIUM (new schema shape choices — flagged explicitly below)

## Summary

Phase 11 extends an **already-implemented** Phase 10 infrastructure layer (silence gate, bot arbitrator, budget guard, dual thread_id, `GraphStateAnnotation.argGraph`/`triggerMetadata`) — all of it verified present and matching Phase 10's CONTEXT.md decisions in the current codebase, despite `STATE.md` showing a stale "Not started" status for Phase 10. The planner can treat Phase 10 primitives as stable, tested dependencies to call, not build.

A `11-AI-SPEC.md` already exists for this phase (produced by `/gsd:ai-integration-phase`) and contains a Context7-verified LangGraph quick reference, a full conditional-START-edge code sample, model/token budget guidance, and a Zod tool-use extraction pattern for the argGraph. That document is HIGH confidence for LangGraph mechanics and should be the planner's primary implementation template. **This RESEARCH.md's value-add is what AI-SPEC.md could not know without reading the live repository: three concrete conflicts between AI-SPEC.md's proposed code and code that Phase 10 already shipped, plus a gap between AI-SPEC.md's routing sample and ROADMAP's success criterion 2.** These are documented below and must be resolved during planning, not discovered during implementation.

**Primary recommendation:** Follow `11-AI-SPEC.md` Section 3 (Framework Quick Reference) and Section 4 (Implementation Guidance) as the LangGraph implementation template, but (1) extend the **existing** `packages/types/src/bot.ts` `ArgNodeSchema`/`ArgEdgeSchema` — do NOT create a new `arg-graph.ts` file with a competing schema, (2) add a `facilitation` entry to `TASK_MODELS` for all three providers, (3) number the new migration `0014_*.sql` (not `0012`/`0009` as referenced in various docs — `0013_revoke_public_execute.sql` is the latest on disk), and (4) make `routeFromStart`'s error path explicit rather than defaulting unrecognized `trigger_type` values silently into the human-message `orchestrator` path.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Coach/Analyst behavioral discipline (Role rules) | API / Backend (LangGraph node code) | — | Roles are fixed code per D-01 — belongs in `apps/api/src/graph/nodes/` |
| Personality voice/tone data | Database / Storage (Supabase table) | API / Backend (prompt composition) | D-04: real Supabase table, not hardcoded TS; API reads it and appends to prompt per D-03 |
| Conditional START-edge routing | API / Backend (LangGraph graph topology) | — | Pure server-side graph wiring; no client involvement |
| argGraph state | Database / Storage (PostgresSaver checkpoint) | API / Backend (ArgGraphBuilderNode writes it) | BOT-05: must survive serverless cold starts — checkpoint, not process memory |
| Silence-scan interim loop | API / Backend (standalone Node server, `setInterval`) | Database / Storage (reads `messages`/`branches` via Supabase) | D-15: must run on long-lived `server.ts` process, not Vercel serverless (interval state doesn't survive cold starts) |
| Coach message delivery | Database / Storage (direct `messages` insert) | Browser / Client (SSE-fallback/polling picks it up) | D-16: no active HTTP request to stream over for a proactive fire |
| Per-session Role toggle (Coach/Analyst on/off) | Browser / Client (`CreatorControls.tsx` Sheet UI) | API / Backend (`personas.ts`-style toggle route) | D-09: reuses existing "Analistas activos" drawer pattern |
| Blueprint→Role→default-Personality link | Database / Storage (Blueprint `definition` jsonb or new column) | API / Backend (resolved at session/graph-invocation time) | D-05, D-11: Blueprint is the source of truth for defaults, not a hardcoded map |

## Standard Stack

### Core (all already installed — verified against `apps/api/package.json`)

| Library | Version (installed) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@langchain/langgraph` | 1.4.7 `[VERIFIED: apps/api/package.json]` | StateGraph, conditional edges, Annotation | Already the graph engine for this codebase since Phase 6; Phase 11 extends it, does not introduce it |
| `@langchain/langgraph-checkpoint-postgres` | 1.0.4 `[VERIFIED: apps/api/package.json]` | PostgresSaver checkpointer | Already wired via `langgraph-checkpointer.ts` singleton |
| `@anthropic-ai/sdk` | 0.102.0 `[VERIFIED: apps/api/package.json]` | Underlying Claude API client (never imported directly by nodes — see Don't Hand-Roll) | Accessed only via `createAdapter()` / `AnthropicAdapter` |
| `zod` | already a workspace dep (used throughout `packages/types/src/*.ts`) `[VERIFIED: packages/types/src/bot.ts, blueprint.ts]` | Schema + type co-location, `safeParse` gate on tool-use output | Established project-wide convention — every type in `@panelito/types` has a co-located Zod schema |
| `@langfuse/langchain`, `@langfuse/otel`, `@langfuse/tracing` | 5.9.1 `[VERIFIED: apps/api/package.json]` | Tracing — automatically covers new nodes via the existing per-request `CallbackHandler` | No new instrumentation code needed for Phase 11 nodes |

### Supporting

No new supporting libraries are required for Phase 11. All Zod/LangGraph/Supabase primitives needed are already project dependencies.

### Alternatives Considered

Not applicable — this phase extends an existing, already-selected stack (LangGraph + Anthropic SDK + Supabase). See `11-AI-SPEC.md` Section 2 for the full framework-selection rationale (LangGraph vs CrewAI vs OpenAI Agents SDK vs bare LangChain), which remains valid and is not re-litigated here.

**Installation:** None required — no new packages.

## Package Legitimacy Audit

**Not applicable.** Phase 11 introduces zero new external npm packages. All libraries used (`@langchain/langgraph`, `@anthropic-ai/sdk`, `zod`, `@langfuse/*`) are already installed and verified in `apps/api/package.json`/`packages/types/package.json`. No `slopcheck` run was needed. If the planner's task breakdown discovers a need for any new package (e.g., a UUID helper — unlikely, `crypto.randomUUID()` is Node built-in), route it through the Package Legitimacy Gate protocol at that time.

## Critical Findings: Where AI-SPEC.md's Proposed Code Conflicts With Shipped Phase 10 Code

These three findings were discovered by reading the actual repository state, not by reasoning about the domain. They are the most important content in this document — `11-AI-SPEC.md`, which was written by an agent without direct repo access at authoring time, proposes code that either duplicates or silently diverges from what Phase 10 already shipped.

### Finding 1 — ArgNode/ArgEdge already exist in `packages/types/src/bot.ts` with a DIFFERENT shape than AI-SPEC.md proposes

`packages/types/src/bot.ts` (shipped in Phase 10, exported from `index.ts`, and **already imported by `apps/api/src/graph/state.ts`**'s `GraphStateAnnotation.argGraph` field) defines:

```typescript
// packages/types/src/bot.ts — SHIPPED, live in GraphStateAnnotation right now
export const ArgNodeSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),          // e.g. 'claim', 'evidence', 'rebuttal'
  label: z.string(),
  branch_id: z.string().uuid(),
});

export const ArgEdgeSchema = z.object({
  id: z.string().uuid(),
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  relation: z.string(),      // e.g. 'SUPPORTS', 'CONTRADICTS'
});
```

`11-AI-SPEC.md` Section 4b.1 proposes creating a **new** `packages/types/src/arg-graph.ts` file with a **different** schema for the same concept:

```typescript
// 11-AI-SPEC.md's proposal — NOT what state.ts currently imports
export const ArgNodeSchema = z.object({
  id: z.string(),
  claim: z.string(),
  speaker: z.string(),
  message_id: z.string(),
  confidence: z.number().min(0).max(1),
  node_type: z.enum(['claim', 'evidence', 'counterargument', 'question']),
})

export const ArgEdgeSchema = z.object({
  from_id: z.string(),
  to_id: z.string(),
  relation: z.enum(['supports', 'contradicts', 'questions', 'extends']),
})
```

These are two incompatible schemas sharing the same export names (`ArgNodeSchema`, `ArgNode`). Creating both would either (a) cause a duplicate-export collision if both land in `index.ts`, or (b) silently create two parallel, never-reconciled types if the new file uses different names — and `GraphStateAnnotation.argGraph` is typed against `bot.ts`'s version, so anything the new `ArgGraphBuilderNode` writes there **must** conform to `bot.ts`'s `ArgNode`/`ArgEdge`, not AI-SPEC's proposal.

**Recommendation for the planner:** Extend the existing `packages/types/src/bot.ts` schema additively — do not create `arg-graph.ts`. Concretely:
- `ArgNodeSchema.type` already covers AI-SPEC's `node_type` concept (rename intent, not new concept) — reconcile enum values (`'rebuttal'` vs `'counterargument'`, `'evidence'`, `'claim'`, add `'question'` if needed) into one canonical set.
- Add the fields GRAPH-04 and the citation requirement (PERSONA-02) actually need but `bot.ts` currently lacks: a way to reference the source message (`bot.ts` has none — AI-SPEC's `message_id` is necessary for the Analyst's "cites a specific prior message" contract) and a `speaker`/display-name field (also absent from `bot.ts`, also necessary for the same contract). A `confidence` field is optional/nice-to-have but not required by any locked decision — Claude's discretion whether to add it.
- `ArgEdgeSchema.source_id`/`target_id` are typed `z.string().uuid()`. **This is a real constraint the tool-use extraction step must satisfy** — see Finding 2 below.
- Keep `branch_id` on `ArgNode` (already required by `bot.ts` and consistent with how `canvas_nodes`/`canvas_edges` scope everything by branch).

### Finding 2 — LLM-generated tool-use output cannot reliably satisfy `z.string().uuid()` fields

`ArgNodeSchema.id` and `ArgEdgeSchema.source_id`/`target_id` are typed as `z.string().uuid()` (RFC 4122 v4 UUID format). Claude's tool-use JSON output for a field like `id` will typically be a short reference string (`"n1"`, `"claim-1"`) unless explicitly instructed and constrained — LLMs do not reliably emit compliant v4 UUID strings on their own, and constraining the model to do so wastes output tokens for no benefit. `[ASSUMED — based on general LLM structured-output behavior, not empirically tested against this specific extraction prompt]`

**Recommendation:** Design the `argGraphExtractionTool` (the Anthropic tool schema, a plain JSON schema — NOT the same object as `ArgNodeSchema`) to accept short opaque string IDs from the model (e.g. `id: string`, `source_ref: string`, `target_ref: string`), then **server-side**, after `ArgGraphSchema.safeParse` validates the *shape*, map those short refs to real UUIDs via `crypto.randomUUID()` (or reuse an existing UUID if the ref matches a prior node already in `state.argGraph`) before merging into `GraphState.argGraph`. This mirrors the existing `agent.ts` pattern where the tool-use schema (`canvasMutationTool`, a raw JSON schema) is a distinct object from the Zod validation schema (`CanvasOpSchema`) applied *after* the tool call returns. Do not reuse `ArgNodeSchema`/`ArgEdgeSchema` directly as the Anthropic tool `input_schema` if their `id`/`source_id`/`target_id` fields require `.uuid()` — either relax those fields in a separate tool-input Zod schema, or perform the ID-substitution step before `safeParse`.

### Finding 3 — Migration numbering is stale in every upstream document

`10-PATTERNS.md` already documents this exact class of error occurring once in Phase 10 (`0009` proposed in CONTEXT.md, actual number ended up `0012`). It has recurred: `11-CONTEXT.md`'s canonical refs and `11-AI-SPEC.md` both reference `0012_bot_infrastructure.sql` as "most recent." **The actual most recent migration on disk is `0013_revoke_public_execute.sql`.** `[VERIFIED: ls supabase/migrations/]`

**Recommendation:** The new personalities table + any Blueprint schema extension for Phase 11 goes in `supabase/migrations/0014_personalities.sql` (or similarly named — exact filename is Claude's discretion, but the number must be `0014`). Re-verify this number immediately before executing the migration-creation task, since other work may land migrations between research and execution.

## Additional Non-Obvious Findings From Live Codebase Reading

### Finding 4 — `TASK_MODELS` has no `facilitation` tier; it must be added for all three providers, not just `anthropic`

`apps/api/src/lib/model-config.ts` types `TASK_MODELS` as `Record<ProviderName, Record<TaskType, string>>` — a **fully required** matrix (`ProviderName` = `anthropic | openai | gemini`, `TaskType` = `analysis | compression | categorization | classification`). Adding a `facilitation` value to `TaskType` without adding a corresponding entry for **all three** providers is a TypeScript compile error, not just an Anthropic-only oversight. `[VERIFIED: apps/api/src/lib/model-config.ts]`

Existing precedent confirms the model ID to reuse for Anthropic's `facilitation` tier is **already in the file**: `compression`, `categorization`, and `classification` all already point to `claude-haiku-4-5-20251001` for `anthropic`. Reuse that same ID for `facilitation` — no new model ID needs to be sourced or verified. For `openai` reuse `gpt-5.4-mini`; for `gemini` reuse `gemini-2.5-flash` (both already used for the same fast/light-tier task types in the file).

### Finding 5 — `bot_cooldowns` (the explicit "follow this precedent" pattern cited in CONTEXT.md for D-11) is a TypeScript-only extension, not an actual Blueprint schema field

`11-CONTEXT.md` D-11 says to "follow the precedent of `bot_cooldowns` as an optional Blueprint extension" for the new `bot_defaults` map. Reading the actual precedent: `bot-arbitrator.ts` defines

```typescript
type BlueprintWithCooldowns = Blueprint & { bot_cooldowns?: Record<string, number> }
```

purely as a local TypeScript intersection type at the point of use — `bot_cooldowns` does **not** appear anywhere in `packages/types/src/blueprint.ts` (`BlueprintSchema`), nor in the seeded `debate-strategy-v1` Blueprint JSON in `0008_nsai_foundation.sql`, nor in any migration. It is accessed purely via optional chaining (`bp.bot_cooldowns?.[winnerId] ?? DEFAULT_COOLDOWN_SECONDS`) and silently falls back to a hardcoded default when absent — which it always currently is. `[VERIFIED: grep across supabase/ and packages/types/]`

**This is a real decision point for the planner, not a settled pattern:** should `bot_defaults` (D-11) follow the same "TS-only, always-optional, silently-falls-back" pattern (cheap, but the Blueprint never actually carries this data in the DB — every session gets the same hardcoded default forever), or should it be added as a first-class field in `BlueprintSchema` + the seeded Blueprint JSON (more correct given that D-05/D-10 explicitly require "the list of available bots and their default on/off state come from the active Blueprint," which cannot be true if the field is never populated in the DB)? Given that D-10 is a locked decision requiring Blueprint-sourced defaults (not a hardcoded fallback), **the `bot_cooldowns`-style TS-only pattern does not satisfy D-10 for `bot_defaults`** — the planner should add `bot_defaults` (and the Role→default-Personality map) as real fields in `BlueprintSchema` and populate them in the `debate-strategy-v1` seed data, not merely as an optional TS intersection type.

### Finding 6 — `routeFromStart`'s AI-SPEC.md sample code does not fully satisfy ROADMAP success criterion 2

ROADMAP.md Phase 11 success criterion 2: *"a misconfigured routing condition does not silently default to either — it errors with a clear log."*

`11-AI-SPEC.md`'s sample `routeFromStart` implementation collapses two very different cases into one fallback:
1. **Legitimate case:** a human message with no `trigger_type` set at all (`undefined`) — this should route to `orchestrator`, no error.
2. **Bug case:** a `triggerMetadata.trigger_type` that is set but doesn't match any known value (e.g. a typo, a future trigger type introduced in Phase 12 without updating this function, a corrupted checkpoint) — the sample code's `if/if/else` chain treats this **identically** to case 1: it falls through to `return 'orchestrator'` with only a `console.info` log.

This does not "error with a clear log" for case 2 — it silently (from the log's perspective, `console.info` is not an error-level signal) does the same thing as the legitimate no-trigger path. `[Author's own analysis of the provided sample code cross-referenced against ROADMAP.md; no external source]`

**Recommendation:** `routeFromStart` must distinguish `triggerMetadata.trigger_type === undefined` (valid — human path) from `triggerMetadata.trigger_type` being a **defined but unrecognized** string (a bug). For the latter, use `console.error` (not `console.info`) and consider whether LangGraph conditional-edge functions propagate thrown errors the same way node functions do (AI-SPEC.md's Pitfall 5 confirms **nodes** don't get automatic try/catch — this should be verified for the conditional-edge router function specifically before deciding between "throw" and "log + safe fallback" as the error-handling strategy; `[ASSUMED equivalent behavior, not independently confirmed against LangGraph JS source for the edge-router case specifically]`). At minimum, the unrecognized-trigger-type case must emit a distinguishable `console.error` log line so success criterion 2 is testably satisfied (a plan verification step can grep test logs for this).

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────┐
                         │  server.ts (long-lived Node) │
                         │  startSilenceScanLoop() [NEW]│  ← setInterval, same shape as
                         │  alongside startAutoFreeze-  │    startAutoFreezeTracker
                         │  Tracker()                   │
                         └──────────────┬───────────────┘
                                         │ every SCAN_INTERVAL_MS:
                                         │ checkSilenceGate() per active branch
                                         ▼
                         ┌───────────────────────────────┐
                         │ checkSilenceGate() [Phase 10,  │
                         │ EXISTING — call, don't rebuild]│
                         └──────────────┬──────────────────┘
                          passed:true   │
                                        ▼
                         ┌───────────────────────────────┐
                         │ runArbitration() [Phase 10,    │
                         │ EXISTING — Coach/Analyst        │
                         │ registerBot() here in Phase 11]│
                         └──────────────┬──────────────────┘
                          winner: 'coach'│
                                        ▼
      ┌─────────────────────────────────────────────────────────────┐
      │  graph.invoke({ triggerMetadata:{trigger_type:'silence_gate'}│
      │  ...}, {configurable:{thread_id:`bot-${branchId}`, ...}})    │
      │                                                                │
      │   START ──(conditional: routeFromStart)──┬──► facilitation    │
      │                                            ├──► argGraphBuilder│
      │                                            │      → analysis   │
      │                                            └──► orchestrator   │
      │                                                 (human path,   │
      │                                                  unchanged)    │
      └───────────────────────┬─────────────────────────────────────┘
                               │ FacilitationAgentNode returns
                               │ { triggerMetadata: {...} } — partial state
                               ▼
                 ┌───────────────────────────────┐
                 │ Direct INSERT into `messages`  │ ← D-16: no SSE (no active
                 │ table (role:'assistant',       │   HTTP request for a
                 │ branch_id, display_name=       │   proactive fire)
                 │ Personality.display_name)      │
                 └──────────────┬──────────────────┘
                                │ .channel(`session:${id}`).httpSend('new_message', row)
                                ▼
                 ┌───────────────────────────────┐
                 │ Clients: Supabase Realtime OR  │ ← existing SSE-fallback/
                 │ SSE-fallback/polling (WSL2-    │   polling pattern already
                 │ dead-Realtime degradation)     │   used elsewhere
                 └───────────────────────────────┘
```

Human message path (unchanged): `START → orchestrator → (agent | driftReply | END)`. The new conditional START edge in `graph.ts` REPLACES the existing fixed `.addEdge(START, 'orchestrator')` — both cannot coexist (see AI-SPEC.md Pitfall 2, HIGH confidence, this is standard LangGraph behavior).

### Recommended Project Structure

Matches `11-AI-SPEC.md` Section 3's "Recommended Project Structure" exactly — verified consistent with the actual existing `apps/api/src/graph/nodes/` directory contents (`agent.ts`, `orchestrator.ts`, `mutation-gate.ts`, `drift-reply.ts` all confirmed present). No changes to that structure recommendation; not repeated here to avoid duplication. New files: `apps/api/src/graph/nodes/facilitation-agent.ts`, `analytics-agent.ts`, `arg-graph-builder.ts`; `apps/api/src/lib/silence-scan.ts`; `packages/types/src/personality.ts` (new); extend `packages/types/src/bot.ts` (do not create `arg-graph.ts` — see Finding 1).

### Pattern 1: Four-step node skeleton (established, all 4 existing nodes follow it)

**What:** Every LangGraph node in this codebase — `agentNode`, `orchestratorNode`, `mutationGateNode`, `driftReplyNode` — follows: (1) read deps from `config.configurable` with `as X | undefined` casts, fail fast with `console.error('[nodename] ...')` + `return {}` if a required dep is missing; (2) build the system prompt as a pure function (`buildXSystemPrompt`) separate from the node body, for testability; (3) call `adapter.stream()` inside try/catch, never `throw`; (4) return a `Partial<GraphState>`, never write to Supabase/DB directly from node body.
**When to use:** Every new node in this phase — `facilitationAgentNode`, `analyticsAgentNode`, `argGraphBuilderNode` — must match this exact shape for consistency with existing code review expectations (`code_review_depth: standard` is enabled per `.planning/config.json`).
**Example:** See `apps/api/src/graph/nodes/agent.ts` lines 87–182 (full node body, read in this research session) — `11-AI-SPEC.md` Section 4's `facilitation-agent.ts` sample already follows this shape correctly.

### Pattern 2: Test-seam adapters via `config.configurable`

**What:** Every node accepts an optional named adapter override (`agentAdapter`, `classifierAdapter`, `driftReplyAdapter`) so unit tests can inject a deterministic mock `AIProvider` without touching `createAdapter()`/real API keys.
**When to use:** New nodes need `facilitationAdapter`, `analyticsAdapter`, `argGraphAdapter` (or similar) seams, consistent with the existing three.
**Example:** `[CITED: apps/api/src/graph/nodes/agent.ts lines 93-96]` — `const agentAdapter = config?.configurable?.agentAdapter as AIProvider | undefined`.

### Pattern 3: Graph-level testing via `MemorySaver` + mock adapters (no per-node unit test files exist)

**What:** The codebase currently has **zero** per-node unit test files (`agent.test.ts`, `orchestrator.test.ts`, `mutation-gate.test.ts`, `drift-reply.test.ts` do not exist). Testing happens at the **graph** level: `graph.test.ts` builds a full `createGraph(new MemorySaver())`, invokes it with mock adapters for each seam, and asserts on the final merged state across all 5 D-11 paths. A separate `graph.integration.test.ts` exercises the same graph against a real `PostgresSaver` + Langfuse, gated behind `SUPABASE_DIRECT_URL`/`LANGFUSE_*` env vars (skips cleanly in CI without them).
**When to use:** Phase 11 should very likely extend `graph.test.ts` with new describe blocks for the 3 new conditional-START paths (facilitation / analysis+argGraphBuilder / orchestrator-fallback) rather than introduce a new per-node testing convention, for consistency. `[VERIFIED: apps/api/src/graph/graph.test.ts, graph.integration.test.ts — read in full this session]`
**Example:** `apps/api/src/graph/graph.test.ts` lines 146–164 (`makeConfig` helper) is the direct template for a new `makeConfig` variant accepting `facilitationAdapter`/`analyticsAdapter`/`argGraphAdapter` plus a `triggerMetadata` initial-state field.

### Pattern 4: Direct message insert + Realtime broadcast (D-16's exact template)

**What:** `apps/api/src/routes/ai.ts` lines 428–454 insert an assistant message directly into `messages` (fields: `session_id`, `author_id`, `display_name`, `parent_id: null`, `path_id`, `branch_id`, `role: 'assistant'`, `content`, `canvas_snapshot_state: null`), then broadcast via `supabase.channel(\`session:${sessionId}\`).httpSend('new_message', row)` wrapped in a `.catch()` (never blocks on broadcast failure).
**When to use:** The silence-scan loop's Coach message insert (D-16) should reuse this exact shape. Open question for the planner: what `author_id` to use — the existing pattern uses `session.creator_id` for AI messages (not a dedicated bot/system UUID), which is a slightly surprising but established precedent; alternatively reuse `SYSTEM_AUTHOR_ID` from `sessions-helpers.ts` (currently used only for freeze/unfreeze/close system messages, always with `display_name: 'system'`, `role` left at its default `'user'` — **not** `'assistant'**, so this ID is not a drop-in match either). Recommend a **new dedicated bot author strategy** be decided explicitly in planning rather than silently reusing either existing convention, since neither existing precedent (`creator_id`-as-author, or `SYSTEM_AUTHOR_ID`-as-`role:user`) cleanly fits "Coach as `role: assistant` speaker with its own `display_name`."
**Example:** `[CITED: apps/api/src/routes/ai.ts lines 428-454]`, `[CITED: apps/api/src/lib/sessions-helpers.ts lines 44-60]`.

### Anti-Patterns to Avoid

- **Creating a competing `arg-graph.ts` type file:** See Finding 1. Extend `packages/types/src/bot.ts` instead.
- **Leaving both `.addEdge(START, 'orchestrator')` and `.addConditionalEdges(START, routeFromStart, ...)` in `graph.ts`:** The fixed edge silently wins; the conditional router is never called. `[CITED: 11-AI-SPEC.md Pitfall 2, itself sourced from LangGraph JS official docs via Context7]`
- **Using `ArgNodeSchema`/`ArgEdgeSchema` directly as the Anthropic tool `input_schema`:** Their `.uuid()`-typed ID fields will not reliably validate against raw model output. See Finding 2.
- **Treating `bot_cooldowns`'s "always falls back to hardcoded default" pattern as the template for `bot_defaults`:** It does not satisfy D-10's requirement that Blueprint be the actual source of truth. See Finding 5.
- **Hardcoding a hardcoded model string** in `facilitationAgentNode` (e.g. `'claude-haiku-4-5-20251001'` inline): must route through `TASK_MODELS[providerName].facilitation` per COST-01 and the established convention in every other node.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Silence detection (elapsed-time + typing check) | A new polling/timer mechanism | `checkSilenceGate()` from `apps/api/src/lib/silence-gate.ts` | Already fully built, tested (BOT-03), and handles the WSL2 Presence-channel-dead fallback correctly |
| Bot-vs-bot arbitration / "who fires" | Ad hoc `if` checks per trigger | `registerBot()` / `runArbitration()` from `apps/api/src/lib/bot-arbitrator.ts` | Already provides atomic DB-backed locking (BOT-02); Phase 11 just needs to call `registerBot('coach', scorerFn)` at module load |
| Token budget / circuit breaker | A new in-memory counter | `checkBotBudget()` from `apps/api/src/lib/bot-budget.ts` | Already fail-closed, already atomic via `check_and_record_bot_budget` RPC (BOT-01) |
| Direct Anthropic/OpenAI/Gemini SDK calls | `import Anthropic from '@anthropic-ai/sdk'` inside a node | `createAdapter(providerName, plaintextKey)` from `apps/api/src/lib/adapter-factory.ts` | Every existing node follows this; breaking it breaks multi-provider support and the test-seam pattern uniformly |
| Structured LLM output validation | Manual JSON.parse + hand-rolled field checks | Zod `safeParse` against a co-located schema (see `agent.ts`'s `CanvasOpSchema.safeParse` pattern) | Established project-wide; fail-silent + logged, never throws |

**Key insight:** Nearly everything Phase 11 needs at the infrastructure layer (silence detection, arbitration, budget guard, checkpointing, adapter abstraction) was deliberately built in Phase 10 specifically so Phase 11 would not need to hand-roll it. The actual net-new engineering surface of Phase 11 is narrower than it first appears: two new LangGraph nodes with prompt-composition logic, one new extraction node, one new Supabase table, one new interim scan loop, and Blueprint/UI wiring for toggles.

## Common Pitfalls

### Pitfall 1: ArgNode/ArgEdge schema drift between `packages/types/src/bot.ts` and any new extraction/prompt code
**What goes wrong:** Code that builds the Coach/Analyst prompt context from `state.argGraph` assumes fields (`speaker`, `message_id`) that don't exist on the currently-shipped `ArgNode` type, causing either a TypeScript compile error or silent `undefined` interpolation into prompts (e.g. "undefined mencionó que...").
**Why it happens:** `11-AI-SPEC.md` was authored without reading the live `bot.ts` file (see Finding 1).
**How to avoid:** Decide the final `ArgNode`/`ArgEdge` shape once, in planning, before writing any node code that reads `state.argGraph` fields.
**Warning signs:** TypeScript errors referencing `Property 'speaker' does not exist on type 'ArgNode'`.

### Pitfall 2: `TASK_MODELS` compile break from a partial provider matrix
**What goes wrong:** Adding `facilitation` to the `TaskType` union but only populating `TASK_MODELS.anthropic.facilitation` (forgetting `openai`/`gemini`) is a TypeScript error against the `Record<ProviderName, Record<TaskType, string>>` type — this will fail the build, not just silently misbehave.
**Why it happens:** Easy to focus only on the Anthropic path since that's the only provider actually exercised by BYOK testing in this phase.
**How to avoid:** Add all three provider entries in the same edit (see Finding 4 for exact model IDs to reuse — all already used elsewhere in the file for other fast-tier tasks).
**Warning signs:** `tsc` failure on `model-config.ts` referencing missing property `facilitation`.

### Pitfall 3: Conditional START edge silently dropping invocations (LangGraph-native pitfall, HIGH confidence)
**What goes wrong:** If `routeFromStart` can return a string not present as a key in the `addConditionalEdges` pathsMap, LangGraph does not throw — the entire invocation is silently dropped (no error, no state update, `graph.invoke()` resolves with whatever partial state existed at START).
**Why it happens:** LangGraph JS's conditional-edge pathsMap lookup has no runtime exhaustiveness check.
**How to avoid:** Enumerate every possible `routeFromStart` return value as a pathsMap key, including an explicit handling strategy for the "unrecognized trigger_type" case (see Finding 6 — this is also where ROADMAP success criterion 2 must be satisfied).
**Warning signs:** A proactive bot invocation completes with no `messages`/`argGraph` change and no error logged.
`[CITED: 11-AI-SPEC.md Pitfall 1, sourced via Context7 from LangGraph JS official docs]`

### Pitfall 4: Personality voice bleeding into Role behavioral output (D-03 violation)
**What goes wrong:** If Personality voice text is concatenated into the system prompt *before* Role behavioral rules, or interleaved with them, the model tends to weight the more recent (Personality) instructions more heavily, causing the Coach to occasionally stop asking questions when a "warm/casual" personality is active.
**Why it happens:** LLM instruction-following has a mild recency bias within a single system prompt block.
**How to avoid:** Fixed prompt composition order per D-03: Role rules → Blueprint context → argGraph context → Personality voice, always in that order, never reordered per-call.
**Warning signs:** Coach outputs ending in `.` or `!` instead of `?` correlating with which Personality is active.
`[CITED: 11-AI-SPEC.md Section 4b.3, itself grounded in D-03 CONTEXT.md decision + Springer Nature Socratic-AI research cited in the AI-SPEC's domain research]`

### Pitfall 5: Dual persona systems coexisting without clear boundaries (D-06 scope)
**What goes wrong:** Phase 11 introduces a *second* persona/personality concept (`packages/types/src/personality.ts`, Supabase `personalities` table) alongside the *existing* one (`packages/types/src/persona.ts`'s `PERSONA_LIBRARY`/`PersonaConfigSchema`, `sessions.active_personas`, the `personas.ts` toggle route, `agentNode`'s `activePersonas`/`personaInstructions` composition). D-06 explicitly keeps the Analista Científico's *invocation mechanism* on the old system while migrating only its *voice data* to the new model — meaning both systems run in production simultaneously post-Phase-11, touching genuinely different code paths (`agentNode` vs the new `facilitationAgentNode`/`analyticsAgentNode`) but confusingly similar names ("persona" vs "Personality").
**Why it happens:** This is an explicit, deliberate scope boundary (D-06), not an oversight — but it's easy for someone reading the code later (or a future Claude session) to assume they're the same system.
**How to avoid:** Name the new type/table/field distinctly from the old ones in code (`Personality`/`personalities` is already distinct from `PersonaConfig`/`PERSONA_LIBRARY` — keep it that way; do not rename either to converge them in this phase), and add a code comment at both `persona.ts` and the new `personality.ts` cross-referencing D-06's boundary explicitly.
**Warning signs:** A future phase's task list assuming `active_persona_ids` (Blueprint, old system) and the new Role/Personality Blueprint fields are the same array.

## Code Examples

### Message insert + broadcast (D-16 template)
```typescript
// Source: apps/api/src/routes/ai.ts lines 428-454 (existing, verified in this session)
const { data: row, error: insertError } = await supabase
  .from('messages')
  .insert({
    session_id: sessionId,
    author_id: session.creator_id,      // existing precedent — see Pattern 4 for the open question on bot author_id
    display_name: matchedPersonas[0]?.displayName ?? 'AI',
    parent_id: null,
    path_id: activePathId,
    branch_id: activeBranchId,
    role: 'assistant',
    content: accumulatedText,
    canvas_snapshot_state: null,
  })
  .select()
  .single()

if (!insertError && row) {
  supabase.channel(`session:${sessionId}`).httpSend('new_message', row)
    .catch((err) => console.error('[silence-scan] broadcast failed', err))
}
```

### RPC call + fail-closed guard (established pattern to reuse for any new RPCs Phase 11 needs)
```typescript
// Source: apps/api/src/lib/bot-budget.ts (existing, verified in this session)
const { data, error } = await supabase.rpc('check_and_record_bot_budget', {
  p_branch_id: branchId,
  p_tokens_used: tokensUsed,
})
if (error || !data || !Array.isArray(data) || data.length === 0) {
  console.error('[module-name] rpc error:', error?.message ?? 'no rows returned')
  return FAIL_CLOSED_SENTINEL
}
```

### Async `setInterval` — the ONE critical mistake this codebase's context makes catastrophic
```typescript
// Source: 11-AI-SPEC.md Section 4b.2, cross-verified against auto-freeze.ts's setTimeout pattern
// CORRECT — async callback, awaited invoke, errors caught so the interval survives:
const intervalHandle = setInterval(async () => {
  try {
    await runSilenceScan(supabase, graph)
  } catch (err) {
    console.error('[silence-scan] uncaught error in scan tick', err)
  }
}, SCAN_INTERVAL_MS)
// WRONG — fire-and-forget allows overlapping ticks, directly causing Critical Failure Mode 3
// (silence trigger re-fires during cooldown) from 11-AI-SPEC.md Section 1:
// setInterval(() => { runSilenceScan(...) }, SCAN_INTERVAL_MS)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Single fixed `START → orchestrator` edge | Conditional `START` edge routing to `facilitation` / `argGraphBuilder→analysis` / `orchestrator` | This phase (Phase 11) | Highest-risk topology change per STATE.md decisions log — must be isolated and fully tested before Phase 12+ triggers build on it |
| Reactive-only personas (`PERSONA_LIBRARY`, toggled per-message via `activePersonas` string join) | Proactive Role/Personality architecture (`FacilitationAgentNode`/`AnalyticsAgentNode` as fixed code + Supabase-backed voice data) | This phase | Two systems now coexist by deliberate design (D-06) — see Pitfall 5 |
| `bot_arbitration`/`bot_budget_ledger`/`bot_circuit_state` registry empty (Phase 10 short-circuit, `runArbitration` always returns `null`) | Coach and Analyst `registerBot()` calls populate the registry for the first time | This phase | `runArbitration`'s `_registry.size === 0` early-return path stops being exercised in production — worth a regression test confirming the non-empty-registry path still behaves correctly |

**Deprecated/outdated:** None — this is an additive phase on an actively-maintained internal stack, not a phase migrating away from an external deprecated API.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | LLM tool-use output cannot reliably satisfy `z.string().uuid()`-typed fields without an explicit server-side ID-substitution step | Finding 2 | If wrong (models do reliably emit valid UUIDs when instructed), the recommended two-schema (tool-input vs domain-type) split is unnecessary extra complexity — but if the planner skips it and the assumption is correct, `ArgGraphSchema.safeParse` will fail on a high percentage of real extractions, degrading GRAPH-02 silently to "argGraph never populates" |
| A2 | LangGraph JS conditional-edge router functions (`addConditionalEdges` callback) propagate thrown errors identically to node functions (i.e., uncaught, straight to `graph.invoke()` caller) | Finding 6 | If the router function's error-handling behaves differently (e.g. LangGraph wraps/swallows router exceptions), the recommended "throw on unrecognized trigger_type" strategy could crash the whole invocation more destructively than intended, or could be silently swallowed defeating the "errors with a clear log" success criterion — this needs a throwaway spike test before committing to an approach in the plan |
| A3 | The `author_id` field for a proactively-fired Coach message should NOT reuse `session.creator_id` (existing AI-message precedent) nor `SYSTEM_AUTHOR_ID` (existing system-message precedent) without an explicit decision, because neither cleanly represents "a bot speaking as itself" | Pattern 4 | Low risk either way functionally (both are valid UUIDs satisfying the FK), but affects future features (e.g. "who sent this message" filtering, moderation, analytics) — worth a deliberate choice rather than accidental precedent-following |

## Open Questions

1. **Should `ArgNode`/`ArgEdge` gain a `confidence` field and an "open assertion" concept for GRAPH-04's "argGraph summary (nodes, edges, open assertions)" injection requirement?**
   - What we know: ROADMAP success criterion 4 explicitly names "open assertions" as something the Analyst's injected context must include; `bot.ts`'s current schema has no `status`/`resolved`/`open` concept on `ArgNode`.
   - What's unclear: whether "open assertions" means a dedicated new field, or is derivable at prompt-build time (e.g., "nodes with no supporting/contradicting edge yet" = open) without a schema change.
   - Recommendation: Decide during planning whether this is a schema-level field or a query-time derivation — the latter avoids yet another schema field to keep in sync but requires the prompt-builder to do a graph traversal every invocation.

2. **What exact Supabase table shape should `personalities` take, and does it need a `role_compatible_with` field at all given D-03 (any Personality works with any Role by design)?**
   - What we know: D-04 says follow the `domain_blueprints` jsonb-definition-column pattern; D-02 says Personalities are Role-agnostic pure styling data.
   - What's unclear: exact column list (id, display_name, definition jsonb containing language/formality/catchphrases/knowledge_scope? or separate typed columns?).
   - Recommendation: Follow `domain_blueprints`' exact shape (`id text PK, name text, definition jsonb NOT NULL, created_at`) for consistency and because D-04 explicitly says to use it as the closest analog — resolved with HIGH confidence, listed here only because the exact `definition` jsonb internal shape (which fields) is still Claude's discretion per CONTEXT.md.

3. **Does throwing from `routeFromStart` actually surface as a clear, testable error, or does it need a different mechanism (e.g., writing an error marker to `triggerMetadata` and having a distinct terminal node)?**
   - What we know: AI-SPEC.md Pitfall 5 confirms *nodes* don't get automatic try/catch. The conditional-edge router function is architecturally different from a node (it runs synchronously during edge resolution, before any node executes).
   - What's unclear: LangGraph JS's exact error-propagation behavior for router-function exceptions specifically — not verified against source in this research session (would require a Context7 deep-dive or a throwaway integration test).
   - Recommendation: Planner should treat this as a Wave 0 spike/verification task — write a 5-line test that makes `routeFromStart` throw and asserts what `graph.invoke()` does, before committing the "throw vs log+route-to-error-node" strategy into the real implementation plan.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime for `apps/api` | Yes | v22.17.1 `[VERIFIED: node --version]` | — matches CLAUDE.md's "Node.js 22 LTS" constraint exactly |
| pnpm | Package manager, monorepo workspace | Yes | 10.18.3 `[VERIFIED: pnpm --version]` | — |
| `@langchain/langgraph` | StateGraph, conditional edges | Yes | 1.4.7 `[VERIFIED: apps/api/package.json]` | — |
| `@langchain/langgraph-checkpoint-postgres` | PostgresSaver | Yes | 1.0.4 `[VERIFIED: apps/api/package.json]` | — |
| Supabase (local/dev instance) | All new tables/RPCs | Not directly probed this session (no `pg_isready`/`curl` run against a live instance) | — | Existing `.env`-driven config; `graph.integration.test.ts` already has an `HAS_SUPABASE` env-gate skip pattern to reuse if the dev DB is unreachable during planning |
| Supabase Realtime (WebSocket) | Client pickup of proactively-inserted Coach messages | **Known dead in WSL2 local dev** `[CITED: .claude/projects/memory/feedback_wsl2_realtime.md — referenced per canonical_refs, not independently re-verified this session]` | — | Existing SSE-fallback/polling pattern (already used for ghost nodes per STATE.md's 2026-07-06 decision log entry) — D-16 explicitly designs around this |

**Missing dependencies with no fallback:** None identified.

**Missing dependencies with fallback:** Supabase Realtime in WSL2 — existing SSE-fallback/polling pattern is the documented, already-proven fallback; no new work needed to handle this, just don't rely on Realtime alone for message delivery verification during local testing.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (new work) | Existing `requireAuth` middleware, unchanged — any new toggle route follows `personas.ts`'s existing pattern |
| V3 Session Management | No (new work) | N/A |
| V4 Access Control | Yes | New Role-toggle route (D-09) must replicate `personas.ts`'s creator-only check (`session.creator_id !== user.id → 403`) — this is a direct, must-copy pattern, not a design choice |
| V5 Input Validation | Yes | Zod `safeParse` on all new tool-use extraction (`ArgGraphSchema`), on the new `personalities` table's API-facing shape if any write route is added, and on any new Blueprint field additions |
| V6 Cryptography | No (new work) | Not applicable — no new crypto surface in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A non-creator toggling Coach/Analyst on/off for a session they don't own | Elevation of Privilege | Copy `personas.ts`'s existing creator_id check verbatim (T-02-18 precedent, already in production code) |
| A malformed/adversarial `triggerMetadata.trigger_type` value reaching `routeFromStart` from a corrupted checkpoint or a future code path bug | Tampering / Denial of Service | See Finding 6 — explicit unrecognized-value handling, not silent fallback |
| Bot-authored messages bypassing the existing token budget guard (a bug that lets Coach/Analyst fire without calling `checkBotBudget`) | Denial of Service (BYOK cost explosion) | Every new node/scan-loop invocation MUST call `checkBotBudget()` before the LLM call, exactly as designed in Phase 10 — this is a **must-verify** item in the plan's task list, not just a nice-to-have, since Critical Failure Mode 6 in `11-AI-SPEC.md` explicitly calls out "AI keeps participating in a frozen session" as a token-waste risk; the same class of risk applies if budget-guard calls are accidentally omitted from a new node |
| Bot firing on a frozen session | Tampering (unauthorized state mutation) / resource waste | `11-AI-SPEC.md` Critical Failure Mode 6 explicitly flags this. No existing session-status check was found inside `silence-gate.ts`, `bot-arbitrator.ts`, or `bot-budget.ts` during this research session — **the silence-scan loop itself must check `sessions.status === 'active'` before invoking the graph**, since none of the reused Phase 10 primitives do this check on the caller's behalf. `[VERIFIED: read all three files in full — no status check present]` |

## Sources

### Primary (HIGH confidence)
- `apps/api/src/lib/silence-gate.ts`, `bot-arbitrator.ts`, `bot-budget.ts` — read in full this session
- `apps/api/src/graph/state.ts`, `graph.ts`, `nodes/agent.ts`, `nodes/orchestrator.ts`, `nodes/mutation-gate.ts`, `nodes/drift-reply.ts` — read in full this session
- `packages/types/src/bot.ts`, `persona.ts`, `blueprint.ts`, `session.ts`, `message.ts`, `ai.ts` (interface section), `index.ts` — read in full this session
- `apps/api/src/routes/personas.ts`, `ai.ts` (message-insert section) — read in full this session
- `apps/api/src/lib/sessions-helpers.ts`, `auto-freeze.ts`, `model-config.ts`, `adapter-factory.ts` — read in full this session
- `supabase/migrations/0008_nsai_foundation.sql`, `0012_bot_infrastructure.sql` — read in full this session; `ls supabase/migrations/` confirmed `0013_revoke_public_execute.sql` is latest
- `apps/api/src/graph/graph.test.ts`, `graph.integration.test.ts` — read in full this session
- `apps/web/components/workspace/CreatorControls.tsx` (persona toggle section) — read this session
- `.planning/phases/10-infrastructure-foundation/10-CONTEXT.md`, `10-PATTERNS.md` — read in full this session
- `.planning/phases/11-personality-basic-triggers/11-AI-SPEC.md` — read in full this session (itself Context7-sourced for LangGraph mechanics; treated as HIGH confidence for framework mechanics, but cross-checked against live code for integration correctness)
- `apps/api/package.json` — verified installed package versions

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` (Phase 11 section), `.planning/STATE.md` — project-level documents, internally consistent with code but STATE.md's phase-status header is stale/contradictory (see note below)

### Tertiary (LOW confidence)
- Claims about LangGraph JS conditional-edge error-propagation behavior (Open Question 3, Assumption A2) — not independently verified against LangGraph source in this session; flagged for a Wave 0 spike

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, all versions verified against `package.json`
- Architecture (LangGraph mechanics): HIGH for the parts sourced from `11-AI-SPEC.md`'s Context7-verified quick reference; MEDIUM for router-function error-propagation specifics (Open Question 3)
- New schema design (`ArgNode`/`ArgEdge` extension, `personalities` table, `bot_defaults`): MEDIUM — grounded in existing precedent (`bot.ts`, `domain_blueprints`) but final field lists are explicitly left to planning per CONTEXT.md's Claude's Discretion section
- Pitfalls: HIGH — sourced from direct code reading of 20+ files plus AI-SPEC.md's Context7-cited LangGraph pitfalls

**Important note on `.planning/STATE.md`:** Its header says `"Phase status: Not started — roadmap ready, awaiting /gsd:plan-phase 10"` and its `Current Position` footer says `"Phase: 10 (infrastructure-foundation) — EXECUTING"` — both are stale relative to the actual repository state, which shows Phase 10 fully implemented (migrations 0012/0013 applied, all Phase 10 library code present and matching its own CONTEXT.md decisions, `10-01/02/03-SUMMARY.md` and `10-REVIEW.md`/`10-REVIEW-FIX.md` all present in the phase directory). The planner should not be blocked by STATE.md's stale status text — treat the actual code + `10-PATTERNS.md`/`10-REVIEW.md` file presence as ground truth for "is Phase 10 done."

**Research date:** 2026-07-10
**Valid until:** 30 days (stable internal stack, no fast-moving external dependencies) — but re-verify migration numbering (Finding 3) immediately before the migration-writing task regardless of research age, since that number can change with any intervening merge.
