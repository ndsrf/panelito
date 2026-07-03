# Phase 9: Graph Canvas Frontend - Research

**Researched:** 2026-07-04
**Domain:** @xyflow/react canvas rendering, ghost node interaction, Supabase Realtime reconnect, panel routing, pg_cron migration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Ghost Node Delivery (D-01 through D-04)**
- D-01: Ghost nodes ARE persisted to `canvas_nodes` with `status='ghost'` — reverses Phase 8 D-14
- D-02: `canvas_update` broadcast carries both committed and ghost nodes from each invocation
- D-03: `GET /api/sessions/:id/canvas` returns committed nodes only on reconnect; ghost nodes are discarded
- D-04: 60-second ghost expiry via `pg_cron` — `DELETE FROM canvas_nodes WHERE status = 'ghost' AND created_at < now() - interval '60 seconds'`

**Panel View Routing (D-05 through D-09)**
- D-05: `Blueprint.canvas_view_mode` = `'graph'` always shows GraphCanvas; `'chart'` never shows GraphCanvas; `'auto'` deferred
- D-06: `GraphCanvas` registered as `'graph'` widget type in widgetRegistry; reads node/edge data from `sessionStore.canvasNodes/canvasEdges` directly — NOT from `widgetData`
- D-07: `'graph'` widget triggered by `panel_update` broadcast with `widget_type: 'graph'` after committed canvas upserts — same mechanism as chart widgets
- D-08: `canvas_view_mode` resolved server-side in `sessions/[id]/page.tsx` from Blueprint; passed as prop to Workspace
- D-09: Last AI action wins; panel freely switches per `panelStore.setWidget()` calls

**Ghost Node Interactions (D-10 through D-12)**
- D-10: Any participant (not creator-only) can confirm or dismiss a ghost node — first click wins
- D-11: Confirm = `PATCH /api/canvas_nodes/:id` with `{ status: 'committed' }` + `canvas_update` broadcast
- D-12: Dismiss = `PATCH /api/canvas_nodes/:id` with `{ status: 'silent' }` + node disappears for all participants; row kept for audit trail

**Canvas Fetch on Branch Switch (D-13 through D-14)**
- D-13: Canvas fetch on branch switch lives in `workspace.tsx`; calls `GET /api/sessions/:id/canvas?branch_id=`; calls `sessionStore.setCanvasData(nodes, edges)`
- D-14: Realtime reconnect triggers canvas refresh in `use-session-channel.ts` on Supabase `'SUBSCRIBED'` status event

### Claude's Discretion

- Exact @xyflow/react node/edge rendering configuration (layout algorithm, `dagre` vs manual positions, zoom controls, minimap)
- PanelWidget type union extension to add `'graph'` entry and its minimal shape
- Whether the `PATCH /api/canvas_nodes/:id` endpoint is a new `canvasRouter` or added to `sessions.ts`
- Whether the pg_cron job is added via a new migration or an existing maintenance migration
- Exact CSS for ghost node rendering in @xyflow/react (dashed border via custom node type, opacity via className or style prop)
- Whether to show a confirmation tooltip on ghost node hover before the click action

### Deferred Ideas (OUT OF SCOPE)

- `canvas_view_mode: 'auto'` — AI decides per-invocation
- Multi-widget horizontal scroll panel
- Human manual canvas editing (UI-04)
- Branch fork canvas carry-over (CANVAS-05)
- Silent node cleanup pg_cron job (v2.1)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CANVAS-03 | On branch switch or Realtime reconnect, client fetches canonical canvas state from `GET /api/sessions/:id/canvas?branch_id=`; ghost nodes discarded on reconnect | Backend route pattern, `apiFetch` utility, Supabase `SUBSCRIBED` callback, session store `setCanvasData` |
| CANVAS-04 | Active Blueprint's `canvas_view_mode` determines Graph Canvas (View A) vs Recharts panel (View B); both coexist | Server-side Blueprint load in `page.tsx`, prop pass to Workspace, `panelStore.setWidget` routing |
| UI-01 | Shared interactive Graph Canvas built with @xyflow/react (ssr:false dynamic import); node types and colors from active Blueprint | @xyflow/react v12.11.1 installed, `next/dynamic ssr:false` pattern confirmed, Blueprint `node_types[].color` |
| UI-02 | Ghost nodes: dashed borders, ~40% opacity; click to confirm (committed) or dismiss; 60-second expiry via pg_cron | @xyflow/react custom nodeTypes API, optimistic update pattern, pg_cron migration pattern |
| UI-03 | Graph Canvas updates in real time via Supabase Realtime within 1 second; branch switch re-renders committed snapshot | `canvas_update` handler already in `use-session-channel.ts`, `sessionStore.canvasNodes/canvasEdges` already wired |
</phase_requirements>

---

## Summary

Phase 9 delivers the Graph Canvas as a new `'graph'` widget type inside the existing AnalyticsPanel widget zone. All real-time plumbing is already wired from Phase 8 — `canvas_update` broadcast arrives, is parsed, and written to `sessionStore.canvasNodes/canvasEdges`. Phase 9 builds the renderer and the two missing API endpoints on top of that foundation.

The most significant code change is a **backend architectural reversal**: Phase 8 D-14 excluded ghost nodes from DB persistence; Phase 9 D-01 requires ghost nodes to be persisted so all participants see them in real time. This means `ai.ts` must be modified to upsert ghost-status nodes/edges and include them in the `canvas_update` broadcast alongside committed nodes. The `GET /api/sessions/:id/canvas` endpoint must filter to `status = 'committed'` only on branch-switch/reconnect fetch.

@xyflow/react 12.11.1 is already installed. The key rendering pattern is: convert `CanvasNode[]` / `CanvasEdge[]` from `sessionStore` into @xyflow/react `Node[]` / `Edge[]` objects with a dagre auto-layout fallback when `position_x`/`position_y` are null. Node drag is disabled (`nodesDraggable={false}`) since UI-04 is deferred.

**Primary recommendation:** Build GraphCanvas as a thin adapter that converts sessionStore's canvas data into @xyflow/react format, registers custom node/edge renderers for Blueprint-colored + ghost styling, and delegates all interaction to the existing store and API patterns.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ghost node DB persistence | API / Backend (ai.ts) | Database | ai.ts upserts ghost nodes after graph run; reverses Phase 8 D-14 |
| Ghost confirm/dismiss | API / Backend (new PATCH endpoint) | Database | Status update is a DB write; broadcast follows |
| Ghost expiry | Database (pg_cron) | — | Zero client coordination; server-side only |
| Canvas fetch on branch switch | Frontend Server (page.tsx triggers apiFetch in workspace) | API (GET /canvas) | apiFetch called client-side in workspace.tsx on branch change |
| Realtime reconnect canvas refresh | Browser / Client (use-session-channel.ts) | API (GET /canvas) | SUBSCRIBED handler fires in the Realtime subscription hook |
| Panel routing (graph vs chart) | Frontend Server (page.tsx) | Browser (panelStore) | canvas_view_mode resolved at SSR time; panelStore switches on widget_type |
| @xyflow/react rendering | Browser / Client | — | DOM-dependent; ssr:false mandatory |
| Ghost node visual state | Browser / Client (GraphNode component) | — | CSS opacity + dashed border applied per node.data.status |
| Optimistic ghost confirm/dismiss | Browser / Client (GraphCanvas) | — | Immediate local state mutation before API response |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @xyflow/react | 12.11.1 | Interactive node/edge canvas | Already installed (INFRA-01); DOM-dependent, loaded via ssr:false |
| @dagrejs/dagre | 3.0.0 | Auto-layout for null-position nodes | Official React Flow recommendation; lightweight; used in reactflow.dev dagre example |
| Zustand | 5.0.14 | sessionStore already owns canvasNodes/canvasEdges | Already in use — no new state library needed |
| Framer Motion | 12.40.0 | AnimatePresence for graph/chart panel transition | Already used for all widget transitions in AnalyticsPanel |
| sonner | latest | Error toast on confirm/dismiss failure | Already used in the project for notification pattern |

[VERIFIED: npm registry] — @xyflow/react 12.11.1 confirmed installed at `apps/web/package.json`
[VERIFIED: npm registry] — @dagrejs/dagre 3.0.0 confirmed on npm registry; slopcheck: [OK]

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | 0.511.0 | Check/X icons for ghost confirm/dismiss buttons | Ghost node action buttons |
| shadcn/ui Button | installed | Ghost node touch targets (44x44px minimum) | Confirm/dismiss affordance within GraphNode |
| shadcn/ui Skeleton | installed | Loading state during canvas fetch on branch switch | While `GET /api/sessions/:id/canvas` is in-flight |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @dagrejs/dagre | elkjs | ELK produces better layouts for complex graphs but adds ~300KB; dagre is sufficient for Phase 9 node counts |
| @dagrejs/dagre | d3-hierarchy | d3-hierarchy only works for trees (no cycles); debate graphs may have cycles |
| Custom PATCH endpoint | Supabase client direct update | Direct client updates bypass the broadcast step; the PATCH endpoint triggers broadcast for all participants |

**Installation:** `@dagrejs/dagre` is the only new package required. @xyflow/react is already installed.

```bash
pnpm add @dagrejs/dagre --filter @panelito/web
```

---

## Package Legitimacy Audit

| Package | Registry | Age | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|
| @xyflow/react | npm | ~4 yrs (xyflow org) | [OK] | Approved — already installed v12.11.1 |
| @dagrejs/dagre | npm | Active fork of graphlib/dagre | [OK] | Approved — official dagre org on npm |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Browser Client
  │
  ├── use-session-channel.ts
  │     ├── canvas_update broadcast → sessionStore.setCanvasData(nodes, edges)
  │     │     (ghost + committed nodes both arrive here — D-02)
  │     └── SUBSCRIBED status event → apiFetch GET /canvas?branch_id=
  │           → sessionStore.setCanvasData(committed only — D-03)
  │
  ├── workspace.tsx (branch switch handler)
  │     └── setActiveBranch(id) + apiFetch GET /canvas?branch_id=
  │           → sessionStore.setCanvasData(committed only — D-13)
  │
  ├── AnalyticsPanel (WidgetZone)
  │     └── widgetRegistry.get('graph') → <GraphCanvas />
  │           (rendered when panelStore.widgetType === 'graph')
  │
  └── GraphCanvas
        ├── reads sessionStore.canvasNodes / sessionStore.canvasEdges
        ├── filters out status='silent' nodes
        ├── converts to @xyflow/react Node[] / Edge[] with dagre layout fallback
        ├── renders <ReactFlow nodeTypes={nodeTypes} edgeTypes={edgeTypes} />
        │     ├── GraphNode (committed: solid; ghost: dashed + 0.6 opacity)
        │     └── GraphEdge (Blueprint-colored stroke)
        └── ghost node click → optimistic update → PATCH /api/canvas_nodes/:id
              → server broadcasts canvas_update
              → all participants' sessionStore updated

API (Hono)
  ├── GET /api/sessions/:id/canvas?branch_id=
  │     └── SELECT committed nodes/edges → return JSON
  │
  ├── PATCH /api/canvas_nodes/:id { status }
  │     ├── UPDATE canvas_nodes SET status = ? WHERE id = ?
  │     └── broadcast canvas_update { nodes: [updated_node], edges: [] }
  │
  └── ai.ts /invoke (modified from Phase 8)
        ├── ghost ops upserted to canvas_nodes with status='ghost' (D-01 reversal)
        └── canvas_update broadcast includes both committed AND ghost nodes (D-02)

Database
  ├── canvas_nodes (status IN committed/ghost/silent)
  ├── pg_cron: ghost expiry job (new migration 0011)
  └── pg_cron: existing jobs unchanged
```

### Recommended Project Structure

```
apps/web/components/workspace/widgets/
├── GraphCanvas.tsx        # @xyflow/react wrapper; loaded via next/dynamic ssr:false
├── GraphNode.tsx          # Custom node renderer; committed/ghost visual states
├── GraphEdge.tsx          # Custom edge renderer; Blueprint-colored strokes
└── widget-registry.ts     # Add 'graph' → GraphCanvas entry (existing file)

apps/api/src/routes/
└── sessions.ts            # Add GET /:id/canvas + PATCH /canvas_nodes/:id routes

supabase/migrations/
└── 0011_ghost_expiry.sql  # pg_cron ghost node expiry job + ghost persistence schema update
```

### Pattern 1: @xyflow/react with Controlled External Store

The GraphCanvas reads from sessionStore (Zustand) and converts to @xyflow/react format. This is the controlled flow pattern where external state drives the canvas.

```tsx
// Source: reactflow.dev/learn/advanced-use/state-management
// Verified: @xyflow/react v12 installed types at node_modules/.pnpm/@xyflow+react@12.11.1

import { ReactFlow, applyNodeChanges, applyEdgeChanges, Controls, Background } from '@xyflow/react'
import type { Node, Edge, NodeChange, EdgeChange } from '@xyflow/react'
import { useSessionStore } from '@/store/session-store'
import { useCallback, useMemo, useState, useEffect } from 'react'
import { nodeTypes } from './GraphNode'
import { edgeTypes } from './GraphEdge'
import { applyDagreLayout } from './graphLayout'

export function GraphCanvas() {
  const canvasNodes = useSessionStore(s => s.canvasNodes)
  const canvasEdges = useSessionStore(s => s.canvasEdges)

  // Convert CanvasNode[] → @xyflow/react Node[]; filter silent
  const rfNodes: Node[] = useMemo(() => {
    const visible = canvasNodes.filter(n => n.status !== 'silent')
    return visible.map(n => ({
      id: n.id,
      type: 'graphNode',  // → GraphNode component
      position: { x: n.position_x ?? 0, y: n.position_y ?? 0 },
      data: { canvasNode: n },
    }))
  }, [canvasNodes])

  const rfEdges: Edge[] = useMemo(() => (
    canvasEdges
      .filter(e => e.status !== 'silent')
      .map(e => ({
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        type: 'graphEdge',
        data: { canvasEdge: e },
      }))
  ), [canvasEdges])

  // Apply dagre if any node lacks a position
  const needsLayout = rfNodes.some(n => n.data.canvasNode.position_x === null)
  const layoutedNodes = needsLayout ? applyDagreLayout(rfNodes, rfEdges) : rfNodes

  const [nodes, setNodes] = useState<Node[]>(layoutedNodes)
  const [edges, setEdges] = useState<Edge[]>(rfEdges)

  // Sync from store changes
  useEffect(() => { setNodes(layoutedNodes) }, [rfNodes])
  useEffect(() => { setEdges(rfEdges) }, [rfEdges])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes(ns => applyNodeChanges(changes, ns)),
    []
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      nodesDraggable={false}   // UI-04 deferred
      nodesConnectable={false}
      colorMode="dark"
      fitView
    >
      <Background />
      <Controls />
    </ReactFlow>
  )
}
```

### Pattern 2: Dagre Layout Fallback for Null Positions

Nodes added by the AI have `position_x = null`. The dagre layout runs when any node lacks coordinates.

```typescript
// Source: reactflow.dev/examples/layout/dagre (Official React Flow docs)
import dagre from '@dagrejs/dagre'
import type { Node, Edge } from '@xyflow/react'

const NODE_WIDTH = 180
const NODE_HEIGHT = 60

export function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', ranksep: 60, nodesep: 40 })

  nodes.forEach(n => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  edges.forEach(e => g.setEdge(e.source, e.target))

  dagre.layout(g)

  return nodes.map(n => {
    const pos = g.node(n.id)
    return { ...n, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } }
  })
}
```

### Pattern 3: Custom Node with Ghost State and Confirm/Dismiss

```tsx
// Source: reactflow.dev/learn/customization/custom-nodes (Official docs)
// Ghost visual contract from 09-UI-SPEC.md
import { Handle, Position } from '@xyflow/react'
import type { NodeProps, Node } from '@xyflow/react'
import type { CanvasNode } from '@panelito/types'
import { Button } from '@/components/ui/button'
import { Check, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useSessionStore } from '@/store/session-store'
import { useState } from 'react'

type GraphNodeData = { canvasNode: CanvasNode; blueprintColor: string }

export function GraphNode({ data }: NodeProps<Node<GraphNodeData>>) {
  const { canvasNode, blueprintColor } = data
  const isGhost = canvasNode.status === 'ghost'
  const [optimisticStatus, setOptimisticStatus] = useState(canvasNode.status)

  const handleConfirm = async () => {
    setOptimisticStatus('committed')  // optimistic
    try {
      await apiFetch(`/api/canvas_nodes/${canvasNode.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'committed' }),
      })
    } catch {
      setOptimisticStatus('ghost')  // revert
      // show sonner toast per UI-SPEC error copy
    }
  }

  const handleDismiss = async () => {
    setOptimisticStatus('silent')  // optimistic hide
    try {
      await apiFetch(`/api/canvas_nodes/${canvasNode.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'silent' }),
      })
    } catch {
      setOptimisticStatus('ghost')  // revert
    }
  }

  if (optimisticStatus === 'silent') return null

  const ghostStyle = isGhost ? {
    opacity: 0.6,
    border: `1.5px dashed ${blueprintColor}`,
    background: `${blueprintColor}1A`,  // 10% opacity fill
  } : {
    border: `1.5px solid ${blueprintColor}`,
    background: `${blueprintColor}26`,  // 15% opacity fill
  }

  return (
    <div
      className="rounded-md p-2 min-w-[120px] relative"
      style={ghostStyle}
    >
      <Handle type="target" position={Position.Top} />
      <span className="text-[12px]" style={{ color: isGhost ? '#a1a1aa' : '#fafafa' }}>
        {canvasNode.label}
      </span>

      {isGhost && (
        <div className="flex gap-1 mt-1">
          <Button
            size="sm"
            className="min-h-[44px] min-w-[44px]"
            onClick={handleConfirm}
            aria-label={`Confirmar nodo ${canvasNode.label}`}
          >
            <Check size={16} />
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="min-h-[44px] min-w-[44px]"
            onClick={handleDismiss}
            aria-label={`Descartar nodo ${canvasNode.label}`}
          >
            <X size={16} />
          </Button>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

// Register nodeTypes OUTSIDE component to prevent re-renders
export const nodeTypes = { graphNode: GraphNode }
```

### Pattern 4: next/dynamic SSR Gate

```typescript
// Source: CONTEXT.md code_context — established pattern in project
// @xyflow/react requires DOM APIs; must not render server-side
import dynamic from 'next/dynamic'

const GraphCanvas = dynamic(
  () => import('@/components/workspace/widgets/GraphCanvas').then(m => ({ default: m.GraphCanvas })),
  {
    ssr: false,
    loading: () => <div className="h-full bg-card animate-pulse rounded" />,
  }
)

// In widget-registry.ts:
import dynamic from 'next/dynamic'
const GraphCanvasDynamic = dynamic(...) as WidgetComponent
widgetRegistry.set('graph', GraphCanvasDynamic)
```

### Pattern 5: Supabase SUBSCRIBED Reconnect Canvas Fetch

```typescript
// Source: @supabase/realtime-js types — REALTIME_SUBSCRIBE_STATES.SUBSCRIBED verified
// CONTEXT.md D-14: reconnect triggers canvas refresh

.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    // Reconnect: overwrite store with committed-only canvas state
    apiFetch<{ nodes: CanvasNode[], edges: CanvasEdge[] }>(
      `/api/sessions/${sessionId}/canvas?branch_id=${useSessionStore.getState().activeBranchId}`
    )
      .then(({ nodes, edges }) => {
        useSessionStore.getState().setCanvasData(nodes, edges)
      })
      .catch(() => {}) // fail-silent per CONTEXT.md
  }
})
```

### Pattern 6: Ghost Node Upsert in ai.ts (Backend Reversal)

This is the most critical code change. The existing Phase 8 code in `ai.ts` filters to `committedOps` only. Phase 9 extends this to also upsert ghost ops:

```typescript
// Existing: committedOps (status='committed', confidence > 0.85)
const committedOps = finalState.canvasOps.filter(op => op.status === 'committed')

// Phase 9 addition: ghostOps (status='ghost', 0.5-0.85 confidence)
const ghostOps = finalState.canvasOps.filter(op => op.status === 'ghost')

// Upsert ghost nodes (same pattern as committed, different status column value)
// Then broadcast canvas_update with BOTH committed and ghost rows
supabase
  .channel(`session:${sessionId}`)
  .httpSend('canvas_update', {
    nodes: [...committedNodeRows, ...ghostNodeRows],
    edges: [...committedEdgeRows, ...ghostEdgeRows],
  })
```

### Pattern 7: Panel Widget 'graph' Type Extension

```typescript
// packages/types/src/panel.ts — add 'graph' discriminant
// No node/edge payload — GraphCanvas reads from sessionStore directly (D-06)
z.object({
  widget_type: z.literal('graph'),
  // No additional fields — canvas data comes from sessionStore, not widgetData
})

// ai.ts — after ghost+committed upserts, emit panel_update to trigger panel switch
supabase
  .channel(`session:${sessionId}`)
  .httpSend('panel_update', { widget_type: 'graph' })
  .catch(...)

// Also add 'graph' to renderPanelTool.parameters.widget_type enum (ai.ts types)
// This tells the AI it can emit 'graph' as a widget_type selection
```

### Anti-Patterns to Avoid

- **Embedding nodes/edges in widgetData**: The `'graph'` widget type carries NO data payload — GraphCanvas reads from sessionStore. If you put node/edge data in widgetData, you'll create a dual-source-of-truth bug and break real-time updates.
- **Defining nodeTypes inside the component**: `nodeTypes` must be defined outside the `GraphCanvas` component (or memoized). Defining inside causes React Flow to unmount/remount all nodes on every parent render.
- **Using `display:none` to hide ghost nodes**: Use `opacity: 0.6` on the wrapper. `display:none` interferes with @xyflow/react's node measurement. Filtering `status='silent'` nodes out of the nodes array entirely is the correct approach for silent nodes.
- **SSR rendering @xyflow/react**: `@xyflow/react` calls `window`, `document`, and `ResizeObserver`. Any render without `ssr: false` will crash Next.js SSR. The dynamic import gate is mandatory.
- **Forgetting to include ghost ops in `canvas_update` broadcast**: After D-01 reversal, the broadcast must include BOTH committed and ghost rows. Omitting ghost rows means participants won't see ghost nodes in real time.
- **Blocking the SSE stream with ghost upserts**: Ghost upserts happen after `'done'` SSE event, same as committed upserts (Phase 8 D-18 pattern). They must not delay the SSE stream.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Node layout with null positions | Custom force-directed layout | `@dagrejs/dagre` | Handles cycles, directed graphs, configurable spacing; well-tested for knowledge graphs |
| SVG edge routing | Custom bezier/path calculation | @xyflow/react built-in edge types (`smoothstep`, `bezier`) | Handles all geometric cases including self-loops, overlapping edges |
| Node dragging with position persistence | Custom drag handlers + DB writes | disabled (`nodesDraggable={false}`) until UI-04 (v2.1) | Zero complexity: just don't enable it |
| Real-time canvas state | Custom WebSocket or polling | Already wired: `use-session-channel.ts` `canvas_update` handler + `sessionStore` | Supabase Realtime handles reconnection, ordering, deduplication |
| Ghost node expiry countdown | Client-side timer per node | pg_cron server-side DELETE | Client timers drift, don't survive reconnects; pg_cron runs once/minute and is exact |
| Accessibility touch targets | Custom CSS padding math | shadcn/ui `Button` with `min-h-[44px] min-w-[44px]` | shadcn Button already has accessible focus rings; size constraint is a CSS class |

---

## Runtime State Inventory

> This is a modification phase (backend architectural reversal for ghost node persistence).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `canvas_nodes` table — currently only `status='committed'` rows exist (Phase 8 D-14). No ghost rows. | No migration needed — existing schema supports `status='ghost'` (CHECK constraint already includes it). Phase 9 simply starts writing ghost rows. |
| Live service config | None — no external service config references ghost node behavior | None |
| OS-registered state | None — no OS-level registrations | None |
| Secrets/env vars | None — no new env vars required for Phase 9 | None |
| Build artifacts | None — @xyflow/react is already installed at v12.11.1 | None — no reinstall needed |

**No migration required for ghost column** — `canvas_nodes.status CHECK (status IN ('committed', 'ghost', 'silent'))` already covers all three values from migration 0008. Only a new migration for the pg_cron ghost expiry job is needed.

---

## Common Pitfalls

### Pitfall 1: nodeTypes Defined Inside Component (React Flow Re-mount Storm)

**What goes wrong:** All canvas nodes unmount and remount on every parent re-render, causing a jarring flash.
**Why it happens:** React treats `nodeTypes` as a new object reference each render, triggering full remount of all node components.
**How to avoid:** Define `nodeTypes` and `edgeTypes` as module-level constants or use `useMemo` with an empty dep array.
**Warning signs:** Nodes flash/disappear briefly when any unrelated state updates.

### Pitfall 2: @xyflow/react CSS Not Imported

**What goes wrong:** Canvas renders with no styling — nodes are invisible or the viewport doesn't clip correctly.
**Why it happens:** @xyflow/react requires its own CSS file to be imported.
**How to avoid:** Add `import '@xyflow/react/dist/style.css'` in `GraphCanvas.tsx` (inside the dynamic-loaded component, not in the SSR boundary).
**Warning signs:** Canvas renders as an empty white/black area.

### Pitfall 3: `canvas_update` setCanvasData Overwrites All Nodes

**What goes wrong:** Each `canvas_update` broadcast replaces the entire `canvasNodes` array, wiping nodes from previous invocations.
**Why it happens:** `setCanvasData(nodes, edges)` is a full replacement (not merge). Each broadcast only carries nodes from the CURRENT invocation, not the entire session canvas.
**How to avoid:** `setCanvasData` must MERGE incoming nodes/edges with the existing store, keyed by `id`. New nodes are added; existing nodes are updated by `id` (upsert semantics). The branch-switch canvas fetch (D-13) IS a full replacement — that's correct. But live `canvas_update` broadcasts should merge.

> **Critical clarification:** The current `use-session-channel.ts` calls `setCanvasData(nodes, edges)` which is defined as a full replacement. For live canvas_update broadcasts, this must be changed to upsert/merge semantics. Only the branch-switch and reconnect fetches should be full replacements.

**How to avoid:** Add a `mergeCanvasData(nodes, edges)` action to sessionStore that upserts by ID, and use it in the `canvas_update` handler. Use the existing `setCanvasData` only for branch switch and reconnect.
**Warning signs:** Earlier nodes disappear after the AI emits new nodes in a subsequent turn.

### Pitfall 4: Ghost Node Disappears on Reconnect (Correct Behavior, Unexpected UX)

**What goes wrong:** A participant sees ghost nodes, disconnects briefly, reconnects, and the ghosts are gone.
**Why it happens:** This is CORRECT per D-03 and D-14 — reconnect fetches committed-only. Ghost nodes are ephemeral per invocation.
**How to avoid:** Don't add ghost nodes to the reconnect fetch. Document the behavior in comments.
**Warning signs:** Confusion if ghost-only users reconnect. The pg_cron 60s expiry means ghosts are short-lived anyway.

### Pitfall 5: ai.ts Ghost Upsert Creates Schema Mismatch

**What goes wrong:** Ghost upserts fail because `ADD_NODE` ops with `status='ghost'` have the same `label` as committed nodes, creating FK conflicts or duplicate keys.
**Why it happens:** The AI may emit the same node label in multiple invocations. Node IDs are server-generated UUIDs — each upsert creates a new UUID, potentially creating duplicate label nodes.
**How to avoid:** Ghost nodes don't need deduplication — they're ephemeral. Multiple ghost nodes with the same label from different invocations will coexist until expiry or confirmation. This is acceptable UX.
**Warning signs:** `canvas_nodes` accumulates multiple rows with the same `label` and `status='ghost'`.

### Pitfall 6: panel_update Missing 'graph' in PanelWidget Schema

**What goes wrong:** TypeScript compilation error or runtime safeParse rejection when the AI emits `panel_update: { widget_type: 'graph' }`.
**Why it happens:** `PanelWidgetSchema` in `packages/types/src/panel.ts` does not include a `'graph'` variant. `panelStore.setWidget()` accepts `PanelWidget` — schema must include `'graph'`.
**How to avoid:** Add `z.object({ widget_type: z.literal('graph') })` to `PanelWidgetSchema` discriminated union. Also add `'graph'` to `renderPanelTool.parameters.widget_type enum` in `ai.ts`.
**Warning signs:** `PanelWidgetSchema.safeParse({ widget_type: 'graph' })` returns an error.

### Pitfall 7: Fullscreen Mode for Graph Widget

**What goes wrong:** Double-clicking the graph widget triggers the existing fullscreen overlay. The fullscreen overlay calls `widgetRegistry.get(fullscreenWidget.widget_type)` and renders `<FullscreenComp data={fullscreenWidget} />`. But `GraphCanvas` ignores `data` entirely (reads from store). This will likely work correctly but may show stale canvas state in fullscreen if the branch changes.
**Why it happens:** `AnalyticsPanel.tsx` line 289 calls `widgetRegistry.get(fullscreenWidget.widget_type)` for fullscreen. Since `GraphCanvas` reads from sessionStore, it will automatically reflect current state.
**How to avoid:** Test that fullscreen overlay renders GraphCanvas correctly. The `isFullscreen` prop can be used to adjust canvas height in fullscreen mode. No special handling needed if the component reads from store.
**Warning signs:** Fullscreen canvas shows no nodes (empty).

---

## Code Examples

### GET /api/sessions/:id/canvas endpoint

```typescript
// Source: CONTEXT.md backend route patterns; sessions.ts existing pattern
sessionsRouter.get('/:id/canvas', requireAuth, async (c) => {
  const { id } = c.req.param()
  const branchId = c.req.query('branch_id')
  const supabase = createServiceClient()

  // D-03: Return committed nodes only — ghosts are discarded on reconnect
  const [{ data: nodes, error: nodesErr }, { data: edges, error: edgesErr }] = await Promise.all([
    supabase
      .from('canvas_nodes')
      .select('*')
      .eq('session_id', id)
      .eq('branch_id', branchId ?? '')
      .eq('status', 'committed'),
    supabase
      .from('canvas_edges')
      .select('*')
      .eq('session_id', id)
      .eq('branch_id', branchId ?? '')
      .eq('status', 'committed'),
  ])

  if (nodesErr || edgesErr) return c.json({ error: 'internal' }, 500)
  return c.json({ nodes: nodes ?? [], edges: edges ?? [] }, 200)
})
```

### PATCH /api/canvas_nodes/:id endpoint

```typescript
// Source: CONTEXT.md D-11, D-12; messages.ts httpSend pattern
sessionsRouter.patch('/canvas_nodes/:id', requireAuth, async (c) => {
  const { id } = c.req.param()
  const supabase = createServiceClient()

  const body = await c.req.json().catch(() => ({}))
  const StatusSchema = z.object({ status: z.enum(['committed', 'silent']) })
  const parsed = StatusSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'invalid_status' }, 400)

  const { data: node, error } = await supabase
    .from('canvas_nodes')
    .update({ status: parsed.data.status })
    .eq('id', id)
    .select()
    .single()

  if (error || !node) return c.json({ error: 'not_found' }, 404)

  // Broadcast canvas_update so all participants see the status change
  const sessionId = node.session_id
  supabase
    .channel(`session:${sessionId}`)
    .httpSend('canvas_update', { nodes: [node], edges: [] })
    .catch((err) => console.error('[canvas_nodes] broadcast failed', err))

  return c.json(node, 200)
})
```

### pg_cron Ghost Expiry Migration

```sql
-- supabase/migrations/0011_ghost_expiry.sql
-- D-04: 60-second ghost node expiry via pg_cron
-- Runs every minute; deletes ghosts older than 60 seconds

SELECT cron.schedule(
  'canvas-ghost-expiry',
  '* * * * *',  -- every minute
  $$
    DELETE FROM public.canvas_nodes
    WHERE status = 'ghost'
      AND created_at < now() - interval '60 seconds';
  $$
);
```

### sessionStore mergeCanvasData (new action needed)

```typescript
// CRITICAL: Use mergeCanvasData for live broadcasts; setCanvasData for branch-switch/reconnect
mergeCanvasData: (nodes: CanvasNode[], edges: CanvasEdge[]) => {
  set(state => {
    const nodeMap = new Map(state.canvasNodes.map(n => [n.id, n]))
    nodes.forEach(n => nodeMap.set(n.id, n))

    const edgeMap = new Map(state.canvasEdges.map(e => [e.id, e]))
    edges.forEach(e => edgeMap.set(e.id, e))

    return {
      canvasNodes: Array.from(nodeMap.values()),
      canvasEdges: Array.from(edgeMap.values()),
    }
  })
},
```

### @xyflow/react CSS Import

```typescript
// In GraphCanvas.tsx (inside the dynamically loaded component)
import '@xyflow/react/dist/style.css'
// Alternatively, the base CSS without built-in theming:
// import '@xyflow/react/dist/base.css'
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ghost nodes ephemeral in LangGraph (Phase 8 D-14) | Ghost nodes persisted to DB with status='ghost' (Phase 9 D-01) | Phase 9 design session | All participants see ghost nodes in real time |
| Only committed ops in canvas_update | Both committed + ghost ops in canvas_update | Phase 9 D-02 | ai.ts broadcast payload changes |
| setCanvasData = full replace | Need setCanvasData (branch switch) + mergeCanvasData (live) | Phase 9 (pitfall) | sessionStore needs new mergeCanvasData action |

**Deprecated/outdated from this project's perspective:**
- Phase 8 D-14 ("ghost nodes NOT in DB") is reversed. All code comments referencing D-14 in ai.ts should be updated.
- The comment in `session-store.ts` documenting `canvasNodes` as "CANVAS-02, D-14" is now stale; update to reference Phase 9 D-01.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Ghost upserts in ai.ts follow the same ADD_NODE before ADD_EDGE ordering as committed upserts (Phase 8 D-17) | Architecture Patterns / Pattern 6 | Ghost edges referencing ghost nodes from the same invocation would fail if ordering is different |
| A2 | The existing `canvas_update` handler in `use-session-channel.ts` uses `setCanvasData` (full replace); needs to become merge for correctness | Common Pitfalls / Pitfall 3 | If it's already a merge (it is not — code verified), Pitfall 3 is moot |
| A3 | @xyflow/react `colorMode="dark"` correctly inherits Tailwind CSS variables for background; no manual `--xy-*` variable overrides needed | Standard Stack / Code Examples | Canvas background may render in wrong color (light mode) |
| A4 | @dagrejs/dagre v3.0.0 is compatible with @xyflow/react 12.x integration pattern from reactflow.dev docs | Standard Stack | Layout may not apply correctly; would need to check dagre API differences |

---

## Open Questions

1. **Should PATCH /canvas_nodes/:id also update associated edges' status?**
   - What we know: D-12 says dismiss sets the node status='silent'. Edges referencing a silent node will still exist in the DB and arrive in broadcasts.
   - What's unclear: Should edges become silent when their source/target node is silenced? The @xyflow/react rendering filters by node IDs — edges with missing source/target are ignored by ReactFlow.
   - Recommendation: Let ReactFlow handle it gracefully — edges with missing nodes are dropped from rendering automatically. No cascade needed for v1.

2. **Can a ghost edge exist without a committed source/target?**
   - What we know: Phase 8 only upserted committed nodes (D-14). With D-01 reversal, ghost nodes are now in DB. The AI emits ADD_EDGE ops that may reference ghost nodes.
   - What's unclear: Can `canvas_edges.source_node_id` reference a ghost `canvas_node`? FK exists to `canvas_nodes.id` with no status constraint.
   - Recommendation: Yes, ghost edges can reference ghost nodes (FK is by ID, status-agnostic). The Ghost Node Upsert must handle ADD_EDGE after ADD_NODE for ghost ops too, using the same nodeIdMap pattern.

3. **Does `canvas_view_mode` prop need to be passed through to GraphCanvas?**
   - What we know: `canvas_view_mode` determines WHICH widget to show via panelStore. Once GraphCanvas is the active widget, it doesn't need `canvas_view_mode` itself.
   - What's unclear: Nothing — this is resolved. GraphCanvas does not need canvas_view_mode as a prop. The routing is entirely in the panel layer.
   - Recommendation: No prop needed. GraphCanvas is shown/hidden by the panel layer, not by self-inspection.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| @xyflow/react | UI-01 (GraphCanvas) | ✓ | 12.11.1 | — |
| @dagrejs/dagre | Null-position layout | ✗ (not installed) | 3.0.0 available | Require install via `pnpm add @dagrejs/dagre --filter @panelito/web` |
| Node.js | Backend routes | ✓ | v22.17.1 | — |
| pg_cron (Supabase) | D-04 ghost expiry | ✓ (already used in migration 0004_auto_freeze_pg_cron.sql) | Supabase-managed | — |
| Supabase service client | Backend routes | ✓ | via createServiceClient() | — |

**Missing dependencies with no fallback:**
- `@dagrejs/dagre` must be installed before GraphCanvas is implemented. Without it, nodes with null positions won't be renderable.

**Missing dependencies with fallback:**
- None.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (PATCH endpoint) | requireAuth middleware — existing pattern in sessions.ts |
| V3 Session Management | no | n/a |
| V4 Access Control | yes (any participant can confirm/dismiss, not just creator) | No creator gate needed per D-10; but must verify the node belongs to the request's session |
| V5 Input Validation | yes | Zod schema: `z.enum(['committed', 'silent'])` on PATCH body |
| V6 Cryptography | no | no new crypto operations |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PATCH /canvas_nodes/:id by a user outside the session | Elevation of Privilege | After UPDATE, verify `node.session_id` matches a session the caller participates in (or use RLS) |
| Ghost nodes with malformed status in broadcast | Tampering | `canvas_update` handler in use-session-channel.ts already guards with `Array.isArray()` per existing code; add status field filter |
| Dagre layout with pathological graphs (1000+ nodes) | DoS | Phase 9 node counts are bounded by LangGraph invocation budget; no practical risk in v1 |

**Session membership check for PATCH:** The PATCH endpoint uses `requireAuth` but does not currently verify the caller is a participant in the session. The RLS policy `canvas_nodes_update` requires `auth.uid() IS NOT NULL` and `session.status = 'active'` — it does NOT restrict to session participants. Since the service client bypasses RLS, the route should explicitly verify the node's `session_id` maps to a session where the caller is authenticated (creator or guest token holder). Cross-session manipulation is otherwise possible.

---

## Sources

### Primary (HIGH confidence)
- @xyflow/react v12.11.1 installed types — `node_modules/.pnpm/@xyflow+react@12.11.1.../dist/esm/index.d.ts`
- @supabase/realtime-js types — `REALTIME_SUBSCRIBE_STATES.SUBSCRIBED` confirmed
- Project codebase: `apps/web/hooks/use-session-channel.ts`, `apps/web/store/session-store.ts`, `apps/api/src/routes/ai.ts`, `apps/api/src/routes/sessions.ts`
- Project types: `packages/types/src/canvas.ts`, `packages/types/src/blueprint.ts`, `packages/types/src/panel.ts`
- Migration `supabase/migrations/0008_nsai_foundation.sql` — canvas_nodes/edges schema with status CHECK constraint
- Migration `supabase/migrations/0004_auto_freeze_pg_cron.sql` — pg_cron usage pattern

### Secondary (MEDIUM confidence)
- [reactflow.dev/examples/layout/dagre](https://reactflow.dev/examples/layout/dagre) — dagre integration pattern, getLayoutedElements function
- [reactflow.dev/learn/customization/custom-nodes](https://reactflow.dev/learn/customization/custom-nodes) — nodeTypes registration, NodeProps API
- [reactflow.dev/learn/advanced-use/state-management](https://reactflow.dev/learn/advanced-use/state-management) — Zustand + ReactFlow controlled pattern

### Tertiary (LOW confidence)
- None — all claims verified against codebase or official docs.

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — @xyflow/react is installed and typed; dagre confirmed on npm with slopcheck [OK]
- Architecture: HIGH — based directly on existing codebase patterns and CONTEXT.md locked decisions
- Pitfalls: HIGH — Pitfalls 1-4 confirmed against actual installed types and codebase code; Pitfalls 5-7 from design analysis

**Research date:** 2026-07-04
**Valid until:** 2026-08-04 (stable stack; @xyflow/react 12.x is stable)
