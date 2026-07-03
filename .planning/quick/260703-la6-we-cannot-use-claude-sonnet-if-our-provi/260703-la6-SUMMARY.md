---
phase: quick
plan: 260703-la6
subsystem: api/graph
tags: [model-config, provider-routing, graph-nodes, task-models]
dependency_graph:
  requires: []
  provides:
    - TASK_MODELS.classification task type
    - Provider-aware model selection in all three LangGraph graph nodes
  affects:
    - apps/api/src/lib/model-config.ts
    - apps/api/src/graph/nodes/orchestrator.ts
    - apps/api/src/graph/nodes/agent.ts
    - apps/api/src/graph/nodes/drift-reply.ts
tech_stack:
  added: []
  patterns:
    - TASK_MODELS[providerName ?? 'anthropic'] index pattern for all LLM calls in graph nodes
key_files:
  created: []
  modified:
    - apps/api/src/lib/model-config.ts
    - apps/api/src/graph/nodes/orchestrator.ts
    - apps/api/src/graph/nodes/agent.ts
    - apps/api/src/graph/nodes/drift-reply.ts
decisions:
  - TaskType 'classification' semantically distinct from 'categorization': classification = binary/enum low-token call (orchestrator); categorization = label assignment from tag set (labeler.ts)
  - anthropic.classification maps to claude-haiku-4-5-20251001 (not claude-sonnet) — lightweight single-token response
  - ?? 'anthropic' fallback in all node files: TypeScript requires a valid ProviderName key; the adapter creation guard above already bails before the index is reached if providerName is truly missing
metrics:
  duration: "< 5 minutes"
  completed: "2026-07-03"
  tasks_completed: 2
  files_modified: 4
---

# Quick Task 260703-la6: Provider-aware model routing in LangGraph nodes

One-liner: Added 'classification' TaskType to TASK_MODELS and replaced all three hardcoded 'claude-sonnet-4-6' literals in graph nodes with TASK_MODELS[providerName ?? 'anthropic'] lookups so OpenAI/Gemini sessions no longer attempt Anthropic model calls.

## What Was Done

### Task 1 — Add 'classification' task type to TASK_MODELS (commit: 8b8d38f)

`apps/api/src/lib/model-config.ts`:
- Extended `TaskType` union from `'analysis' | 'compression' | 'categorization'` to include `'classification'`
- Added `classification` entry to all three provider blocks:
  - `anthropic`: `claude-haiku-4-5-20251001` (cheapest/fastest — single-token response)
  - `openai`: `gpt-5.4-mini`
  - `gemini`: `gemini-2.5-flash`
- Updated JSDoc to document all four task types and their semantic distinctions

### Task 2 — Replace hardcoded model strings in graph nodes (commit: b1c771b)

All three graph node files now import `TASK_MODELS` and use provider-aware lookups:

| File | Old | New |
|------|-----|-----|
| `orchestrator.ts` | `'claude-sonnet-4-6'` | `TASK_MODELS[providerName ?? 'anthropic'].classification` |
| `agent.ts` | `'claude-sonnet-4-6'` | `TASK_MODELS[providerName ?? 'anthropic'].analysis` |
| `drift-reply.ts` | `'claude-sonnet-4-6'` | `TASK_MODELS[providerName ?? 'anthropic'].analysis` |

## Verification Results

| Check | Result |
|-------|--------|
| `grep -rn "claude-sonnet-4-6" apps/api/src/graph/nodes/` | 0 matches |
| `grep -c "TASK_MODELS" apps/api/src/graph/nodes/orchestrator.ts` | 2 (import + usage) |
| `grep -c "TASK_MODELS" apps/api/src/graph/nodes/agent.ts` | 2 (import + usage) |
| `grep -c "TASK_MODELS" apps/api/src/graph/nodes/drift-reply.ts` | 2 (import + usage) |
| `node_modules/.bin/tsc --noEmit` | 0 errors |
| `node_modules/.bin/vitest run src/graph` | 7/7 tests passed |

## Deviations from Plan

None - plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundary changes introduced. The `?? 'anthropic'` fallback satisfies T-la6-01 (Tampering: unknown providerName index into TASK_MODELS) as specified in the plan's threat model.

## Self-Check: PASSED

- File `apps/api/src/lib/model-config.ts`: FOUND (modified, 'classification' in TaskType union and all 3 provider blocks)
- File `apps/api/src/graph/nodes/orchestrator.ts`: FOUND (TASK_MODELS import + lookup)
- File `apps/api/src/graph/nodes/agent.ts`: FOUND (TASK_MODELS import + lookup)
- File `apps/api/src/graph/nodes/drift-reply.ts`: FOUND (TASK_MODELS import + lookup)
- Commit 8b8d38f: FOUND
- Commit b1c771b: FOUND
