---
phase: 08-human-control-canvas-sync
fixed_at: 2026-07-03T00:00:00Z
review_path: .planning/phases/08-human-control-canvas-sync/08-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 5
skipped: 1
status: partial
---

# Phase 08: Code Review Fix Report

**Fixed at:** 2026-07-03
**Source review:** `.planning/phases/08-human-control-canvas-sync/08-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 6
- Fixed: 5
- Skipped: 1

## Fixed Issues

### CR-01: `phase_signal` SSE sends the current phase, not the next phase — "Advance Phase" is a no-op

**Files modified:** `apps/api/src/routes/ai.ts`, `apps/web/hooks/use-ai-stream.ts`, `apps/web/components/workspace/CreatorControls.tsx`
**Commit:** `5658578`
**Applied fix:** In `ai.ts`, replaced the `phase_signal` SSE payload that sent `current_phase_id: session.current_phase` with logic that computes the next phase in `blueprint.phase_sequence` and emits `next_phase_id: nextPhase.id`. The signal is suppressed (not emitted) if the session is already at the last phase. In `use-ai-stream.ts`, updated the `phase_signal` handler to read `payload.next_phase_id` instead of `payload.current_phase_id`. Also updated JSDoc comments in both `use-ai-stream.ts` and `CreatorControls.tsx` to reflect the renamed field.

---

### CR-02: `PATCH /sessions/:id/phase` missing null guard for blueprint_id — throws 500 on V1 sessions

**Files modified:** `apps/api/src/routes/sessions.ts`
**Commit:** `fcf688b`
**Applied fix:** Added a null guard immediately after the ownership check (line 451) and before the `loadBlueprint()` call. If `session.blueprint_id` is falsy, returns `{ error: 'no_blueprint', message: 'Phase advancement requires a Blueprint session' }` with HTTP 400. This mirrors the D-01 gate in `POST /invoke` and prevents the unhandled 500 that occurred when `loadBlueprint(null)` found no row and threw.

---

### WR-01: `canvas_update` broadcast handler accesses payload.nodes/edges without null guards

**Files modified:** `apps/web/hooks/use-session-channel.ts`
**Commit:** `fb550f4`
**Applied fix:** Replaced direct unsafe casts and `.length` access on `payload.nodes` / `payload.edges` with `Array.isArray` guards that default to empty arrays. The handler now safely handles malformed broadcast payloads without throwing a TypeError that could crash the Supabase channel subscription.

---

### WR-02: Rename button rendered for synthetic 'main' branch stub — fires invalid API call

**Files modified:** `apps/web/components/workspace/CreatorControls.tsx`
**Commit:** `d145746`
**Applied fix:** Wrapped the Rename button in `{b.path_id !== 'main' && (...)}`, matching the semantics of the existing Archive button guard (`{b.id !== 'main' && (...)}` — kept for archive since the stub has `id === 'main'`). Using `path_id` for the rename guard covers both the synthetic stub and any real main branch, preventing the invalid `PATCH /api/sessions/:id/branches/main` call.

---

### WR-03: ADD_EDGE label-to-UUID resolution is inconsistent with tool schema

**Files modified:** `packages/types/src/canvas-tool.ts`
**Commit:** `898596d`
**Applied fix:** Updated the `source_node_id` and `target_node_id` schema descriptions from "UUID of the source/target canvas node" to "Label of the source/target node if it was added via ADD_NODE in this same response; DB UUID for existing nodes already in the canvas." This aligns the schema description with the actual server-side `nodeIdMap` resolution behavior and removes the ambiguity that caused the LLM to emit UUIDs for same-invocation nodes (which then failed the label-to-UUID lookup and dropped the edge silently).

---

## Skipped Issues

### WR-04: blueprint.edge_types array accessed without minItems guard — can inject empty prompt block

**File:** `apps/api/src/graph/nodes/agent.ts:38-44`
**Reason:** code context differs from review — fix already present in codebase

**Original issue:** The review stated that the Ajv blueprint schema lacked `minItems: 1` on the `edge_types` array (only enforcing it on `node_types`), which would allow a malformed blueprint to produce an empty system prompt block. The review recommended adding `minItems: 1` to the Ajv schema and mirroring it in the Zod schema.

**Finding:** On inspection of the current `apps/api/src/lib/blueprint-loader.ts`, `edge_types` already has `minItems: 1` (line 53, with comment "matches BlueprintSchema .min(1)"). The Zod schema in `packages/types/src/blueprint.ts` also already has `.min(1)` on `edge_types` (line 61). Both constraints are already enforced. No code change required.

---

_Fixed: 2026-07-03_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
