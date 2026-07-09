# Phase 10: Infrastructure Foundation - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the safety and concurrency infrastructure that every proactive bot in Phases 11–14 depends on. No bot fires, no persona speaks, no trigger evaluates until these 5 constructs exist and are tested:

1. **Token budget guard + circuit breaker** (BOT-01) — sliding 5-minute window counter, circuit trips at 200 tokens/min, 10-minute pause, server-side state only
2. **Bot arbitration lock** (BOT-02) — Supabase table, central BotArbitrator module with plugin registry, Blueprint-configurable cooldowns
3. **Two-signal silence gate** (BOT-03) — Supabase Presence `is_typing` check with WSL2 graceful fallback + MAX(created_at) from messages table
4. **Dual LangGraph thread_id** (BOT-04) — migrate from `branch_id` to `branch_id:human` and `branch_id:bot` thread separation
5. **Extended state schema** (BOT-05) — add `argGraph` and `triggerMetadata` fields to `GraphStateAnnotation` with @panelito/types definitions

**What this phase does NOT include:**
- Any bot personalities, facilitation logic, or agent nodes (Phase 11)
- Any trigger implementations beyond the silence gate utility stub (Phase 11+)
- Creator notification UI / Realtime broadcast (Phase 14 Polish)
- ArgGraphBuilderNode (Phase 11)

</domain>

<decisions>
## Implementation Decisions

### Bot Arbitration Lock (BOT-02)

- **D-01:** Lock lives in a Supabase table, mirroring the existing mic lock (`acquire_mic` / `release_mic`) pattern from Phase 8. New `bot_arbitration` table with `(branch_id, locked_until, winner_bot_id)`. Atomic `UPDATE WHERE locked_until < NOW()` pattern — one round-trip, no race conditions.
- **D-02:** Cooldown duration comes from Blueprint config at lock time. Blueprint carries a `bot_cooldowns` map; the invoker resolves duration from the active Blueprint before calling the lock RPC. Consistent with where other per-bot config (cooldown budgets) lives.
- **D-03:** A central `BotArbitrator` module is responsible for scoring all registered bots and calling the lock. Bots self-register via a plugin registry: `registerBot(botId, scorerFn)` called on bot module import. In Phase 10, the registry is empty — BotArbitrator short-circuits cleanly when no bots are registered.

### Token Budget Guard + Circuit Breaker (BOT-01)

- **D-04:** Invocation ledger stored in a new Supabase table: `bot_budget_ledger (branch_id, invoked_at, tokens_used)`. Append-only rows. SQL window query: `SUM(tokens_used) WHERE invoked_at > NOW() - INTERVAL '5 minutes'`.
- **D-05:** Circuit breaker state stored in a separate `bot_circuit_state` table — single upsertable row per branch: `(branch_id, circuit_open: boolean, reset_at: timestamptz)`. Separate from the ledger for clarity and indexing.
- **D-06:** Budget threshold (default 200 tokens/min → 1000 tokens/5 min) stored in the **session settings table** — not Blueprint config. Allows creator to override per-session without redeploying a Blueprint.
- **D-07:** Budget check and circuit trip implemented as a single Postgres RPC: `check_and_record_bot_budget(branch_id, tokens_used) → { allowed: boolean, circuit_open: boolean }`. Atomically: checks circuit state, sums window, records usage, trips circuit if over threshold. Consistent with mic lock RPC pattern. Works in WSL2 (HTTP/PostgREST, not WebSocket).
- **D-08:** Creator notification is server-side only in Phase 10. When circuit trips, `bot_circuit_state.circuit_open = true` and `reset_at` is set. Client can poll on next page load. Real-time notification (Supabase Realtime broadcast) deferred to Phase 14.

### Two-Signal Silence Gate (BOT-03)

- **D-09:** `is_typing` read from Supabase Presence (WebSocket channel) as primary source. In WSL2 where Presence is dead, the gate degrades gracefully: if the Presence check fails or times out, assume no participant is typing and let the trigger proceed. Fallback is logged in Langfuse as `silence_gate_presence_fallback: true` so it's observable.
- **D-10:** Elapsed time since last human message read from Supabase messages table: `SELECT MAX(created_at) FROM messages WHERE branch_id = $1`. Consistent with the decision to have bots read from Supabase directly (not from LangGraph human thread checkpoint).

### Dual Thread ID Separation (BOT-04)

- **D-11:** Thread ID format changes from `branch_id` (bare UUID) to `${branch_id}:human` and `${branch_id}:bot`. The `:human` thread is the existing invocation path (minimal change — append `:human` to the existing thread_id construction in `ai.ts` line 344). The `:bot` thread is new — initialized on first proactive invocation.
- **D-12:** Human and bot threads are completely independent checkpoints in PostgresSaver. No cross-thread reads from LangGraph state — bots get conversation history from Supabase messages table, not from the `:human` checkpoint.

### State Schema Extension (BOT-05)

- **D-13:** Extend the existing `GraphStateAnnotation` in `apps/api/src/graph/state.ts` — do NOT create a separate BotGraphStateAnnotation or a second graph. Bot and human threads share the same annotation. Fields irrelevant to a given invocation type remain at their defaults.
- **D-14:** New `argGraph` field typed as `{ nodes: ArgNode[], edges: ArgEdge[] }`. `ArgNode` and `ArgEdge` types defined in `@panelito/types` alongside `CanvasNode`/`CanvasEdge`. Default: `{ nodes: [], edges: [] }`. ArgGraphBuilderNode that populates this comes in Phase 11.
- **D-15:** New `triggerMetadata` field typed as `Record<string, { last_fired_at: string | null, cooldown_until: string | null }>` (keyed by trigger type). Default: `{}`. Populated by trigger implementations in Phase 11+.

### Claude's Discretion

- Migration numbering for the 3 new Supabase tables (`bot_arbitration`, `bot_budget_ledger`, `bot_circuit_state`) — follow existing migration convention (`0009_*.sql` next in sequence).
- TypeScript naming conventions for the BotArbitrator module and RPC wrappers — follow existing `lib/` naming patterns.
- RLS policies for the 3 new tables — service role only (no participant reads needed, consistent with mic lock table).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### LangGraph & Checkpointer (existing)
- `apps/api/src/lib/langgraph-checkpointer.ts` — PostgresSaver singleton, `langgraph` schema, SUPABASE_DIRECT_URL. Phase 10 must NOT create a second singleton — extend this.
- `apps/api/src/graph/state.ts` — existing `GraphStateAnnotation`. Phase 10 adds `argGraph` and `triggerMetadata` fields here.
- `apps/api/src/graph/graph.ts` — graph compilation; thread_id construction referenced at `apps/api/src/routes/ai.ts:344`.

### Mic Lock Pattern (reference for bot lock)
- `apps/api/src/routes/ai.ts` — `acquire_mic` / `release_mic` RPC usage at lines ~300–320, 698–704. Bot arbitration lock must follow this exact pattern.

### Model & Provider Config
- `apps/api/src/lib/model-config.ts` — `TASK_MODELS` registry; Phase 10 does NOT extend this (Phase 12 task).

### Requirements
- `.planning/REQUIREMENTS.md` §BOT-01–BOT-05 — all 5 infrastructure requirements with success criteria
- `.planning/ROADMAP.md` §Phase 10 — goal, success criteria (5 testable scenarios)

### WSL2 constraint
- `.claude/projects/memory/feedback_wsl2_realtime.md` — Supabase Realtime (WebSocket) dead in WSL2; silence gate must handle this gracefully (D-09)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/lib/langgraph-checkpointer.ts` — `getCheckpointer()` singleton: reuse directly, do not reinitialize
- `apps/api/src/routes/ai.ts` — mic lock RPC pattern (`supabase.rpc('acquire_mic', ...)`) is the exact template for `try_acquire_bot_lock` and `check_and_record_bot_budget`
- `apps/api/src/lib/model-config.ts` — `TASK_MODELS` registry exists; Phase 10 does not extend it but must not break it

### Established Patterns
- Postgres RPC for atomic DB operations (mic lock) — Phase 10 extends this to arbitration lock and budget guard
- Module-level singleton with Promise guard (checkpointer) — BotArbitrator should follow same pattern if it holds any state
- `@panelito/types` as the shared type package — all new types (`ArgNode`, `ArgEdge`, extended `GraphState`) must be defined here

### Integration Points
- `apps/api/src/routes/ai.ts:344` — where `thread_id: activeBranchId` is constructed; must change to `${activeBranchId}:human`
- `apps/api/src/graph/state.ts` — add `argGraph` and `triggerMetadata` fields
- `supabase/migrations/` — 3 new tables need a new migration file (`0009_bot_infrastructure.sql`)
- `packages/types/src/` — `ArgNode`, `ArgEdge` type definitions to add

</code_context>

<specifics>
## Specific Ideas

- The dual thread_id change in `ai.ts:344` is a one-line change (`thread_id: activeBranchId` → `thread_id: \`${activeBranchId}:human\``). High-leverage, low-risk. Do this first to unblock bot thread creation.
- The `BotArbitrator` module should export `registerBot(botId: string, scorer: (context: ArbContext) => number): void` and `runArbitration(branchId: string, blueprint: Blueprint): Promise<string | null>` (returns winning bot ID or null).
- `check_and_record_bot_budget` RPC should return `{ allowed: boolean, circuit_open: boolean, tokens_used_window: number }` — the third field is useful for Langfuse tracing.

</specifics>

<deferred>
## Deferred Ideas

- Real-time creator notification via Supabase Realtime broadcast (`bot_circuit_tripped` event) — Phase 14
- Blueprint-configurable token budget threshold — currently in session settings; may want to consolidate into Blueprint config in a future cleanup
- Per-invocation cost attribution in Langfuse by trigger type (COST-03) — Phase 14

</deferred>

---

*Phase: 10-Infrastructure Foundation*
*Context gathered: 2026-07-09*
