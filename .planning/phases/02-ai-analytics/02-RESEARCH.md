# Phase 2: AI + Analytics — Research

**Researched:** 2026-06-13
**Domain:** Claude SSE streaming + Anthropic tool use, Hono streamSSE, Recharts widget rendering, Zustand panel state, Supabase Presence for AI lock signal, Framer Motion widget transitions
**Confidence:** HIGH (all core stack verified against installed versions and official Anthropic docs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Streaming Architecture**
- D-01: Frontend consumes Hono SSE stream via `fetch()` + `ReadableStream` (NOT EventSource) — allows POST body with session context and fine-grained chunk processing.
- D-02: AI text tokens render as ephemeral local React state on the invoking client while streaming; the final complete message is POSTed to Supabase and broadcast via Realtime to all participants at stream end. No token-by-token DB writes.
- D-03: Dual-channel separation uses Anthropic tool use — Hono defines a `render_panel` tool; Claude emits text normally and calls the tool for panel mutations. Server streams text delta events and emits a separate `panel_update` SSE event type when a `tool_use` block completes. The tool definition and streaming contract MUST be wrapped behind a thin `AIProvider` interface (`stream(messages, tools) → AsyncIterable<TextDelta | ToolUse>`).
- D-04: Chat input is soft-locked for ALL participants in the session when AI response is in flight. Lock signal broadcast via existing Supabase Presence/Realtime channel. Lock indicator already scaffolded in `InputBox`.

**Panel State & Widget Rendering**
- D-05: Panel widget state lives in a Zustand `panelStore`: `{ widgetType, widgetData, branchId, snapshotState }`.
- D-06: All 4 widget types fully implemented: bento grid, radar chart, scatter plot, pie chart. Widget registry is an extensible `Map<widgetType, ReactComponent>`.
- D-07: On branch switch, panel hydrated from `canvas_snapshot_state` of most recent message with non-null snapshot for that branch.
- D-08: Panel widget transitions use Framer Motion `AnimatePresence` + `layout` animations — cross-fade/morphing for both in-branch AI mutations and branch switches.

**Reaction → AI Trigger Flow**
- D-09: Reaction POST to `/api/sessions/:id/reactions`; 🔥/📌/🎯 trigger AI server-side; client then opens SSE connection to `/api/sessions/:id/invoke`. 🧠 recorded but does NOT trigger AI.
- D-10: Optimistic UI — badge appears immediately; reverts silently on server failure.
- D-11: 🧠 marks messages as key concepts — reaction count badge only in Phase 2.

**Persona System**
- D-12: Personas managed from session creation form AND CreatorControls workspace panel.
- D-13: Phase 2 library contains one persona: Analista Científico. Library UI pattern is extensible.
- D-14: Each AI response bubble shows a badge in the header: `[icon] Analista Científico`.
- D-15: Persona toggle surfaces in CreatorControls workspace panel (PERSONA-02).

**AI Context Assembly (Server-Side)**
- D-16: Context assembled server-side using only messages with `path_id` matching active branch. Sliding window: last 8 raw messages; older history compressed via lighter/faster model call. These EXTEND `assemblePromptArray()` in `apps/api/src/lib/anthropic.ts`, not replace it.
- D-17: AI fires only on (a) `@analista` mention or (b) 🔥/📌/🎯 reaction. If Supabase Presence detects a participant is typing, queued AI responses are held until human input clears.

### Claude's Discretion

- Exact Zod schema shape for `ui_mutation_block` (field names, nesting, per-widget data structure)
- Widget visual design within Recharts components (colors, axis labels, tooltip format) — per 02-UI-SPEC.md
- Exact SSE event type names (e.g., `text_delta`, `panel_update`, `done`)
- Historical summary compression model choice (lighter model for AI-08 background summary)
- `AIProvider` interface shape — minimal interface covering streaming text + tool use across providers

### Deferred Ideas (OUT OF SCOPE)

- Kick mechanism (bots or humans from session) — Phase 3
- Devil's Advocate persona (PERSONA-04, v2)
- Flash Router (PERSONA-06, v2)
- Scroll-spy time-travel (TIME-01, v2)
- Per-session AI cap override (global cap in /settings only)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AI-03 | AI responses stream token-by-token into chat stream with visible streaming indicator | Anthropic SDK `stream()` + Hono `streamSSE()` + fetch ReadableStream consumer |
| AI-04 | AI output uses strict dual-channel streaming: `text_stream` → chat, `ui_mutation_block` → panel (separate tool call) | Anthropic tool use streaming: `contentBlock` event fires when tool block completes with accumulated JSON |
| AI-05 | Every `ui_mutation_block` validated against Zod schema before touching React state; invalid payloads silently discarded | Zod schema in packages/types; validate in frontend before calling panelStore.setWidget |
| AI-06 | AI context assembled server-side using only messages with matching `path_id` (active branch) | Extend `assemblePromptArray()` with path filter on DB query; `messages_session_path_created_idx` index already in migration |
| AI-07 | Bot activation matrix: only `@analista` mention or 🔥/📌/🎯 reaction; held while participant typing | Server-side `@analista` regex + reaction trigger check; Supabase Presence query for typing state |
| AI-08 | Sliding window: last 8 messages + background-compressed summary of older history | Extend `assemblePromptArray()` with compressed summary; lighter model call for summary generation |
| PANEL-01 | AI selects appropriate widget type and renders it | `render_panel` tool definition with `widget_type` discriminated union; widget registry Map |
| PANEL-02 | Panel re-renders instantly on branch switch from `canvas_snapshot_state` | panelStore hydration from message row; Framer Motion AnimatePresence |
| PANEL-03 | Colored badge on panel indicates active branch | Panel header strip with branch badge (Phase 2: "Main" only) |
| PANEL-04 | Each AI message that mutates panel stores `canvas_snapshot_state` in message row | INSERT to messages table with `canvas_snapshot_state: jsonb` (column already exists in migration) |
| REACT-01 | 🧠 Insight — marks message as key concept; visible reaction count | POST /reactions; 🧠 does NOT trigger AI; optimistic badge |
| REACT-02 | 🔥 Intensify — triggers AI to critically attack the message | POST /reactions triggers AI invoke server-side; SSE stream opens for response |
| REACT-03 | 📌 Pin — triggers AI to convert message content into visual panel card | Same trigger flow; `render_panel` tool call expected in AI response |
| REACT-04 | 🎯 Simplify — triggers AI to summarize its last response in 3-5 bullet points | Same trigger flow; AI context includes last AI message |
| REACT-05 | All reactions apply optimistically on local client | Client-side optimistic state update before server confirmation |
| PERSONA-01 | Analista Científico persona available in all sessions | Persona system + session `active_personas` field; system prompt with persona instructions |
| PERSONA-02 | Creator can toggle persona on/off before or during session | Session creation form picker + CreatorControls drawer toggle; POST `/api/sessions/:id/personas` |
| PERSONA-03 | Each AI response labeled with persona name and distinct icon | MessageBubble `isAI` variant with persona badge; see 02-UI-SPEC.md |
</phase_requirements>

---

## Summary

Phase 2 is a high-confidence implementation phase — the stack is fully installed, Phase 1 scaffold stubs are in place, and the core patterns (SSE streaming, tool use, Supabase Presence) are well-understood with official documentation. No new external packages are required; all dependencies are already in the monorepo.

The central technical work is replacing the `/invoke` stub (returns 501) with a real Hono `streamSSE()` route that calls `client.messages.stream()` with a `render_panel` tool definition. Text delta events are forwarded as `text_delta` SSE events; when the `contentBlock` event fires with `type === 'tool_use'`, the server emits a `panel_update` SSE event with the accumulated JSON. The frontend opens the stream via `fetch()` + `ReadableStream`, appends tokens to ephemeral state, and validates the panel payload with Zod before touching the `panelStore`.

Two package version discrepancies exist between CLAUDE.md and what is actually installed: the project uses `framer-motion@12.40.0` (CLAUDE.md says 11.x) and `recharts@3.8.1` (CLAUDE.md says 2.x). Both are drop-in compatible — `framer-motion` v12 has no API-breaking changes from v11; Recharts 3.x is intentionally minimal-breakage with main change being `TooltipProps` → `TooltipContentProps` for custom tooltip content components.

New DB migrations are needed for: (1) a `reactions` table (emoji, message_id, user_id), (2) an `active_personas` column on the `sessions` table. The `canvas_snapshot_state jsonb` column on messages already exists from Phase 1 migration 0001.

**Primary recommendation:** Plan waves as: (Wave 1) DB migration + types + AIProvider interface + Zod schemas; (Wave 2) Hono streaming route + SSE contract; (Wave 3) Frontend SSE consumer + panelStore + widget registry + AI bubble variant; (Wave 4) Reactions system (POST route + optimistic UI + badge rendering); (Wave 5) Persona system (session form picker + CreatorControls drawer + toggle API); (Wave 6) Integration + hardening (AI lock, soft-lock input, cap increment after real stream).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Claude API call + tool use invocation | API / Backend (Hono) | — | Key must never reach browser (AI-02); streaming response originates here |
| SSE stream bridging (Anthropic → client) | API / Backend (Hono) | — | Hono `streamSSE()` relays Anthropic events to the frontend client |
| AI context assembly + path filtering | API / Backend (Hono) | — | Requires service-role DB access to read messages by path_id |
| Bot activation decision (mention + reaction) | API / Backend (Hono) | — | Must be server-side gate; client cannot be trusted to decide |
| Typing lock check (hold AI if typing) | API / Backend (Hono) | — | Reads Supabase Presence server-side before streaming |
| SSE consumption + token display | Browser / Client (Next.js) | — | Ephemeral local state during stream; no DB writes until complete |
| Panel payload Zod validation | Browser / Client (Next.js) | — | Validate before touching panelStore; malformed payloads silently discarded |
| Panel state (widgetType + widgetData) | Browser / Client (Next.js) | — | Zustand `panelStore`; lives in client memory, persisted to DB via canvas_snapshot_state |
| Widget rendering (Recharts) | Browser / Client (Next.js) | — | Recharts is client-side only; wrapped in AnimatePresence for transitions |
| Reaction POST + optimistic UI | Browser / Client (Next.js) | API / Backend | Client fires POST; server records + triggers AI; client does not wait |
| Reaction persistence | API / Backend (Hono) | Supabase Postgres | Server writes reaction; Realtime broadcasts to all participants |
| Persona toggle | API / Backend (Hono) | Supabase Postgres | Server updates session `active_personas`; broadcast to all via Realtime |
| AI stream lock broadcast | Browser / Client (Next.js) | Supabase Presence | Invoking client broadcasts `ai_streaming: true` on Presence channel |
| Canvas snapshot persistence | API / Backend (Hono) | Supabase Postgres | Server INSERTs AI message with `canvas_snapshot_state` after stream completes |

---

## Standard Stack

All packages are already installed in the monorepo. No new installs required for core functionality.

### Core (existing, verified)

| Library | Installed Version | Latest Version | Purpose | Source |
|---------|------------------|----------------|---------|--------|
| `@anthropic-ai/sdk` | 0.102.0 | 0.104.1 | Streaming + tool use calls | [VERIFIED: npm registry] |
| `hono` | 4.12.24 | 4.12.25 | SSE streaming route + reactions route | [VERIFIED: npm registry] |
| `recharts` | 3.8.1 | 3.8.1 | All 4 widget types | [VERIFIED: npm registry] |
| `framer-motion` | 12.40.0 | 12.40.0 | Widget AnimatePresence transitions | [VERIFIED: npm registry] |
| `zustand` | 5.0.14 | 5.0.14 | panelStore + existing sessionStore | [VERIFIED: npm registry] |
| `zod` | 4.4.3 | 4.4.3 | `ui_mutation_block` schema validation | [VERIFIED: npm registry] |

### shadcn Components to Add (Phase 2)

Per 02-UI-SPEC.md:
```bash
npx shadcn@latest add switch scroll-area
```

`switch` — persona management drawer live toggle
`scroll-area` — persona drawer future-proofing (>2 personas)

### Version Notes

- **`@anthropic-ai/sdk` 0.102.0 vs 0.104.1**: Minor patch delta. No breaking changes. Update optional but not required for Phase 2. [ASSUMED: based on semver convention; not verified against changelogs]
- **`framer-motion` 12.x vs CLAUDE.md 11.x**: Package is installed as `framer-motion` (not `motion`). v12 has no API-breaking changes for React usage. `AnimatePresence`, `motion`, `layout` all work identically. Import from `'framer-motion'` as before. [CITED: motion.dev/docs/react-upgrade-guide]
- **`recharts` 3.x vs CLAUDE.md 2.x**: The project already has 3.8.1. Breaking change affecting Phase 2: custom `<Tooltip content={...}>` prop type changed from `TooltipProps` to `TooltipContentProps`. All 4 widget types need custom tooltips — use `TooltipContentProps` from recharts. [CITED: github.com/recharts/recharts/wiki/3.0-migration-guide]

---

## Package Legitimacy Audit

All packages below are already installed in the monorepo. slopcheck run on all 6 core packages.

| Package | Registry | slopcheck | No postinstall | Disposition |
|---------|----------|-----------|----------------|-------------|
| `@anthropic-ai/sdk` | npm | [OK] | confirmed | Approved |
| `hono` | npm | [OK] | confirmed | Approved |
| `recharts` | npm | [OK] | confirmed | Approved |
| `framer-motion` | npm | [OK] | confirmed | Approved |
| `zustand` | npm | [OK] | confirmed | Approved |
| `zod` | npm | [OK] | confirmed | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
TRIGGER (client)
  ├── @analista mention in message → POST /api/sessions/:id/messages (existing route)
  │     └── Server detects @analista → triggers AI invoke
  └── Power reaction → POST /api/sessions/:id/reactions (new route)
        └── Server: records reaction, checks emoji → 🔥📌🎯 trigger AI invoke

AI INVOKE FLOW (Hono backend)
  ┌─────────────────────────────────────────────────────────┐
  │ POST /api/sessions/:id/invoke                           │
  │   1. Auth + cap check (existing cap-guard.ts)           │
  │   2. Fetch last 8 msgs (path_id filter — AI-06)         │
  │   3. Detect typing presence (Supabase Presence read)    │
  │   4. If typing → 429 / queue hold                       │
  │   5. Build prompt: assemblePromptArray() extended       │
  │   6. Open SSE stream via streamSSE(c, ...)              │
  │   7. client.messages.stream() with render_panel tool    │
  └─────────────────────────────────────────────────────────┘
                          │
             ┌────────────┴────────────┐
             │                         │
   text_delta SSE events         input_json_delta chunks
   (forwarded in real time)      (accumulated until content_block_stop)
             │                         │
             ▼                         ▼
   data: {"type":"text_delta",   data: {"type":"panel_update",
           "text": "..."}               "payload": {widgetType, data...}}
             │                         │
             ▼                         ▼
  CLIENT (fetch + ReadableStream)
    ├── text_delta → append to ephemeral useState buffer → render streaming bubble
    ├── panel_update → Zod.parse(payload)
    │     ├── VALID → panelStore.setWidget(widgetType, widgetData) → Recharts render
    │     └── INVALID → silently discard; last stable state preserved (AI-05)
    └── done → POST complete message to Supabase → Realtime broadcast to others

PANEL STORE (Zustand)
  panelStore: { widgetType, widgetData, branchId, snapshotState }
    └── AnalyticsPanel reads → widget registry Map → Recharts component
          └── AnimatePresence key=${widgetType}-${branchId} → morph transition

REACTION BADGE FLOW
  Client: optimistic badge on tap → POST /reactions
    ├── Server: record + trigger AI (🔥📌🎯) or record only (🧠)
    └── Realtime: broadcast reactions update to all participants
          ↓ client updates message reaction counts
```

### Recommended Project Structure Changes

```
apps/api/src/
├── lib/
│   ├── anthropic.ts          # EXTEND: assemblePromptArray + path filter + summary
│   ├── ai-provider.ts        # NEW: AIProvider interface + AnthropicAdapter
│   └── ...
├── routes/
│   ├── ai.ts                 # REPLACE stub: real streamSSE invoke route
│   └── reactions.ts          # NEW: POST /api/sessions/:id/reactions
apps/web/
├── store/
│   ├── session-store.ts      # EXISTING (unchanged)
│   └── panel-store.ts        # NEW: Zustand panelStore
├── components/workspace/
│   ├── AnalyticsPanel.tsx    # EXTEND: add header strip + widget zone
│   ├── widgets/
│   │   ├── widget-registry.ts  # NEW: Map<widgetType, ReactComponent>
│   │   ├── BentoGrid.tsx       # NEW
│   │   ├── RadarWidget.tsx     # NEW
│   │   ├── ScatterWidget.tsx   # NEW
│   │   └── PieWidget.tsx       # NEW
│   ├── MessageBubble.tsx     # EXTEND: isAI prop, reaction badges
│   └── QuickReactionPopover.tsx # EXTEND: replace console.log with POST
packages/types/src/
│   ├── panel.ts              # NEW: PanelWidget, ui_mutation_block Zod schema
│   ├── reaction.ts           # NEW: Reaction type + schema
│   └── persona.ts            # NEW: PersonaConfig type + schema
supabase/migrations/
│   └── 0004_reactions_personas.sql  # NEW: reactions table + sessions.active_personas column
```

### Pattern 1: Hono streamSSE with Anthropic streaming

**What:** Route opens an SSE stream, iterates Anthropic events, and emits typed SSE events to the client.

**When to use:** Any server endpoint that streams AI text + tool use to a browser client.

```typescript
// Source: hono.dev/docs/helpers/streaming + platform.claude.com/docs/en/build-with-claude/streaming
import { streamSSE } from 'hono/streaming'
import Anthropic from '@anthropic-ai/sdk'

aiRouter.post('/:id/invoke', async (c) => {
  // ... auth, cap check, context assembly ...
  return streamSSE(c, async (stream) => {
    const aiStream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      tools: [renderPanelTool],
      messages: promptArray,
    })

    // Forward text deltas immediately
    aiStream.on('text', async (textDelta) => {
      await stream.writeSSE({ event: 'text_delta', data: JSON.stringify({ text: textDelta }) })
    })

    // Wait for full tool_use block (JSON accumulates until content_block_stop)
    aiStream.on('contentBlock', async (block) => {
      if (block.type === 'tool_use' && block.name === 'render_panel') {
        await stream.writeSSE({
          event: 'panel_update',
          data: JSON.stringify(block.input),  // fully accumulated JSON
        })
      }
    })

    await aiStream.done()
    // POST final message to Supabase with canvas_snapshot_state
    await stream.writeSSE({ event: 'done', data: '{}' })
  })
})
```

### Pattern 2: Frontend fetch-based SSE consumer

**What:** Client opens a POST SSE connection with session context and processes chunked events.

**When to use:** Consuming the `/invoke` SSE endpoint. Cannot use `EventSource` (requires GET).

```typescript
// Source: D-01 decision; standard fetch + ReadableStream pattern
async function openAIStream(sessionId: string, context: string) {
  const response = await fetch(`/api/sessions/${sessionId}/invoke`, {
    method: 'POST',
    body: JSON.stringify({ context }),
    headers: { 'Content-Type': 'application/json' },
  })

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value)
    // Parse SSE lines: "event: text_delta\ndata: {...}\n\n"
    for (const line of chunk.split('\n')) {
      if (line.startsWith('data: ')) {
        const payload = JSON.parse(line.slice(6))
        // dispatch to appropriate handler
      }
    }
  }
}
```

### Pattern 3: Zod validation gate for panel payloads (AI-05)

**What:** Validate `ui_mutation_block` before touching panelStore. Silent discard on failure.

**When to use:** Every time a `panel_update` SSE event arrives on the client.

```typescript
// Source: AI-05 requirement + existing Zod pattern in the codebase
const PanelUpdateSchema = z.discriminatedUnion('widget_type', [
  z.object({ widget_type: z.literal('bento'), cards: z.array(BentoCardSchema) }),
  z.object({ widget_type: z.literal('radar'), axes: z.array(RadarAxisSchema) }),
  z.object({ widget_type: z.literal('scatter'), points: z.array(ScatterPointSchema) }),
  z.object({ widget_type: z.literal('pie'), segments: z.array(PieSegmentSchema) }),
])

function handlePanelUpdate(raw: unknown) {
  const result = PanelUpdateSchema.safeParse(raw)
  if (!result.success) {
    // AI-05: silently discard — do NOT update panelStore
    console.warn('[panel] schema invalid — discarded:', result.error.issues)
    return
  }
  usePanelStore.getState().setWidget(result.data)
}
```

### Pattern 4: Framer Motion widget morph (D-08)

**What:** AnimatePresence key-driven unmount/remount produces cross-fade + blur morph.

**When to use:** Widget zone wrapper — applies to both in-branch AI updates and branch switches.

```typescript
// Source: 02-UI-SPEC.md animation spec
import { AnimatePresence, motion } from 'framer-motion'

<AnimatePresence mode="wait">
  <motion.div
    key={`${widgetType}-${branchId}`}
    initial={{ opacity: 0, scale: 0.97, filter: 'blur(4px)' }}
    animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
    exit={{ opacity: 0, scale: 1.02, filter: 'blur(4px)' }}
    transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
  >
    {WidgetComponent && <WidgetComponent data={widgetData} />}
  </motion.div>
</AnimatePresence>
```

### Pattern 5: Recharts 3.x custom tooltip

**What:** Custom tooltip using the updated `TooltipContentProps` type (breaking change from 2.x).

**When to use:** All 4 widget types that use custom `<Tooltip content={...}>`.

```typescript
// Source: github.com/recharts/recharts/wiki/3.0-migration-guide
import type { TooltipContentProps } from 'recharts'  // NOT TooltipProps (v2 name)

function CustomTooltip({ active, payload, label }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-md p-2 text-[15px]">
      {payload[0].value}
    </div>
  )
}
```

### Anti-Patterns to Avoid

- **EventSource for the invoke stream:** EventSource is GET-only; cannot send session context in body. Use `fetch()` + `ReadableStream` (D-01).
- **Token-by-token DB writes:** Do not INSERT each streaming token to Supabase. Accumulate client-side; write once at stream end (D-02). DB write-rate will exhaust RLS row budgets quickly under concurrent load.
- **Parsing `input_json_delta` chunks as JSON mid-stream:** Tool input JSON is partial and cannot be parsed until `content_block_stop`. Use the SDK's `contentBlock` event which fires after full accumulation.
- **Calling panelStore before Zod validation:** Always validate the raw payload first. A Recharts component will crash on unexpected data shapes, and the error boundary does not protect the chat stream.
- **Importing from `TooltipProps` (Recharts 2.x name):** This type was renamed in Recharts 3.x. Use `TooltipContentProps`.
- **Broadcasting AI lock via a new Supabase channel:** The existing `presence:${sessionId}` channel (from `use-typing-presence.ts`) already handles all participants. Extend the presence payload to include `ai_streaming: boolean`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON accumulation of tool_use stream | Custom streaming parser | `anthropic.messages.stream()` + `contentBlock` event | SDK accumulates partial `input_json_delta` events and fires `contentBlock` only after `content_block_stop` with complete parsed JSON |
| SSE event formatting | Manual `data:\n\n` strings | Hono `streamSSE()` + `writeSSE({ event, data })` | Handles SSE protocol formatting, connection keep-alive, abort detection |
| Tool input schema enforcement | Custom validator | Zod `safeParse()` + discriminated union | Handles all 4 widget types with type narrowing; `safeParse` never throws |
| Recharts radar/scatter/pie layout | D3-based custom charts | Recharts `RadarChart`, `ScatterChart`, `PieChart` with `ResponsiveContainer` | ResponsiveContainer handles all resize/mobile scenarios; pure React props API |
| Widget transition animations | CSS transition classes | Framer Motion `AnimatePresence mode="wait"` + `motion.div` | `mode="wait"` ensures exit completes before enter starts; key-driven remount triggers both directions |
| Presence-based AI streaming lock | Custom WebSocket | Supabase Presence on existing `presence:${sessionId}` channel | Existing channel already established; extend payload with `ai_streaming` field |

**Key insight:** The Anthropic SDK handles the hardest part — accumulating partial JSON deltas for tool use. Do not bypass it by consuming raw SSE events for tool blocks; the `contentBlock` event gives you the fully-parsed tool input object ready for Zod validation.

---

## Common Pitfalls

### Pitfall 1: SSE consumer mis-parsing multi-line chunks

**What goes wrong:** `ReadableStream` `read()` does not guarantee one SSE event per chunk. A single `read()` call may deliver partial events, multiple events, or events split across two reads.

**Why it happens:** HTTP chunked transfer has no SSE boundary guarantees at the stream layer.

**How to avoid:** Buffer the decoder output and split on `\n\n` (SSE event boundary), not on `\n`. Maintain a `buffer` string across reads; process complete events from buffer, keep remainder.

**Warning signs:** Panel update fires with corrupted JSON; partial `text_delta` events appear as undefined.

### Pitfall 2: Recharts SSR crash on widget first render

**What goes wrong:** `ResponsiveContainer` requires a parent with a defined height during SSR, or it renders with 0 height. The `RadarChart` has known SSR edge cases when dimensions are 0.

**Why it happens:** Next.js App Router renders server-side first; browser dimensions not available.

**How to avoid:** Mark all widget components with `'use client'`. Use `dynamic(() => import('./widgets/RadarWidget'), { ssr: false })` for Recharts components if SSR crashes persist. The `AnalyticsPanel` is already `'use client'`.

**Warning signs:** Widget renders at zero height on first load; Recharts throws "ResizeObserver loop" errors.

### Pitfall 3: Supabase Presence payload clobbering

**What goes wrong:** The AI stream lock broadcasts `{ ai_streaming: true }` on the same presence channel used for typing. If the payload overwrites the typing state, participants see their typing indicator cleared when the AI starts.

**Why it happens:** `channel.track()` replaces the entire presence payload for that key — it does not merge.

**How to avoid:** Always track with a merged payload: `channel.track({ typing: currentTypingState, ai_streaming: true })`. The invoking client must read its current presence state before broadcasting the lock.

**Warning signs:** Typing indicator disappears mid-stream for the invoking user.

### Pitfall 4: `canvas_snapshot_state` not saved after stream completes

**What goes wrong:** PANEL-04 requires that each AI message row includes the resulting panel state. If the server INSERTs the message before the tool use block completes, the snapshot is null.

**Why it happens:** Race condition between message INSERT and panel_update emission.

**How to avoid:** Wait for `aiStream.done()` (all events including tool blocks complete) before inserting the message row. The `canvas_snapshot_state` must be the exact JSON that was emitted in the `panel_update` event.

**Warning signs:** Panel shows correct widget live, but branch switch fails to restore it (PANEL-02 broken).

### Pitfall 5: AI context includes messages from all path_ids

**What goes wrong:** In Phase 2 there is only a "main" path, but the existing `assemblePromptArray()` helper fetches messages without a path_id filter. Phase 3 branching breaks immediately if Phase 2 does not enforce AI-06 correctly.

**Why it happens:** The Phase 1 stub in `ai.ts` does not filter by path_id.

**How to avoid:** Always add `.eq('path_id', activePath)` to the DB query in the extend invoke route. The index `messages_session_path_created_idx` (session_id, path_id, created_at) already exists for this query.

**Warning signs:** AI context grows unbounded once Phase 3 creates sibling branches.

### Pitfall 6: Optimistic reaction badge not reverted on server error

**What goes wrong:** Badge appears on double-tap, POST fails silently, badge persists showing incorrect count.

**Why it happens:** Error in `catch` branch does not trigger UI revert.

**How to avoid:** Maintain a rollback snapshot of the reactions array before the POST. On catch, restore from snapshot. The 02-UI-SPEC.md specifies silent revert — no toast, just remove the badge.

**Warning signs:** Reaction counts drift from server truth over time.

### Pitfall 7: Persona toggle POST fails but optimistic switch state stays ON

**What goes wrong:** UI shows persona as active but server rejected the toggle; AI still uses deactivated persona.

**Why it happens:** Optimistic update not rolled back on failure.

**How to avoid:** Show toast on failure per 02-UI-SPEC.md (`"No se pudo cambiar el analista. Inténtalo de nuevo."`). Roll back the switch state. This IS a toasted error (unlike reaction revert).

---

## Code Examples

### Anthropic `render_panel` tool definition

```typescript
// Source: platform.claude.com/docs/en/build-with-claude/streaming (tool use schema)
// Claude's Discretion: exact field names — recommended schema below

const renderPanelTool = {
  name: 'render_panel',
  description: 'Renders a visual analytics widget in the analytics panel based on the conversation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      widget_type: {
        type: 'string',
        enum: ['bento', 'radar', 'scatter', 'pie'],
        description: 'The type of widget to render',
      },
      title: { type: 'string', description: 'Brief panel header title' },
      data: {
        type: 'object',
        description: 'Widget-specific data payload (varies by widget_type)',
      },
    },
    required: ['widget_type', 'data'],
  },
}
```

### Zod schema for `ui_mutation_block` (Claude's Discretion schema — recommended)

```typescript
// Source: AI-05 requirement; Claude's Discretion field names
// packages/types/src/panel.ts

const BentoCardSchema = z.object({
  category: z.string().max(60),
  concept: z.string().max(120),
  relevance_score: z.number().min(0).max(100).optional(),
})

const RadarAxisSchema = z.object({
  axis: z.string().max(60),
  value: z.number().min(0).max(100),
})

const ScatterPointSchema = z.object({
  concept: z.string().max(80),
  consensus: z.number().min(0).max(100),
  impact: z.number().min(0).max(100),
})

const PieSegmentSchema = z.object({
  label: z.string().max(60),
  value: z.number().min(0),
})

export const PanelWidgetSchema = z.discriminatedUnion('widget_type', [
  z.object({ widget_type: z.literal('bento'), title: z.string().optional(), cards: z.array(BentoCardSchema).min(1).max(6) }),
  z.object({ widget_type: z.literal('radar'), title: z.string().optional(), axes: z.array(RadarAxisSchema).min(3).max(8) }),
  z.object({ widget_type: z.literal('scatter'), title: z.string().optional(), points: z.array(ScatterPointSchema).min(1).max(20) }),
  z.object({ widget_type: z.literal('pie'), title: z.string().optional(), segments: z.array(PieSegmentSchema).min(2).max(8) }),
])

export type PanelWidget = z.infer<typeof PanelWidgetSchema>
```

### AI lock broadcast via Presence (extension of existing pattern)

```typescript
// Source: use-typing-presence.ts pattern (existing in codebase)
// Extend the existing presence payload — do NOT replace it

// In the invoking client, before opening SSE:
channel.track({
  typing: false,                  // explicitly clear typing during AI stream
  ai_streaming: true,
  streaming_started_at: Date.now(),
}).catch(() => {})

// All clients read from presenceState:
const isAIStreaming = Object.values(state).some(
  payloads => payloads.some(p => p.ai_streaming === true)
)
```

---

## New DB Migration Requirements

Phase 2 requires one new migration (`0004_reactions_personas.sql`):

```sql
-- Reactions table (REACT-01 through REACT-05)
CREATE TABLE public.reactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid        NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  session_id  uuid        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  author_id   uuid        NOT NULL,
  emoji       text        NOT NULL CHECK (emoji IN ('🧠', '🔥', '📌', '🎯')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, author_id, emoji)   -- one reaction per emoji per user per message
);

-- Allow participants to read reactions; INSERT only if auth.uid() = author_id
-- Index for fetching reactions by message
CREATE INDEX reactions_message_idx ON public.reactions (message_id);

-- Add active_personas to sessions (PERSONA-01, PERSONA-02)
ALTER TABLE public.sessions
  ADD COLUMN active_personas text[] NOT NULL DEFAULT '{analista_cientifico}';
```

The `canvas_snapshot_state jsonb` column on `messages` already exists from migration 0001.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| EventSource for SSE | `fetch()` + `ReadableStream` for POST SSE | D-01 locked decision | Allows POST body with session context; required for this use case |
| Manual SSE parsing of tool_use JSON | Anthropic SDK `contentBlock` event | SDK v0.20+ | SDK accumulates partial JSON automatically; never parse raw deltas |
| `TooltipProps` (Recharts 2.x) | `TooltipContentProps` (Recharts 3.x) | Recharts 3.0 | Must update any custom tooltip component types |
| `framer-motion` as independent package | `motion` (npm) as canonical name, `framer-motion` as alias | 2025 | `framer-motion` package still works; import from `'framer-motion'` unchanged |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@anthropic-ai/sdk` 0.102.0 → 0.104.1 delta has no breaking changes | Standard Stack | Minor: may need patch; update to 0.104.1 before streaming implementation to avoid edge cases |
| A2 | Supabase local dev supports Presence for typing detection during AI lock check (server-side Presence read) | Architecture Patterns | Medium: if local Supabase Presence is unreliable, typing-gate may always pass; fallback: skip typing check in dev mode |
| A3 | Claude claude-sonnet-4-6 supports tool use with streaming (text + tool_use in same response) | Code Examples | LOW risk: claude-sonnet-4-6 is confirmed to support tool use; parallel text+tool_use blocks are documented behavior |
| A4 | Historical summary compression uses a lighter Anthropic model (AI-08); specific model not locked | Architecture Patterns (AI-08) | LOW: Claude's Discretion; claude-haiku-4-5-20251001 already used for `verifyApiKey` — use same model for compression |

---

## Open Questions

1. **AI-07: Server-side typing detection during invoke**
   - What we know: Supabase Presence is used client-side for display; the server uses the service-role client.
   - What's unclear: Whether the Hono backend can efficiently read Presence state from Supabase server-side before initiating the stream, vs. having the client pass a "is_anyone_typing" flag in the POST body.
   - Recommendation: Client passes `{ anyoneTyping: boolean }` in the POST body to `/invoke`. Client reads from the existing `useTypingPresence` store state before the POST. This avoids a round-trip to Supabase Presence from the backend.

2. **Reactions Realtime broadcast mechanism**
   - What we know: Messages are broadcast via Supabase Realtime INSERT events. Reactions need to reach all participants.
   - What's unclear: Whether reactions use Postgres Realtime INSERT subscription (same as messages) or a dedicated Broadcast channel.
   - Recommendation: Use Postgres Realtime `INSERT` subscription on the `reactions` table — consistent with the existing messages pattern and requires zero additional backend code.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 LTS | Hono backend runtime | ✓ | v22.17.1 | — |
| Supabase CLI | DB migrations | ✓ | 2.105.0 | — |
| `@anthropic-ai/sdk` | AI streaming | ✓ | 0.102.0 | — |
| shadcn CLI | `switch`, `scroll-area` components | ✓ | v4.11.0 | — |
| Creator Anthropic API key | Claude API calls | Must exist in creator_settings | — | Existing `verifyApiKey` gate handles missing key |

**Missing dependencies with no fallback:** none

---

## Validation Architecture

nyquist_validation is explicitly `false` in `.planning/config.json` — section skipped per protocol.

---

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth — existing `requireAuth` middleware on all AI routes |
| V4 Access Control | yes | Session creator_id gate on `/invoke`; reaction INSERT checks `auth.uid() = author_id` |
| V5 Input Validation | yes | Zod `PanelWidgetSchema.safeParse()` before panelStore update (AI-05); content body max 4000 chars already enforced |
| V6 Cryptography | yes | API key already encrypted at rest (AES-256-GCM); never transmitted to browser (AI-02) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client-side bot activation bypass | Elevation of Privilege | Server-side `@analista` pattern match + reaction trigger check — client POST does not self-authorize AI call |
| Panel payload injection (corrupt widget data) | Tampering | Zod `safeParse()` discards invalid payloads silently (AI-05); never trust AI output before validation |
| Reaction spam → runaway AI cost | Denial of Service | Existing `cap-guard.ts` `checkCap()` enforced before every invoke; UNIQUE constraint on reactions table prevents duplicate emoji per user per message |
| API key exposure via SSE stream | Information Disclosure | Key decrypted server-side only; never included in any SSE event or response body |
| Guest impersonation via reaction POST | Spoofing | `reactions` table RLS: `auth.uid() = author_id` on INSERT (mirrors messages pattern) |

---

## Sources

### Primary (HIGH confidence)
- `platform.claude.com/docs/en/build-with-claude/streaming` — Event flow for tool use streaming (content_block_start, content_block_delta, content_block_stop), TypeScript examples
- `github.com/anthropics/anthropic-sdk-typescript/blob/main/helpers.md` — MessageStream API: `stream()`, `.on('text')`, `.on('contentBlock')`, `.done()`
- `hono.dev/docs/helpers/streaming` — `streamSSE()` API, `writeSSE({ event, data, id })`, `stream.aborted`
- `apps/api/src/lib/anthropic.ts` — Existing `assemblePromptArray()` + `verifyApiKey()` — verified in codebase
- `apps/api/src/routes/ai.ts` — Existing 501 stub — verified in codebase
- `supabase/migrations/0001_initial_schema.sql` — `canvas_snapshot_state jsonb` already exists; `messages_session_path_created_idx` already exists

### Secondary (MEDIUM confidence)
- `github.com/recharts/recharts/wiki/3.0-migration-guide` — `TooltipProps` → `TooltipContentProps` breaking change in Recharts 3.x
- `motion.dev/docs/react-upgrade-guide` — framer-motion 12.x has no API-breaking changes from 11.x for React
- Codebase scan (`use-typing-presence.ts`, `use-creator-presence.ts`, `session-store.ts`) — Presence channel pattern, existing Zustand store shape

### Tertiary (LOW confidence)
- `deepwiki.com/anthropics/anthropic-sdk-typescript` — Additional streaming event types (cross-verified with official helpers.md)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified installed via package.json + npm view
- Streaming architecture: HIGH — verified against official Anthropic docs + Hono docs
- Recharts widget API: MEDIUM — 3.x migration guide confirmed, but widget-specific edge cases (SSR, ResponsiveContainer height) are ASSUMED from training knowledge
- Panel store pattern: HIGH — mirrors existing sessionStore pattern already in codebase
- DB migration: HIGH — existing schema confirmed in migration files; new tables follow established patterns

**Research date:** 2026-06-13
**Valid until:** 2026-07-13 (stable stack, 30-day validity)
