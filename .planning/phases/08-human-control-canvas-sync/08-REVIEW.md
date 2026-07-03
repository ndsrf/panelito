---
phase: 08-human-control-canvas-sync
reviewed: 2026-07-03T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - apps/api/src/graph/nodes/agent.ts
  - apps/api/src/graph/nodes/mutation-gate.ts
  - apps/api/src/graph/state.ts
  - apps/api/src/routes/ai.ts
  - apps/api/src/routes/sessions.ts
  - apps/web/app/(protected)/sessions/[id]/workspace.tsx
  - apps/web/components/workspace/CreatorControls.tsx
  - apps/web/components/workspace/InputBox.tsx
  - apps/web/hooks/use-ai-stream.ts
  - apps/web/hooks/use-session-channel.ts
  - apps/web/store/session-store.ts
  - packages/types/src/canvas-tool.ts
  - supabase/migrations/0010_mic_lock.sql
findings:
  critical: 2
  warning: 4
  info: 2
  total: 8
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-07-03
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Phase 8 implements mic lock (HUMAN-01), phase advancement via `phase_signal` (HUMAN-02), and canvas DB sync (CANVAS-02). The mic lock design is solid: atomic compare-and-set in Postgres, `finally`-guaranteed release, and correct branch-scoped filtering on the client. The canvas upsert pipeline (ADD_NODE before ADD_EDGE, label-to-UUID mapping, existence checks) follows the documented design. The SSE drain-queue pattern is correct for Node.js single-threaded execution.

Two blockers are present. The most critical is a semantic inversion in the `phase_signal` SSE payload: it sends the *current* phase ID as `current_phase_id`, which the client forwards unchanged as `next_phase_id` to `PATCH /phase`. The PATCH endpoint sets `sessions.current_phase` to that value — which is already the active phase — making the "Advance Phase" button a no-op. The phase never advances. The second blocker is a missing `blueprint_id` null guard in `PATCH /api/sessions/:id/phase` that causes an unhandled 500 on V1 sessions.

---

## Critical Issues

### CR-01: `phase_signal` SSE sends the current phase, not the next phase — "Advance Phase" is a no-op

**File:** `apps/api/src/routes/ai.ts:456-462`

**Issue:** The `phase_signal` SSE event payload embeds `current_phase_id: session.current_phase` (the phase already active). The client (`use-ai-stream.ts:221`) stores this as `pendingPhaseId` and the `AdvancePhaseButton` (`CreatorControls.tsx:229`) POSTs it to `PATCH /sessions/:id/phase` as `next_phase_id`. The PATCH handler writes `sessions.current_phase = next_phase_id` (i.e. the same value). Result: clicking "Advance Phase" performs an idempotent no-op — the session stays on the current phase permanently, regardless of how many times the button is pressed.

**Fix:** Compute the _next_ phase index in the sequence before emitting the SSE event:

```typescript
// apps/api/src/routes/ai.ts — inside the phase_signal emit block
if ((finalState as any)?.phase_signal === true) {
  const currentPhaseIndex = blueprint.phase_sequence.findIndex(
    (p) => p.id === (session.current_phase ?? blueprint.phase_sequence[0]?.id)
  )
  const nextPhase = blueprint.phase_sequence[currentPhaseIndex + 1] ?? null

  if (nextPhase) {
    await stream.writeSSE({
      event: 'phase_signal',
      data: JSON.stringify({
        next_phase_id: nextPhase.id,    // renamed field: the phase to advance TO
        blueprint_id: session.blueprint_id,
      }),
    })
  }
  // If no next phase exists, suppress the signal (already at final phase)
}
```

Update `use-ai-stream.ts` to read `payload.next_phase_id` instead of `payload.current_phase_id`, and update `AdvancePhaseButton` to use that value. Also update the `phase_signal` SSE client comment in `use-ai-stream.ts:219` to match.

---

### CR-02: `PATCH /sessions/:id/phase` calls `loadBlueprint(session.blueprint_id)` without a null guard — throws unhandled 500 on V1 sessions

**File:** `apps/api/src/routes/sessions.ts:456`

**Issue:** The `PATCH /:id/phase` route fetches the session's `blueprint_id` and passes it directly to `loadBlueprint()`. There is no null check. If a V1 session (no `blueprint_id`) reaches this route, `loadBlueprint(null)` is called, queries for `id = null`, finds nothing, and throws. The outer catch at line 485 returns `{ error: 'internal' }` with HTTP 500 — the wrong status code for an easily detectable client error, and the error message is misleading.

This is analogous to the `D-01` guard that exists in `POST /invoke` (line 92-94) but is absent here.

**Fix:** Add a blueprint gate immediately after the ownership check:

```typescript
// apps/api/src/routes/sessions.ts — after the creator_id check (line 451)
if (!session.blueprint_id) {
  return c.json({ error: 'no_blueprint', message: 'Phase advancement requires a Blueprint session' }, 400)
}

const blueprint = await loadBlueprint(session.blueprint_id)
```

---

## Warnings

### WR-01: `canvas_update` broadcast handler accesses `payload.nodes` and `payload.edges` without null guards — crashes on malformed broadcast

**File:** `apps/web/hooks/use-session-channel.ts:82-83`

**Issue:** The `canvas_update` handler directly accesses `payload.nodes` and `payload.edges` via unsafe casts and calls `.length` on them in the `console.log`. If the broadcast payload is missing either field (e.g. due to a partial failure or schema drift between API and client versions), this throws a `TypeError: Cannot read properties of undefined`, which may crash the Supabase channel subscription and silently stop all real-time updates for the session.

```typescript
// Current — crashes if payload.nodes or payload.edges is undefined:
console.log('[canvas] update received', (payload.nodes as CanvasNode[]).length, ...)
useSessionStore.getState().setCanvasData(payload.nodes as CanvasNode[], payload.edges as CanvasEdge[])
```

**Fix:**
```typescript
.on('broadcast', { event: 'canvas_update' }, ({ payload }) => {
  const nodes = Array.isArray(payload?.nodes) ? payload.nodes as CanvasNode[] : []
  const edges = Array.isArray(payload?.edges) ? payload.edges as CanvasEdge[] : []
  console.log('[canvas] update received', nodes.length, 'nodes', edges.length, 'edges')
  useSessionStore.getState().setCanvasData(nodes, edges)
})
```

---

### WR-02: Rename button is rendered for the synthesized `'main'` branch stub — fires an invalid API call

**File:** `apps/web/components/workspace/CreatorControls.tsx:406-430`

**Issue:** When the session store has no branch with `path_id === 'main'` (e.g. during initial load before `setBranches` is called), a synthetic fallback branch with `id: 'main'` is prepended to `displayBranches` (line 407). The archive button correctly excludes `b.id === 'main'` (line 433), but the Rename button is rendered unconditionally for all branches including this stub. Clicking Rename on the stub calls `handleRename('main', 'Principal')`, which sends `PATCH /api/sessions/:id/branches/main`. `'main'` is not a valid UUID, so the API returns a 4xx error that surfaces to the user as `toast.error('No se pudo renombrar la rama.')` even though the session has a perfectly valid main branch in the database that they cannot actually see yet.

**Fix:** Guard the Rename button the same way as the Archive button, or use `b.path_id !== 'main'` to exclude stub-or-real main:

```tsx
{b.path_id !== 'main' && (
  <Button variant="ghost" size="sm" onClick={() => handleRename(b.id, b.label)} ...>
    Renombrar
  </Button>
)}
```

---

### WR-03: `ADD_EDGE` label-to-UUID resolution is undocumented and inconsistent with the tool schema

**File:** `apps/api/src/routes/ai.ts:477-511`

**Issue:** `nodeIdMap` maps node labels to server-generated UUIDs for same-invocation `ADD_NODE + ADD_EDGE` cases (line 503: `nodeIdMap.set(op.label, nodeId)`). However, the `canvas_mutation` tool schema (`canvas-tool.ts:52-56`) describes `source_node_id` and `target_node_id` as "UUID of the source/target canvas node". If the LLM follows the schema literally and emits a label string (e.g. `"Hypothesis"`) as `source_node_id`, the fallback `?? op.source_node_id` (line 510) passes the label through to the DB existence check, which fails (label is not a UUID), causing the edge to be silently dropped.

Conversely, if the LLM correctly generates a non-existent UUID for a brand-new node (because no UUID exists at prompt time), `nodeIdMap.get(uuid)` returns `undefined`, the fallback returns the UUID, and the existence check correctly fails. In neither case does a same-invocation `ADD_EDGE` reliably succeed without the LLM guessing that it should send a label, not a UUID.

**Fix:** Update the tool schema description to say "Label of the source node if added in this same response, or DB UUID for existing nodes." Alternatively, always map by label and require the LLM to send labels for `source_node_id` / `target_node_id` when referencing same-invocation nodes.

---

### WR-04: `blueprint.node_types` and `blueprint.edge_types` arrays are accessed without checking for empty — `buildAgentSystemPrompt` can inject an empty block

**File:** `apps/api/src/graph/nodes/agent.ts:38-44`

**Issue:** If `blueprint.node_types` or `blueprint.edge_types` is an empty array (a malformed blueprint that somehow passes Ajv validation, which requires `minItems: 1` only on `node_types`), `nodeTypeDescriptions` or `edgeTypeDescriptions` becomes an empty string. The system prompt then contains:

```
Allowed node types (use node_type_id from this list only):

Allowed edge types (use edge_type_id from this list only):
```

…with empty lists. The model receives contradictory instructions (use node_type_id from this list, but the list is empty), which will cause every op to be `NO_ACTION` or emit a `node_type_id` that fails post-validation in `mutationGateNode`. The Ajv schema guards against empty `node_types` but not empty `edge_types` (`edge_types` has no `minItems` constraint). Blueprint validation should enforce `minItems: 1` on `edge_types` too.

**Fix:** Add `minItems: 1` to the `edge_types` array in the Ajv JSON schema (in `blueprint-loader.ts`), and add a defensive check in `BlueprintSchema` (Zod) to mirror it.

---

## Info

### IN-01: `window.prompt()` in `handleRename` blocks the main thread and has no mobile keyboard support

**File:** `apps/web/components/workspace/CreatorControls.tsx:336`

**Issue:** Branch renaming uses `window.prompt()`, which is a synchronous blocking call, not supported in iOS WKWebView, and visually inconsistent with the rest of the shadcn/ui design system. On iOS Safari, `prompt()` is a no-op in certain contexts. Given the mobile-first constraint documented in `CLAUDE.md`, this will silently fail on iOS for creators trying to rename branches.

**Fix:** Replace with a controlled `<Dialog>` component containing a shadcn `<Input>` field, consistent with the existing `<Sheet>` pattern used in `CreatorControls`.

---

### IN-02: `mutation-gate.ts` fails open when `blueprint` is absent from `config.configurable`

**File:** `apps/api/src/graph/nodes/mutation-gate.ts:37-46`

**Issue:** When `blueprint` is `undefined` in `config.configurable`, the `validNodeType` check defaults to `true` (line 39) and `validEdgeType` to `true` (line 52), bypassing all vocabulary validation. The comment acknowledges this as intentional ("skip"). In the current execution path, `agentNode` returns `{}` when `blueprint` is missing (line 96-98), so `canvasOps` would be empty and `mutationGateNode` would exit early at line 29. The fail-open is therefore unreachable in production. However, if the graph is invoked programmatically in a test without a blueprint, vocabulary validation is silently skipped, which could let malformed ops through in test environments.

**Fix:** Consider changing the fallback to fail-closed (`return {}`) or add a `console.warn` to make the skip detectable in tests.

---

_Reviewed: 2026-07-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
