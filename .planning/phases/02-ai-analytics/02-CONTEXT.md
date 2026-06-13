# Phase 2: AI + Analytics - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the full split-screen AI experience: Claude streams into chat when invoked via `@mention` or power reaction, the analytics panel renders the correct Recharts widget (bento grid, radar chart, scatter plot, pie chart) driven by a validated `ui_mutation_block` tool call, power reactions (🧠🔥📌🎯) are persisted and trigger appropriate AI behavior, and every AI response is labeled with the Analista Científico persona badge. The creator can toggle and manage personas from the workspace.

**Requirements in scope:** AI-03, AI-04, AI-05, AI-06, AI-07, AI-08, PANEL-01, PANEL-02, PANEL-03, PANEL-04, REACT-01, REACT-02, REACT-03, REACT-04, REACT-05, PERSONA-01, PERSONA-02, PERSONA-03

**Out of scope for Phase 2:** Conversation branching, branch merge, scroll-spy time-travel (v2), Devil's Advocate persona (v2), Flash Router orchestration (v2), session export, kick mechanism (deferred).

</domain>

<decisions>
## Implementation Decisions

### Streaming Architecture
- **D-01:** Frontend consumes the Hono SSE stream via `fetch()` + `ReadableStream` (not EventSource). This allows a POST body with session context, full header control, and fine-grained chunk processing.
- **D-02:** AI text tokens are rendered as ephemeral local React state on the invoking client while streaming; the final complete message is POSTed to Supabase and broadcast via Realtime to all other participants at stream end. No token-by-token DB writes.
- **D-03:** Dual-channel separation uses **Anthropic tool use** — the Hono route defines a `render_panel` tool; Claude emits text tokens normally and calls the tool for panel mutations. The server streams text delta events and emits a separate `panel_update` SSE event type when a `tool_use` block completes. **The tool definition and streaming contract must be wrapped behind a thin `AIProvider` interface** (`stream(messages, tools) → AsyncIterable<TextDelta | ToolUse>`) so that a Gemini or OpenAI adapter can be plugged in for v2 without changing Hono route logic.
- **D-04:** When an AI response is in flight, the chat input is soft-locked for **all participants in the session** (CHAT-06). The lock signal is broadcast via the existing Supabase Presence/Realtime channel. The lock indicator is already scaffolded in `InputBox`.

### Panel State & Widget Rendering
- **D-05:** Panel widget state lives in a **Zustand `panelStore`**: `{ widgetType, widgetData, branchId, snapshotState }`. The workspace component updates the store when a `ui_mutation_block` arrives from the stream or when a branch switch occurs.
- **D-06:** All 4 widget types are fully implemented: bento grid (key concept cards), radar chart (multi-axis), scatter plot (consensus/impact), pie chart (proportional breakdown). The widget registry is an extensible `Map<widgetType, ReactComponent>` — future types (maps, funnels, etc.) register without touching the panel container.
- **D-07:** On branch switch, the panel is hydrated from the `canvas_snapshot_state` field of the most recent message with a non-null snapshot for that branch (PANEL-04). This is the instant re-render contract for PANEL-02 / BRANCH-06.
- **D-08:** Panel widget transitions use **Framer Motion `AnimatePresence` + `layout` animations** — a cross-fade/morphing effect plays both when the AI mutates the panel within the same branch AND when switching branches. The panel feels alive and evolving, not like a page flip.

### Reaction → AI Trigger Flow
- **D-09:** When a power reaction is applied, the client POSTs to `/api/sessions/:id/reactions` with `{ messageId, emoji }`. The server records the reaction AND, for 🔥 (Intensify), 📌 (Pin), and 🎯 (Simplify), triggers the AI response server-side. The client then opens a new SSE connection to `/api/sessions/:id/invoke` to receive the stream. 🧠 (Insight) is recorded server-side but does not trigger AI.
- **D-10:** Optimistic UI (REACT-05): reactions appear immediately as an emoji + count badge on the `MessageBubble`. If the server call fails, the badge reverts. Badge is compact (e.g. `🔥 2`) positioned below the message content.
- **D-11:** 🧠 Insight marks messages as key concepts — surfaced only as a reaction count on the bubble in Phase 2. Session summary (Phase 3+) will use these counts to identify key concepts.

### Persona System
- **D-12:** Personas are managed from two entry points:
  1. **Session creation form** — optional persona picker (library of available personas); creator can pre-select which personas are active before starting.
  2. **CreatorControls workspace panel** — a persona management drawer/panel for adding/removing active personas mid-session.
- **D-13:** In Phase 2, the persona library contains one entry: **Analista Científico** (PERSONA-01). The library UI pattern is extensible for Devil's Advocate and future personas (Phase 3+).
- **D-14:** Each AI response bubble shows a small **badge in the bubble header** alongside the display name: `[icon] Analista Científico`. This is visually distinct from human messages (PERSONA-03).
- **D-15:** The persona toggle (on/off) surfaces in the CreatorControls workspace panel, satisfying PERSONA-02's "before or during a session" requirement.

### AI Context Assembly (Server-Side)
- **D-16:** AI context is assembled server-side using only messages whose `path_id` matches the active branch path (AI-06). The sliding window passes the last 8 raw messages; older history is compressed via a lighter/faster model call (AI-08). These extend the existing `assemblePromptArray()` helper in `apps/api/src/lib/anthropic.ts`.
- **D-17:** Bot activation matrix (AI-07): AI only fires on (a) `@analista` mention or (b) 🔥/📌/🎯 reaction. If Supabase Presence detects a participant is typing, queued AI responses are held until the human input clears.

### Claude's Discretion
- Exact Zod schema shape for `ui_mutation_block` (field names, nesting, per-widget data structure) — Claude designs these following AI-05's validation requirement.
- Widget visual design within each Recharts component (colors, axis labels, tooltip format) — Claude picks sensible defaults consistent with existing shadcn/ui theming.
- The exact SSE event type names for text chunks vs. panel updates (e.g., `text_delta`, `panel_update`, `done`).
- Historical summary compression model choice (lighter model for AI-08 background summary).
- `AIProvider` interface shape — Claude designs a minimal interface that covers streaming text + tool use across providers.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & Requirements
- `.planning/PROJECT.md` — Core product definition, constraints, key decisions, tech environment
- `.planning/REQUIREMENTS.md` — Full v1 requirements. Phase 2 covers: AI-03–08, PANEL-01–04, REACT-01–05, PERSONA-01–03.
- `.planning/ROADMAP.md` — Phase 2 goal, success criteria, and requirement mapping. The 5 success criteria are the acceptance bar.

### Phase 1 Artifacts (reuse, don't rewrite)
- `.planning/phases/01-live-session-shell/01-CONTEXT.md` — Phase 1 decisions (D-01 through D-09, scaffold patterns)
- `apps/api/src/lib/anthropic.ts` — `assemblePromptArray()` and `verifyApiKey()` — Phase 2 extends these, does not replace them
- `apps/api/src/routes/ai.ts` — The `POST /api/sessions/:id/invoke` stub (501) that Phase 2 replaces with real SSE streaming
- `apps/web/components/workspace/AnalyticsPanel.tsx` — Error boundary + empty states; Phase 2 adds dynamic widget rendering inside the boundary
- `apps/web/components/workspace/QuickReactionPopover.tsx` — Reaction emoji scaffold; Phase 2 replaces `console.log` with actual POST
- `apps/web/components/workspace/MessageBubble.tsx` — Gesture handlers already wired; Phase 2 adds reaction badges and AI message variant

### Technology Stack
- `CLAUDE.md` (project root) — Stack table: Next.js 15, Hono, Supabase, Zustand, shadcn/ui, Recharts 2.x, Framer Motion 11.x, `@anthropic-ai/sdk`. Also lists what NOT to use.

No external ADRs — requirements fully captured in decisions above and REQUIREMENTS.md.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/lib/anthropic.ts` — `assemblePromptArray()` builds the full prompt with cache_control breakpoint. Phase 2 extends it with path filtering (AI-06) and historical summary (AI-08), then wires the real Anthropic streaming call.
- `apps/web/components/workspace/AnalyticsPanel.tsx` — Error boundary (LAYOUT-07) is production-ready. Phase 2 adds a dynamic widget zone inside `<AnalyticsPanelErrorBoundary>`.
- `apps/web/components/workspace/QuickReactionPopover.tsx` — `REACTION_EMOJIS` constant and popover UI scaffolded. Replace `handleReact` body.
- `apps/web/components/workspace/MessageBubble.tsx` — Gesture system (double-tap → popover, long-press → action menu) is complete. Phase 2 adds reaction count badges and an AI-message variant (persona badge in header).
- `apps/web/hooks/use-session-channel.ts` — Supabase Realtime channel hook. Phase 2 extends this for the AI-streaming lock signal broadcast.
- `apps/api/src/lib/cap-guard.ts` — `checkCap` / `incrementCount` already wired in the invoke route; Phase 2 keeps these.

### Established Patterns
- **Zustand for reactive client state** — the project already chose Zustand for branch state. The `panelStore` follows the same pattern.
- **Hono streaming** — Hono has first-class `streamSSE()` / `stream()` support; use `streamSSE` for the invoke endpoint.
- **Supabase Realtime for presence** — typing indicators already use Presence; the AI stream lock extends the same channel.
- **shadcn/ui + Tailwind** — all UI components follow this pattern; new components (persona badge, reaction badge) should too.
- **Zod for schema validation** — already used in the API layer; AI-05's `ui_mutation_block` validation uses Zod.

### Integration Points
- `apps/api/src/routes/ai.ts` — The `/invoke` route body is replaced with real streaming logic
- `apps/api/src/index.ts` — New `/reactions` route needs to be registered here
- `apps/web/components/workspace/workspace.tsx` — Workspace component needs to: open SSE connection, update `panelStore`, broadcast lock state
- `packages/types` — New shared types needed: `Reaction`, `PanelWidget`, `PersonaConfig`, `AIStreamEvent`

</code_context>

<specifics>
## Specific Ideas

- **Panel animation**: The panel transition must feel like the content *morphs and evolves*, not like switching pages. Framer Motion `AnimatePresence` with a cross-fade + scale effect. This applies both to in-branch AI updates (new widget data) and branch switches (different snapshot).
- **AIProvider interface**: Must be thin enough that swapping Anthropic → Gemini → OpenAI in v2 only requires writing a new adapter, not touching the Hono route logic. The interface defines: `stream(messages, tools) → AsyncIterable<TextDeltaEvent | ToolUseEvent | DoneEvent>`.
- **Persona library pattern**: Even though Phase 2 has only 1 persona (Analista Científico), the session creation form and the workspace panel should be designed as if there's a library — a list component with persona cards. Phase 3 adds more cards, not new UI patterns.
- **@analista mention detection**: Server-side pattern match on message content before AI invocation (AI-07). The mention string is `@analista` (case-insensitive). Client does NOT auto-invoke — the server decides.

</specifics>

<deferred>
## Deferred Ideas

- **Kick mechanism** (bots or humans from session) — new capability not in Phase 2 requirements. Noted for Phase 3.
- **Devil's Advocate persona** (PERSONA-04, v2) — Phase 2 only builds Analista Científico. The library pattern is ready for it.
- **Flash Router** (PERSONA-06, v2) — multi-agent orchestration that auto-selects personas based on conversation signals. Phase 3+.
- **Scroll-spy time-travel** (TIME-01, v2) — panel reflects historical state as user scrolls back. Phase 3+.
- **Per-session AI cap override** — Phase 1 decision: global cap in /settings. Keep for Phase 2.

</deferred>

---

*Phase: 2-AI + Analytics*
*Context gathered: 2026-06-13*
