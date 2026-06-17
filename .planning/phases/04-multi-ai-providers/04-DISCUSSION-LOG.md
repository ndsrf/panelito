# Phase 4: Multi-AI Providers - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 4-multi-ai-providers
**Areas discussed:** Interface refactor, Provider selection UX, BYOK multi-provider, Feature parity commitment

---

## Scope / Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Add as Phase 4 (after v1) | Keep v1 intact, add multi-provider as clean new phase after Phase 2+3 | |
| Pull into v1 now (new Phase 4) | Add to current v1 roadmap immediately | ✓ |
| Start a v2 milestone | Separate v2 milestone, keep v1 clean | |

**User's choice:** Pull into v1 now — treating as Phase 4 in the v1 roadmap.
**Notes:** Driver is Claude API cost/quota limits. Some users may only have OpenAI or Gemini keys. Multi-provider support is needed before v1 can be fully deployed.

---

## Interface Refactor

### Message and Tool Types

| Option | Description | Selected |
|--------|-------------|----------|
| Own simple types | Define ProviderMessage/ProviderTool in packages/types, zero external deps | ✓ |
| Keep Anthropic types in interface | OpenAI/Gemini adapters convert Anthropic format internally | |

**User's choice:** Own simple types.

### History Compression Provider

| Option | Description | Selected |
|--------|-------------|----------|
| Always Claude Haiku | Hardwire compression to Claude Haiku regardless of active provider | |
| Use active provider | Compress with the same provider the user selected | ✓ |

**User's choice:** Use active provider — with task-to-model mapping from config.
**Notes:** User provided rich rationale: "some users might have a Claude key while others might only have a Gemini one." Introduced the concept of a task-to-model config mapping (analysis, compression, categorization, semantic caching, etc.) stored in a config file and reviewed periodically. This became decision D-03 and D-04.

---

## Provider Selection UX

### When to Select Provider

| Option | Description | Selected |
|--------|-------------|----------|
| Global /settings | One provider for all sessions, set once | ✓ |
| Per session at creation | Provider picker in Create Session form | |
| Both — global default + per-session override | Default in settings, override per session | |

**User's choice:** Global /settings.

### Model Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed sensible default per provider | Auto-selected, no user choice | ✓ |
| Dropdown of curated models per provider | Short list 2-3 per provider | |
| Free text model input | Any model name | |

**User's choice:** Automatic model selection with defaults in config per provider per task.
**Notes:** User emphasized that different tasks need different models (categorization is not the same as analysis). Task-to-model mapping in config file, reviewable periodically.

### AI Call Failure in Live Session

| Option | Description | Selected |
|--------|-------------|----------|
| Show error in chat, session continues | Error visible in chat bubble | ✓ |
| Auto-fallback to another provider | Try next available key | |
| Freeze AI slot, surface error to creator only | Private admin alert | |

**User's choice:** Show error in chat, session continues.

### Mid-Session Provider Switching

| Option | Description | Selected |
|--------|-------------|----------|
| No — set in /settings before session | Simple and predictable | ✓ |
| Yes — CreatorControls drawer | More flexible | |

**User's choice:** No mid-session switching.

---

## BYOK Multi-Provider

### Settings Page Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Three separate key sections | Each provider has own section with icon + key + status | ✓ |
| Single key input switching by provider | One field, relabeled by selection | |

**User's choice:** Three separate sections.
**Notes:** User specified visual design: "show the icons for each provider (openai, claude, gemini) and highlight the selected one (in color while the not selected are shown in grey)."

### Key Validation Timing

| Option | Description | Selected |
|--------|-------------|----------|
| Upfront — verify immediately on save | Consistent with existing verifyApiKey() | ✓ |
| Lazy — fail on first real use | Less round-trips | |

**User's choice:** Upfront validation.

### Key Storage Security Model

| Option | Description | Selected |
|--------|-------------|----------|
| Encrypted in Supabase user_metadata | Same as existing Claude key | ✓ |
| Separate keys table in Supabase | New migration, more structured | |

**User's choice:** Supabase user_metadata (consistent with Phase 1).

### Keys for Inactive Providers

| Option | Description | Selected |
|--------|-------------|----------|
| Keys persist silently | All saved keys stay regardless of active provider | ✓ |
| Clear inactive keys on switch | Delete previous keys when switching | |

**User's choice:** Keys persist silently.

### Active Provider Indicator

| Option | Description | Selected |
|--------|-------------|----------|
| Active provider badge on settings row | 'Active' badge on selected provider | |
| Separate dropdown + key sections | Provider selection separate from key input | |
| Color icons (active) / grey icons (inactive) | Visual icon-based selector | ✓ |

**User's choice:** Color icons (active) / grey icons (inactive). Provider icons visible for all 3 providers at once.

---

## Feature Parity Commitment

### Panel Parity Requirement

| Option | Description | Selected |
|--------|-------------|----------|
| Full parity required | All 3 providers MUST drive the panel | ✓ |
| Graceful degradation | Panel freezes if tool call fails | |
| Text-only providers allowed | Static panel placeholder for some providers | |

**User's choice:** Full parity required. If a provider can't do render_panel, it's not shipped.

### Gemini SDK

| Option | Description | Selected |
|--------|-------------|----------|
| js-genai only (@google/genai) | v2 SDK as specified | ✓ |
| Evaluate both SDKs | Compare and pick | |

**User's choice:** @google/genai only.

### System Prompt

| Option | Description | Selected |
|--------|-------------|----------|
| One provider-neutral system prompt | Same prompt for all | ✓ |
| Per-provider system prompt variants | Optimize per provider | |

**User's choice:** Provider-neutral system prompt with optional per-provider override capability declared in interface, unused in Phase 4.

### Future Capabilities

**Notes (free-text):** User requested the interface be designed to accommodate future features: context caching, semantic caching, compression, image generation, voice processing. These should be declared in `ProviderCapabilities` but disabled/unimplemented in Phase 4. UI and route code should conditionally disable features based on `capabilities()` return value.

---

## Claude's Discretion

- Exact `ProviderCapabilities` interface fields beyond the ones listed
- Key verification endpoint approach per provider (each provider has different test call patterns)
- Whether task-to-model config lives in `.planning/config.json` or a dedicated file
- Error message wording for provider failures in chat
- Exact Supabase user_metadata key names for multi-provider keys
- How `AnthropicAdapter` converts `ProviderMessage[]` to Anthropic `MessageParam[]` internally

## Deferred Ideas

- Context caching, semantic caching, image generation, voice processing — declared in capabilities, not implemented in Phase 4
- Per-provider system prompt overrides — slot declared in interface, unused Phase 4
- Auto-fallback between providers on quota/error
- Per-session or mid-session provider switching
