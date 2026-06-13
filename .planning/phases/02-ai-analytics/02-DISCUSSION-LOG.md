# Phase 2: AI + Analytics - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-13
**Phase:** 2-AI + Analytics
**Areas discussed:** Streaming delivery, Panel state & widget data, Reaction → AI trigger flow, Persona toggle & labeling

---

## Streaming delivery

| Option | Description | Selected |
|--------|-------------|----------|
| fetch() + ReadableStream | Frontend calls fetch() on /invoke, reads body as stream. Full control over chunk processing. | ✓ |
| EventSource API | Browser-native SSE. Simpler but can't set POST body with session context. | |
| Anthropic SDK on frontend | Direct browser call — exposes API key (prohibited by AI-02). | |

**User's choice:** fetch() + ReadableStream

---

| Option | Description | Selected |
|--------|-------------|----------|
| Ephemeral local state, committed on completion | In-flight text in React state; final message POSTed to Supabase at end of stream. | ✓ |
| Write tokens to Supabase in real-time | Each chunk updates the DB; many round-trips and Realtime noise. | |
| Separate 'streaming' Supabase channel | Broadcast raw chunks over dedicated channel; complex reconnect handling. | |

**User's choice:** Ephemeral local state, committed on completion

---

| Option | Description | Selected |
|--------|-------------|----------|
| Anthropic tool use | Claude emits text normally + calls render_panel tool for panel mutations. | ✓ (with note) |
| JSON envelope in stream | Server classifies chunks as text/panel; fragile unstructured parsing. | |

**User's choice:** Anthropic tool use
**Notes:** User explicitly requested that the implementation be wrapped behind a thin `AIProvider` adapter interface so that Gemini and OpenAI can be swapped in for v2 without changing Hono route logic.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Soft-lock input for everyone (CHAT-06) | All participants see the lock indicator during AI stream. | ✓ |
| Only lock for the invoker | Others can still type — risks conflicting prompts. | |
| No lock — queue requests | Complex server-side queue; out of MVP scope. | |

**User's choice:** Soft-lock for everyone (CHAT-06 as designed)

---

## Panel state & widget data

| Option | Description | Selected |
|--------|-------------|----------|
| Zustand panelStore | { widgetType, widgetData, branchId, snapshotState }. Clean unidirectional flow, easy branch-swap. | ✓ |
| React state lifted into workspace.tsx | Simpler short-term; prop-drilling becomes messy. | |
| Supabase Realtime subscription in AnalyticsPanel | Direct subscription; harder to sequence with local optimistic updates. | |

**User's choice:** Zustand panelStore

---

| Option | Description | Selected |
|--------|-------------|----------|
| All 4 widget types fully implemented | Bento + radar + scatter + pie. AI selects the right one. | ✓ (with note) |
| Bento + radar first, scatter + pie as stubs | Lower risk but AI may select unsupported type. | |
| Bento only | One layout; doesn't deliver the "AI selects the right widget" promise. | |

**User's choice:** All 4 fully implemented
**Notes:** User noted there will be more widget types in the future (maps, funnels, etc.). Captured as a requirement: build an extensible widget registry (`widgetType → component map`) so new types can be added without modifying the panel container.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Read canvas_snapshot_state from last AI message for branch | Instant panel re-render on branch switch from stored snapshot. | ✓ (with note) |
| Re-invoke AI on branch switch | Too slow and wastes API calls. | |
| Clear panel to empty state on branch switch | Visually jarring; loses branch analysis history. | |

**User's choice:** canvas_snapshot_state hydration
**Notes:** User explicitly requested animated transitions — panel should *morph and evolve*, not switch like pages. This applies both to in-branch AI updates and branch switches. Framer Motion AnimatePresence + layout animations are the implementation vehicle.

---

## Reaction → AI trigger flow

| Option | Description | Selected |
|--------|-------------|----------|
| Reaction POST → server handles AI trigger | Single POST to /reactions; server decides whether to fire AI based on emoji type. | ✓ |
| Two-step from client | POST reaction then POST /invoke — two round-trips, race condition risk. | |
| Optimistic + WebSocket trigger | Multiple clients each fire AI — not viable. | |

**User's choice:** Reaction POST → server triggers AI

---

| Option | Description | Selected |
|--------|-------------|----------|
| Count badge on the message bubble | Emoji + count appears immediately on apply; reverts on failure. | ✓ |
| Full reaction bar below the bubble | More visible but adds layout complexity and shifts scroll. | |
| Toast notification only | No persistent UI; doesn't show cumulative reactions from others. | |

**User's choice:** Count badge on message bubble

---

| Option | Description | Selected |
|--------|-------------|----------|
| Reaction count on bubble only (Phase 2 scope) | 🧠 shows as a count badge; session summary uses it in Phase 3+. | ✓ |
| Pin to dedicated 'Key Concepts' panel section | 5th widget type, adds complexity. | |
| Highlighted border on message bubble | Visual distinction without panel interaction. | |

**User's choice:** Reaction count on bubble only

---

## Persona toggle & labeling

| Option | Description | Selected |
|--------|-------------|----------|
| CreatorControls bar only | Toggle in existing freeze/share controls. | |
| Session creation form only | Not changeable mid-session. | |
| Settings page (/settings) | Global default; no per-session control. | |

**User's choice:** Free text / expanded scope
**Notes:** User described a more complete persona system: (1) optional persona picker at session creation — pick from a library; (2) mid-session persona management via a CreatorControls panel/drawer to add/remove personas; (3) also requested a kick mechanism for bots or humans. The kick mechanism was noted as a deferred idea (Phase 3). The persona library pattern is captured — Phase 2 implements it with 1 persona (Analista Científico) but the UI supports future additions.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Badge in bubble header | Small badge alongside display name: [icon] Analista Científico. | ✓ |
| Colored left border | Text-only persona indicator. | |
| Full persona card header | Larger header row; more space per message. | |

**User's choice:** Badge in bubble header (PERSONA-03 as designed)

---

## Claude's Discretion

- Exact Zod schema for `ui_mutation_block` (field names, per-widget data structure)
- Widget visual design in Recharts components (colors, axes, tooltip format) — consistent with shadcn/ui theme
- SSE event type names for text chunks vs. panel updates vs. done signal
- Historical summary compression model choice (AI-08)
- `AIProvider` interface shape — minimal interface covering streaming text + tool use across providers

## Deferred Ideas

- **Kick mechanism** (bots or humans from session) — raised by user during persona discussion. New capability not in Phase 2 requirements. Noted for Phase 3.
- **Devil's Advocate persona** (PERSONA-04, v2) — Phase 2 only builds Analista Científico.
- **Flash Router** (PERSONA-06, v2) — multi-agent persona orchestration based on conversation signals.
- **Scroll-spy time-travel** (TIME-01, v2) — panel historical state on scroll.
