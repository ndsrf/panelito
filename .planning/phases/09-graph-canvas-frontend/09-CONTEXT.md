# Phase 9: Graph Canvas Frontend - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 9 delivers the interactive Graph Canvas — the visual surface that makes the AI's knowledge graph tangible for all participants. Concretely:

- `GET /api/sessions/:id/canvas?branch_id=` endpoint returning committed canvas state for branch switch / Realtime reconnect (CANVAS-03)
- Blueprint-based panel routing: `canvas_view_mode` resolves server-side and determines whether the session renders the Graph Canvas or the existing Recharts panel (CANVAS-04)
- `GraphCanvas` component built with `@xyflow/react` (loaded via `next/dynamic ssr:false`), registered as a `'graph'` widget type in the existing widgetRegistry — Blueprint-colored node and edge types (UI-01)
- Ghost node rendering (dashed border, ~40% opacity); any participant can click to confirm (→ committed) or dismiss (→ silent); pg_cron handles 60-second expiry (UI-02)
- Real-time canvas updates: `canvas_update` broadcast (already wired in `use-session-channel.ts`) triggers live re-render for all participants within one second (UI-03)
- `PATCH /api/canvas_nodes/:id` endpoint for ghost confirm/dismiss actions (new in Phase 9)

**Phase 9 ends** when all 4 success criteria in ROADMAP.md §Phase 9 pass.

**Key architectural reversal from Phase 8:** Ghost nodes ARE now persisted to `canvas_nodes` with `status='ghost'` (Phase 8 D-14 excluded them from DB). This is a user decision made in this discussion.

**Not in this phase:** Human manual canvas editing (UI-04, v2.1 deferred); multi-widget horizontal scroll panel (v2.1 deferred); `canvas_view_mode: 'auto'` where the AI chooses between graph and chart per invocation (v2.1 deferred); branch fork canvas carry-over (CANVAS-05, v2.1 deferred).

</domain>

<decisions>
## Implementation Decisions

### Ghost Node Delivery (UI-02, CANVAS-02)

- **D-01:** Ghost nodes ARE persisted to `canvas_nodes` with `status='ghost'` — this reverses Phase 8 D-14. The user decision is that ghost nodes must be visible to all participants in real time, which requires DB persistence and broadcast.
- **D-02:** The `canvas_update` Realtime broadcast carries both committed and ghost nodes from each invocation. All participants receive ghosts via the same channel as committed nodes.
- **D-03:** `GET /api/sessions/:id/canvas` (CANVAS-03) returns **committed nodes only** on branch switch/reconnect. Ghost nodes are discarded on reconnect — they're ephemeral per invocation. Client filters by `status = 'committed'`.
- **D-04:** 60-second ghost expiry is handled by a Supabase `pg_cron` job: `DELETE FROM canvas_nodes WHERE status = 'ghost' AND created_at < now() - interval '60 seconds'`. Zero client coordination required.

### Panel View Routing (CANVAS-04, UI-01)

- **D-05:** `Blueprint.canvas_view_mode` determines the panel mode for the session:
  - `'graph'` → GraphCanvas widget always active; the AI may still emit regular chart widgets in the same session (last AI action wins)
  - `'chart'` → existing Recharts panel behavior; GraphCanvas never appears
  - `'auto'` → deferred to v2.1 (AI chooses per-invocation between graph and chart)
- **D-06:** `GraphCanvas` is registered as a new `'graph'` widget type in `widgetRegistry`, alongside `radar`, `bar`, `scatter`, etc. It reads node/edge data from `sessionStore.canvasNodes` / `sessionStore.canvasEdges` directly — NOT from `widgetData` in panelStore. The `widgetData` for a `'graph'` widget is minimal (no embedded node/edge payload).
- **D-07:** The `'graph'` widget is triggered when the `/invoke` route emits a `panel_update` broadcast with `widget_type: 'graph'` after committing canvas nodes — same mechanism as chart widget updates. This makes the path consistent and enables future `'auto'` mode on the backend without frontend changes.
- **D-08:** `canvas_view_mode` is resolved **server-side** in `sessions/[id]/page.tsx` by loading the Blueprint from `session.blueprint_id`, then passed as a prop to `Workspace` — same pattern as `hasApiKey`. No client-side Blueprint fetch required for routing.
- **D-09:** When the panel is showing a chart and a canvas mutation arrives (or vice versa), **last AI action wins** — the panel switches to whatever the AI most recently emitted. This is already the behavior of `panelStore.setWidget()`. No stickiness; panel freely switches per invocation.

### Ghost Node Interactions (UI-02)

- **D-10:** Any participant (not creator-only) can confirm or dismiss a ghost node by clicking it in the Graph Canvas. First click wins (last-write-wins on the DB row).
- **D-11:** **Confirm** = client calls `PATCH /api/canvas_nodes/:id` with `{ status: 'committed' }`. Server updates DB and broadcasts `canvas_update` (committed node replaces ghost for all participants).
- **D-12:** **Dismiss** = client calls `PATCH /api/canvas_nodes/:id` with `{ status: 'silent' }`. Row stays in DB for audit trail. Canvas re-renders without the silent node. pg_cron may clean up silent rows on a longer schedule.

### Canvas Fetch on Branch Switch (CANVAS-03)

- **D-13:** Canvas fetch on branch switch lives in **`workspace.tsx`** alongside the existing branch switch handler. On branch change: `setActiveBranch(branchId)` + `fetchCanvas(sessionId, branchId)` (calls `GET /api/sessions/:id/canvas?branch_id=`) + `sessionStore.setCanvasData(nodes, edges)` to overwrite local state with committed-only snapshot.
- **D-14:** Realtime reconnect triggers a canvas refresh inside **`use-session-channel.ts`** on the Supabase `'SUBSCRIBED'` status event — overwrites `sessionStore` with committed canvas state to fill any gaps during disconnection.

### Claude's Discretion

- Exact `@xyflow/react` node/edge rendering configuration (layout algorithm, `dagre` vs manual positions, zoom controls, minimap)
- PanelWidget type union extension to add `'graph'` entry and its minimal shape
- Whether the `PATCH /api/canvas_nodes/:id` endpoint is a new `canvasRouter` or added to an existing router
- Whether the pg_cron job is added via a new migration or an existing maintenance migration
- Exact CSS for ghost node rendering in @xyflow/react (dashed border via custom node type, opacity via className or style prop)
- Whether to show a confirmation tooltip on ghost node hover before the click action

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and Roadmap
- `.planning/REQUIREMENTS.md §UI-01, UI-02, UI-03` — 3 frontend requirements for Phase 9; exact acceptance criteria for ghost node rendering, real-time updates, and Blueprint-colored node types
- `.planning/REQUIREMENTS.md §CANVAS-03, CANVAS-04` — Canvas fetch on branch switch/reconnect; view mode routing; success criteria language
- `.planning/ROADMAP.md §Phase 9` — 4 success criteria that must be TRUE; read exact wording before planning tests/verification
- `.planning/REQUIREMENTS.md §Out of Scope` — Human canvas editing (UI-04) explicitly v2.1; CRDT/Yjs banned; per-domain schemas banned

### Prior Phase Context (MUST READ — Phase 9 extends Phase 8 decisions)
- `.planning/phases/08-human-control-canvas-sync/08-CONTEXT.md` — D-15 (server generates UUIDs before upsert — stable React keys for Phase 9), D-16 (canvas_update broadcast format: `{ nodes: CanvasNode[], edges: CanvasEdge[] }`), D-17 (ADD_NODE before ADD_EDGE ordering), D-18 (canvas upsert timing relative to SSE done). **Note:** D-14 (ghost nodes not in DB) is REVERSED by Phase 9 D-01.
- `.planning/phases/07-invoke-route-modification/07-CONTEXT.md` — D-05 (streamWriter seam), D-06 (Promise.all graph+SSE pattern); Phase 9's `/invoke` modifications must not contradict these.
- `.planning/phases/06-graph-construction-checkpointer/06-CONTEXT.md` — D-07 (Blueprint vocabulary enforcement in MutationGateNode), D-09 (Blueprint in configurable, not checkpointed state)

### Types (check before defining anything new)
- `packages/types/src/canvas.ts` — `CanvasNode`, `CanvasEdge`, `CanvasNodeStatus` (committed/ghost/silent); the status field drives all rendering decisions in Phase 9
- `packages/types/src/blueprint.ts` — `Blueprint`, `NodeTypeConfig`, `EdgeTypeConfig`; Phase 9 reads `node_types[].color` and `node_types[].label` for graph node styling; `canvas_view_mode` field drives panel routing
- `packages/types/src/ai.ts` — `PanelWidget` union type; Phase 9 adds `'graph'` as a new widget type entry

### Frontend Components (USE, extend, don't duplicate)
- `apps/web/components/workspace/AnalyticsPanel.tsx` — Current top 40% panel; Phase 9 adds `'graph'` case to the widget render path inside `WidgetZone`; error boundary already wraps it
- `apps/web/components/workspace/widgets/widget-registry.ts` — Phase 9 adds `'graph'` → `GraphCanvas` entry here
- `apps/web/hooks/use-session-channel.ts` — Already handles `canvas_update` broadcast and writes to `sessionStore.canvasNodes/canvasEdges` (D-13/D-14); Phase 9 adds the Realtime reconnect canvas fetch on `'SUBSCRIBED'` event
- `apps/web/store/session-store.ts` — `canvasNodes`, `canvasEdges`, `setCanvasData()` already defined and wired; `GraphCanvas` reads directly from this store

### Backend — Existing Route Patterns
- `apps/api/src/routes/ai.ts` — Phase 9 adds `panel_update` broadcast with `widget_type: 'graph'` after committed canvas nodes are upserted (alongside existing canvas_update broadcast); follows the same post-stream cleanup sequence
- `apps/api/src/routes/messages.ts` — httpSend broadcast pattern; `PATCH /canvas_nodes/:id` broadcasts `canvas_update` following same pattern
- `apps/api/src/routes/sessions.ts` — New `GET /:id/canvas` and `PATCH /canvas_nodes/:id` routes added here (or a new `canvasRouter`)
- `apps/api/src/lib/supabase.ts` — `createServiceClient()` for all DB writes in new canvas routes

### Database (Phase 5 deliverables — already exist)
- `supabase/migrations/0008_*.sql` (or equivalent) — `canvas_nodes` and `canvas_edges` tables already created; Phase 9 adds `PATCH` endpoint for status updates, adds `pg_cron` job for ghost expiry (new migration), and adds the `GET /canvas` read endpoint
- RLS on `canvas_nodes` / `canvas_edges` — Phase 9 read/write must respect existing RLS policies

### Do NOT Touch (v2.1 domain)
- Human manual canvas editing (UI-04) — deferred
- Multi-widget horizontal scroll panel — deferred
- `canvas_view_mode: 'auto'` AI-driven panel selection — deferred
- Branch fork canvas carry-over (CANVAS-05) — deferred

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/web/hooks/use-session-channel.ts#canvas_update handler` — Already writes `nodes` and `edges` from broadcast to `sessionStore.setCanvasData()`. Phase 9 adds a `'SUBSCRIBED'` handler to the same channel for reconnect canvas fetch.
- `apps/web/store/session-store.ts#canvasNodes/canvasEdges/setCanvasData` — Already defined; `GraphCanvas` reads these directly without needing new store fields.
- `apps/web/components/workspace/widgets/widget-registry.ts` — Phase 9 adds one entry: `'graph' → GraphCanvas`. Same pattern as existing widget registrations.
- `apps/web/lib/api.ts#apiFetch` — `apiFetch<T>('/api/sessions/:id/canvas', ...)` pattern for canvas fetch; same auth pattern as other API calls.
- `apps/web/app/(protected)/sessions/[id]/page.tsx` — Server component that already fetches `session` and `hasApiKey`; Phase 9 adds Blueprint load here to extract `canvas_view_mode`.

### Established Patterns
- **next/dynamic ssr:false**: Required for `@xyflow/react` (DOM-dependent); use `dynamic(() => import('@/components/workspace/GraphCanvas'), { ssr: false })`. Match how heavy chart widgets handle SSR if applicable.
- **Widget registration pattern**: `widgetRegistry.ts` maps `widget_type` string → React component. `GraphCanvas` follows this exactly.
- **Error boundary**: `AnalyticsPanelErrorBoundary` already wraps `WidgetZone`. `GraphCanvas` is rendered inside this boundary — crashes in @xyflow/react won't break the chat.
- **httpSend fire-and-forget broadcast**: `supabase.channel(...).httpSend(...)` non-blocking pattern; `PATCH /canvas_nodes/:id` broadcasts `canvas_update` using this pattern.
- **Fail-silent for non-fatal operations**: Phase 9 canvas fetch failures on branch switch → log + leave existing canvas state unchanged (don't crash the branch switch).
- **Server prop pattern**: `hasApiKey` is resolved server-side in `page.tsx` and passed to `Workspace`. `canvas_view_mode` follows the same pattern.

### Integration Points
- `workspace.tsx` — Branch switch handler: add `fetchCanvas(sessionId, newBranchId)` call + `sessionStore.setCanvasData()` after `sessionStore.setBranchId()`
- `AnalyticsPanel.tsx#WidgetZone` — Add `'graph'` case: when `widgetType === 'graph'`, render `<GraphCanvas />` inside `AnimatePresence` keyed on `graph-${branchId}`
- `/invoke route` (`apps/api/src/routes/ai.ts`) — After committed canvas upserts (Phase 8), add `panel_update` broadcast with `{ widget_type: 'graph' }` to trigger panel switch for all participants
- `canvas_nodes` / `canvas_edges` DB tables — Phase 9 adds a `PATCH` status-update endpoint and a `GET` read endpoint; tables already exist from Phase 5

</code_context>

<specifics>
## Specific Ideas

- **Graph as a widget, not a panel replacement**: The user's vision is the GraphCanvas as one of many possible panel states (like radar, bar, scatter). The panel is a flexible display surface; the graph is the AI's current visualization choice, not a permanent mode lock.
- **Last AI action wins**: Panel freely switches between graph and chart widgets per invocation. If the AI emits a radar chart one turn and a canvas mutation the next, the panel shows the graph. No stickiness required in Phase 9.
- **Ghost confirm/dismiss UX**: Ghost nodes have dashed borders and ~40% opacity. On hover/click, show affordance for confirm (✓) or dismiss (✗). All participants see the result in real time via `canvas_update` broadcast.
- **Future horizontal scroll**: The user explicitly wants multiple widgets visible simultaneously with horizontal scroll in a future version. Phase 9 should not create architectural debt against this — the `widgetRegistry` pattern of typed components maps cleanly to a future `widgetList: PanelWidget[]` model.
- **Blueprint node colors**: `NodeTypeConfig.color` drives the visual style in `@xyflow/react`. Debate Blueprint node types (Hypothesis, Evidence, Counter-Argument, Action) each have a distinct color. Phase 9 reads these from the Blueprint loaded at the server component level.
- **"auto" mode is explicitly v2.1**: User confirmed the three-mode model (graph/chart/auto) where "auto" allows the AI to switch per invocation. Phase 9 only implements graph and chart as static Blueprint-level configuration.

</specifics>

<deferred>
## Deferred Ideas

- **`canvas_view_mode: 'auto'`** — AI decides per-invocation whether to emit a graph or chart widget. Requires changes to the AgentNode tool schema, backend routing logic, and a unified panel history. Explicitly v2.1.
- **Multi-widget horizontal scroll panel** — User wants to show multiple widgets simultaneously with a priority order and horizontal scroll. Phase 9 establishes the `widgetRegistry` pattern that this will extend. Explicitly v2.1.
- **Human manual canvas editing (UI-04)** — Participants manually adding, editing, or deleting canvas nodes and edges. Explicitly v2.1 per REQUIREMENTS.md.
- **Branch fork canvas carry-over (CANVAS-05)** — Forked branches inheriting parent canvas state. Explicitly v2.1 per REQUIREMENTS.md.
- **Silent node cleanup** — pg_cron for silent rows (audit trail cleanup after configurable grace period). Phase 9 only implements ghost expiry (60s). Silent rows persist until a v2.1 maintenance job.

</deferred>

---

*Phase: 09-graph-canvas-frontend*
*Context gathered: 2026-07-04*
