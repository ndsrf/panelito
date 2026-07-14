---
phase: 11-personality-basic-triggers
plan: 04
subsystem: api
tags: [langgraph, typescript, zod, bot-personas, prompt-engineering]

# Dependency graph
requires:
  - phase: 11-personality-basic-triggers
    plan: 01
    provides: Personality type, ArgNode message_id/speaker citation fields, TASK_MODELS.facilitation tier, bot-context.ts summarizeArgGraph()/CONTEXT_WINDOWS
provides:
  - "facilitationAgentNode + buildCoachSystemPrompt — Coach Role, question-only output, Role-dominant prompt composition"
  - "analyticsAgentNode + buildAnalyticsSystemPrompt — Analyst Role, citation-enforcing prompt, conditional fact-check framing"
  - "Fixed vitest.config.ts worktree node_modules depth-probing (works for any worktree nesting depth, not just 3-levels-up)"
affects: [11-05-conditional-start-edge, 11-06, 11-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Role/Personality composition: Role behavioral contract composed FIRST (hardcoded, non-negotiable, few-shot pairs), Blueprint context second, argGraph summary third, Personality voice appended LAST as styling-only (D-03, never reorder)"
    - "Text delivery via config.configurable.streamWriter closure — node returns no response-text state field; caller (human SSE route or future proactive invoker) owns text capture/delivery and DB insertion (D-16)"
    - "Per-node adapter test seam named after the node (facilitationAdapter, analyticsAdapter), mirroring agentAdapter/classifierAdapter"

key-files:
  created:
    - apps/api/src/graph/nodes/facilitation-agent.ts
    - apps/api/src/graph/nodes/facilitation-agent.test.ts
    - apps/api/src/graph/nodes/analytics-agent.ts
    - apps/api/src/graph/nodes/analytics-agent.test.ts
  modified:
    - apps/api/vitest.config.ts

key-decisions:
  - "personality resolved from config.configurable.personality (single key for both nodes), not the AI-SPEC sample's node-specific facilityPersonality — plan's own interface text specifies config.configurable.personality"
  - "Coach's triggerMetadata key is 'silence_gate' (matches plan text explicitly); Analyst's is 'fact_check' (Claude's discretion — the only Phase-11-scoped trigger type conceptually tied to the Analyst's role per PROJECT.md's 6 trigger types; not prescribed verbatim by the plan)"
  - "factCheckFraming read from config.configurable.factCheckFraming (not a new GraphState field) — no live trigger wires this yet in Phase 11; keeps this plan's files_modified scope to the two node files only"
  - "Analyst reuses canvasMutationTool + CanvasOpSchema.safeParse exactly like agentNode; citation discipline is enforced by the system prompt only, per plan text"

patterns-established:
  - "Every new Role node (Coach, Analyst, and future Roles) must compose prompts in the fixed D-03 order and expose a pure buildXSystemPrompt function separate from the node body for testability"

requirements-completed: [PERSONA-01, PERSONA-02, GRAPH-04]

# Metrics
duration: 40min
completed: 2026-07-14
---

# Phase 11 Plan 04: Personality + Basic Triggers — Facilitation/Analytics Agents Summary

**Coach (FacilitationAgentNode) and Analyst (AnalyticsAgentNode) graph nodes with Role-dominant, Personality-appended-last prompt composition — Coach forces question-only output via a hardcoded behavioral contract, Analyst enforces citation-by-speaker discipline with a conditional fact-check-framing branch, both routed through TASK_MODELS and streaming via the shared AIProvider adapter interface.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-14T14:15:00Z
- **Completed:** 2026-07-14T14:57:00Z
- **Tasks:** 2 completed
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `facilitationAgentNode` (Coach): every response is structurally forced to be question-only via a hardcoded Role contract composed BEFORE any Personality voice text; injects `summarizeArgGraph(state.argGraph)` content-aware context (D-13/D-14) plus a sliding 10-message window
- `analyticsAgentNode` (Analyst): citation-by-speaker Role contract composed first (GRAPH-04 — cites real argGraph nodes, not free-form recall); conditional fact-check-framing branch appends uncertainty-only language and forbids confident counter-assertions (PERSONA-02) when `config.configurable.factCheckFraming === true`
- Both nodes are fail-silent (never throw), route models exclusively through `TASK_MODELS[...].facilitation`/`.analysis`, and never import `@anthropic-ai/sdk` directly
- Fixed a pre-existing worktree tooling bug (`vitest.config.ts`) that prevented running any test suite from this Claude Code linked-worktree layout at all — blocking, so fixed under Rule 3 (see Deviations)

## Task Commits

Each task followed the TDD RED → GREEN cycle:

1. **Task 1: FacilitationAgentNode (Coach)**
   - `c736338` (test) — 10 failing tests for `buildCoachSystemPrompt` source-order/few-shot/argGraph assertions and `facilitationAgentNode` fail-silent/routing behavior; includes the `vitest.config.ts` blocking fix (see Deviations)
   - `ce901cf` (feat) — implementation

2. **Task 2: AnalyticsAgentNode (Analyst/Fact-Checker)**
   - `847171c` (test) — 12 failing tests for `buildAnalyticsSystemPrompt` citation-contract/fact-check-framing assertions and `analyticsAgentNode` fail-silent/routing/tool-use behavior
   - `3b589b2` (feat) — implementation

**Plan metadata:** (this commit, docs: complete plan)

_Both tasks followed RED → GREEN (no REFACTOR needed — implementation matched planned shape on first pass, apart from one test-string case-mismatch fixed during GREEN)._

## Files Created/Modified
- `apps/api/src/graph/nodes/facilitation-agent.ts` - `facilitationAgentNode` + `buildCoachSystemPrompt` (Coach Role, question-only contract)
- `apps/api/src/graph/nodes/facilitation-agent.test.ts` - 10 unit tests (prompt composition + node behavior)
- `apps/api/src/graph/nodes/analytics-agent.ts` - `analyticsAgentNode` + `buildAnalyticsSystemPrompt` (Analyst Role, citation contract + fact-check framing)
- `apps/api/src/graph/nodes/analytics-agent.test.ts` - 12 unit tests (prompt composition + node behavior + tool-use parsing)
- `apps/api/vitest.config.ts` - fixed worktree `node_modules` depth-probing (see Deviations)

## Decisions Made
- `personality` is read from `config.configurable.personality` for both nodes (not per-node key names like the AI-SPEC sample's `facilityPersonality`) — the plan's own `<interfaces>` section specifies this key explicitly, taking precedence over the earlier AI-SPEC illustrative sample
- Coach's `triggerMetadata` key is `silence_gate` (plan text explicitly names this); Analyst's is `fact_check` — a reasonable, documented choice since the plan's Task 2 action text says only "plus any triggerMetadata update" without naming a key, and `fact_check` is the PROJECT.md-listed trigger type conceptually tied to the Analyst
- `factCheckFraming` is read from `config.configurable.factCheckFraming` rather than adding a new `GraphState` field — keeps this plan's `files_modified` scope to exactly the two node files (state.ts changes are out of scope per the plan's frontmatter)
- Text delivery mechanism (documented in both files' header comments): both nodes forward every token via `config.configurable.streamWriter(text)` and return no response-text state field (GraphState has none in this plan's scope) — for human `/invoke` this is the existing SSE queue; a future proactive invoker (Phase 14 TriggerEngine) must supply a streamWriter closure that accumulates chunks for DB insertion

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed vitest.config.ts worktree node_modules depth-probing**
- **Found during:** Task 1, running the RED test for the first time
- **Issue:** `vitest.config.ts`'s worktree-detection logic hardcoded a single relative path (`../../../apps/api/node_modules`, i.e. exactly 3 levels up from `apps/api`) to locate the main repo's `node_modules` for module aliasing. Claude Code's linked-worktree layout (`panelito/.claude/worktrees/<id>/apps/api`) is 5 levels up from the main repo root, not 3 — so the alias was never set and every test file importing any external package (including `@panelito/types`, `@anthropic-ai/sdk` transitively via `adapter-factory.ts`) failed to load with `Cannot find module`. This blocked running ANY test in this worktree, not just my new files.
- **Fix:** Changed the single hardcoded candidate to a probed range (2–8 levels up), and hardened the existence check to require a known package subdirectory (`@anthropic-ai`) inside the candidate rather than trusting a bare `statSync` on the directory itself — a prior test run had left a stray `node_modules/.vite` cache directory in the worktree that would otherwise have been mistaken for a real `node_modules` at the wrong (too-shallow) depth.
- **Files modified:** `apps/api/vitest.config.ts`
- **Verification:** `pnpm exec vitest run` now runs cleanly from this worktree (previously failed to load any test); full suite: 90/90 relevant tests pass (7 pre-existing files fail on missing `.env`, unrelated — see Known Issues)
- **Committed in:** `c736338` (part of Task 1 test commit)

Separately (not a code deviation, a local-environment step): symlinked the main repo's `node_modules` (root, `apps/api`, `packages/types`) into this worktree so `pnpm exec tsc`/`pnpm exec vitest` resolve normally. These symlinks are gitignored (`apps/api/node_modules`, `packages/types/node_modules` explicitly; the root-level `node_modules` symlink matched no ignore pattern since `node_modules/` only matches real directories, but was never staged — confirmed via `git status --short` before every commit).

---

**Total deviations:** 1 auto-fixed (1 blocking, plus a non-code local tooling setup step)
**Impact on plan:** The `vitest.config.ts` fix was necessary to run this plan's own TDD verification at all — without it, no test in the worktree (not just this plan's) could execute. No scope creep beyond the two node files this plan targets; the config fix is a narrow, well-contained bug fix.

## Issues Encountered

**Worktree was stale at spawn time** (same class of issue as Plan 01). The worktree branch (`worktree-agent-aaa12c7d9d8c7aa69`) was created before Wave 1's merge (`4c08fe8`/`406e27a`) landed on `main`, so `11-04-PLAN.md` and Plan 01's shared contracts (Personality, ArgNode citation fields, TASK_MODELS.facilitation, bot-context.ts) did not exist in the worktree. Fast-forward merged `main` into the worktree branch before starting execution — a clean, non-destructive fast-forward (28 files, no conflicts, zero divergent commits on this branch).

## Known Issues (pre-existing, out of scope)

- `apps/api/src/lib/bot-arbitrator.test.ts:136` — `TS2532` strict-mode array-index access issue, pre-existing since Phase 10 (documented in Plan 01's SUMMARY and `deferred-items.md`). Confirmed still present and unrelated to this plan's changes.
- 7 apps/api test files fail with "Missing or invalid environment variables" (no `.env` in this worktree) — pre-existing, unrelated to this plan's code.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `facilitationAgentNode`/`analyticsAgentNode` are ready to be wired into the graph topology by Plan 05 (conditional START edge) — both accept the same `config.configurable` shape (`blueprint`, `providerName`, `plaintextKey`, `personality`, node-specific adapter seam, `streamWriter`) as the existing `agentNode`/`orchestratorNode`.
- Behavioral assertions beyond this plan's unit-level checks (e.g. full-graph invocation exercising both nodes together) are deferred to Plan 05's `graph.test.ts` describe blocks, per this plan's own `<verification>` section.
- No blockers for downstream plans in this wave.

---
*Phase: 11-personality-basic-triggers*
*Completed: 2026-07-14*
