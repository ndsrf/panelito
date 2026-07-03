---
phase: 07-invoke-route-modification
plan: 01
subsystem: graph-nodes
tags: [langgraph, streaming, sse, orchestrator, agent, env]
dependency_graph:
  requires: [06-graph-construction-checkpointer]
  provides: [streamWriter-seam, steeringTextEnabled-state, LANGFUSE_TRACE_LEVEL-env]
  affects: [07-02-invoke-route]
tech_stack:
  added: []
  patterns: [streamWriter-seam, identity-reducer, Zod-enum-default]
key_files:
  created: []
  modified:
    - apps/api/src/graph/state.ts
    - apps/api/src/graph/nodes/agent.ts
    - apps/api/src/graph/nodes/drift-reply.ts
    - apps/api/src/graph/nodes/orchestrator.ts
    - apps/api/src/lib/env.ts
    - .env.example
decisions:
  - "steeringTextEnabled uses identity-reducer Annotation<boolean | null> pattern matching driftAction"
  - "AgentNode reads state.steeringTextEnabled directly (typed field, no cast needed after Task 1)"
  - "DOMAIN_BRIDGE steering text appended to system prompt via string concat rather than separate LLM call"
metrics:
  duration: "~20 minutes"
  completed: "2026-07-03"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 6
---

# Phase 7 Plan 01: Graph Node Interface Layer Summary

**One-liner:** streamWriter seam wired into AgentNode and DriftReplyNode, steeringTextEnabled state field added, OrchestratorNode DOMAIN_BRIDGE probability roll implemented, and LANGFUSE_TRACE_LEVEL validated env var added.

## What Was Built

This plan is the interface layer that Plan 02 (the /invoke route) consumes. Three targeted changes were made to the Phase 6 graph nodes:

1. **State schema** (`state.ts`): Added `steeringTextEnabled: Annotation<boolean | null>` using the identity-reducer pattern, documenting that `null` = not a DOMAIN_BRIDGE path and `true/false` = OrchestratorNode probability roll result.

2. **DriftReplyNode** (`drift-reply.ts`): Replaced the Phase 6 empty comment block in the `text_delta` branch with a single `config?.configurable?.streamWriter?.(event.text)` call — the entire Phase 7 scope for this file.

3. **AgentNode** (`agent.ts`):
   - Extended `buildAgentSystemPrompt` signature to accept `activePersonaInstructions?: string` (D-10)
   - Added D-08 banned-phrase rule (no "I added a node", "I mapped this to", "I connected", "I've recorded")
   - Added D-09 silence-preference rule (prefer no text when canvas mutation captures the insight)
   - Added `text_delta` branch before `tool_use` in the stream loop calling `streamWriter` (D-05)
   - `agentNode` reads `config?.configurable?.activePersonas` and joins into persona instructions
   - `agentNode` reads `state.steeringTextEnabled` and augments system prompt with facilitation instruction when `true` (D-11/D-12)
   - All forbidden words ("blueprint", "domain", "ontology") excluded from steering text instruction
   - Existing `CanvasOpSchema.safeParse` gate and fail-silent `catch` block preserved unchanged

4. **OrchestratorNode** (`orchestrator.ts`):
   - Added DOMAIN_BRIDGE steering roll block after the existing DOMAIN_DRIFT block using `blueprint.drift_reply_probability ?? 0.8`
   - Logs `[orchestrator] bridge steering event` with `steering_probability`, `steering_roll`, `steering_enabled` (mirrors drift event pattern)
   - Returns `steeringTextEnabled` in all exit paths, including both early-return branches (missing blueprint, no messages)

5. **Env schema** (`env.ts`): Added `LANGFUSE_TRACE_LEVEL: z.enum(['graph', 'full']).default('graph')` — validates automatically via existing `EnvSchema.safeParse(process.env)` call (D-15).

6. **`.env.example`**: Added `LANGFUSE_TRACE_LEVEL=graph` with explanatory comment after the Langfuse section.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | fb31212 | feat(07-01): add steeringTextEnabled state field and streamWriter seam to DriftReplyNode |
| 2 | 399906e | feat(07-01): extend AgentNode with streamWriter seam, persona injection, and steering text |
| 3 | 44817c1 | feat(07-01): add DOMAIN_BRIDGE steering roll to OrchestratorNode and LANGFUSE_TRACE_LEVEL env var |

## Verification

- `npx tsc --noEmit` in `apps/api` exits 0 after all three tasks
- `grep -R "streamWriter" apps/api/src/graph/nodes/` returns matches in both `agent.ts` and `drift-reply.ts`
- `pnpm test` — existing graph unit tests (`graph.test.ts`, `graph.integration.test.ts`) all pass; 2 pre-existing failures in `keys.test.ts` and `ai-provider.test.ts` unrelated to this plan (confirmed by running tests on the commit prior to Task 3 changes)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All fields are live — `steeringTextEnabled` is set by OrchestratorNode and consumed by AgentNode; `streamWriter` is a seam that Plan 02 will wire.

## Threat Surface Scan

No new security surface beyond what the plan's threat model covers. T-07-01 mitigation is satisfied: `streamWriter` forwards only `event.text` deltas from the model, never the system prompt string or `plaintextKey`. T-07-02 mitigation is satisfied: `LANGFUSE_TRACE_LEVEL` validated by `z.enum(['graph','full'])` at startup.

## Self-Check: PASSED

- [x] `apps/api/src/graph/state.ts` contains `steeringTextEnabled` — FOUND
- [x] `apps/api/src/graph/nodes/drift-reply.ts` contains `streamWriter` — FOUND
- [x] `apps/api/src/graph/nodes/agent.ts` contains `streamWriter`, `steeringTextEnabled`, `activePersonaInstructions`, `I added a node` — FOUND
- [x] `apps/api/src/graph/nodes/orchestrator.ts` contains `bridge steering event`, `steeringTextEnabled` — FOUND
- [x] `apps/api/src/lib/env.ts` contains `LANGFUSE_TRACE_LEVEL` — FOUND
- [x] `.env.example` contains `LANGFUSE_TRACE_LEVEL=graph` — FOUND
- [x] Commits fb31212, 399906e, 44817c1 exist in git log — FOUND
