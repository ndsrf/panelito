# Phase 9: Graph Canvas Frontend - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-04
**Phase:** 09-graph-canvas-frontend
**Areas discussed:** Ghost node delivery, Panel view routing, Ghost interactions, Canvas fetch on branch switch, Graph vs. chart coexistence

---

## Ghost Node Delivery

| Option | Description | Selected |
|--------|-------------|----------|
| SSE event — ghost_update | After graph run, /invoke emits a ghost_update SSE event with ghost CanvasOps. Only the invoking client sees it immediately; other participants via a separate broadcast. | |
| Persist ghosts to DB (revisit Phase 8 D-14) | Upsert ghost nodes with status='ghost' to canvas_nodes. canvas_update broadcast carries both committed and ghost. | ✓ |
| Ghosts ephemeral per-client only | Only the triggering participant sees the ghost locally; other participants never see it. | |

**User's choice:** Persist ghosts to DB (revisit Phase 8 D-14)

---

**Canvas fetch on reconnect — what to return:**

| Option | Description | Selected |
|--------|-------------|----------|
| Committed nodes only | GET /canvas returns status='committed' rows only. Stale ghosts irrelevant on reconnect. | ✓ |
| All nodes (committed + ghost) | GET /canvas returns all rows; client filters. Stale ghosts re-appear after reconnect. | |

**User's choice:** Committed nodes only

---

**Ghost expiry mechanism:**

| Option | Description | Selected |
|--------|-------------|----------|
| Supabase pg_cron job | Scheduled DELETE for ghost rows older than 60 seconds. Zero client coordination. | ✓ |
| Client-side countdown with PATCH | Each client runs a timer and PATCHes on expiry. Risk of multiple writes. | |

**User's choice:** pg_cron job

---

## Panel View Routing

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side: pass canvas_view_mode as a prop | Next.js server component resolves Blueprint and passes canvas_view_mode into Workspace. | ✓ |
| Denormalize onto sessions table | Add canvas_view_mode column to sessions; Workspace reads from Session object. | |

**User's choice:** Server-side (recommended), with important clarification:

**Notes:** User clarified that `canvas_view_mode` should have a third option `'auto'` (future v2.1) where the AI decides what to show per-invocation. In graph mode, the graph is treated as another chart type — not a full panel replacement. The AI can emit both graph and chart widgets in the same session. Future vision: horizontal scroll showing multiple widgets simultaneously.

---

**GraphCanvas data source:**

| Option | Description | Selected |
|--------|-------------|----------|
| From sessionStore directly | 'graph' widget reads canvasNodes/canvasEdges from sessionStore; no data payload in widgetData. | ✓ |
| Packed into widgetData | Graph widget includes a snapshot of current nodes/edges in widgetData, like other widgets. | |

**User's choice:** From sessionStore directly

---

**Trigger for graph widget to appear:**

| Option | Description | Selected |
|--------|-------------|----------|
| Automatic on first committed canvas node | Once first committed node lands, panel switches to graph. Blueprint already says graph mode. | |
| AI-explicit: graph appears only when AI emits show_graph signal | AI must explicitly choose to show graph widget. | |
| Blueprint-default: canvas_view_mode='graph' sessions always show graph | Purely Blueprint-driven, no AI choice. | |

**User's choice:** AI-explicit is the right concept, but qualified — the Blueprint configuration determines the coarse mode: graph sessions never show charts, chart sessions never show graph. Only in future 'auto' mode does the AI choose per-invocation.

**Notes:** For Phase 9, the route emits `panel_update` with `widget_type: 'graph'` after committed canvas mutations — same mechanism as chart widget updates, consistent for future 'auto' mode.

---

**Behavior when panel switches between graph and chart:**

| Option | Description | Selected |
|--------|-------------|----------|
| Last AI action wins | Panel switches to whatever AI most recently emitted. No stickiness. | ✓ |
| Graph is 'sticky' | Once graph shows, stays until explicitly cleared. | |

**User's choice:** Last AI action wins — with future note that horizontal scroll multi-widget is the intended v2.1 approach.

---

## Ghost Interactions

| Option | Description | Selected |
|--------|-------------|----------|
| All participants | Any participant can confirm or dismiss. Collaborative. First click wins. | ✓ |
| Creator only | Only session creator can act on ghost nodes. | |

**User's choice:** All participants

---

**Confirm action:**

| Option | Description | Selected |
|--------|-------------|----------|
| PATCH /canvas_nodes/:id with status='committed' | Server updates DB and broadcasts canvas_update. | ✓ |
| DELETE ghost + POST new committed node | Two operations; loses original UUID. | |

**User's choice:** PATCH with status='committed'

---

**Dismiss action:**

| Option | Description | Selected |
|--------|-------------|----------|
| PATCH /canvas_nodes/:id with status='silent' | Row stays in DB for audit trail. | ✓ |
| DELETE the row immediately | Hard delete. Clean but no audit trail. | |

**User's choice:** PATCH with status='silent'

---

## Canvas Fetch on Branch Switch

| Option | Description | Selected |
|--------|-------------|----------|
| In workspace.tsx alongside branch switch handler | All branch-switch effects in one place. | ✓ |
| In a new useCanvasSync hook | Dedicated hook watching activeBranchId. | |
| Inside use-session-channel on reconnect only | Branch switch relies on canvas_update events. | |

**User's choice:** workspace.tsx alongside existing branch switch handler

---

**Reconnect canvas refresh:**

| Option | Description | Selected |
|--------|-------------|----------|
| Re-fetch canvas inside use-session-channel on reconnect event | On SUBSCRIBED event, trigger GET /canvas. | ✓ |
| Rely on canvas_update events | No explicit reconnect handling. | |

**User's choice:** Re-fetch inside use-session-channel on SUBSCRIBED event

---

## Graph vs. Chart Coexistence

| Option | Description | Selected |
|--------|-------------|----------|
| Graph mode is exclusive (Phase 9 scope) | canvas_view_mode='graph' disables chart widgets. | |
| AI can emit both in the same session | AI decides per-invocation; panel switches freely. | ✓ |

**User's choice:** AI can emit both graph and chart widgets in the same session

**Notes:** User confirmed canvas_view_mode='graph' sessions allow chart widgets alongside canvas mutations. Last AI action wins. The future multi-widget horizontal scroll is explicitly deferred to v2.1.

---

## Claude's Discretion

- Exact @xyflow/react node/edge rendering configuration (layout algorithm, dagre vs manual positions, zoom controls, minimap)
- PanelWidget type union extension to add 'graph' entry and its minimal shape
- Whether PATCH /api/canvas_nodes/:id is a new canvasRouter or added to an existing router
- Whether pg_cron ghost expiry is added via a new migration or an existing maintenance migration
- Exact CSS for ghost node rendering in @xyflow/react (dashed border via custom node type, opacity via className or style prop)
- Whether to show a confirmation tooltip on ghost node hover before the click action

---

## Deferred Ideas

- **canvas_view_mode: 'auto'** — AI picks between graph and charts per-invocation. v2.1.
- **Multi-widget horizontal scroll panel** — Show multiple widgets simultaneously with priority order. v2.1.
- **Human manual canvas editing (UI-04)** — Participants edit nodes/edges directly. v2.1 per REQUIREMENTS.md.
- **Branch fork canvas carry-over (CANVAS-05)** — Forked branches inherit parent canvas state. v2.1 per REQUIREMENTS.md.
- **Silent node cleanup pg_cron** — Grace period cleanup of silent rows. v2.1 maintenance job.
