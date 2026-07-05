---
phase: 09-graph-canvas-frontend
plan: "03"
subsystem: frontend-canvas-renderer
tags: [canvas, xyflow, dagre, ghost-nodes, blueprint-colors, widget-registry, ssr-gate]
dependency_graph:
  requires: [09-01, 09-02]
  provides: [GraphCanvas, GraphNode, GraphEdge, graphLayout, graph-widget-type]
  affects: [widget-registry, session-store, workspace, page]
tech_stack:
  added: []
  patterns:
    - "@xyflow/react controlled store pattern (sessionStore → ReactFlow nodes/edges)"
    - "next/dynamic ssr:false gate for DOM-dependent canvas component"
    - "Module-level nodeTypes/edgeTypes to prevent remount storm (Pitfall 1)"
    - "Blueprint.node_types[].color / edge_types[].color resolution at runtime — no hardcoding"
    - "Optimistic PATCH with revert-on-error for ghost confirm/dismiss"
    - "Blueprint passed server-side via page.tsx → Workspace → sessionStore.setBlueprint()"
key_files:
  created:
    - apps/web/components/workspace/widgets/graphLayout.ts
    - apps/web/components/workspace/widgets/GraphNode.tsx
    - apps/web/components/workspace/widgets/GraphEdge.tsx
    - apps/web/components/workspace/widgets/GraphCanvas.tsx
  modified:
    - apps/web/components/workspace/widgets/widget-registry.ts
    - apps/web/store/session-store.ts
    - apps/web/app/(protected)/sessions/[id]/page.tsx
    - apps/web/app/(protected)/sessions/[id]/workspace.tsx
decisions:
  - "Blueprint stored in sessionStore (setBlueprint action) rather than prop-drilled to GraphCanvas — enables runtime color resolution without prop threading through ReactFlow tree"
  - "page.tsx parses full Blueprint with BlueprintSchema.safeParse and passes it to Workspace as a new blueprint? prop alongside the existing canvasViewMode prop"
  - "GraphCanvasDynamic uses next/dynamic ssr:false (Pitfall 2 + T-09-09) — @xyflow/react requires window/document/ResizeObserver; SSR crash would surface as AnalyticsPanelErrorBoundary fallback"
  - "edgeTypes/nodeTypes defined at module level in GraphEdge.tsx/GraphNode.tsx — never inside GraphCanvas or any component (Pitfall 1 prevents remount storm)"
  - "FALLBACK_COLOR '#6366f1' (Indigo 500 accent) used when Blueprint is unavailable — intentional, matches project palette, not a hardcoded node color"
metrics:
  duration: "~18 minutes"
  completed_date: "2026-07-05"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 4
  files_created: 4
---

# Phase 9 Plan 3: Graph Canvas Renderer Summary

## One-liner

@xyflow/react graph canvas with Blueprint-colored nodes/edges, ghost confirm/dismiss (optimistic PATCH + revert), dagre layout fallback, ssr:false registry entry, and full Blueprint piped server-to-store for runtime color resolution.

## What Was Built

### Task 1: graphLayout util + GraphEdge + GraphNode

**graphLayout.ts** — Pure utility with no project imports. Exports `applyDagreLayout(nodes, edges)` using `@dagrejs/dagre` with `rankdir: 'TB'`, `ranksep: 60`, `nodesep: 40`, `NODE_WIDTH: 180`, `NODE_HEIGHT: 60`. Centers positions by subtracting half-dimensions from dagre's center-origin output. Called by GraphCanvas when any visible node has `position_x === null`.

**GraphEdge.tsx** — Custom edge using `BaseEdge` + `getSmoothStepPath`. Stroke color resolved from `data.blueprintColor` (falls back to `#6366f1`). Stroke width 1.5px. `edgeTypes = { graphEdge: GraphEdge }` exported at module level (Pitfall 1 guard).

**GraphNode.tsx** — Custom node renderer with three visual states:
- **Ghost** (`status === 'ghost'`): `opacity: 0.6` wrapper; `1.5px dashed ${blueprintColor}99` border; `${blueprintColor}1A` fill (10%); `#a1a1aa` label color (muted-foreground)
- **Committed** (`status === 'committed'`): `1.5px solid ${blueprintColor}` border; `${blueprintColor}26` fill (15%); `--color-foreground` label
- **Silent** (`optimisticStatus === 'silent'`): returns null

Ghost confirm button: `Check` icon, `min-h-[44px] min-w-[44px]`, aria-label `Confirmar nodo {label}`, optimistic set 'committed' then PATCH, revert to 'ghost' + sonner toast on error.
Ghost dismiss button: `X` icon, `variant="destructive"`, `min-h-[44px] min-w-[44px]`, aria-label `Descartar nodo {label}`, optimistic set 'silent' then PATCH `{ status: 'silent' }`, revert to 'ghost' + toast on error.

`nodeTypes = { graphNode: GraphNode }` exported at module level (Pitfall 1 guard).

**session-store.ts** — Added `blueprint: Blueprint | null` field and `setBlueprint(blueprint)` action to `SessionStoreState`. Blueprint is `null` when no Blueprint is configured for the session. GraphCanvas reads `sessionStore.blueprint` to resolve `node_type_id → color` and `edge_type_id → color` at runtime.

### Task 2: GraphCanvas wrapper + widget-registry 'graph' registration

**GraphCanvas.tsx** — 'use client' with `import '@xyflow/react/dist/style.css'` at top (Pitfall 2 — mandatory inside the dynamically loaded module). Reads `canvasNodes`, `canvasEdges`, `blueprint` from `useSessionStore`. Builds `rfNodes` via `useMemo` — filters silent, maps `CanvasNode` to `{ id, type: 'graphNode', position, data: { canvasNode, blueprintColor } }` where `blueprintColor = blueprint?.node_types.find(t => t.id === n.node_type_id)?.color ?? '#6366f1'`. Builds `rfEdges` similarly with edge Blueprint color. Runs `applyDagreLayout` when any node has `position_x === null`. Syncs local `nodes`/`edges` state from store via `useEffect`. Renders `<ReactFlow nodesDraggable={false} nodesConnectable={false} colorMode="dark" fitView>` with `<Background />` and `<Controls />`. Imports `nodeTypes`/`edgeTypes` from GraphNode/GraphEdge (not redefined). Empty state shows "El grafo está vacío" / "El AI añadirá nodos a medida que avance la conversación."

**widget-registry.ts** — Added `import dynamic from 'next/dynamic'`. Added `GraphCanvasDynamic = dynamic(() => import('./GraphCanvas').then(m => ({ default: m.GraphCanvas })), { ssr: false, loading: () => <div className="w-full h-full bg-card animate-pulse rounded" /> }) as WidgetComponent`. Registered `['graph', GraphCanvasDynamic]` in `widgetRegistry`.

**page.tsx** — Extended Blueprint fetch to parse full `BlueprintSchema.safeParse(def)` after extracting `canvas_view_mode`. Passes `blueprint={blueprint}` (type `Blueprint | null`) to `<Workspace>`.

**workspace.tsx** — Added `blueprint?: Blueprint | null` to `WorkspaceProps`. Added `useEffect` that calls `useSessionStore.getState().setBlueprint(blueprint ?? null)` on mount.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 1272b0e | feat(09-03): graphLayout util + GraphEdge + GraphNode + blueprint store |
| 2 | 55b8335 | feat(09-03): GraphCanvas wrapper + widget-registry 'graph' ssr:false registration |

## Deviations from Plan

### Auto-added: Blueprint piped to sessionStore

**Found during:** Task 2 implementation (GraphCanvas Blueprint color resolution)

**Issue:** The plan said "if not already in a store, fall back to a neutral color" for Blueprint colors — implying GraphCanvas could work with just a fallback. However, without the Blueprint in a client-accessible store, all nodes and edges would render with the same fallback color (#6366f1) regardless of node type, which violates the "Node and edge colors come from the active Blueprint's node_types[].color / edge_types[].color, not hardcoded" must_have truth.

**Fix:** Extended the existing Blueprint fetch in `page.tsx` (which already queried `domain_blueprints` for `canvas_view_mode`) to also parse the full Blueprint using `BlueprintSchema.safeParse`. Passed it as a new `blueprint?` prop to `Workspace`. `Workspace` calls `sessionStore.setBlueprint()` on mount via `useEffect`. Added `blueprint: Blueprint | null` + `setBlueprint()` to `SessionStoreState`. TypeScript and build pass.

**Files modified:** `apps/web/store/session-store.ts`, `apps/web/app/(protected)/sessions/[id]/page.tsx`, `apps/web/app/(protected)/sessions/[id]/workspace.tsx`

**Rule:** Rule 2 — Missing critical functionality (Blueprint colors are a must_have correctness requirement per plan frontmatter)

## Known Stubs

None. All implementations wire to real data sources:
- `graphLayout.ts` uses real @dagrejs/dagre (v3.0.0 installed)
- `GraphNode` resolves real Blueprint colors from `sessionStore.blueprint`
- `GraphCanvas` reads live `canvasNodes/canvasEdges` from Zustand store
- Blueprint is parsed from the real `domain_blueprints` Supabase table
- Ghost confirm/dismiss PATCHes the real `/api/canvas_nodes/:id` endpoint (built in 09-01)

## Threat Flags

No new threat surface beyond the plan's threat_model:
- T-09-08 (node label XSS): Labels rendered as React text children — no `dangerouslySetInnerHTML` anywhere in GraphNode.tsx. ✓
- T-09-09 (SSR crash): `next/dynamic ssr:false` gate in widget-registry.ts + AnalyticsPanelErrorBoundary wraps WidgetZone. ✓
- T-09-10 (optimistic confirm/dismiss): Optimistic state reverts on PATCH failure + sonner toast; server broadcast is source of truth. ✓

## Self-Check: PASSED

Files created/modified:
- [x] apps/web/components/workspace/widgets/graphLayout.ts — EXISTS
- [x] apps/web/components/workspace/widgets/GraphEdge.tsx — EXISTS
- [x] apps/web/components/workspace/widgets/GraphNode.tsx — EXISTS
- [x] apps/web/components/workspace/widgets/GraphCanvas.tsx — EXISTS
- [x] apps/web/components/workspace/widgets/widget-registry.ts — MODIFIED ('graph' registered ssr:false)
- [x] apps/web/store/session-store.ts — MODIFIED (blueprint field + setBlueprint action)
- [x] apps/web/app/(protected)/sessions/[id]/page.tsx — MODIFIED (Blueprint parsed + passed)
- [x] apps/web/app/(protected)/sessions/[id]/workspace.tsx — MODIFIED (blueprint prop accepted + setBlueprint on mount)

Commits verified:
- [x] 1272b0e — Task 1 commit (graphLayout + GraphEdge + GraphNode + store)
- [x] 55b8335 — Task 2 commit (GraphCanvas + widget-registry + page + workspace)

Verification:
- [x] `applyDagreLayout` in graphLayout.ts — 2 occurrences
- [x] `export const nodeTypes` at module level in GraphNode.tsx — 1
- [x] `export const edgeTypes` at module level in GraphEdge.tsx — 1
- [x] `min-h-[44px]` in GraphNode.tsx — 3 (confirm + dismiss buttons)
- [x] `@xyflow/react/dist/style.css` in GraphCanvas.tsx — 1
- [x] `ssr: false` in widget-registry.ts — present
- [x] `'graph'` in widget-registry.ts — registered
- [x] `pnpm --filter @panelito/web exec tsc --noEmit` — exits 0
- [x] `pnpm --filter @panelito/web build` — exits 0 (SSR gate holds)
