---
phase: 260718-sxn
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/graph/graph.integration.test.ts
  - apps/api/src/graph/nodes/facilitation-agent.ts
  - apps/api/src/graph/nodes/analytics-agent.ts
  - apps/api/src/graph/nodes/facilitation-agent.test.ts
  - apps/api/src/graph/nodes/analytics-agent.test.ts
autonomous: true
requirements: [QUICK-260718-sxn]
must_haves:
  truths:
    - "The Langfuse OTel smoke test no longer fires a real trace on ordinary test runs when only LANGFUSE_PUBLIC_KEY/SECRET_KEY are set"
    - "The smoke test still runs when the developer deliberately opts in with RUN_LANGFUSE_SMOKE_TEST=true"
    - "Coach (facilitation) Langfuse Generation traces show both the system prompt AND the actual conversation window sent to the model"
    - "Analyst (analytics) Langfuse Generation traces show both the system prompt AND the actual conversation window sent to the model"
  artifacts:
    - path: apps/api/src/graph/graph.integration.test.ts
      provides: "Smoke-test suite gated behind an explicit RUN_LANGFUSE_SMOKE_TEST opt-in"
      contains: "RUN_LANGFUSE_SMOKE_TEST"
    - path: apps/api/src/graph/nodes/facilitation-agent.ts
      provides: "Coach Generation input carrying system + conversation messages"
    - path: apps/api/src/graph/nodes/analytics-agent.ts
      provides: "Analyst Generation input carrying system + conversation messages"
  key_links:
    - from: apps/api/src/graph/nodes/facilitation-agent.ts
      to: streamWithGeneration
      via: "input field"
      pattern: "input:\\s*\\{\\s*system,\\s*messages"
    - from: apps/api/src/graph/nodes/analytics-agent.ts
      to: streamWithGeneration
      via: "input field"
      pattern: "input:\\s*\\{\\s*system,\\s*messages"
---

<objective>
Fix two Langfuse observability defects reported by the user:

1. A spurious "Climate change is urgent." trace appears in the user's real Langfuse project every time the API test suite runs. This is caused by the OBS-01/02 OTel smoke test firing automatically whenever `LANGFUSE_PUBLIC_KEY`/`SECRET_KEY` are present in the environment — which they are, for normal dev.

2. Coach and Analyst agent Generation traces only record the system prompt as their `input`, so the user cannot see the actual conversation/messages sent to the model.

Purpose: Stop test-suite runs from polluting the user's live Langfuse dashboard, and make agent traces show the real model input for debugging.
Output: Gated smoke test + enriched Generation `input` at both agent call sites, with tests updated to lock in the new behavior.
</objective>

<execution_context>
@/home/jgm/dev/projects/web-projects/panelito/.claude/get-shit-done/workflows/execute-plan.md
@/home/jgm/dev/projects/web-projects/panelito/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

<interfaces>
<!-- Verified against the codebase 2026-07-18. Use these directly. -->

streamWithGeneration params (apps/api/src/lib/langfuse-generation.ts):
- `input?: unknown` — recorded verbatim on the Generation observation via
  `startObservation(name, { model, input, metadata }, { asType: 'generation' })`.
  Accepts any shape; no new abstraction needed. `input` is set ONCE at start and
  never updated afterward.

Coach call site (apps/api/src/graph/nodes/facilitation-agent.ts, ~line 205-219):
  adapter.stream(state.messages.slice(-CONTEXT_WINDOWS.facilitation), [], { model, maxTokens: 256, system })
  streamWithGeneration(..., { name: 'facilitation-coach', model, metadata: { trigger, tier: 'fast' }, input: system, streamWriter })

Analyst call site (apps/api/src/graph/nodes/analytics-agent.ts, ~line 245-256):
  adapter.stream(state.messages.slice(-CONTEXT_WINDOWS.analytics), [canvasMutationTool], { model, maxTokens: 512, system })
  streamWithGeneration(..., { name: 'analytics-analyst', model, metadata: { trigger, tier: 'capable' }, input: system, streamWriter, onEvent })

CONTEXT_WINDOWS (apps/api/src/lib/bot-context.ts): { facilitation: 10, analytics: 20 }
  Already imported and in scope at both call sites.

Smoke-test gate (apps/api/src/graph/graph.integration.test.ts):
  line 34: const HAS_SUPABASE = !!process.env.SUPABASE_DIRECT_URL
  line 35: const HAS_LANGFUSE = !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY)
  line 219: describe.skipIf(!HAS_SUPABASE || !HAS_LANGFUSE)('Test B: Langfuse OTel smoke (OBS-01/02)', ...)
  Hardcoded polluting message at line 253: content: 'Climate change is urgent.'

Both agent tests (facilitation-agent.test.ts:498, analytics-agent.test.ts:513) assert
`mockStartObservation` was called with `expect.objectContaining({ model, metadata })` —
they do NOT currently assert on `input`, so adding `input` will NOT break them.
langfuse-generation.test.ts does not assert on `input` either.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Gate the Langfuse OTel smoke test behind an explicit opt-in env var</name>
  <files>apps/api/src/graph/graph.integration.test.ts</files>
  <action>
Stop the OBS-01/02 smoke test (the `describe.skipIf(!HAS_SUPABASE || !HAS_LANGFUSE)('Test B: Langfuse OTel smoke (OBS-01/02)', ...)` block, ~line 219) from firing automatically whenever Langfuse creds happen to be present in `.env` for normal dev — which is what creates the recurring "Climate change is urgent." trace in the user's real Langfuse project on every test run.

Add a new opt-in gate near the existing gates (lines 34-35): `const RUN_LANGFUSE_SMOKE = process.env.RUN_LANGFUSE_SMOKE_TEST === 'true'`. Change the Test B `describe.skipIf` condition to also require this flag, i.e. skip unless `RUN_LANGFUSE_SMOKE && HAS_SUPABASE && HAS_LANGFUSE` (express as `describe.skipIf(!RUN_LANGFUSE_SMOKE || !HAS_SUPABASE || !HAS_LANGFUSE)`).

Update the Test B header doc comment (the "Test B: Langfuse OTel smoke test (OBS-01, OBS-02)" banner around line 216) to document that this test now requires `RUN_LANGFUSE_SMOKE_TEST=true` to run because it flushes a REAL trace to the configured Langfuse project (network side effect), so it must not run on ordinary test invocations — it is a deliberate one-off OBS-01/02 verification whose full dashboard confirmation is the human-verify checkpoint.

Do NOT touch Test A's gate or any other suite. Do NOT change the hardcoded 'Climate change is urgent.' message content or the flush logic — only the skip gate and the doc comment. Do NOT modify langfuse-otel.ts.
  </action>
  <verify>
    <automated>cd apps/api && grep -n "RUN_LANGFUSE_SMOKE_TEST" src/graph/graph.integration.test.ts && pnpm vitest run src/graph/graph.integration.test.ts 2>&1 | grep -Eiq "skipped|pass|no tests" && echo GATED_OK</automated>
  </verify>
  <done>Test B is skipped when RUN_LANGFUSE_SMOKE_TEST is unset even with LANGFUSE keys present; the doc comment documents the new required env var; no real "Climate change is urgent." trace is emitted on an ordinary `pnpm vitest run` of this file.</done>
</task>

<task type="auto">
  <name>Task 2: Include the conversation window in Coach and Analyst Generation input</name>
  <files>apps/api/src/graph/nodes/facilitation-agent.ts, apps/api/src/graph/nodes/analytics-agent.ts, apps/api/src/graph/nodes/facilitation-agent.test.ts, apps/api/src/graph/nodes/analytics-agent.test.ts</files>
  <action>
Make agent Langfuse Generation traces show the actual messages sent to the model, not just the system prompt.

In `facilitation-agent.ts` (~line 216): change `input: system` to `input: { system, messages: state.messages.slice(-CONTEXT_WINDOWS.facilitation) }`. This is the exact same slice already passed as the first arg to `adapter.stream(...)` on line 208 — reference that expression, do not compute a different window.

In `analytics-agent.ts` (~line 255): change `input: system` to `input: { system, messages: state.messages.slice(-CONTEXT_WINDOWS.analytics) }`. This mirrors the slice passed to `adapter.stream(...)` on line 247 — use `CONTEXT_WINDOWS.analytics` (verified value 20), not facilitation's.

Keep it minimal: `streamWithGeneration`'s `input?: unknown` already accepts this object shape; no new type, no helper, no other fields. Do not change `metadata`, `model`, `streamWriter`, or `onEvent`.

Tests: the existing assertions in `facilitation-agent.test.ts` (~line 498) and `analytics-agent.test.ts` (~line 513) use `expect.objectContaining({ model, metadata })` and do NOT assert on `input`, so they will not break. Strengthen the `mockStartObservation` assertion in BOTH files to additionally assert the new input shape — extend the existing `expect.objectContaining({...})` (2nd arg) to include `input: expect.objectContaining({ system: expect.any(String), messages: expect.any(Array) })`. This locks in the fix so a future regression to `input: system` fails the test.
  </action>
  <verify>
    <automated>cd apps/api && grep -Eq "input:\s*\{\s*system,\s*messages: state.messages.slice\(-CONTEXT_WINDOWS.facilitation\)" src/graph/nodes/facilitation-agent.ts && grep -Eq "input:\s*\{\s*system,\s*messages: state.messages.slice\(-CONTEXT_WINDOWS.analytics\)" src/graph/nodes/analytics-agent.ts && pnpm vitest run src/graph/nodes/facilitation-agent.test.ts src/graph/nodes/analytics-agent.test.ts</automated>
  </verify>
  <done>Both call sites pass `{ system, messages: <same slice sent to adapter.stream> }` as `input`; both agent test suites pass with assertions verifying the new input shape (system string + messages array).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| test runner → Langfuse network | Smoke test flushes real traces to the user's live Langfuse project |
| agent node → Langfuse Generation | Conversation content (messages) crosses into an observability sink |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-sxn-01 | Information Disclosure | graph.integration.test.ts smoke test | mitigate | Gate behind explicit `RUN_LANGFUSE_SMOKE_TEST=true` so ordinary runs never emit network traces to the live project (Task 1) |
| T-sxn-02 | Information Disclosure | agent Generation `input` (conversation messages) | accept | Messages are already sent to the model provider and already partially traced; recording the same window in Langfuse (the user's own project, BYOK) is the intended debugging behavior the user requested. No new PII sink beyond what Langfuse already receives. |
| T-sxn-SC | Tampering | npm/pip/cargo installs | accept | No new packages installed — edits use existing in-repo modules only. |
</threat_model>

<verification>
- `pnpm vitest run apps/api/src/graph/graph.integration.test.ts` — Test B skipped without the opt-in flag; no "Climate change is urgent." trace emitted.
- `pnpm vitest run apps/api/src/graph/nodes/facilitation-agent.test.ts apps/api/src/graph/nodes/analytics-agent.test.ts` — both pass, including the strengthened input-shape assertions.
- `pnpm -C apps/api typecheck` (or the repo's typecheck script) passes — the `{ system, messages }` object satisfies `input?: unknown`.
</verification>

<success_criteria>
- Running the API test suite with Langfuse creds present no longer creates a "Climate change is urgent." trace in the user's Langfuse dashboard.
- Setting `RUN_LANGFUSE_SMOKE_TEST=true` still runs the OBS-01/02 smoke test for deliberate verification.
- Coach and Analyst Generation observations record `{ system, messages }` reflecting the actual conversation window sent to the model.
- All touched tests pass.
</success_criteria>

<output>
Create `.planning/quick/260718-sxn-remove-the-sample-climate-change-is-urge/260718-sxn-SUMMARY.md` when done.
</output>
