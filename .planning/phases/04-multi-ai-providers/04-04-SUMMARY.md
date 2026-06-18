---
phase: 04-multi-ai-providers
plan: "04"
subsystem: ai-wiring
tags: [ai, routing, settings-ui, provider-agnostic, schema-gate, compressHistory, multi-provider]
dependency_graph:
  requires:
    - apps/api/src/lib/adapter-factory.ts (createAdapter — Plan 02)
    - apps/api/src/lib/model-config.ts (TASK_MODELS — Plan 02)
    - packages/types/src/ai.ts (AIProvider, ProviderName, renderPanelTool — Plan 01)
    - packages/types/src/panel.ts (PanelWidgetSchema — Phase 2)
    - packages/types/src/api-key.ts (MultiProviderStatus — Plan 03)
    - apps/api/src/routes/keys.ts (multi-provider verify/active-provider routes — Plan 03)
  provides:
    - apps/api/src/routes/ai.ts (provider-agnostic /invoke route using createAdapter + schema gate)
    - apps/api/src/lib/anthropic.ts (compressHistory accepting AIProvider + model string)
    - apps/web/app/(protected)/settings/settings-form.tsx (three-provider selector UI)
    - apps/web/lib/creator-settings.ts (getKeyStatus returning MultiProviderStatus)
  affects:
    - apps/web/app/(protected)/settings/page.tsx (passes keyStatus instead of last4)
tech_stack:
  added: []
  patterns:
    - createAdapter(providerName, plaintextKey) called once; adapter reused for compression + streaming (D-03)
    - Dynamic column resolution: ${providerName}_api_key for multi-provider key lookup
    - PanelWidgetSchema.safeParse gate on render_panel before panel_update SSE (AI-05, T-04-12)
    - compressHistory uses adapter.stream() iterable; accumulates text_delta; ignores tool_use
    - Three-provider card UI: grid grid-cols-1 md:grid-cols-3; active card ring-2 ring-primary
    - Per-provider prefix hint in validation errors (sk-ant-/sk-/AI...)
key_files:
  created: []
  modified:
    - apps/api/src/routes/ai.ts (provider-agnostic /invoke, schema gate, createAdapter, TASK_MODELS)
    - apps/api/src/lib/anthropic.ts (compressHistory signature: AIProvider + model + messages)
    - apps/api/src/lib/ai-provider.test.ts (compressHistory test updated to 3-arg signature)
    - apps/web/app/(protected)/settings/settings-form.tsx (three-provider selector UI)
    - apps/web/app/(protected)/settings/page.tsx (keyStatus prop instead of last4)
    - apps/web/lib/creator-settings.ts (getKeyStatus returns MultiProviderStatus)
decisions:
  - "Adapter instantiated once before compression + streaming (not twice) — same instance serves both tasks under the active provider (D-03)"
  - "compressHistory signature changed from (client: Anthropic, messages) to (adapter: AIProvider, model, messages) — uses adapter.stream() AsyncIterable to accumulate text; no direct Anthropic SDK call"
  - "PanelWidgetSchema.safeParse gate: invalid render_panel payloads dropped with console.error + no SSE written; does not crash the stream (AI-05, T-04-12)"
  - "ProviderCard is an inner component (not exported); keeps all per-provider state (keyInput, verifying, verifyError) local to avoid cross-card state pollution"
  - "settings-form.tsx fetches active_provider decision from keyStatus.active_provider (server-rendered); no client-side toggle state — router.refresh() triggers server re-fetch after PUT (D-08)"
metrics:
  duration_minutes: 15
  completed: "2026-06-18"
  tasks_completed: 2
  files_changed: 6
---

# Phase 04 Plan 04: Provider Wiring + Settings UI Summary

**One-liner:** /invoke route wired to createAdapter(active_provider) with PanelWidgetSchema gate; compressHistory uses active provider's adapter; /settings replaced with three-provider card selector calling /api/keys/verify and /api/keys/active-provider.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Provider-aware compressHistory + refactor /invoke to adapter factory with schema gate | 1c53d86 | routes/ai.ts, lib/anthropic.ts, ai-provider.test.ts |
| 2 | Multi-provider settings UI + creator-settings helper | ba3dc06 | settings-form.tsx, page.tsx, creator-settings.ts |
| 3 | Verify multi-provider end-to-end | — | (checkpoint: awaiting human verification) |

## What Was Built

**apps/api/src/routes/ai.ts** (refactored):
- Removed `import Anthropic from '@anthropic-ai/sdk'` and `AnthropicAdapter` import
- Imports: `createAdapter` from `../lib/adapter-factory`; `TASK_MODELS` from `../lib/model-config`; `renderPanelTool, PanelWidgetSchema, ProviderName` from `@panelito/types`
- Creator settings select changed to `anthropic_api_key, openai_api_key, gemini_api_key, active_provider`
- `providerName` resolved as `(creatorSettings?.active_provider ?? 'anthropic') as ProviderName`
- Encrypted key column resolved as `creatorSettings?.[${providerName}_api_key]`; returns `no_api_key` (400) if absent
- `adapter = createAdapter(providerName, plaintextKey)` instantiated once; used for both `compressHistory` and `adapter.stream()`
- `compressHistory` call changed to `compressHistory(adapter, TASK_MODELS[providerName].compression, olderMessages)`
- `adapter.stream()` passes `{ model: TASK_MODELS[providerName].analysis, maxTokens: 2048, system: BASE_SYSTEM_PROMPT + '\n\n' + personaInstructions }`
- `render_panel` tool_use events: `PanelWidgetSchema.safeParse(event.input)` gates emission; success writes `panel_update` SSE; failure logs + drops (AI-05, T-04-12)

**apps/api/src/lib/anthropic.ts** (compressHistory):
- Signature: `compressHistory(adapter: AIProvider, model: string, messages: Message[]): Promise<string>`
- First line: `if (messages.length === 0) return ''` — short-circuit preserved
- Uses `adapter.stream([compressionMessage], [], { model, maxTokens: 512, system: '...' })`
- Accumulates `text_delta` events into a string; returns after `done`; ignores `tool_use`
- `Anthropic` import retained (still used by `verifyApiKey`); `AIProvider` added to imports

**apps/api/src/lib/ai-provider.test.ts** (updated):
- `compressHistory` test updated: mock is a `{ stream: vi.fn(), capabilities: vi.fn() }` object; called with 3 args `(mockAdapter, 'test-model', [])`; asserts `mockAdapter.stream` not called on empty input

**apps/web/app/(protected)/settings/settings-form.tsx** (rewritten):
- Props changed: `{ settings: CreatorSettings, keyStatus: MultiProviderStatus }`
- Three `ProviderCard` inner components: one each for `anthropic`, `openai`, `gemini`
- Each card: provider label; masked key or "Sin clave configurada"; key input + "Verificar y guardar" button; per-provider prefix error copy; "Usar como proveedor activo" button (hidden when is_active)
- Active card: `ring-2 ring-primary` border + "Activo" badge; inactive: `opacity-80`
- Grid: `grid grid-cols-1 md:grid-cols-3 gap-3` for mobile-stacking
- `handleActivate` calls `apiFetch('/api/keys/active-provider', { method: 'PUT', body: JSON.stringify({ provider }) })` + `router.refresh()`
- `handleVerify` calls `apiFetch('/api/keys/verify', { method: 'POST', body: JSON.stringify({ provider, key }) })` + `router.refresh()`
- AI Response Cap card preserved below, unchanged

**apps/web/app/(protected)/settings/page.tsx** (updated):
- `getKeyStatus()` now returns `MultiProviderStatus`; page passes `keyStatus={keyStatus}` to `SettingsForm`
- Description text updated to mention "AI" generically (not just Anthropic)

**apps/web/lib/creator-settings.ts** (updated):
- `getKeyStatus()` return type: `MultiProviderStatus` (imported from `@panelito/types`)
- Fetches `GET /api/keys/status` which returns `MultiProviderStatus`
- Safe default on error: `{ active_provider: 'anthropic', providers: [{...false for all 3}] }`

## Verification Results

- `npx tsc --noEmit` in `apps/api`: exit 0 (clean)
- `npx tsc --noEmit` in `apps/web`: exit 0 (clean)
- `npx vitest run src/lib/ai-provider.test.ts`: 8/8 tests pass
- `grep createAdapter( apps/api/src/routes/ai.ts`: present
- `grep PanelWidgetSchema.safeParse apps/api/src/routes/ai.ts`: present
- `grep -L "@anthropic-ai/sdk" apps/api/src/routes/ai.ts`: no sdk import
- `grep active_provider apps/api/src/routes/ai.ts`: present (in select and providerName resolution)
- `grep md:grid-cols-3 apps/web/.../settings-form.tsx`: present
- `grep MultiProviderStatus apps/web/lib/creator-settings.ts`: present

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] compressHistory test used old 2-argument signature**
- **Found during:** Task 1 — `npx tsc --noEmit` reported TS2554 (Expected 3 arguments, but got 2) in `ai-provider.test.ts` line 166
- **Issue:** The test called `compressHistory(mockClient as never, [])` with the old `(client: Anthropic, messages)` signature. After the signature change to `(adapter: AIProvider, model: string, messages)`, this became a TypeScript error and the test's mock shape was wrong (Anthropic client vs AIProvider adapter)
- **Fix:** Updated test to use a `{ stream: vi.fn(), capabilities: vi.fn() }` mock adapter and called `compressHistory(mockAdapter as never, 'test-model', [])` with 3 args. Asserts `mockAdapter.stream` not called (short-circuit behavior preserved).
- **Files modified:** `apps/api/src/lib/ai-provider.test.ts`
- **Commit:** 1c53d86

## Known Stubs

None. All implemented functionality is fully wired:
- `/invoke` route reads `active_provider` from DB and uses `createAdapter()` — not hardcoded
- Settings UI calls real API endpoints (`/api/keys/verify` + `/api/keys/active-provider`)
- `compressHistory` uses the adapter's `stream()` AsyncIterable — no hardcoded Anthropic client

## Threat Flags

All STRIDE threats from the plan's threat model were applied:

| Threat ID | Status | Implementation |
|-----------|--------|----------------|
| T-04-12 | Mitigated | `PanelWidgetSchema.safeParse(event.input)` gate added in /invoke before panel_update SSE; invalid dropped silently with `console.error` |
| T-04-13 | Accepted | Key decrypted server-side only; held in memory for request duration; never written to SSE |
| T-04-14 | Accepted | Adapters yield `done` in `finally` (Plans 01-02); existing SSE `catch` closes stream on error |
| T-04-15 | Mitigated | On stream error: generic `stream_failed` SSE emitted; no provider-specific detail included |

## Checkpoint: Human Verification Required (Task 3)

Task 3 is a `checkpoint:human-verify` (gate="blocking"). Two auto tasks (1 and 2) are complete and committed. Human verification required before phase is considered complete.

**Verification steps:**
1. Start dev servers and open `/settings` — confirm three provider cards render and stack on narrow viewport
2. Enter a valid OpenAI key (sk-...) and an invalid one — confirm invalid key rejected with Spanish error; valid key shows ✓/last4
3. Click OpenAI card "Usar como proveedor activo" — confirm OpenAI card shows ring + "Activo" badge, others are opacity-80
4. Open a session, trigger AI — confirm chat streams AND analytics panel renders a valid widget under OpenAI
5. Switch active provider to Gemini (with valid Gemini key) and repeat step 4 — confirm parity
6. Confirm session feels identical to participants under each provider

## Self-Check

- [x] apps/api/src/routes/ai.ts contains `createAdapter(` and reads `active_provider`
- [x] apps/api/src/routes/ai.ts contains `PanelWidgetSchema.safeParse`
- [x] apps/api/src/routes/ai.ts has no `from '@anthropic-ai/sdk'` import
- [x] apps/api/src/routes/ai.ts has no `new AnthropicAdapter`
- [x] apps/api/src/lib/anthropic.ts compressHistory takes `AIProvider` and `model` string as first two args
- [x] apps/api/src/lib/anthropic.ts preserves `if (messages.length === 0) return ''` as first line of compressHistory
- [x] apps/web/lib/creator-settings.ts getKeyStatus returns `MultiProviderStatus` with 3-provider default
- [x] apps/web/.../settings-form.tsx references 'anthropic', 'openai', 'gemini'
- [x] apps/web/.../settings-form.tsx calls `/api/keys/verify` and `/api/keys/active-provider`
- [x] apps/web/.../settings-form.tsx uses `md:grid-cols-3` responsive grid
- [x] apps/web/.../settings-form.tsx uses `ring-2 ring-primary` for active provider
- [x] Commits 1c53d86, ba3dc06 confirmed in git log
- [x] TypeScript clean on both apps/api and apps/web (tsc --noEmit exit 0)
- [x] All 8 tests pass

## Self-Check: PASSED
