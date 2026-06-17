# Phase 3: The Multiverse - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the "Multiverse" conversation branching engine. Any participant can fork from any human message to create a parallel, isolated timeline. Branches are automatically labeled by a flash model (2–3 words), color-coded from a 10-color deep saturation palette, and isolated such that AI context never bleeds across branches. The Branch Navigator supports up to 50 active branches with horizontal scrolling and auto-centering. Switching branches instantly re-renders the analytics panel to its last stable snapshot for that branch. Parent messages ("the trunk") remain visible in the branch view but are dimmed and separated by a clear visual indicator.

**Requirements in scope:** BRANCH-01, BRANCH-02, BRANCH-03, BRANCH-04, BRANCH-05, BRANCH-06, AI-09

**Out of scope for Phase 3:** Branch merging (v2), forking from AI messages (Human-only in v1), per-session AI provider switching (Phase 4), time-travel scroll-spy (v2).

</domain>

<decisions>
## Implementation Decisions

### Branch Colors & Visuals
- **D-01:** **Fixed Sequence Color Assignment**: New branches are assigned colors in the order they are created. No user selection during forking to minimize friction.
- **D-02:** **Deep Saturation Palette**: Indigo (Main), then Emerald, Rose, Amber, Violet, Sky, Slate, Teal, Orange, Fuchsia. The palette cycles every 10 branches.
- **D-03:** **Accent-Only UI**: Branch colors are applied as accents (Navigator chip, message bubble borders, active indicator) and a subtle gradient in the Navigator bar. No full-page background tints to keep the UI clean.
- **D-04:** **Main stays Indigo**: The "Main" (trunk) branch always uses the permanent Indigo color established in Phase 1, acting as the visual anchor.

### Branch Labeling & Renaming
- **D-05:** **Auto-Labeling**: When a fork is created, a "flash" model (Haiku/Flash/Mini depending on the active provider) generates a 2–3 word semantic label based on the source message.
- **D-06:** **Manual Renaming**: Any participant can rename a branch by tapping or long-pressing its chip in the Navigator.
- **D-07:** **Strict Length Limit**: Branch names are capped at ~25 characters to ensure they fit within the Navigator chips without excessive truncation.
- **D-08:** **Human-Only Display**: Manually renaming a branch updates the UI label but does NOT update the AI's system prompt for that branch in Phase 3. The name is for human coordination.

### Timeline & Visibility
- **D-09:** **Show Full Ancestry**: Switching to a branch shows the entire message path from the session root to the current branch tip.
- **D-10:** **Trunk Indicator**: Parent messages ("the trunk") are visually dimmed (lower opacity) and separated from the branch's unique messages by a clear "Branch Point" divider (e.g., "--- Branched here for [Name] ---").
- **D-11:** **Original Colors**: Messages in the trunk retain their original branch colors (e.g., Indigo for Main messages) even when viewed from a child branch, reinforcing the ancestry concept.
- **D-12:** **Unlimited Backscroll**: Users can scroll back to the very beginning of the session history in any branch. Asynchronous loading will be added in future versions for performance, but Phase 1-3 loads all relevant messages for simplicity.

### Branch Lifecycle & Navigation
- **D-13:** **50-Branch Soft Limit**: The Navigator supports up to 50 active branches. If someone exceeds this, the app prevents further forking.
- **D-14:** **Horizontal Smart Scroll**: The Branch Navigator bar supports native horizontal swipe/drag. It automatically auto-centers the active branch chip whenever a user switches branches.
- **D-15:** **Fork Source Control**: Participants can only fork from human messages. Forking from AI-generated responses is disabled in Phase 3.
- **D-16:** **Isolation Feedback**: A small label above the chat input field ("Enviando a [Branch Name]") provides clear visual confirmation that the user is currently in an isolated branch context.
- **D-17:** **Archive & Restore**: The Session Creator can "Archive" branches from the Navigator (right-click/long-press) to hide them. Archived branches can be viewed and restored via a new list in the `CreatorControls` drawer.

### Claude's Discretion
- The exact visual styling of the "Branch Point" separator.
- The specific 10-color hex codes for the Deep Saturation palette.
- The UI pattern for the "Archived Branches" list in the CreatorControls drawer.
- The exact wording of the branch isolation label in the input area.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Branching Requirements
- `.planning/REQUIREMENTS.md` §Branching Engine — BRANCH-01..06, AI-09 details.
- `.planning/ROADMAP.md` §Phase 3 — Goal and success criteria.

### Data Model & Patterns
- `supabase/migrations/0001_initial_schema.sql` — `messages` table schema (`parent_id`, `path_id`). `path_id` is the materialized path for branch isolation.
- `apps/web/store/session-store.ts` — Existing message state. Phase 3 extends this to track `activeBranchId` and `branches[]`.
- `.planning/phases/02-ai-analytics/02-CONTEXT.md` §D-07 — Establish snapshot hydration pattern for the analytics panel.

### Components to Update
- `apps/web/components/workspace/BranchNavigator.tsx` — Transition from static "Main" chip to dynamic horizontally-scrolling list of branch chips.
- `apps/web/components/workspace/MessageBubble.tsx` — Add "Fork" action to the existing long-press menu.
- `apps/web/components/workspace/ChatStream.tsx` — Update message filtering and rendering to support dimmed ancestry + branch point indicators.
- `apps/web/components/workspace/CreatorControls.tsx` — Add branch archive/restore management.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `BranchNavigator.tsx` — Skeleton is ready; uses a nice Indigo gradient that sets the tone for branch accents.
- `session-store.ts` — `addMessage` and `setMessages` already handle simple message lists; add filtering by `path_id`.
- `0001_initial_schema.sql` — Indexes already exist for `(session_id, path_id, created_at)` to optimize branch-specific queries.

### Established Patterns
- **Zustand for State**: Use Zustand to track the `activeBranchId`.
- **Materialized Paths**: `path_id` is intended for branch isolation. A fork from message `A` (path `main`) creates a new path (e.g., `main.branch1`).
- **Snapshot Persistance**: AI messages already have `canvas_snapshot_state` (JSONB) intended for branch-switch hydration.

### Integration Points
- **MessageActionMenu**: The long-press menu on `MessageBubble` is the entry point for forking.
- **AI Context Assembly**: Server-side logic (`apps/api/src/lib/anthropic.ts` or equivalent) needs to filter by the `path_id` provided in the invocation request.

</code_context>

<specifics>
## Specific Ideas

- **Forking Animation**: When a user clicks "Fork", show a brief "Forking..." loading state on the message bubble while the flash model generates the name, then slide the new branch chip into the Navigator and auto-switch to it.
- **Branch Divider**: `--- Bifurcado aquí: [Nombre] ---` in the branch's primary color, positioned immediately after the parent message where the divergence occurred.
- **Input Label**: A small floating badge or text above the input box like `📍 Respondiendo en: Estrategia Gas` (using the branch color for the text/icon).

</specifics>

<deferred>
## Deferred Ideas

- **Branch Merging**: PRD goal v1, but ROADMAP Phase 3 requirements focus on branching/isolation only. Deferred to v2.
- **Forking from AI**: Discussed and restricted to human-only messages for Phase 3 to simplify the mental model.
- **Time-travel scroll-spy**: Panel updates as you scroll through history. Deferred to v2.

</deferred>

---

*Phase: 3-The Multiverse*
*Context gathered: 2026-06-17*
