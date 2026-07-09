# Phase 10: Infrastructure Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-09
**Phase:** 10-infrastructure-foundation
**Areas discussed:** Arbitration lock mechanism, Token budget storage, State schema approach, Creator notification scope

---

## Arbitration Lock Mechanism

### Q1: Lock storage mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Supabase table (mirror mic lock) | New `bot_arbitration` table, atomic UPDATE WHERE locked_until < NOW(). Proven pattern already in codebase. | ✓ |
| Postgres advisory lock | pg_try_advisory_lock(hashtext(branch_id)) — transaction-scoped, fragile in serverless | |
| LangGraph bot thread state CAS | Store `active_bot` field in PostgresSaver, read-compare-write. Not natively atomic. | |

**User's choice:** Supabase table (mirror mic lock)
**Notes:** Consistent with existing mic lock pattern; no new infra needed.

---

### Q2: Cooldown duration source

| Option | Description | Selected |
|--------|-------------|----------|
| Per-bot hardcoded defaults in the lock RPC | Caller passes cooldown_seconds param | |
| Blueprint config injected at lock time | Blueprint carries `bot_cooldowns` map; invoker resolves before calling lock | ✓ |

**User's choice:** Blueprint config injected at lock time
**Notes:** Consistent with where other per-bot config lives.

---

### Q3: Scoring responsibility

| Option | Description | Selected |
|--------|-------------|----------|
| Each bot scores itself, RPC picks winner | Per-bot scoring, atomic DB picks highest | |
| Central arbitration module scores all bots | BotArbitrator class knows all bots, scores them, picks winner, then acquires lock | ✓ |

**User's choice:** Central arbitration module
**Notes:** Preferred for cross-bot scoring context and centralized logic.

---

### Q4: Bot registry (Phase 10 has no bots yet)

| Option | Description | Selected |
|--------|-------------|----------|
| Plugin registry — bots self-register on import | `registerBot(botId, scorer)` extension point; empty in Phase 10, short-circuits | ✓ |
| Static bot list in arbitrator | Explicit KNOWN_BOTS array, modified when adding bots | |

**User's choice:** Plugin registry
**Notes:** Clean extension point; Phase 10 registry is empty and arbitrator short-circuits.

---

## Token Budget Storage

### Q1: Ledger storage

| Option | Description | Selected |
|--------|-------------|----------|
| Supabase table — `bot_budget_ledger` | Append-only rows, SQL window query for 5-min sum | ✓ |
| LangGraph bot thread state (BOT-05 strict) | Array of {timestamp, tokens} in PostgresSaver; heavier to query | |

**User's choice:** Supabase table
**Notes:** SQL window queries more ergonomic; queryable from Langfuse.

---

### Q2: Circuit breaker state storage

| Option | Description | Selected |
|--------|-------------|----------|
| Same table as ledger — sentinel row | One table, one RLS policy | |
| Separate `bot_circuit_state` table | Single upsertable row per branch, clean separation | ✓ |

**User's choice:** Separate `bot_circuit_state` table
**Notes:** Cleaner schema; ledger is append-only, circuit state is upsertable.

---

### Q3: Threshold config location

| Option | Description | Selected |
|--------|-------------|----------|
| Blueprint config | Consistent with arbitration cooldowns | |
| Session settings table | Creator can override per session without redeploying Blueprint | ✓ |

**User's choice:** Session settings table
**Notes:** Per-session override without Blueprint redeploy is important for creator control.

---

### Q4: Budget check implementation

| Option | Description | Selected |
|--------|-------------|----------|
| Postgres RPC — atomic, single round-trip | `check_and_record_bot_budget` — read + write in one DB call | ✓ (after WSL clarification) |
| TypeScript service with direct queries | Three separate calls; race condition risk | |

**User's choice:** Postgres RPC
**Notes:** User initially hesitated due to WSL2 concern. Clarified: Supabase RPCs use HTTP (PostgREST), not WebSocket — not affected by WSL2 Realtime issue. Existing mic lock RPCs already work in WSL2. User confirmed RPC approach.

---

## State Schema Approach

### Q1: Shared vs. separate StateAnnotation

| Option | Description | Selected |
|--------|-------------|----------|
| Extend existing annotation | Add argGraph + triggerMetadata to GraphStateAnnotation; shared by both thread types | ✓ |
| Separate BotGraphStateAnnotation | Parallel graph for bot invocations; two compilation pipelines | |

**User's choice:** Extend existing annotation
**Notes:** Phase 11 adds conditional START edge to the same graph; separate annotation would require a second graph.

---

### Q2: Bot conversation history source

| Option | Description | Selected |
|--------|-------------|----------|
| Supabase messages table directly | Simple query by branch_id; consistent with canvas route pattern | ✓ |
| Human thread LangGraph checkpoint | Read branch_id:human checkpoint; couples thread lifecycles | |

**User's choice:** Supabase messages table directly
**Notes:** Avoids cross-thread coupling; same pattern as existing GET /api/sessions/:id/canvas.

---

### Q3: argGraph field type

| Option | Description | Selected |
|--------|-------------|----------|
| Typed TS object { nodes: ArgNode[], edges: ArgEdge[] } | Types in @panelito/types; type-safe; defaults to empty arrays | ✓ |
| Raw JSON string | Simpler to store; loses type safety; requires parse/stringify on every access | |

**User's choice:** Typed TS object in @panelito/types
**Notes:** Consistent with how CanvasNode/CanvasEdge are defined.

---

## Creator Notification Scope

### Q1: Notification delivery timing

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side only — circuit state in DB, notification deferred to Phase 14 | Keeps Phase 10 backend-only | ✓ |
| Wire Supabase Realtime broadcast now | Full notification; adds frontend scope | |

**User's choice:** Server-side only, Phase 14 deferred
**Notes:** Phase 10 is infrastructure-only; no frontend work.

---

### Q2: Silence gate `is_typing` source

| Option | Description | Selected |
|--------|-------------|----------|
| Supabase Presence (primary) + DB fallback for WSL2 | Graceful degradation; logs fallback in Langfuse | ✓ |
| DB-only: store is_typing in a Supabase table | Works in WSL2 but adds a table + per-keystroke writes | |

**User's choice:** Supabase Presence with WSL2 graceful fallback
**Notes:** Prod uses Presence; WSL2 assumes nobody typing if Presence unavailable; logged in Langfuse.

---

### Q3: Elapsed time source for silence gate

| Option | Description | Selected |
|--------|-------------|----------|
| Supabase messages table — MAX(created_at) | Simple SQL; consistent with bots reading from Supabase | ✓ |
| LangGraph bot thread state — store last_human_message_at | Cross-thread write coupling from human path | |

**User's choice:** Supabase messages table
**Notes:** Consistent with decision that bots read from Supabase directly.

---

## Claude's Discretion

- Migration numbering (next in sequence after existing migrations)
- TypeScript naming conventions for BotArbitrator and RPC wrappers
- RLS policies for new tables (service role only)

## Deferred Ideas

- Real-time creator notification via Supabase Realtime broadcast — Phase 14
- Blueprint-configurable token budget threshold (currently session settings) — possible future consolidation
- COST-03 per-invocation cost attribution in Langfuse by trigger type — Phase 14
