# Phase 9: Graph Canvas Frontend - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 11 new/modified files
**Analogs found:** 10 / 11

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/web/components/workspace/widgets/GraphCanvas.tsx` | component | event-driven (store-driven render) | `apps/web/components/workspace/widgets/RadarWidget.tsx` | role-match |
| `apps/web/components/workspace/widgets/GraphNode.tsx` | component | request-response (PATCH) | `apps/web/components/workspace/widgets/RadarWidget.tsx` | partial-match |
| `apps/web/components/workspace/widgets/GraphEdge.tsx` | component | transform | `apps/web/components/workspace/widgets/RadarWidget.tsx` | partial-match |
| `apps/web/components/workspace/widgets/widget-registry.ts` | config | — | self (extend) | exact |
| `apps/web/hooks/use-session-channel.ts` | hook | event-driven (Realtime) | self (extend) | exact |
| `apps/web/store/session-store.ts` | store | CRUD | self (extend) | exact |
| `apps/web/app/(protected)/sessions/[id]/page.tsx` | component (server) | request-response | self (extend) | exact |
| `apps/web/app/(protected)/sessions/[id]/workspace.tsx` | component (client) | request-response | self (extend) | exact |
| `apps/api/src/routes/sessions.ts` | route | CRUD + broadcast | self (extend) | exact |
| `apps/api/src/routes/ai.ts` | route | streaming + batch | self (extend) | exact |
| `supabase/migrations/0011_ghost_expiry.sql` | migration | batch | `supabase/migrations/0004_auto_freeze_pg_cron.sql` | role-match |
| `packages/types/src/panel.ts` | type | — | self (extend) | exact |

---

## Pattern Assignments

### `apps/web/components/workspace/widgets/GraphCanvas.tsx` (component, event-driven)

**Analog:** `apps/web/components/workspace/widgets/RadarWidget.tsx`

**Why:** RadarWidget is the closest existing widget component — it is a client component registered in widgetRegistry, reads from a narrowed `PanelWidget` data prop, and manages mounted state for DOM-dependent rendering. GraphCanvas follows the same registration shape but reads from sessionStore instead of `data`.

**Imports pattern** (RadarWidget lines 1-26):
```typescript
'use client'

import { useState, useEffect } from 'react'
import type { PanelWidget } from '@panelito/types'
// GraphCanvas adds:
import { ReactFlow, Controls, Background, applyNodeChanges } from '@xyflow/react'
import type { Node, Edge, NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'   // CRITICAL: must import CSS inside dynamic-loaded module
import { useSessionStore } from '@/store/session-store'
import { useMemo, useState, useEffect, useCallback } from 'react'
import { nodeTypes } from './GraphNode'       // MUST be module-level constant (Pitfall 1)
import { edgeTypes } from './GraphEdge'       // MUST be module-level constant (Pitfall 1)
import { applyDagreLayout } from './graphLayout'
```

**Mounting guard pattern** (RadarWidget lines 46-52):
```typescript
// RadarWidget uses a timeout-based mount guard for Recharts SSR safety:
const [mounted, setMounted] = useState(false)
useEffect(() => {
  const timer = setTimeout(() => { setMounted(true) }, 300)
  return () => clearTimeout(timer)
}, [])
if (!mounted) return <div className="w-full h-full min-h-0" />
```
GraphCanvas uses `next/dynamic ssr:false` instead (no mount guard needed inside the component; the SSR boundary is at the registry import level — see widget-registry.ts pattern below).

**Core store-driven render pattern** (RESEARCH.md Pattern 1):
```typescript
export function GraphCanvas() {
  const canvasNodes = useSessionStore(s => s.canvasNodes)
  const canvasEdges = useSessionStore(s => s.canvasEdges)

  const rfNodes: Node[] = useMemo(() => {
    const visible = canvasNodes.filter(n => n.status !== 'silent')
    return visible.map(n => ({
      id: n.id, type: 'graphNode',
      position: { x: n.position_x ?? 0, y: n.position_y ?? 0 },
      data: { canvasNode: n },
    }))
  }, [canvasNodes])

  const rfEdges: Edge[] = useMemo(() => (
    canvasEdges.filter(e => e.status !== 'silent').map(e => ({
      id: e.id, source: e.source_node_id, target: e.target_node_id,
      type: 'graphEdge', data: { canvasEdge: e },
    }))
  ), [canvasEdges])

  const needsLayout = rfNodes.some(n => n.data.canvasNode.position_x === null)
  const layoutedNodes = needsLayout ? applyDagreLayout(rfNodes, rfEdges) : rfNodes

  const [nodes, setNodes] = useState<Node[]>(layoutedNodes)
  const [edges, setEdges] = useState<Edge[]>(rfEdges)

  useEffect(() => { setNodes(layoutedNodes) }, [rfNodes])
  useEffect(() => { setEdges(rfEdges) }, [rfEdges])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes(ns => applyNodeChanges(changes, ns)),
    []
  )

  return (
    <div className="w-full h-full min-h-0">
      <ReactFlow
        nodes={nodes} edges={edges}
        nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        nodesDraggable={false}    // UI-04 deferred
        nodesConnectable={false}
        colorMode="dark"
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}
```

**Container sizing pattern** (RadarWidget lines 60-62):
```typescript
// Match RadarWidget's container pattern — fills full height, no overflow:
<div className="w-full h-full min-h-0">
  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
```

---

### `apps/web/components/workspace/widgets/GraphNode.tsx` (component, request-response)

**Analog:** `apps/web/components/workspace/widgets/RadarWidget.tsx` (for component shape), `apps/web/hooks/use-ai-stream.ts` (for apiFetch optimistic pattern)

**Why:** No exact analog for a custom @xyflow/react node renderer with optimistic PATCH. RadarWidget provides the widget component shape; the PATCH+optimistic pattern maps to how `workspace.tsx` calls `apiFetch` with fire-and-forget semantics.

**Imports pattern:**
```typescript
'use client'

import { Handle, Position } from '@xyflow/react'
import type { NodeProps, Node } from '@xyflow/react'
import type { CanvasNode } from '@panelito/types'
import { Button } from '@/components/ui/button'
import { Check, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { useState } from 'react'
```

**Sonner toast pattern** (from `apps/web/hooks/use-session-channel.ts` line 14, 93):
```typescript
import { toast } from 'sonner'
// ...
toast.success('La sesion ha avanzado a la siguiente fase.')
// For errors in GraphNode:
toast.error('No se pudo confirmar el nodo. Intenta de nuevo.')
```

**apiFetch PATCH pattern** (`apps/web/app/(protected)/sessions/[id]/workspace.tsx` lines 166-174):
```typescript
apiFetch<Session>(`/api/sessions/${session.id}/unfreeze`, { method: 'POST' })
  .then((updatedSession) => { ... })
  .catch((err) => console.error('[Workspace] Auto-unfreeze failed:', err))
// For GraphNode:
apiFetch(`/api/canvas_nodes/${canvasNode.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ status: 'committed' }),
}).catch(() => {
  setOptimisticStatus('ghost')   // revert on failure
  toast.error('No se pudo confirmar el nodo. Intenta de nuevo.')
})
```

**Ghost visual state + confirm/dismiss pattern** (RESEARCH.md Pattern 3 — full excerpt):
```typescript
type GraphNodeData = { canvasNode: CanvasNode; blueprintColor: string }

export function GraphNode({ data }: NodeProps<Node<GraphNodeData>>) {
  const { canvasNode, blueprintColor } = data
  const isGhost = canvasNode.status === 'ghost'
  const [optimisticStatus, setOptimisticStatus] = useState(canvasNode.status)

  if (optimisticStatus === 'silent') return null

  const ghostStyle = isGhost ? {
    opacity: 0.6, border: `1.5px dashed ${blueprintColor}`,
    background: `${blueprintColor}1A`,
  } : {
    border: `1.5px solid ${blueprintColor}`,
    background: `${blueprintColor}26`,
  }

  return (
    <div className="rounded-md p-2 min-w-[120px] relative" style={ghostStyle}>
      <Handle type="target" position={Position.Top} />
      <span className="text-[12px]" style={{ color: isGhost ? '#a1a1aa' : '#fafafa' }}>
        {canvasNode.label}
      </span>
      {isGhost && (
        <div className="flex gap-1 mt-1">
          <Button size="sm" className="min-h-[44px] min-w-[44px]" onClick={handleConfirm}
            aria-label={`Confirmar nodo ${canvasNode.label}`}>
            <Check size={16} />
          </Button>
          <Button size="sm" variant="destructive" className="min-h-[44px] min-w-[44px]"
            onClick={handleDismiss} aria-label={`Descartar nodo ${canvasNode.label}`}>
            <X size={16} />
          </Button>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

// CRITICAL: nodeTypes OUTSIDE component to prevent React Flow re-mount storm (Pitfall 1)
export const nodeTypes = { graphNode: GraphNode }
```

---

### `apps/web/components/workspace/widgets/GraphEdge.tsx` (component, transform)

**Analog:** `apps/web/components/workspace/widgets/RadarWidget.tsx` (component shape)

**Why:** No existing custom edge renderer in the codebase. GraphEdge is the simplest new file — a thin @xyflow/react custom edge that applies Blueprint edge color to a smoothstep path.

**Pattern** (@xyflow/react custom edge, module-level edgeTypes export):
```typescript
'use client'

import { BaseEdge, getSmoothStepPath } from '@xyflow/react'
import type { EdgeProps, Edge } from '@xyflow/react'
import type { CanvasEdge } from '@panelito/types'

type GraphEdgeData = { canvasEdge: CanvasEdge; blueprintColor?: string }

export function GraphEdge({
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data,
}: EdgeProps<Edge<GraphEdgeData>>) {
  const [edgePath] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <BaseEdge
      path={edgePath}
      style={{ stroke: data?.blueprintColor ?? '#6366f1', strokeWidth: 1.5 }}
    />
  )
}

// CRITICAL: edgeTypes OUTSIDE component (same rule as nodeTypes — Pitfall 1)
export const edgeTypes = { graphEdge: GraphEdge }
```

---

### `apps/web/components/workspace/widgets/widget-registry.ts` (config, extend)

**Analog:** Self — `apps/web/components/workspace/widgets/widget-registry.ts`

**Existing registration pattern** (lines 1-50, full file):
```typescript
'use client'

import type { ComponentType } from 'react'
import type { PanelWidget } from '@panelito/types'
import { BentoGrid } from './BentoGrid'
// ... other widget imports

export type WidgetComponent = ComponentType<{ data: PanelWidget; isFullscreen?: boolean }>

export const widgetRegistry = new Map<PanelWidget['widget_type'], WidgetComponent>([
  ['bento', BentoGrid as WidgetComponent],
  ['radar', RadarWidget as WidgetComponent],
  // ...
])
```

**GraphCanvas addition (add after existing imports):**
```typescript
import dynamic from 'next/dynamic'

// GraphCanvas is DOM-dependent (@xyflow/react); must be loaded ssr:false
const GraphCanvasDynamic = dynamic(
  () => import('./GraphCanvas').then(m => ({ default: m.GraphCanvas })),
  {
    ssr: false,
    loading: () => <div className="w-full h-full bg-card animate-pulse rounded" />,
  }
) as WidgetComponent

// Add to Map constructor:
['graph', GraphCanvasDynamic],
```

**Key note:** The `WidgetComponent` type is `ComponentType<{ data: PanelWidget; isFullscreen?: boolean }>`. GraphCanvas ignores `data` entirely (reads from sessionStore per D-06), but must satisfy this signature for the registry. Cast with `as WidgetComponent`.

---

### `apps/web/hooks/use-session-channel.ts` (hook, event-driven — extend)

**Analog:** Self — `apps/web/hooks/use-session-channel.ts`

**Existing canvas_update handler** (lines 80-87):
```typescript
.on('broadcast', { event: 'canvas_update' }, ({ payload }) => {
  // D-16, CANVAS-02: Canvas is session-wide — no branch filter
  // WR-01: guard against missing fields in broadcast payload (schema drift / partial failure)
  const nodes = Array.isArray(payload?.nodes) ? payload.nodes as CanvasNode[] : []
  const edges = Array.isArray(payload?.edges) ? payload.edges as CanvasEdge[] : []
  console.log('[canvas] update received', nodes.length, 'nodes', edges.length, 'edges')
  useSessionStore.getState().setCanvasData(nodes, edges)   // ← CHANGE to mergeCanvasData (Pitfall 3)
})
```

**Phase 9 change 1 — switch canvas_update to mergeCanvasData:**
```typescript
// Change line 86: setCanvasData → mergeCanvasData
useSessionStore.getState().mergeCanvasData(nodes, edges)
```

**Phase 9 change 2 — add SUBSCRIBED reconnect handler** (after `.subscribe()` — current line 94):
```typescript
// Current: .subscribe()
// Replace with:
.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    // D-14: reconnect — overwrite store with committed-only canvas (full replace, not merge)
    const { activeBranchId } = useSessionStore.getState()
    apiFetch<{ nodes: CanvasNode[], edges: CanvasEdge[] }>(
      `/api/sessions/${sessionId}/canvas?branch_id=${activeBranchId}`
    )
      .then(({ nodes, edges }) => {
        useSessionStore.getState().setCanvasData(nodes, edges)  // full replace on reconnect (D-03)
      })
      .catch(() => {})  // fail-silent per CONTEXT.md established pattern
  }
})
```

**Existing subscribe pattern** for reference (`use-session-channel.ts` line 33):
```typescript
const channel = supabase
  .channel(`session:${sessionId}`)
  .on('broadcast', { event: 'new_message' }, ...)
  // ...
  .subscribe()   // ← currently no callback; Phase 9 adds status callback here
```

---

### `apps/web/store/session-store.ts` (store, extend)

**Analog:** Self — `apps/web/store/session-store.ts`

**Existing setCanvasData pattern** (line 164):
```typescript
setCanvasData: (nodes, edges) => set({ canvasNodes: nodes, canvasEdges: edges }),
```

**New mergeCanvasData action to add** (RESEARCH.md sessionStore pattern):
```typescript
/** Merge incoming canvas nodes/edges into store by id — upsert semantics.
 *  Used for live canvas_update broadcasts (Pitfall 3 — don't full-replace on broadcast).
 *  Use setCanvasData for branch-switch and reconnect (full replace).
 */
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

**Interface addition:**
```typescript
// Add to SessionStoreState interface alongside setCanvasData:
/** Merge canvas nodes/edges by id (upsert semantics). For live broadcasts. */
mergeCanvasData: (nodes: CanvasNode[], edges: CanvasEdge[]) => void
```

---

### `apps/web/app/(protected)/sessions/[id]/page.tsx` (server component, extend)

**Analog:** Self — `apps/web/app/(protected)/sessions/[id]/page.tsx`

**Existing server prop pattern** (lines 26-84):
```typescript
// Pattern: server component fetches extra data; passes as prop to Workspace
const creatorSettings = await getCreatorSettings()
// ...
const hasApiKey = user?.is_anonymous ? true : creatorSettings.has_api_key
// passed to <Workspace hasApiKey={hasApiKey} ... />
```

**Phase 9 addition — load Blueprint to extract canvas_view_mode (D-08):**
```typescript
// After existing session fetch (around line 46):
import { loadBlueprint } from '@/lib/blueprint-loader'  // or equivalent server-side util
import type { Blueprint } from '@panelito/types'

let canvasViewMode: Blueprint['canvas_view_mode'] = 'chart'  // safe default
if (session.blueprint_id) {
  try {
    const blueprint = await apiFetch<Blueprint>(
      `/api/blueprints/${session.blueprint_id}`,
      {},
      accessToken
    )
    canvasViewMode = blueprint.canvas_view_mode
  } catch {
    // fail-silent — default to 'chart' (no graph canvas shown)
  }
}

// Add to Workspace props:
<Workspace
  session={session}
  hasApiKey={hasApiKey}
  canvasViewMode={canvasViewMode}   // new prop (D-08)
  currentUserId={user?.id ?? ''}
  // ...
/>
```

**NOTE:** Check whether a Blueprint API endpoint exists or if the Blueprint must be loaded directly via `loadBlueprint()` from the api package. The existing `sessions.ts` imports `loadBlueprint` from `'../lib/blueprint-loader'`. A server action or direct import may be more appropriate than an HTTP call from the server component.

---

### `apps/web/app/(protected)/sessions/[id]/workspace.tsx` (client component, extend)

**Analog:** Self — `apps/web/app/(protected)/sessions/[id]/workspace.tsx`

**Existing branch switch pattern** (workspace.tsx lines 155-156 + 166-176):
```typescript
const activeBranchId = useSessionStore((s) => s.activeBranchId)
// ...
// Pattern: apiFetch call followed by store update — fire-and-forget with error logging
apiFetch<Session>(`/api/sessions/${session.id}/unfreeze`, { method: 'POST' })
  .then((updatedSession) => {
    if (updatedSession) {
      useSessionStore.getState().setSession(updatedSession)
    }
  })
  .catch((err) => console.error('[Workspace] Auto-unfreeze failed:', err))
```

**Phase 9 addition — canvas fetch on branch switch (D-13):**
```typescript
// Add canvasViewMode to WorkspaceProps:
interface WorkspaceProps {
  // ...existing props...
  canvasViewMode?: 'graph' | 'chart'
}

// Add fetchCanvas helper (alongside refreshMessages):
const fetchCanvas = (branchId: string) => {
  apiFetch<{ nodes: CanvasNode[], edges: CanvasEdge[] }>(
    `/api/sessions/${liveSession.id}/canvas?branch_id=${branchId}`
  )
    .then(({ nodes, edges }) => {
      useSessionStore.getState().setCanvasData(nodes, edges)
    })
    .catch(() => {})  // fail-silent per CONTEXT.md — leave existing canvas state unchanged
}

// In branch switch handler (wherever setBranchId is called):
useSessionStore.getState().setBranchId(newBranchId)
fetchCanvas(newBranchId)  // D-13: fetch committed-only snapshot for new branch
```

**canvasViewMode prop forward** (to AnalyticsPanel or via panelStore):
```typescript
// canvasViewMode is needed by AnalyticsPanel/WidgetZone to gate 'graph' widget rendering
// D-08: panel routing is via panelStore.widgetType — the Blueprint's canvas_view_mode
// only governs whether panel_update broadcasts with widget_type='graph' are accepted.
// Pass to AnalyticsPanel if needed for gating, or handle in panelStore.setWidget().
```

---

### `apps/api/src/routes/sessions.ts` (route, extend — new GET + PATCH endpoints)

**Analog:** Self — `apps/api/src/routes/sessions.ts` (existing PATCH + GET patterns)

**Existing GET pattern** (sessions.ts lines 214-233):
```typescript
sessionsRouter.get('/:id', requireAuth, async (c) => {
  const { id } = c.req.param()
  const supabase = createServiceClient()
  try {
    const { data, error } = await supabase
      .from('sessions').select('*').eq('id', id).single()
    if (error || !data) return c.json({ error: 'not_found' }, 404)
    return c.json(data, 200)
  } catch (err) {
    return c.json({ error: toClientError(err) }, 500)
  }
})
```

**New GET /canvas endpoint pattern** (RESEARCH.md GET /canvas example):
```typescript
// Add to sessions.ts — parallel to existing GET /:id
sessionsRouter.get('/:id/canvas', requireAuth, async (c) => {
  const { id } = c.req.param()
  const branchId = c.req.query('branch_id')
  const supabase = createServiceClient()

  // D-03: committed nodes only on reconnect/branch-switch
  const [{ data: nodes, error: nodesErr }, { data: edges, error: edgesErr }] = await Promise.all([
    supabase.from('canvas_nodes').select('*')
      .eq('session_id', id).eq('branch_id', branchId ?? '').eq('status', 'committed'),
    supabase.from('canvas_edges').select('*')
      .eq('session_id', id).eq('branch_id', branchId ?? '').eq('status', 'committed'),
  ])
  if (nodesErr || edgesErr) return c.json({ error: 'internal' }, 500)
  return c.json({ nodes: nodes ?? [], edges: edges ?? [] }, 200)
})
```

**Existing PATCH pattern** (sessions.ts lines 421-494, PATCH /:id/phase):
```typescript
// Reusable: same Zod body parse + service client + httpSend broadcast flow
sessionsRouter.patch('/:id/phase', requireAuth, async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')
  const supabase = createServiceClient()

  // Zod body validation
  const PatchPhaseBodySchema = z.object({ next_phase_id: z.string().min(1) })
  const rawBody = await c.req.json().catch(() => ({}))
  const parsed = PatchPhaseBodySchema.safeParse(rawBody)
  if (!parsed.success) return c.json({ error: 'invalid_request', ... }, 400)

  // DB update
  const { error: updateErr } = await supabase.from('sessions')
    .update({ current_phase: parsed.data.next_phase_id }).eq('id', id)
  if (updateErr) return c.json({ error: 'update_failed' }, 500)

  // Fire-and-forget broadcast (httpSend pattern)
  supabase.channel(`session:${id}`)
    .httpSend('phase_advanced', { new_phase_id: parsed.data.next_phase_id, ... })
    .catch((err) => console.error('[sessions] phase_advanced broadcast failed', err))

  return c.json({ current_phase: parsed.data.next_phase_id }, 200)
})
```

**New PATCH /canvas_nodes/:id endpoint** (RESEARCH.md PATCH example):
```typescript
// Add to sessions.ts (or a new canvasRouter — Claude's discretion)
sessionsRouter.patch('/canvas_nodes/:id', requireAuth, async (c) => {
  const { id } = c.req.param()
  const supabase = createServiceClient()

  const rawBody = await c.req.json().catch(() => ({}))
  const StatusSchema = z.object({ status: z.enum(['committed', 'silent']) })
  const parsed = StatusSchema.safeParse(rawBody)
  if (!parsed.success) return c.json({ error: 'invalid_status' }, 400)

  const { data: node, error } = await supabase
    .from('canvas_nodes').update({ status: parsed.data.status })
    .eq('id', id).select().single()
  if (error || !node) return c.json({ error: 'not_found' }, 404)

  // httpSend pattern (same as phase_advanced above)
  supabase.channel(`session:${node.session_id}`)
    .httpSend('canvas_update', { nodes: [node], edges: [] })
    .catch((err) => console.error('[canvas_nodes] broadcast failed', err))

  return c.json(node, 200)
})
```

---

### `apps/api/src/routes/ai.ts` (route, extend — ghost node persistence)

**Analog:** Self — `apps/api/src/routes/ai.ts`

**Existing committed-only filter** (ai.ts lines 479-481):
```typescript
const committedOps = ((finalState as any)?.canvasOps ?? []).filter(
  (op: import('@panelito/types').CanvasOp) => op.op !== 'NO_ACTION' && op.status === 'committed'
)
```

**Phase 9 change — add ghost ops upsert (D-01 reversal):**
```typescript
// After existing committedOps filter (line 481), add:
const ghostOps = ((finalState as any)?.canvasOps ?? []).filter(
  (op: import('@panelito/types').CanvasOp) => op.op !== 'NO_ACTION' && op.status === 'ghost'
)

// Process ghostOps with same ADD_NODE → ADD_EDGE ordering as committedOps (D-17)
const ghostNodeRows: CanvasNode[] = []
const ghostEdgeRows: CanvasEdge[] = []
if (ghostOps.length > 0) {
  const ghostNodeIdMap = new Map<string, string>()
  for (const op of ghostOps.filter((o: any) => o.op === 'ADD_NODE')) {
    const nodeId = crypto.randomUUID()
    const { data: nrow, error: nerr } = await supabase.from('canvas_nodes')
      .upsert({
        id: nodeId, session_id: sessionId, branch_id: activeBranchId,
        blueprint_id: session.blueprint_id, node_type_id: op.node_type_id,
        label: op.label, status: 'ghost',   // key difference from committed
        position_x: null, position_y: null,
      }, { onConflict: 'id' }).select().single()
    if (!nerr && nrow) { ghostNodeIdMap.set(op.label, nodeId); ghostNodeRows.push(nrow) }
  }
  // ADD_EDGE for ghost ops (same pattern as committed edges, lines 516-553)
}

// Step 3: broadcast canvas_update with BOTH committed AND ghost rows (D-02)
if (nodeRows.length > 0 || edgeRows.length > 0 || ghostNodeRows.length > 0 || ghostEdgeRows.length > 0) {
  supabase.channel(`session:${sessionId}`)
    .httpSend('canvas_update', {
      nodes: [...nodeRows, ...ghostNodeRows],
      edges: [...edgeRows, ...ghostEdgeRows],
    })
    .catch((err) => console.error('[ai] canvas_update broadcast failed', err))
}

// After committed canvas upserts, add panel_update broadcast for 'graph' widget (D-07):
supabase.channel(`session:${sessionId}`)
  .httpSend('panel_update', { widget_type: 'graph' })
  .catch((err) => console.error('[ai] panel_update graph broadcast failed', err))
```

---

### `supabase/migrations/0011_ghost_expiry.sql` (migration, batch)

**Analog:** `supabase/migrations/0004_auto_freeze_pg_cron.sql`

**pg_cron schedule pattern** (0004 lines 53-57):
```sql
SELECT cron.schedule(
  'auto-freeze-inactive-sessions-job',
  '* * * * *', -- every minute
  'SELECT auto_freeze_inactive_sessions()'
);
```

**Phase 9 migration pattern** (RESEARCH.md pg_cron example):
```sql
-- supabase/migrations/0011_ghost_expiry.sql
-- D-04: 60-second ghost node expiry via pg_cron

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

**Note:** No `CREATE EXTENSION IF NOT EXISTS pg_cron` needed — already enabled in migration 0004.

---

### `packages/types/src/panel.ts` (type, extend)

**Analog:** Self — `packages/types/src/panel.ts`

**Existing discriminated union pattern** (panel.ts lines 61-118):
```typescript
export const BasePanelWidgetSchema = z.discriminatedUnion('widget_type', [
  z.object({ widget_type: z.literal('bento'), title: z.string().optional(), cards: z.array(...) }),
  z.object({ widget_type: z.literal('radar'), title: z.string().optional(), axes: z.array(...) }),
  // ...
])

export const PanelWidgetSchema = z.discriminatedUnion('widget_type', [
  ...BasePanelWidgetSchema.options,
  z.object({ widget_type: z.literal('layout'), widgets: z.array(...) }),
])
```

**Phase 9 addition — add 'graph' to both schemas (D-06, Pitfall 6):**
```typescript
// Add to BasePanelWidgetSchema.options AND PanelWidgetSchema.options:
z.object({
  widget_type: z.literal('graph'),
  // D-06: GraphCanvas reads from sessionStore directly — no node/edge payload here
  // This is intentionally minimal to avoid dual-source-of-truth (RESEARCH.md anti-pattern)
})
```

**Both BasePanelWidgetSchema and PanelWidgetSchema must include 'graph'** since BasePanelWidget can appear inside `layout.widgets` and the discriminated union must be consistent. The `graph` widget type has zero data fields beyond `widget_type`.

---

## Shared Patterns

### Fire-and-Forget httpSend Broadcast
**Source:** `apps/api/src/routes/sessions.ts` lines 484-489 + `apps/api/src/routes/ai.ts` lines 557-561
**Apply to:** All new backend broadcast points (PATCH /canvas_nodes/:id, ai.ts ghost broadcast, ai.ts panel_update)
```typescript
supabase
  .channel(`session:${sessionId}`)
  .httpSend('event_name', { payload })
  .catch((err) => console.error('[module] broadcast failed', err))
// Never await — fire-and-forget. Errors logged, not thrown.
```

### Fail-Silent Pattern
**Source:** `apps/web/app/(protected)/sessions/[id]/workspace.tsx` line 186 + `apps/web/hooks/use-session-channel.ts` (implicit)
**Apply to:** Canvas fetch on branch switch, canvas fetch on reconnect, ghost upserts in ai.ts
```typescript
apiFetch<T>(...)
  .then((data) => { /* update store */ })
  .catch(() => {})  // fail-silent — leave existing state unchanged
```

### requireAuth + createServiceClient Route Boilerplate
**Source:** `apps/api/src/routes/sessions.ts` lines 46-55 + `apps/api/src/routes/messages.ts` lines 34-43
**Apply to:** All new API endpoints in sessions.ts (GET /canvas, PATCH /canvas_nodes/:id)
```typescript
import { Hono } from 'hono'
import { z } from 'zod'
import { createServiceClient } from '../lib/supabase'
import { requireAuth, type AuthVariables } from '../middleware/auth'

const router = new Hono<{ Variables: AuthVariables }>()
router.get('/path', requireAuth, async (c) => {
  const supabase = createServiceClient()
  // ...
})
```

### Zod Body Validation Pattern
**Source:** `apps/api/src/routes/sessions.ts` lines 427-432 (PATCH /phase)
**Apply to:** PATCH /canvas_nodes/:id body validation
```typescript
const BodySchema = z.object({ field: z.string() })
const rawBody = await c.req.json().catch(() => ({}))
const parsed = BodySchema.safeParse(rawBody)
if (!parsed.success) return c.json({ error: 'invalid_request', ... }, 400)
```

### Server Component Prop Pattern
**Source:** `apps/web/app/(protected)/sessions/[id]/page.tsx` lines 56-84
**Apply to:** `canvas_view_mode` resolution from Blueprint in page.tsx
```typescript
// Pattern: server-side derived values fetched from API, passed as typed props to Workspace
const hasApiKey = user?.is_anonymous ? true : creatorSettings.has_api_key
// ...
return <Workspace hasApiKey={hasApiKey} session={session} ... />
```

### Zustand Store Action Pattern
**Source:** `apps/web/store/session-store.ts` lines 149-165
**Apply to:** `mergeCanvasData` new action in session-store.ts
```typescript
// Pattern: set() with state callback for derived state updates
addBranch: (branch) =>
  set((state) => {
    if (state.branches.some((b) => b.id === branch.id)) return state
    return { branches: [...state.branches, branch] }
  }),
// mergeCanvasData follows same set(state => ...) pattern with Map-based upsert
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/web/components/workspace/widgets/graphLayout.ts` (utility) | utility | transform | No layout algorithm utility exists in the codebase; dagre integration is entirely new. Use RESEARCH.md Pattern 2 directly. |

**graphLayout.ts** should be a pure utility function with no imports from project files:
```typescript
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

---

## Critical Anti-Patterns (from RESEARCH.md — enforce in planning)

1. **nodeTypes/edgeTypes inside component** — causes React Flow remount storm. Must be module-level constants.
2. **@xyflow/react without CSS import** — `import '@xyflow/react/dist/style.css'` is mandatory inside GraphCanvas.tsx.
3. **setCanvasData for live broadcasts** — use `mergeCanvasData` for `canvas_update` handler; `setCanvasData` only for branch-switch/reconnect (full replace).
4. **Embedding nodes/edges in PanelWidget 'graph' payload** — `{ widget_type: 'graph' }` only; GraphCanvas reads from sessionStore (D-06).
5. **@xyflow/react without ssr:false** — crashes Next.js SSR. Must use `next/dynamic` with `ssr: false` in widget-registry.ts.

---

## Metadata

**Analog search scope:** `apps/web/components/workspace/`, `apps/web/hooks/`, `apps/web/store/`, `apps/web/lib/`, `apps/web/app/(protected)/`, `apps/api/src/routes/`, `packages/types/src/`, `supabase/migrations/`
**Files scanned:** 22 source files read in full
**Pattern extraction date:** 2026-07-04
