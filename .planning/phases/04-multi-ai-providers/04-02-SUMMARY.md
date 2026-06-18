---
phase: 04-multi-ai-providers
plan: "02"
subsystem: ai-adapters
tags: [ai, openai, gemini, adapter, tdd, factory, model-config, key-verification]
dependency_graph:
  requires:
    - packages/types/src/ai.ts (AIProvider, ProviderMessage, ProviderTool, ProviderCapabilities, AIStreamEvent, ProviderName)
    - apps/api/src/lib/adapters/anthropic.ts (structural reference, VerifyResult type)
    - apps/api/src/lib/anthropic.ts (VerifyResult type export)
  provides:
    - apps/api/src/lib/adapters/openai.ts (OpenAIAdapter implementing AIProvider)
    - apps/api/src/lib/adapters/gemini.ts (GeminiAdapter implementing AIProvider)
    - apps/api/src/lib/adapter-factory.ts (createAdapter(provider, apiKey) → AIProvider)
    - apps/api/src/lib/model-config.ts (TASK_MODELS task-to-model mapping)
    - apps/api/src/lib/verify-key.ts (verifyOpenAIKey + verifyGeminiKey)
  affects:
    - apps/api/src/routes/ai.ts (can now use createAdapter instead of hardcoding AnthropicAdapter)
    - apps/api/src/routes/keys.ts (can use verifyOpenAIKey + verifyGeminiKey for multi-provider key verify)
tech_stack:
  added: []
  patterns:
    - TDD RED/GREEN for both adapters (5 commits total: 2 RED, 2 GREEN for adapters + 1 feat for factory/config/verify)
    - try/finally done guard on AsyncIterable stream (RESEARCH.md Pitfall 4)
    - OpenAI: index-keyed tool call accumulation, system as messages[0]
    - Gemini: role filtering (system → systemInstruction, assistant → model), post-loop function call emission
    - Factory switch with satisfies-never exhaustive type check
    - Error class name logged only on key verification failure (T-04-03)
key_files:
  created:
    - apps/api/src/lib/adapters/openai.ts
    - apps/api/src/lib/adapters/openai.test.ts
    - apps/api/src/lib/adapters/gemini.ts
    - apps/api/src/lib/adapters/gemini.test.ts
    - apps/api/src/lib/adapter-factory.ts
    - apps/api/src/lib/model-config.ts
    - apps/api/src/lib/verify-key.ts
  modified: []
decisions:
  - OpenAI stream() uses client.chat.completions.stream() (not .create({stream:true})) for the streaming interface; tools only passed when oaiTools.length > 0
  - Gemini functionDeclarations uses parametersJsonSchema (v2 API field) not parameters; confirmed against @google/genai dist/genai.d.ts
  - TASK_MODELS pinned to gpt-5.4/gpt-5.4-mini (post-Feb-2026 replacements) and gemini-2.5-flash (post-June-2026 replacement); deprecated IDs appear only in JSDoc comments
  - verifyGeminiKey marked [ASSUMED] per RESEARCH Open Question 1 — Gemini error message matching unverified against live API
  - Test files updated with non-null assertions (!) for noUncheckedIndexedAccess strict TypeScript
metrics:
  duration_minutes: 10
  completed: "2026-06-18"
  tasks_completed: 3
  files_changed: 7
---

# Phase 04 Plan 02: OpenAI + Gemini Adapters Summary

**One-liner:** OpenAIAdapter with index-keyed tool call accumulation and GeminiAdapter with @google/genai v2 role mapping; adapter factory, TASK_MODELS, and per-provider key verification helpers complete the D-14 parity requirement.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | OpenAIAdapter — failing tests | 914fcff | adapters/openai.test.ts |
| 1 (GREEN) | OpenAIAdapter — implementation | 721ad9b | adapters/openai.ts |
| 2 (RED) | GeminiAdapter — failing tests | 13f958e | adapters/gemini.test.ts |
| 2 (GREEN) | GeminiAdapter — implementation | 797aac5 | adapters/gemini.ts |
| 3 | Factory + TASK_MODELS + verify-key | b099afb | adapter-factory.ts, model-config.ts, verify-key.ts (+ test fixes) |

## What Was Built

**apps/api/src/lib/adapters/openai.ts** (new file):
- `class OpenAIAdapter implements AIProvider`
- `capabilities()` returns streaming:true, toolUse:true, all 5 others false
- `stream()` body wrapped in try/finally — done emitted exactly once (Pitfall 4)
- System prompt passed as `{ role: 'system', content: options.system }` as messages[0] (Pattern 2 — NOT a top-level param)
- ProviderMessage role 'system' filtered from messages map (system already handled above)
- Tool call accumulator keyed by `tc.index` (`Record<number, {id, name, arguments}>`)
- `tool_use` events emitted ONLY after `finish_reason === 'tool_calls'` — JSON fully accumulated
- Malformed JSON caught with `try/catch + continue` (no throw, no tool_use emitted)
- No `finalMessage()` call (first-token latency anti-pattern avoided)

**apps/api/src/lib/adapters/gemini.ts** (new file):
- Mandatory comment: `@google/genai v2 — do NOT use @google/generative-ai (legacy v1 SDK)`
- `class GeminiAdapter implements AIProvider`
- `capabilities()` same shape as OpenAIAdapter
- `stream()` body wrapped in try/finally — done emitted exactly once
- Role conversion: `system` messages filtered from contents; `options.system` → `config.systemInstruction`
- Role mapping: `assistant` → `model` in Gemini contents (Pitfall 5 — 'assistant' is rejected by Gemini API)
- `functionDeclarations` use `parametersJsonSchema` field (v2 API) per `@google/genai/dist/genai.d.ts`
- `chunk.functionCalls` treated as complete objects (no JSON.parse — Pitfall 4 contrast with OpenAI)
- `accumulatedFunctionCalls` populated during for-await loop; `tool_use` events emitted AFTER the loop

**apps/api/src/lib/adapter-factory.ts** (new file):
- `export function createAdapter(provider: ProviderName, apiKey: string): AIProvider`
- Switch over `'anthropic' | 'openai' | 'gemini'` returning matching adapter instance
- Default branch: `throw new Error(`Unknown provider: ${provider satisfies never}`)` — enforces exhaustive switching at compile time

**apps/api/src/lib/model-config.ts** (new file):
- `export type TaskType = 'analysis' | 'compression' | 'categorization'`
- `export const TASK_MODELS: Record<ProviderName, Record<TaskType, string>>` as const
- Validated 2026 model IDs: anthropic (claude-sonnet-4-6 / claude-haiku-4-5-20251001), openai (gpt-5.4 / gpt-5.4-mini), gemini (gemini-2.5-flash for all tasks)
- No deprecated IDs: gpt-4o/gpt-4o-mini and gemini-2.0-flash appear only in JSDoc comments

**apps/api/src/lib/verify-key.ts** (new file):
- `export async function verifyOpenAIKey(key: string): Promise<VerifyResult>` — calls `client.models.list()`; maps AuthenticationError/PermissionDeniedError → invalid_key, RateLimitError → rate_limited, other APIError → ok:true, else → network_error
- `export async function verifyGeminiKey(key: string): Promise<VerifyResult>` — calls `ai.models.list()`; inspects error message for API_KEY_INVALID/PERMISSION_DENIED → invalid_key, RESOURCE_EXHAUSTED → rate_limited, else → network_error
- `[ASSUMED]` comment on Gemini error shape (RESEARCH Open Question 1 — not yet verified against live API)
- Neither function logs the key — only error class name (T-04-03)

## Verification Results

- `npx vitest run src/lib/adapters/openai.test.ts`: 11/11 tests pass
- `npx vitest run src/lib/adapters/gemini.test.ts`: 12/12 tests pass
- `npx vitest run src/lib/adapters/openai.test.ts src/lib/adapters/gemini.test.ts`: 23/23 tests pass
- `npx tsc --noEmit` on `apps/api`: exit 0 (clean)
- `TASK_MODELS` contains no deprecated model IDs in executable code
- `gemini.ts` imports only `@google/genai`, never `@google/generative-ai`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript strict mode violations in test files**
- **Found during:** Task 3 — after creating the production files, ran `npx tsc --noEmit` globally
- **Issue:** `noUncheckedIndexedAccess: true` in `tsconfig.base.json` makes array indexing return `T | undefined`. Both test files used `events[0].text`, `textEvents[1].text`, `events[events.length - 1].type` etc. without null guards — 17 TS errors.
- **Fix:** Added `!` non-null assertions on all array index accesses where the surrounding `expect(...).toHaveLength(N)` call logically guarantees existence. Cast for `ReturnType<typeof vi.fn>` added with `as unknown as` to handle the Mock type conversion.
- **Files modified:** `openai.test.ts`, `gemini.test.ts`
- **Commit:** b099afb (included in Task 3 commit as test file fixups)

### ASSUMED Items

**1. Gemini error message matching in verifyGeminiKey**
- The `@google/genai` v2 SDK does not expose typed error subclasses like the OpenAI SDK does. The error message string matching (`API_KEY_INVALID`, `PERMISSION_DENIED`, `RESOURCE_EXHAUSTED`) is based on documented Gemini API error codes but has not been verified against live API responses.
- Documented with `[ASSUMED]` comment in verify-key.ts per RESEARCH Open Question 1.
- Action needed: Run `verifyGeminiKey` with an invalid key against the live Gemini API and confirm the error message contains `API_KEY_INVALID`. Update if the pattern differs.

## TDD Gate Compliance

- RED gate Task 1: commit `914fcff` (`test(04-02): add failing tests for OpenAIAdapter`) — PRESENT
- GREEN gate Task 1: commit `721ad9b` (`feat(04-02): implement OpenAIAdapter...`) after RED — PRESENT
- RED gate Task 2: commit `13f958e` (`test(04-02): add failing tests for GeminiAdapter`) — PRESENT
- GREEN gate Task 2: commit `797aac5` (`feat(04-02): implement GeminiAdapter...`) after RED — PRESENT
- Task 3 (non-TDD): factory/config/verify files verified via `tsc --noEmit` and grep assertions only

## Known Stubs

None. All adapters implement the full AIProvider contract. The `[ASSUMED]` comment in verify-key.ts is a documentation note, not a functional stub — the function is fully implemented and returns a VerifyResult for all error paths.

## Threat Flags

No new security-relevant surface beyond what was modeled in the plan's `<threat_model>`.

| Flag | File | Description |
|------|------|-------------|
| T-04-03 applied | verify-key.ts | Error class name logged only; key never logged in either verifyOpenAIKey or verifyGeminiKey |
| T-04-05 applied | openai.ts, gemini.ts | Both adapters wrap stream() in try/finally; unit tests assert done is final event |
| T-04-06 applied | model-config.ts | TASK_MODELS contains no deprecated model IDs; verified by grep in acceptance criteria |

## Self-Check

- [x] apps/api/src/lib/adapters/openai.ts exists and contains `class OpenAIAdapter implements AIProvider`
- [x] apps/api/src/lib/adapters/gemini.ts exists and contains `class GeminiAdapter implements AIProvider`
- [x] apps/api/src/lib/adapter-factory.ts exists and contains `export function createAdapter`
- [x] apps/api/src/lib/model-config.ts exists and contains `export const TASK_MODELS` with `gpt-5.4`
- [x] apps/api/src/lib/verify-key.ts exists and contains `verifyOpenAIKey` and `verifyGeminiKey`
- [x] Commits 914fcff, 721ad9b, 13f958e, 797aac5, b099afb confirmed in git log
- [x] TypeScript clean on apps/api (npx tsc --noEmit exit 0)
- [x] All 23 unit tests pass
- [x] No deprecated model IDs in TASK_MODELS executable code
- [x] gemini.ts imports only @google/genai (not @google/generative-ai)
