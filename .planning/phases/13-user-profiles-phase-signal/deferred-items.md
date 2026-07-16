# Deferred Items — Phase 13

Pre-existing failures discovered during 13-01 execution while verifying `pnpm exec tsc --noEmit`
and running the apps/api test suite. Confirmed NOT caused by 13-01's changes (reproduced
identically with 13-01's edits reverted). Out of scope per executor scope-boundary rule — logged
here, not fixed.

## 1. `src/lib/silence-scan.test.ts` — 5 failing tests (pre-existing)

Behaviors 2, 3, 4a, 4b, 5 all assert mocked collaborators (`mockCheckSilenceGate`,
`mockRunArbitration`, `mockCheckBotBudget`, `graph.invoke`) were called, but the spies report
zero calls. Reproduced by reverting the sole 13-01 diff to this file (adding
`phase_readiness_gate` to the `debateBlueprint` fixture) — same 5 failures, same call counts.
Likely a vi.mock hoisting/reset issue or an unrelated regression in `runSilenceScan` predating
Phase 13. Needs investigation independent of this plan.

## 2. `src/routes/ai.test.ts` — suite fails to collect (pre-existing)

```
Error: Cannot find module 'hono/streaming' imported from '.../apps/api/src/routes/ai.ts'.
```

Module resolution failure at import time — unrelated to any Phase 13 schema change (fails before
any test body runs). Likely a `hono` version/exports-map mismatch or a missing `vite-tsconfig-paths`
plugin in the vitest config. Needs investigation independent of this plan.
