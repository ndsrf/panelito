---
phase: 05-foundation
plan: "04"
subsystem: api-blueprint-loader
tags: [ajv, blueprint, validation, supabase, typescript, module-singleton]
dependency_graph:
  requires:
    - "05-02: domain_blueprints table with definition jsonb column and Debate Blueprint seed"
    - "05-03: BlueprintSchema exported from @panelito/types"
  provides:
    - "apps/api/src/lib/blueprint-loader.ts: module-level Ajv singleton + cached ValidateFunction + loadBlueprint() async function"
    - "apps/api/src/scripts/verify-blueprint-loader.ts: integration verification script (ALL TESTS PASSED)"
  affects:
    - "06 (Graph Construction): loadBlueprint() called to inject Blueprint ontology into LangGraph State"
tech_stack:
  added: []
  patterns:
    - "Module-level Ajv singleton (ajv = new Ajv) — single instance per process lifetime"
    - "blueprintValidator compiled ONCE at module load — not per request (BLUE-02 enforcement)"
    - "validatorCache Map<string, ValidateFunction> caches validator by blueprintId — getValidator() never re-compiles"
    - "Defense-in-depth: Ajv validates JSON shape, then BlueprintSchema.parse() produces typed value (T-05-09)"
key_files:
  created:
    - "apps/api/src/lib/blueprint-loader.ts — module-level Ajv singleton + validatorCache + loadBlueprint()"
    - "apps/api/src/scripts/verify-blueprint-loader.ts — integration verification script (dev-only, not vitest)"
  modified: []
decisions:
  - "getValidator() stores the already-compiled blueprintValidator in cache keyed by blueprintId — no re-compilation; satisfies BLUE-02 requirement that compile() is called at most once per process"
  - "Wrapped test script in async function (not top-level await) to avoid CJS ESM incompatibility with tsx default CJS output format"
  - "BLUEPRINT_JSON_SCHEMA is a module-level const (not imported) matching D-01 through D-05 exactly; edge_types required does NOT include 'description' per D-03"
  - "loadBlueprint returns BlueprintSchema.parse(data.definition) — Zod produces the typed value after Ajv validates structural shape; defense-in-depth per T-05-09"
metrics:
  duration: "~10m"
  completed_date: "2026-07-01"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 5 Plan 04: Blueprint Loader with Module-Level Ajv Singleton Summary

**One-liner:** Module-level Ajv singleton with validatorCache Map per blueprintId, blueprintValidator compiled once at module load, and loadBlueprint() returning Zod-typed Blueprint after Ajv validates the domain_blueprints JSONB definition.

## What Was Built

**apps/api/src/lib/blueprint-loader.ts** — The runtime enforcement point for BLUE-02:

1. `BLUEPRINT_JSON_SCHEMA` const — inline JSON Schema covering all Blueprint required fields (D-01 through D-05): top-level `required` array, node_types items with `description`, edge_types items WITHOUT `description` (D-03), phase_sequence items, and `additionalProperties: false`

2. `const ajv = new Ajv({ allErrors: true })` — module-level Ajv singleton; single instance for the entire process lifetime

3. `const blueprintValidator: ValidateFunction = ajv.compile(BLUEPRINT_JSON_SCHEMA)` — compiled ONCE at module load, never inside any function; this is the critical BLUE-02 constraint

4. `const validatorCache = new Map<string, ValidateFunction>()` — module-level cache keyed by blueprintId; `getValidator()` stores the pre-compiled validator under each blueprintId — no re-compilation ever occurs

5. `getValidator(blueprintId)` — internal helper; on first call for a blueprintId, stores `blueprintValidator` in the cache; subsequent calls return immediately from cache

6. `export async function loadBlueprint(blueprintId: string): Promise<Blueprint>` — the only public export; queries `domain_blueprints` via service role client (bypasses RLS), runs Ajv validate, runs BlueprintSchema.parse, returns typed Blueprint

**apps/api/src/scripts/verify-blueprint-loader.ts** — Integration verification script:

- Test A: `loadBlueprint("debate-strategy-v1")` returns Blueprint with id, canvas_view_mode="graph", node_types.length=4, edge_types.length=4, phase_sequence.length=3, active_persona_ids includes "analista_cientifico"
- Test B: `loadBlueprint("nonexistent-blueprint")` throws error starting with "Blueprint not found:"
- Test C: second call to `loadBlueprint("debate-strategy-v1")` succeeds (cache hit; no crash)
- All 3 tests pass; script prints "ALL TESTS PASSED"

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm --filter @panelito/api typecheck` | exit 0 |
| `blueprintValidator` at module scope (not inside function) | Confirmed at line 91 |
| `validatorCache` declared at module scope as Map | Confirmed at line 98 |
| `ajv.compile(` in real executable code | Exactly 1 (line 91) |
| Only `loadBlueprint` exported | Confirmed — no other exports |
| Test A: loadBlueprint('debate-strategy-v1') returns valid Blueprint | PASS |
| Test B: nonexistent-blueprint throws "Blueprint not found:" | PASS |
| Test C: second loadBlueprint call succeeds (cache hit) | PASS |
| grep "PASS" count | 4 (3 test + "ALL TESTS PASSED") |

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement blueprint-loader.ts | 98869dd | apps/api/src/lib/blueprint-loader.ts |
| 2 | Write + run verification script | 81171b4 | apps/api/src/scripts/verify-blueprint-loader.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Top-level await not supported in CJS output**

- **Found during:** Task 2 (running the verification script)
- **Issue:** Initial script used top-level `await` at module scope. `tsx` defaults to CommonJS output format which does not support top-level await, causing: `ERROR: Top-level await is currently not supported with the "cjs" output format`
- **Fix:** Wrapped all test logic in an `async function runTests()` and called it with `.catch()` at the end — standard Node.js async entry point pattern
- **Files modified:** `apps/api/src/scripts/verify-blueprint-loader.ts`
- **Commit:** 81171b4 (same commit; fix applied before committing)

**Total deviations:** 1 auto-fixed (Rule 1 — bug in test script execution)
**Impact on plan:** Zero scope change. Script runs correctly and all tests pass.

## BLUE-02 Compliance Proof

The plan's critical requirement BLUE-02 ("compiled validators cached per blueprintId — never per request") is verified structurally:

- `ajv.compile(BLUEPRINT_JSON_SCHEMA)` appears exactly once in executable code (line 91), at module scope
- `getValidator()` contains zero `ajv.compile()` calls — it only reads/writes the `validatorCache` Map
- `loadBlueprint()` contains zero `ajv.compile()` calls — it calls `getValidator()` which returns from cache

## Threat Model Coverage

| Threat ID | Status |
|-----------|--------|
| T-05-09 (Blueprint definition tampering) | Mitigated — Ajv validates definition column before BlueprintSchema.parse; double-validation defense-in-depth |
| T-05-10 (Blueprint injection via blueprintId) | Mitigated — .eq("id", blueprintId).single() parameterized via Supabase JS client; FK constraint on sessions.blueprint_id |
| T-05-11 (DoS via ajv.compile per request) | Mitigated — blueprintValidator compiled once at module load; getValidator() only accesses Map |

## Known Stubs

None — loadBlueprint() queries real Supabase DB and returns real typed Blueprint data. Verified against local Supabase instance with the seeded Debate/Strategy Blueprint.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. The trust boundary (blueprintId → DB query) was covered in the plan's threat model and mitigated.

## Self-Check: PASSED

- apps/api/src/lib/blueprint-loader.ts: FOUND
- apps/api/src/scripts/verify-blueprint-loader.ts: FOUND
- Commit 98869dd: FOUND (feat(05-04): implement blueprint-loader.ts)
- Commit 81171b4: FOUND (feat(05-04): add verify-blueprint-loader.ts)
