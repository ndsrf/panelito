# Requirements: Project Multiverse

**Defined:** 2026-06-08
**Core Value:** The live analytics panel stays synchronized with the active conversation branch — transforming group chat into structured, visual collective thinking.

---

## v1 Requirements

### Layout

- [ ] **LAYOUT-01**: App shell locks `--app-height` from `window.innerHeight` on mount; Visual Viewport API listener updates `--keyboard-height` dynamically so the virtual keyboard never collapses the analytics panel
- [ ] **LAYOUT-02**: Analytics panel occupies exactly 40% of locked app height (`flex-shrink: 0`, `overflow: hidden`) — stays rigid and physically insulated from keyboard displacement
- [ ] **LAYOUT-03**: Chat stream section absorbs 100% of keyboard displacement: height computed as `(--app-height * 0.6) - --keyboard-height`
- [ ] **LAYOUT-04**: Input box is anchored via `position: absolute` to the dynamic bottom of `window.visualViewport.height`, gliding flush on top of the virtual keyboard
- [ ] **LAYOUT-05**: The Branch Navigator is a sticky horizontal bar that acts as the physical divider between the analytics panel (top 40%) and the chat stream (bottom 60%); it displays the active branch label and a chromatic gradient of the branch's assigned color so users always have ambient awareness of which timeline they are in
- [ ] **LAYOUT-06**: Touch gesture protocol on message bubbles: double-tap opens an ephemeral quick-reaction popover (🧠🔥📌🎯); long press (500ms, with light haptic feedback) opens the contextual action menu with "Fork" and "Pin to Panel" options

### Session & Auth

- [ ] **SESS-01**: Session Creator can sign in via OAuth (Google or GitHub) through Supabase Auth — no custom auth system required
- [ ] **SESS-02**: Creator can create a new session with a title and optional operational mode (strategy, debate, red team)
- [ ] **SESS-03**: Creator can display a live QR code and copyable session URL for guest entry
- [ ] **SESS-04**: Guests enter the session by scanning the QR code or opening the URL, providing only a temporary display name — no registration, no password
- [ ] **SESS-05**: Creator can manually freeze the session: all guest input is disabled while the session remains visible
- [ ] **SESS-06**: Creator can formally close/finalize the session: guests can no longer send messages
- [ ] **SESS-07**: Auto-freeze triggers if the creator's connection is inactive or disconnected for 15+ consecutive minutes
- [ ] **SESS-08**: Guest ephemeral credentials expire on session close; unexported session data is scrubbed after a configurable grace period
- [ ] **SESS-09**: Dynamic Room Naming — if the creator leaves the session title blank at creation (`SESS-02`), the system assigns a temporary placeholder; after the first 3 messages are sent, a background flash model call analyzes the conversation and automatically updates the room title with a short, topic-derived name
- [ ] **SESS-10**: Guest Session Persistence — the guest's ephemeral token and `user_id` are stored in `localStorage` on their device at join time; on browser reload or WebSocket reconnection, the app silently restores the guest's active session without showing the identity-claim screen (`SESS-04`) again, preventing duplicate user entries in Supabase
- [ ] **SESS-11**: Anti-Flicker Connection De-bounce — the 15-minute auto-freeze timer (`SESS-07`) applies a 30-second grace buffer before treating an admin disconnect as a real absence; if the creator's device reconnects and emits presence within that window, the timer resets silently without altering the guest interface; only a sustained absence beyond the grace period triggers the freeze

### Real-Time Chat

- [ ] **CHAT-01**: Messages are delivered to all session members in real-time via Supabase Realtime broadcast channels (< 200ms perceived latency)
- [ ] **CHAT-02**: Each message displays the author's display name and a consistent color-coded avatar
- [ ] **CHAT-03**: Chat stream auto-scrolls to the latest message when the user is at the bottom; preserves scroll position when the user is reading history
- [ ] **CHAT-04**: Every message stores `parent_id`, `path_id`, `session_id`, `author_id`, `content`, and `canvas_snapshot_state` (NULL if this message did not mutate the panel)
- [ ] **CHAT-05**: Historical messages are immutable — no edits, no deletes permitted for any participant
- [ ] **CHAT-06**: Supabase Presence tracks each participant's typing state; the Branch Navigator bar displays live co-writing indicators ("Lau está escribiendo...") for anyone currently composing a message in the active branch; the chat input is soft-locked (with a visual indicator) while an AI streaming response is in flight, preventing contradictory simultaneous prompts

### AI Integration

- [ ] **AI-01**: Creator provides their Anthropic API key via a clearly labeled UI flow ("Connect Access Key") — key is stored encrypted in Supabase user metadata, never transmitted to the browser
- [ ] **AI-02**: All Claude API calls are made exclusively server-side (Hono backend) — the API key is never present in any client-side request
- [ ] **AI-03**: AI responses stream token-by-token into the chat stream with visible streaming indicator
- [ ] **AI-04**: AI output uses strict dual-channel streaming: `text_stream` routes to chat bubbles; `ui_mutation_block` is a separate JSON tool call routed to the analytics panel
- [ ] **AI-05**: Every `ui_mutation_block` is validated against a Zod schema before touching React state; corrupted or schema-invalid payloads are silently discarded and the last stable panel state is preserved
- [ ] **AI-06**: AI context is assembled server-side using only messages whose `path_id` matches the active branch path — sibling branch content is never included
- [ ] **AI-07**: Bot activation matrix — the AI only generates a response when (a) a participant explicitly invokes it via `@mention` (e.g. `@analista, ¿qué opinas?`), or (b) a Power Reaction is applied (🔥 Intensify, 📌 Pin, 🎯 Simplify); the bot never auto-responds to every human message; if Supabase Presence detects a participant is typing, any queued AI response is held until the human input clears
- [ ] **AI-08**: Server-side sliding window context strategy: pass only the last 8 raw messages of the active branch to Claude; prepend a background-compressed summary of the older conversation history (generated by a lighter/faster model call) to preserve context without unbounded latency growth
- [ ] **AI-09**: Branch Auto-Labeling — when a fork is created (`BRANCH-01`), the server invokes a lightweight flash model call in the background to analyze the source message and return a semantic 2–3 word label (e.g. "Estrategia Gas", "Variante Pistacho"); the branch is automatically named without any user input, satisfying `BRANCH-02`'s readable label requirement within 200ms
- [ ] **AI-10**: Upfront Key Verification — when the creator submits their API key (`AI-01`), the Hono backend immediately executes a minimal handshake request against the Anthropic API before persisting the key; if the API returns an authentication error, the save is aborted and the frontend displays an immediate, specific error message; keys that pass verification are saved encrypted
- [ ] **AI-11**: Prompt Caching Architecture — the Hono route assembles the Claude prompt array with all static blocks (system prompt, persona instructions, historical summary) as a deterministic prefix with `cache_control: { type: "ephemeral" }` appended at the end of the summary block; the dynamic tail (last 8 sliding-window messages + incoming user prompt) is placed exclusively after the cache breakpoint; this structure ensures the static prefix is never invalidated between consecutive turns in the same session, targeting > 80% cache hit rate across concurrent multi-user requests

### Analytics Panel

- [ ] **PANEL-01**: The AI selects the appropriate widget type for the current conversation content and renders it: bento grid (key concept cards), radar chart (multi-axis analysis), scatter plot (consensus/impact map), or pie chart (proportional breakdown)
- [ ] **PANEL-02**: The analytics panel re-renders instantly when a user switches between branches, reflecting the latest snapshot of the selected branch
- [ ] **PANEL-03**: A visible colored badge on the panel indicates which branch the panel is currently reflecting
- [ ] **PANEL-04**: Each AI message that mutates the panel stores its resulting `canvas_snapshot_state` in the message row for future recall

### Branching Engine

- [ ] **BRANCH-01**: Any session participant can fork from any message in the conversation history to create a new parallel branch
- [ ] **BRANCH-02**: Each branch is assigned a unique color from a pre-defined palette and a readable label
- [ ] **BRANCH-03**: The Branch Navigator (see LAYOUT-05) shows all open branches as labeled color chips; tapping a chip switches the active branch, triggers an instant panel re-render, and updates the bar's gradient to the new branch color
- [ ] **BRANCH-04**: Branch AI context isolation: messages from sibling branches (sharing a common ancestor but diverging paths) are never included in AI context for the active branch
- [ ] **BRANCH-05**: Sessions are limited to a maximum of 5 simultaneous active branches; attempting to create a 6th displays a clear error
- [ ] **BRANCH-06**: Switching to a different branch immediately re-renders the analytics panel to the latest snapshot stored for that branch

### Power Reactions

- [ ] **REACT-01**: Any participant can apply 🧠 Insight to any message — marks it as a key concept; visible in the reaction count on the message
- [ ] **REACT-02**: Any participant can apply 🔥 Intensify to any message — immediately triggers the AI to generate a follow-up response critically attacking that statement and surfacing hidden risks
- [ ] **REACT-03**: Any participant can apply 📌 Pin to any message — immediately triggers the AI to convert the message content into a permanent visual card added to the analytics panel
- [ ] **REACT-04**: Any participant can apply 🎯 Simplify to any AI message — immediately triggers the AI to summarize its last response into 3-5 concise bullet points
- [ ] **REACT-05**: All reactions apply optimistically on the local client interface before server confirmation to ensure fluid mobile responsiveness

### Multi-Agent Personas

- [ ] **PERSONA-01**: The Scientific Analyst persona is available in all sessions — responds with a rigorous, neutral, clinical tone; validates data consistency, flags logical fallacies, and structures quantitative information in the analytics panel
- [ ] **PERSONA-02**: The Session Creator can toggle the Analyst persona on or off before or during a session
- [ ] **PERSONA-03**: Each AI response bubble is clearly labeled with the active persona's name and a distinct icon

---

## v2 Requirements

### Advanced AI Personas
- **PERSONA-04**: Devil's Advocate (Red Team) persona — assertive, constructive, relentlessly surfaces failure points and market risks
- **PERSONA-05**: Creator can configure custom persona prompts (extensible persona framework)
- **PERSONA-06**: Semantic Persona Orchestration (Flash Router) — in sessions with multiple active agents, a flash model intercepts each user message server-side; if it detects undue optimism bias, an unaddressed market risk, or a data hallucination, it automatically injects a trigger to activate the Devil's Advocate (`PERSONA-04`) or Scientific Analyst (`PERSONA-01`) without requiring an explicit `@mention` or power reaction from the user

### Panel Sanity
- **PANEL-05**: Visual Sanity Sanitization — the Zod schema for `ui_mutation_block` includes business-logic range constraints (e.g. no negative values in numeric fields, text fields capped at display-safe lengths); if a structurally valid payload contains out-of-range values, the panel renders the affected widget in a simplified read-only fallback mode with a brief "Optimizando vista..." indicator rather than crashing or displaying corrupted data

### Time-Travel UI
- **TIME-01**: Scroll-spy: scrolling back in chat history smoothly updates the analytics panel to reflect the exact state when that message was sent
- **TIME-02**: Anchor jump: each panel widget exposes an anchor icon that jumps the chat stream to the message that last modified it

### Branch Merge & Convergence
- **MERGE-01**: Administrator can initiate a merge of two branches; Claude synthesizes the key attributes of both into a new unified branch
- **MERGE-02**: Merge conflict resolution: when two branches have different active widget types on the analytics panel (e.g. radar chart vs bento grid), the AI acts as a conflict resolver — it either selects the dominant widget or produces a hybrid layout for the merged branch
- **MERGE-03**: Consensus scatter plot: each idea/branch is positioned on a 2D map by group agreement and AI-assessed strategic impact
- **MERGE-04**: "Golden Path" selection: system ranks branches by engagement and validation metrics and highlights the consensus pathway

### Session Finalization & Export
- **EXPORT-01**: AI-generated session summary: Claude writes a structured markdown report from the finalized branch, covering conclusions, alternative paths explored, and key decisions
- **EXPORT-02**: One-click business case export: full executive document with decision audit trail

### B2B Features
- **B2B-01**: Anonymous mode: creator can hide participant identities so ideas are evaluated on merit, not hierarchy
- **B2B-02**: Per-user message quotas and real-time credit top-up by the creator

### Cross-Branch Awareness
- **AWARE-01**: Subtle activity notifications on the Branch Navigator bar — when a sibling branch receives a burst of messages or 🧠 Insight reactions, a pulsing dot in that branch's color appears on its chip without pulling the user out of their current branch

### Platform
- **PLATFORM-01**: BYOK multi-provider: support OpenAI and other providers via a provider abstraction layer
- **PLATFORM-02**: Session recording and replay

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Recipe / food chemistry mode | Illustrative domain example; not a v1 target market |
| Political persona clones (presets) | Examples of extensibility; not built-in presets in v1 |
| In-session private DMs | Fragments shared group consciousness; conflicts with core model |
| Video / audio | Bandwidth and complexity out of scope for v1 |
| Persistent user social graph | Ephemeral session model is a deliberate design choice |
| Native mobile app | Web-first, mobile-responsive web app; native app is a future initiative |
| Drag-and-drop branch merge UI | Core merge logic deferred; UI polish follows after logic ships |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LAYOUT-01 | Phase 1 | Pending |
| LAYOUT-02 | Phase 1 | Pending |
| LAYOUT-03 | Phase 1 | Pending |
| LAYOUT-04 | Phase 1 | Pending |
| LAYOUT-05 | Phase 1 | Pending |
| LAYOUT-06 | Phase 1 | Pending |
| SESS-01 | Phase 1 | Pending |
| SESS-02 | Phase 1 | Pending |
| SESS-03 | Phase 1 | Pending |
| SESS-04 | Phase 1 | Pending |
| SESS-05 | Phase 1 | Pending |
| SESS-06 | Phase 1 | Pending |
| SESS-07 | Phase 1 | Pending |
| SESS-08 | Phase 1 | Pending |
| CHAT-01 | Phase 1 | Pending |
| CHAT-02 | Phase 1 | Pending |
| CHAT-03 | Phase 1 | Pending |
| CHAT-04 | Phase 1 | Pending |
| CHAT-05 | Phase 1 | Pending |
| CHAT-06 | Phase 1 | Pending |
| AI-01 | Phase 1 | Pending |
| AI-02 | Phase 1 | Pending |
| AI-03 | Phase 1 | Pending |
| AI-04 | Phase 1 | Pending |
| AI-05 | Phase 1 | Pending |
| AI-06 | Phase 1 | Pending |
| AI-07 | Phase 1 | Pending |
| AI-08 | Phase 1 | Pending |
| AI-09 | Phase 3 | Pending |
| AI-10 | Phase 1 | Pending |
| AI-11 | Phase 1 | Pending |
| SESS-09 | Phase 1 | Pending |
| SESS-10 | Phase 1 | Pending |
| SESS-11 | Phase 1 | Pending |
| PANEL-01 | Phase 2 | Pending |
| PANEL-02 | Phase 2 | Pending |
| PANEL-03 | Phase 2 | Pending |
| PANEL-04 | Phase 2 | Pending |
| BRANCH-01 | Phase 3 | Pending |
| BRANCH-02 | Phase 3 | Pending |
| BRANCH-03 | Phase 3 | Pending |
| BRANCH-04 | Phase 3 | Pending |
| BRANCH-05 | Phase 3 | Pending |
| BRANCH-06 | Phase 3 | Pending |
| REACT-01 | Phase 2 | Pending |
| REACT-02 | Phase 2 | Pending |
| REACT-03 | Phase 2 | Pending |
| REACT-04 | Phase 2 | Pending |
| REACT-05 | Phase 2 | Pending |
| PERSONA-01 | Phase 2 | Pending |
| PERSONA-02 | Phase 2 | Pending |
| PERSONA-03 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 50 total
- Mapped to phases: 50
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-08*
*Last updated: 2026-06-08 after scope adjustment (added SESS-10/11, AI-10/11, v2 PANEL-05)*
