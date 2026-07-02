---
phase: 06-graph-construction-checkpointer
fixed_at: 2026-07-02T19:41:00Z
review_path: .planning/phases/06-graph-construction-checkpointer/06-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 06: Code Review Fix Report

**Fixed at:** 2026-07-02T19:41:00Z
**Source review:** `.planning/phases/06-graph-construction-checkpointer/06-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (CR-01, CR-02, WR-01 through WR-06)
- Fixed: 8
- Skipped: 0

## Fixed Issues

### CR-01: `canvasMutationTool` schema — flatten `oneOf` into top-level `properties`

**Files modified:** `packages/types/src/canvas-tool.ts`, `packages/types/src/canvas-tool.test.ts`
**Commit:** 416cef4
**Applied fix:** Replaced the `parameters` block that had `{ type: 'object', oneOf: [...], required: ['op'] }` with a flat `properties` dictionary at root level, matching Anthropic's documented tool schema format. All eight fields (op, node_type_id, label, source_node_id, target_node_id, edge_type_id, confidence, reason) are now in a single top-level `properties` object with only `op` in `required`. Field-conditional constraints are communicated via descriptions; runtime validation is handled by `CanvasOpSchema.safeParse()` in `agentNode`.

Updated `canvas-tool.test.ts` to remove all five `oneOf`-based tests and replace them with eight tests that assert the flat `properties` shape: `parameters.properties` exists, `parameters.oneOf` does not exist, `op` is a string enum with all three values, only `op` is in `required`, ADD_NODE/ADD_EDGE/NO_ACTION fields are present in properties, and confidence has type/min/max constraints.

Verification: 10/10 canvas-tool tests pass. 5/5 graph unit tests pass.

### CR-02: `mutationGateNode` status type erasure — extend CanvasOp with optional `status`

**Files modified:** `packages/types/src/canvas.ts`, `apps/api/src/graph/nodes/mutation-gate.ts`
**Commit:** 416cef4
**Applied fix:**

Step 1 (`canvas.ts`): Added `status: CanvasNodeStatusSchema.optional()` to both the ADD_NODE and ADD_EDGE branches of `CanvasOpSchema`. The NO_ACTION branch is intentionally unchanged — NO_ACTION never reaches the mutation gate. `CanvasNodeStatusSchema` was already exported from the same file so no new export was needed.

Step 2 (`mutation-gate.ts`): Removed the double cast `as CanvasOp & { status: CanvasNodeStatus }` and subsequent `as CanvasOp`. The spread `{ ...op, status }` now satisfies the `CanvasOp` type directly since `status` is an optional field on ADD_NODE and ADD_EDGE branches. Also removed the now-unused `CanvasNodeStatus` import. The `status` local variable type was changed from `CanvasNodeStatus` to `'committed' | 'ghost'` (the two values assignable at the gate — `'silent'` is handled by the early return).

Verification: 5/5 graph unit tests pass. Phase 7 code reading `canvasOps[i].status` will resolve to `'committed' | 'ghost' | undefined` without requiring `as any` or suppression casts.

---

All 6 Warning findings were fixed in a single atomic commit `9fe607b`.

### WR-01: Promise-based singleton in `getCheckpointer()`

**Files modified:** `apps/api/src/lib/langgraph-checkpointer.ts`
**Commit:** 9fe607b
**Applied fix:** Replaced `let _checkpointer: PostgresSaver | null = null` with `let _checkpointerPromise: Promise<PostgresSaver> | null = null`. Changed `getCheckpointer()` from `async function` to a regular function that creates and caches the initialization Promise on the first call and returns it directly on all subsequent calls. Concurrent cold-start callers all await the same Promise, eliminating the race where two callers both see null, both call `fromConnString()`, and one pool is orphaned.

### WR-02: `driftReplyNode` returns wrong `driftAction` on error paths

**Files modified:** `apps/api/src/graph/nodes/drift-reply.ts`
**Commit:** 9fe607b
**Applied fix:** Changed both early-exit paths (missing adapter at line 31, missing lastMessage at line 44) from returning `{ driftAction: 'replied' }` to `{ driftAction: 'ignored' }`. The graph now accurately records that no reply was sent to the user when these failure conditions occur.

### WR-03: Test B has no assertions

**Files modified:** `apps/api/src/graph/graph.integration.test.ts`
**Commit:** 9fe607b
**Applied fix:** Added two assertion blocks to Test B. Before the graph invocation: `const provider = getLangfuseTracerProvider(); expect(provider).not.toBeNull()` — asserts that `setupLangfuseOtel()` (called in `beforeAll`) wired a real OTel provider. After `graph.invoke()`: `expect(result.guardrailResult).toBe('DOMAIN_MATCH')` and `expect(result.canvasOps.length).toBeGreaterThan(0)` — asserts the graph produced the expected output shape. The `forceFlush` TypeScript error (`Property 'forceFlush' does not exist on type 'TracerProvider'`) was confirmed pre-existing before this fix and was not introduced by these changes.

### WR-04: Missing env vars in `.env.example`

**Files modified:** `.env.example`
**Commit:** 9fe607b
**Applied fix:** Moved `SUPABASE_DIRECT_URL=` from the Next.js section into the Hono API section (with an explanatory comment that it is only consumed by `apps/api`). Added a new Langfuse block after `ALLOWED_ORIGINS` documenting `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` with a note that tracing is disabled if these are absent.

### WR-05: Hardcoded absolute paths in `vitest.config.ts`

**Files modified:** `apps/api/vitest.config.ts`
**Commit:** 9fe607b
**Applied fix:** Removed the hardcoded `/home/jgm/dev/projects/web-projects/panelito/apps/api/.env` entry from the `loadDotEnv()` candidates array (was the third entry). Removed the hardcoded `/home/jgm/dev/projects/web-projects/panelito/apps/api/node_modules` entry from the `detectWorktree()` candidates array (was the second entry). Both relative-path candidates are preserved and are sufficient for correct resolution in any environment.

### WR-06: Dead `forceDriftAction` option in `makeConfig()`

**Files modified:** `apps/api/src/graph/graph.test.ts`
**Commit:** 9fe607b
**Applied fix:** Removed the `forceDriftAction?: 'replied' | 'ignored'` field from the `makeConfig()` options type declaration along with its JSDoc comment. No call site passed this option and it was never forwarded to the graph config, so removal has no functional effect.

## Skipped Issues

None — all findings were fixed.

---

_Fixed: 2026-07-02T19:41:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
