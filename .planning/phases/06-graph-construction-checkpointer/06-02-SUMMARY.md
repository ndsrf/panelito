---
phase: 06-graph-construction-checkpointer
plan: 02
subsystem: api
tags: [langgraph, postgres, checkpointer, langfuse, opentelemetry, otel, supabase, migration]

# Dependency graph
requires:
  - phase: 05-nsai-foundation
    provides: "SUPABASE_DIRECT_URL env var, @langchain/langgraph-checkpoint-postgres installed, langgraph schema created by migration 0008"
provides:
  - "sessions.current_phase TEXT NULL column (migration 0009) — BLUE-04 phase-aware prompt mutation unblocked"
  - "getCheckpointer() singleton (PostgresSaver, langgraph schema) — ORCH-05 infrastructure ready"
  - "setupLangfuseOtel() + getLangfuseSpanProcessor() — OBS-01/OBS-02 OTel trace export infrastructure ready"
  - "@langfuse/otel@5.9.1, @opentelemetry/sdk-trace-base@2.8.0, @opentelemetry/exporter-trace-otlp-http@0.219.0, @opentelemetry/core@2.8.0, @langfuse/tracing@5.9.1 installed"
affects:
  - "06-03: graph node files use getCheckpointer() for PostgresSaver integration test"
  - "06-04: server.ts wires setupLangfuseOtel() at startup"
  - "07-invoke-route: invocation route uses getCheckpointer() and passes LangfuseCallbackHandler"

# Tech tracking
tech-stack:
  added:
    - "@langfuse/otel@5.9.1 — LangfuseSpanProcessor for OTel trace export to Langfuse cloud"
    - "@opentelemetry/sdk-trace-base@2.8.0 — BasicTracerProvider wrapping LangfuseSpanProcessor"
    - "@opentelemetry/exporter-trace-otlp-http@0.219.0 — OTLP HTTP exporter (OTel peer dep)"
    - "@opentelemetry/core@2.8.0 — OTel core utilities (peer dep)"
    - "@langfuse/tracing@5.9.1 — setLangfuseTracerProvider() and getLangfuseTracerProvider() utilities"
  patterns:
    - "Lazy singleton with null guard: let _x: T | null = null; if (!_x) { _x = init(); }"
    - "OTel isolated provider: BasicTracerProvider({ spanProcessors }) + setLangfuseTracerProvider() — does NOT call provider.register() (not available on BasicTracerProvider; Langfuse uses isolated provider pattern)"
    - "Graceful OTel skip: setupLangfuseOtel() warns and returns if LANGFUSE_PUBLIC_KEY/SECRET_KEY absent — unit tests work without Langfuse credentials"

key-files:
  created:
    - "supabase/migrations/0009_sessions_current_phase.sql — ADD COLUMN sessions.current_phase TEXT NULL"
    - "apps/api/src/lib/langgraph-checkpointer.ts — getCheckpointer() PostgresSaver singleton"
    - "apps/api/src/lib/langfuse-otel.ts — setupLangfuseOtel() + getLangfuseSpanProcessor()"
  modified:
    - "apps/api/package.json — added @langfuse/otel, @opentelemetry/*, @langfuse/tracing"
    - "pnpm-lock.yaml — lockfile updated with new packages"

key-decisions:
  - "Use BasicTracerProvider (not NodeTracerProvider) from @opentelemetry/sdk-trace-base — NodeTracerProvider is in @opentelemetry/sdk-trace-node (not installed); BasicTracerProvider is sufficient for Node.js Hono runtime with Langfuse isolated provider pattern"
  - "setLangfuseTracerProvider() requires @langfuse/tracing to be installed as a direct dependency in pnpm strict mode — transitive resolution from @langfuse/otel is not sufficient for TypeScript import"
  - "provider.register() is NOT called — BasicTracerProvider lacks this method and it is not needed; Langfuse uses its own isolated TracerProvider via setLangfuseTracerProvider(), not the global OTel provider"
  - "sessions.current_phase uses NULL default (not 'opening') to avoid breaking the one existing dev session; graph treats NULL as fallback to blueprint.phase_sequence[0].id"

patterns-established:
  - "Pattern: lazy singleton for expensive async resources (PostgresSaver, OTel provider) — initialize on first use, skip on subsequent calls"
  - "Pattern: setupX() functions for server startup side effects — follow startAutoFreezeTracker() shape; actual wiring into server.ts deferred to a separate plan"
  - "Pattern: credential-gated observability — warn-and-skip when keys absent allows full test suite without external service credentials"

requirements-completed: [BLUE-04, ORCH-05, OBS-01, OBS-02]

# Metrics
duration: 25min
completed: 2026-07-02
---

# Phase 6 Plan 02: Infrastructure Bootstrap Summary

**PostgresSaver singleton bound to `langgraph` schema + LangfuseSpanProcessor via BasicTracerProvider isolated provider, with migration 0009 adding `sessions.current_phase` for BLUE-04 phase-aware prompt mutation**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-02T00:00:00Z
- **Completed:** 2026-07-02T00:25:00Z
- **Tasks:** 2 (plus 1 pre-task checkpoint already cleared by user)
- **Files modified:** 5 (2 new lib files, 1 new migration, package.json, pnpm-lock.yaml)

## Accomplishments
- Applied migration 0009 adding `sessions.current_phase TEXT NULL DEFAULT NULL` to Supabase — unblocks BLUE-04 phase-aware LLM prompt injection in plan 06-03
- Created `getCheckpointer()` singleton in `langgraph-checkpointer.ts` with mandatory `{ schema: 'langgraph' }` option and idempotent `setup()` call — ORCH-05 infrastructure ready
- Created `setupLangfuseOtel()` and `getLangfuseSpanProcessor()` in `langfuse-otel.ts` using `BasicTracerProvider` + `setLangfuseTracerProvider()` — OBS-01/OBS-02 OTel pipeline ready; gracefully skips when credentials absent

## Task Commits

Each task was committed atomically:

1. **Task 1: Apply migration 0009 + install @langfuse/otel** - `96b6024` (feat)
2. **Task 2: Create getCheckpointer() singleton and setupLangfuseOtel() bootstrap** - `4aaacec` (feat)

**Plan metadata:** (committed with SUMMARY below)

## Files Created/Modified
- `supabase/migrations/0009_sessions_current_phase.sql` — Adds `current_phase TEXT NULL DEFAULT NULL` to `public.sessions`; NULL default safe for existing dev sessions; BLUE-04 comment included
- `apps/api/src/lib/langgraph-checkpointer.ts` — Exports `getCheckpointer(): Promise<PostgresSaver>`; module-level null guard; `{ schema: 'langgraph' }` is MANDATORY (default is 'public'); logs `[langgraph-checkpointer]` prefix only, never the connection string
- `apps/api/src/lib/langfuse-otel.ts` — Exports `setupLangfuseOtel()` and `getLangfuseSpanProcessor()`; warns and returns if `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` absent; never logs key values (T-06-05)
- `apps/api/package.json` — Added `@langfuse/otel@5.9.1`, `@opentelemetry/sdk-trace-base@2.8.0`, `@opentelemetry/exporter-trace-otlp-http@0.219.0`, `@opentelemetry/core@2.8.0`, `@langfuse/tracing@5.9.1`

## Decisions Made
- Used `BasicTracerProvider` (from `@opentelemetry/sdk-trace-base`) instead of `NodeTracerProvider` (from `@opentelemetry/sdk-trace-node` — not installed). Both work for Node.js; `BasicTracerProvider` is the base class that `NodeTracerProvider` extends. For Langfuse's isolated provider pattern, the base class is sufficient.
- Did NOT call `provider.register()` — `BasicTracerProvider` does not have this method (it's added by the platform-specific `NodeTracerProvider`). The call is unnecessary because Langfuse uses `setLangfuseTracerProvider()` to store an isolated provider, not the global OTel provider.
- Added `@langfuse/tracing@5.9.1` as an explicit direct dependency (not just transitive) because pnpm strict mode requires direct imports to be direct dependencies.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added @langfuse/tracing as explicit dependency**
- **Found during:** Task 2 (TypeScript check after creating langfuse-otel.ts)
- **Issue:** `@langfuse/tracing` was available only as a transitive dependency of `@langfuse/otel` and `@langfuse/langchain`. pnpm strict mode does not allow importing from transitive-only packages — TypeScript reported `TS2307: Cannot find module '@langfuse/tracing'` because the package had no symlink in `apps/api/node_modules/@langfuse/`.
- **Fix:** `pnpm --filter @panelito/api add @langfuse/tracing@5.9.1`. Package is from the same langfuse/langfuse-js monorepo as the already-approved `@langfuse/otel` — no additional legitimacy concern.
- **Files modified:** apps/api/package.json, pnpm-lock.yaml
- **Verification:** `ls apps/api/node_modules/@langfuse/` shows `tracing` directory; `npx tsc --noEmit` no longer reports TS2307 for langfuse-otel.ts
- **Committed in:** `4aaacec` (Task 2 commit)

**2. [Rule 1 - Bug] Used BasicTracerProvider instead of NodeTracerProvider**
- **Found during:** Task 2 (inspection of @opentelemetry/sdk-trace-base exports)
- **Issue:** RESEARCH.md Pattern 4 and task instructions specified `NodeTracerProvider` from `@opentelemetry/sdk-trace-base`, but `sdk-trace-base` only exports `BasicTracerProvider`. `NodeTracerProvider` lives in `@opentelemetry/sdk-trace-node` (not installed, not needed).
- **Fix:** Used `BasicTracerProvider` from `@opentelemetry/sdk-trace-base`. Removed the `provider.register()` call (not available on `BasicTracerProvider`; not needed for Langfuse's isolated provider pattern). `setLangfuseTracerProvider(provider)` sets the provider in Langfuse's isolated global state — fully independent of the OTel global provider.
- **Files modified:** apps/api/src/lib/langfuse-otel.ts (design correction during creation)
- **Verification:** TypeScript compiles without errors for langfuse-otel.ts; `setLangfuseTracerProvider` accepts `TracerProvider` interface which `BasicTracerProvider` implements
- **Committed in:** `4aaacec` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for correct TypeScript compilation. No scope creep. The `@langfuse/tracing` addition is a direct dependency that should have been in the install list. The `BasicTracerProvider` substitution is semantically equivalent to `NodeTracerProvider` for this Langfuse isolated provider pattern.

## Issues Encountered
- The RESEARCH.md and task instructions referenced `NodeTracerProvider` from `@opentelemetry/sdk-trace-base` — this class does not exist in that package. It is in `@opentelemetry/sdk-trace-node` which extends the base with Node.js-specific runtime registration. Since Langfuse uses an isolated provider (not the global OTel provider), the base class is fully sufficient and `register()` is not needed. Resolved automatically via deviation Rule 1.

## User Setup Required
Langfuse credentials are needed for OTel trace export (OBS-01/OBS-02). Without them, `setupLangfuseOtel()` warns and skips — all unit tests pass. To enable tracing:

1. Create a Langfuse account at [cloud.langfuse.com](https://cloud.langfuse.com)
2. Go to Settings → API Keys
3. Add to `apps/api/.env`:
   ```
   LANGFUSE_PUBLIC_KEY=pk_...
   LANGFUSE_SECRET_KEY=sk_...
   ```
4. `setupLangfuseOtel()` will initialize on next server startup (plan 06-04 wires the call into server.ts)

## Known Stubs
None — no UI-facing stubs. `getCheckpointer()` requires a real Supabase connection to run `setup()`. `setupLangfuseOtel()` gracefully skips when credentials absent (intentional, not a stub).

## Threat Flags
None — no new network endpoints, auth paths, or trust boundaries beyond what was in the plan's threat model (T-06-04: SUPABASE_DIRECT_URL never logged; T-06-05: Langfuse keys never logged — both implemented as specified).

## Next Phase Readiness
- `getCheckpointer()` is ready to be imported in graph integration tests (plan 06-03)
- `setupLangfuseOtel()` is ready for server.ts wiring (plan 06-04)
- `sessions.current_phase` column exists — OrchestratorNode can read it from Supabase sessions (plan 06-03)
- Pre-existing TypeScript errors in adapter-factory.ts, routes/ai.ts, routes/keys.ts, routes/settings.ts, services/labeler.ts, and packages/types/src/\*.ts are out of scope for this plan and were not introduced by our changes

## Self-Check

- [x] `supabase/migrations/0009_sessions_current_phase.sql` exists with `ADD COLUMN IF NOT EXISTS current_phase TEXT`
- [x] `apps/api/package.json` contains `@langfuse/otel` at 5.9.1
- [x] `apps/api/src/lib/langgraph-checkpointer.ts` exports `getCheckpointer()` with `schema: 'langgraph'`
- [x] `apps/api/src/lib/langfuse-otel.ts` exports `setupLangfuseOtel()` and `getLangfuseSpanProcessor()`
- [x] No `prepare` option in langgraph-checkpointer.ts
- [x] `npx tsc --noEmit` — no new errors introduced by this plan's files (pre-existing errors in unrelated files remain)
- [x] Task commits exist: `96b6024`, `4aaacec`

---
*Phase: 06-graph-construction-checkpointer*
*Completed: 2026-07-02*
