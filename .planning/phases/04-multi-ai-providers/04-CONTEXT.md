# Phase 4: Multi-AI Providers - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend the `AIProvider` abstraction layer so OpenAI (via `openai` npm SDK) and Gemini (via `@google/genai` v2 SDK) can drive the full split-screen experience — streaming chat and `render_panel` tool calls — identically to the existing Anthropic adapter. The creator selects their preferred provider in `/settings`; the rest of the app is provider-unaware.

**Requirements in scope:**
- Refactor `AIProvider` interface to use provider-agnostic types (own types, not Anthropic SDK imports)
- Add `capabilities()` method to `AIProvider` interface
- Implement `OpenAIAdapter` and `GeminiAdapter` behind the existing interface
- Extend `/settings` UI to support 3-provider BYOK (key entry + validation + icon selector)
- Add task-to-model config mapping per provider
- Ensure all 3 providers produce valid `render_panel` tool calls during streaming

**Out of scope for Phase 4:**
- Per-session provider switching or mid-session switching
- Context caching, semantic caching, image generation, voice processing (declared in interface, not implemented)
- Per-provider system prompt variants (all providers use one shared neutral prompt)
- Auto-fallback between providers on quota error
- Devil's Advocate or other personas (Phase 3+)
- Conversation branching provider isolation (Phase 3)

</domain>

<decisions>
## Implementation Decisions

### Interface Refactoring (D-01 – D-04)

- **D-01:** Replace Anthropic-specific types in `AIProvider.stream()` with own provider-agnostic types defined in `packages/types/src/ai.ts`:
  ```typescript
  export interface ProviderMessage {
    role: 'user' | 'assistant' | 'system'
    content: string
  }
  export interface ProviderTool {
    name: string
    description: string
    parameters: Record<string, unknown> // JSON Schema
  }
  export interface AIProvider {
    capabilities(): ProviderCapabilities
    stream(
      messages: ProviderMessage[],
      tools: ProviderTool[],
      options: { model: string; maxTokens: number; system?: string }
    ): AsyncIterable<AIStreamEvent>
  }
  ```
  No Anthropic SDK imports remain in the interface. Each adapter converts internally.

- **D-02:** `AIProvider` gains a `capabilities()` method returning a `ProviderCapabilities` object. This drives conditional UI and route behavior. Phase 4 implements only `streaming` and `toolUse` as `true`. All other capabilities default to `false` but must be declared in the interface for future extension:
  ```typescript
  export interface ProviderCapabilities {
    streaming: boolean
    toolUse: boolean
    contextCaching: boolean     // Phase 5+
    semanticCaching: boolean    // Phase 5+
    imageInput: boolean         // Phase 5+
    voiceInput: boolean         // Phase 5+
    compression: boolean        // Phase 5+
  }
  ```
  UI elements (e.g., panel widget rendering) are disabled with a graceful fallback if the active provider returns `toolUse: false`. All 3 Phase 4 adapters MUST return `toolUse: true` — see D-14.

- **D-03:** All AI tasks (chat streaming, history compression, categorization, etc.) use the active provider with a **task-to-model mapping** from config. No hardwired Claude Haiku for compression — some users may only have a Gemini or OpenAI key.

- **D-04:** Task-to-model mapping is stored in `.planning/config.json` (or a dedicated `provider-models.json`) with the following structure:
  ```json
  {
    "providers": {
      "anthropic": {
        "models": {
          "analysis": "claude-sonnet-4-6",
          "compression": "claude-haiku-4-5-20251001",
          "categorization": "claude-haiku-4-5-20251001"
        }
      },
      "openai": {
        "models": {
          "analysis": "gpt-4o",
          "compression": "gpt-4o-mini",
          "categorization": "gpt-4o-mini"
        }
      },
      "gemini": {
        "models": {
          "analysis": "gemini-2.0-flash",
          "compression": "gemini-2.0-flash",
          "categorization": "gemini-2.0-flash"
        }
      }
    }
  }
  ```
  The researcher must validate and finalize these model names (especially Gemini — version naming changes frequently). The task taxonomy (`analysis`, `compression`, `categorization`) should be determined by the researcher based on actual usage patterns in Phase 2/3.

### Provider Selection UX (D-05 – D-08)

- **D-05:** Provider selection is a **global `/settings` preference** — not per-session. One provider active at a time for all sessions. Switching is instant (update settings, new sessions use the new provider).

- **D-06:** Model selection is **automatic** — no user-facing model picker. The task-to-model config (D-04) determines which model is used per task type. Users should not need to know model names.

- **D-07:** If the AI call fails in a live session (quota, invalid key, network): surface an error message **in chat** (visible to all participants), session continues. No auto-fallback to another provider. Creator resolves by updating key in `/settings`.

- **D-08:** **No mid-session provider switching.** Provider is set in `/settings` before starting any session. CreatorControls drawer does not expose provider switching.

### BYOK Multi-Provider (D-09 – D-13)

- **D-09:** `/settings` page shows **three separate provider sections** (Anthropic, OpenAI, Gemini), each with:
  - Provider icon (color = currently active, grey = not selected)
  - API key input field (masked)
  - Validation status badge (✓ Valid / ✗ Invalid / ○ Not set)
  - Provider selection radio/click behavior (clicking an icon activates that provider)
  - Provider selection and key management are **integrated** in one `/settings` view — no separate dropdown.

- **D-10:** Key validation is **upfront on save** — consistent with existing `verifyApiKey()` in `apps/api/src/routes/keys.ts`. On save, call a test endpoint for the provider. Only persist if verification passes. Extend the existing keys route to support multiple providers.

- **D-11:** Keys stored **encrypted in Supabase user_metadata**, same pattern as existing Claude key (Phase 1). Keys are namespaced by provider: `anthropic_api_key`, `openai_api_key`, `gemini_api_key`. No new DB migration required.

- **D-12:** Keys for **inactive providers persist silently** — no deletion when switching active provider. Switching back to a previously-configured provider is instant.

- **D-13:** The active provider must be persisted too (e.g., `active_provider: "openai"` in user_metadata). The route layer reads this on session init to instantiate the correct adapter.

### Feature Parity (D-14 – D-17)

- **D-14:** **Full parity required** for Phase 4. All 3 providers (Anthropic, OpenAI, Gemini) MUST produce valid `render_panel` tool calls during streaming. If research discovers a provider cannot reliably do streaming + tool use for `render_panel`, that adapter is NOT shipped in Phase 4. No partial panel support.

- **D-15:** Gemini adapter uses **`@google/genai`** (the v2 SDK). Do NOT use `@google/generative-ai` (the legacy v1 SDK). Research must validate that `@google/genai` supports streaming function calling for `render_panel`.

- **D-16:** One **provider-neutral system prompt** for all providers. The `AIProvider` interface includes optional `systemPromptOverride?` per provider (declared but unused in Phase 4). All 3 Phase 4 adapters use the same shared system prompt without modification.

- **D-17:** UI and route code conditionally disables features based on `capabilities()`. For Phase 4, since all 3 adapters return `toolUse: true` and `streaming: true`, the panel always renders. Future capability additions (image input, voice) automatically gate their UI when the active provider returns `false`.

### Claude's Discretion

- Exact `ProviderCapabilities` interface shape (additional fields beyond what's listed in D-02 if the researcher discovers they're needed)
- The exact verification endpoint approach per provider (OpenAI and Gemini have different "test call" patterns vs Anthropic's `verifyApiKey`)
- Whether the task-to-model config lives in `.planning/config.json` or a dedicated file
- Error message wording shown in chat when provider fails (D-07)
- Exact Supabase user_metadata key names (may differ from the examples in D-11)
- How `AnthropicAdapter` is refactored to accept `ProviderMessage[]` instead of `MessageParam[]` — adapter must convert internally with minimal changes to route logic

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing AIProvider Abstraction (start here)
- `apps/api/src/lib/ai-provider.ts` — Current `AIProvider` interface + `AnthropicAdapter`. This is what Phase 4 refactors. Read before writing any new adapter.
- `apps/api/src/lib/ai-provider.test.ts` — Existing tests for the interface and AnthropicAdapter. All tests must continue passing after interface refactor.
- `.planning/phases/02-ai-analytics/02-CONTEXT.md` — Decision D-03 (original AIProvider design intent), D-16 (context assembly), D-17 (bot activation matrix). Phase 4 must not break the invariants established here.
- `.planning/phases/02-ai-analytics/02-01-SUMMARY.md` — Lists all files created/modified in 02-01, including `ai-provider.ts` and how it's consumed by the route.

### BYOK Key Management (existing pattern to extend)
- `apps/api/src/routes/keys.ts` — Current key storage and `verifyApiKey()`. Phase 4 extends this to support multiple providers.
- `apps/api/src/routes/settings.ts` — Current `/settings` endpoint (if exists). Phase 4 updates the settings page.

### Project & Requirements
- `.planning/PROJECT.md` — Core constraints: AI coupling note ("abstraction layer should be clean to allow v2 swap-in"), BYOK constraint, solo dev constraint.
- `.planning/REQUIREMENTS.md` — Full v1 requirements. Phase 4 adds no new functional requirements — it extends the AI integration pattern established in AI-01..08.
- `.planning/ROADMAP.md` — Phase 4 is a new phase not yet in the roadmap. Planner must add it.
- `CLAUDE.md` (project root) — Stack: `@anthropic-ai/sdk`, Next.js 15, Hono, Supabase. Also lists what NOT to use (D3, tRPC, Redux, etc.).

### Technology (research targets)
- `@google/genai` — Google GenAI v2 SDK. Researcher must validate streaming + function calling support for `render_panel`.
- `openai` npm SDK — OpenAI TypeScript SDK. Researcher must validate streaming + tool_calls behavior matches `AIStreamEvent` contract.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/lib/ai-provider.ts` — `AIProvider` interface, `AnthropicAdapter`, `renderPanelTool` — Phase 4 refactors the interface and adds 2 new adapters alongside the existing one
- `apps/api/src/routes/keys.ts` — Key storage and `verifyApiKey()` pattern — extend to support `provider` parameter
- `packages/types/src/panel.ts` — `PanelWidgetSchema` discriminated union — all providers must produce valid payloads that pass this schema (unchanged)
- `apps/web/components/workspace/AnalyticsPanel.tsx` — Error boundary for panel — provider-agnostic by design (reads from Zustand panelStore)

### Established Patterns
- **Phase 2 D-03 pattern:** Route logic never imports from a specific provider SDK. The adapter handles all SDK-specific code. Route imports only `AIProvider`, `AIStreamEvent`, `ProviderMessage`, `ProviderTool`.
- **Validation gate:** `PanelWidgetSchema.safeParse()` before any panelStore update — ALL providers must produce JSON that passes this schema validation (AI-05). Adapters should not weaken this.
- **contentBlock pattern (Phase 2 02-01):** Tool use JSON is only emitted after FULL accumulation, never from streaming chunks. This pattern must be replicated in OpenAI and Gemini adapters (both have analogous events).
- **compressHistory() short-circuit:** Returns immediately on empty input — preserve this optimization when refactoring to be provider-aware.

### Integration Points
- `apps/api/src/routes/ai.ts` — The `/invoke` SSE route instantiates `AnthropicAdapter`. Phase 4 replaces this with a factory that reads `active_provider` from session context and returns the appropriate adapter.
- `apps/web/app/(workspace)/settings/page.tsx` (or equivalent) — Current settings page with Claude key input. Phase 4 replaces with multi-provider UI.

</code_context>

<specifics>
## Specific Ideas

- **Provider icon selector:** In `/settings`, show Anthropic/OpenAI/Gemini icons in a row. Active provider = full color icon. Inactive = greyed. Clicking an icon both selects the provider AND jumps to its key section.
- **Task-to-model config** must include at minimum: `analysis` (primary chat/streaming model), `compression` (history compression), `categorization`. Researcher determines whether additional task types exist and finalizes model names.
- **Capability registry shape** defined in `packages/types/src/ai.ts` alongside `ProviderMessage` and `ProviderTool` — all in one file.
- **System prompt approach:** One neutral system prompt (no "Claude" references). Adapter interface includes optional `systemPromptOverride?` field in the `options` param for future use, but Phase 4 never sets it.

</specifics>

<deferred>
## Deferred Ideas

- **Context caching** (Anthropic feature) — declared in `ProviderCapabilities` but not implemented in Phase 4. Future phase.
- **Semantic caching** — session-level caching of similar prompts. Not in Phase 4.
- **Image generation** — `imageInput: boolean` in capabilities. Not implemented Phase 4.
- **Voice processing** — `voiceInput: boolean` in capabilities. Not implemented Phase 4.
- **Per-provider system prompt overrides** — interface slot declared but unused in Phase 4.
- **Auto-fallback between providers** on quota error — considered and deferred. Would require knowing which keys are valid upfront and adds significant complexity.
- **Per-session provider selection** — global settings only for Phase 4.
- **Mid-session provider switching** — not supported in Phase 4.

</deferred>

---

*Phase: 4-Multi-AI Providers*
*Context gathered: 2026-06-17*
