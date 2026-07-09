# Research Summary: Project Multiverse v3.0
# The Bots Must Help the Conversation Flow

**Synthesized from:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md
**Date:** 2026-07-09
**Confidence:** HIGH overall (MEDIUM for classifier threshold calibration)

---

## Stack Additions

**One new package total.**

| Package | Version | Why |
|---------|---------|-----|
| `@huggingface/transformers` | 4.2.0 | Local ONNX embeddings (`all-MiniLM-L6-v2` at `dtype: 'q4'`) for semantic drift scoring — sub-30ms, zero token cost; using Claude API for continuous drift detection would burn creator keys on every silence check |

**Covered by existing packages (no new install):**

| Need | Covered By |
|------|------------|
| Per-session user profiles + in-memory conversation graph | `LangGraph InMemoryStore` (already installed) — namespaced by `[sessionId, participantId, 'profile']` and `[sessionId, 'graph']` |
| Model cost routing | `TASK_MODELS` registry (already in codebase) — additive extension only |
| Bot personality system | `PERSONA_LIBRARY` (already in codebase) — additive extension only |
| Silence timer | Native `setTimeout`/`clearTimeout` — 5 lines, `Map<branchId, NodeJS.Timeout>` |
| Multi-bot fan-out | LangGraph superstep parallel execution (already in LangGraph JS 1.4.7) |

**What NOT to add:** `node-cron`, `pg_cron` (wrong precision for 45s silence windows), separate Redis store (PostgresSaver covers it), LangChain agent framework (already using LangGraph directly).

---

## Table Stakes (Prerequisite — Build First)

**The intervention gate must exist before any trigger fires.**

Research (CHI 2025/2026) confirms: facilitation bots without a cooldown budget are worse than no bots. Build the gate before the triggers.

Gate requirements:
- **Session token budget guard** with circuit breaker — hard ceiling per session, resets hourly. Trips = bots go silent for 10 min, creator notified.
- **Two-signal silence gate** — check elapsed time AND Supabase Presence `is_typing: false` before any silence trigger fires. If anyone is typing, skip.
- **Global bot arbitration lock** per branch — one bot wins per N-second window via enthusiasm scoring (0-9 self-score, highest wins, others stand down).
- **Cooldown budgets** — Coach: 3/15min, Analyst: 2/15min, Fact-check: 1/30min. Blueprint-configurable.

---

## Bot Personality Design

**Structural constraints, not just tone — personas drift to generic "helpful AI" without these.**

| Bot | Core Constraint | Trigger Affinity | Model |
|-----|----------------|-----------------|-------|
| **Coach** | All output ends with "?" — never statements, always questions | Silence window, phase signal | Fast/light tier (Haiku, GPT-4o-mini, etc.) |
| **Analyst** | Always cites specific prior message by speaker+content | Unlinked assertion, drift | Capable tier (Sonnet, GPT-4o, etc.) |
| **Fact-Checker** (Analyst mode) | Uses uncertainty framing ONLY — "I can't verify that, what's the source?" — NEVER confident counter-assertion | False claim | Capable tier |
| **Devil's Advocate** | Acknowledges before challenging | Human-triggered (Power Reaction) — **v3.1, NOT v3.0** | Sonnet |

**Multi-bot arbitration:** Each bot scores trigger affinity 0-9, highest wins, others stand down. Proven pattern from production multi-bot deployments.

---

## Differentiators

- Coach that genuinely guides humans to their own conclusions (Socratic discipline enforced at prompt level)
- Analyst that builds coherent linked argument graphs — typed edges between claims, not isolated nodes
- Fact-check that increases trust because it never overclaims (uncertainty framing only)
- Blueprint-aware phase progression: bot recognizes when conversation has enough material and nudges the group forward
- Per-session participant profiles used to personalize facilitation ("you said earlier X — does this contradict that?")

---

## Critical Architecture Decisions

**Proactive bots are NOT a new invocation path.** They are a new trigger path feeding the same `graph.stream()` call. `/invoke` route, SSE machinery, Supabase persistence — all unchanged.

| Decision | Recommendation | Risk |
|----------|---------------|------|
| **Dual thread_id** | `branch_id:human` and `branch_id:bot` — separate LangGraph threads, explicit state merge | HIGH — concurrent writes to same thread_id cause checkpoint write-skew; cannot retrofit |
| **argGraph location** | In LangGraph thread state (PostgresSaver) — NOT separate service or JS process memory | HIGH — in-memory = destroyed on cold start; PostgresSaver gives branch isolation for free |
| **TriggerEngine host** | Standalone Node.js server (`server.ts`) — NOT Vercel serverless | HIGH — `setInterval` requires persistent process; Vercel cold-start destroys timer state |
| **Conditional START edge** | Isolate as its own phase, test exhaustively before building ProactiveInvoker on top | HIGHEST RISK — breaks all invocations (human + proactive) if wrong |
| **Proactive Invoker** | Internal `graph.stream()` call — no HTTP, no Mic Check bypass needed | LOW — mirrors existing route body; mic lock RPC already handles concurrency atomically |

---

## Watch Out For

**P21 — BYOK Cost Explosion (most dangerous):**
6 trigger types evaluating continuously can produce 50+ LLM calls/minute on creator's API key with no platform ceiling. Prevention: three-tier classification gate (heuristic -> Haiku -> Sonnet), hard session token budget, circuit breaker. Build this before wiring any trigger to an LLM call.

**P20 — Interruption Storm:**
All three bots fire simultaneously on same silence event, flooding chat. Prevention: server-side typed arbitration lock — one bot wins per N-second window; `is_typing` presence check; Supabase advisory lock per branch.

**P22 — Thread State Corruption:**
Concurrent human + proactive writes to same `thread_id` produce checkpoint write-skew. Prevention: dual `thread_id` separation (human vs. bot) — architectural decision that cannot be retrofitted.

**P23 — In-Memory State Loss:**
Vercel cold-start destroys JS process memory. All bot memory (argGraph, user profiles) must live in LangGraph PostgresSaver state, not JavaScript variables.

**P24 — Fact-Check False Confidence:**
LLM hallucination rates (22-94% depending on benchmark) mean a bot that confidently corrects a correct claim destroys trust. Prevention: uncertainty framing ONLY, never confident counter-assertions.

**P25 — Persona Drift:**
Personas drift to generic "helpful AI" after ~100 turns. Prevention: structural output constraints enforced at prompt level (Coach = ends with "?", Analyst = cites prior content); periodic persona re-anchor.

---

## Suggested Build Order (6 Phases)

| Phase | Name | Key Deliverable | Risk |
|-------|------|----------------|------|
| 1 | Infrastructure Foundation | Intervention gate, token budget guard, dual thread_id, backward-compatible state schema | Must precede ALL trigger work |
| 2 | Personality + Basic Triggers | Coach + Analyst personas, FacilitationAgentNode, AnalyticsAgentNode, silence trigger wired to Coach, conditional START edge (isolated + tested) | Highest-risk topology change |
| 3 | Graph Coherence | argGraph populated, edge-first CanvasOp schema, unlinked assertion trigger wired to Analyst, participant profiles | Medium |
| 4 | Fact-Check + Model Routing | Fact-check trigger (uncertainty framing), moderation trigger, semantic drift (3-tier), TASK_MODELS routing validated via Langfuse | Medium |
| 5 | User Profiles + Natural Speech | Profiles injected into prompts, persona refresh anchor, full prompt audit (no artifacts), 100-turn consistency test | Low |
| 6 | TriggerEngine + Full Wiring | setInterval scan loop, ProactiveInvoker, all 6 triggers wired, Blueprint phase signal, standalone server docs | Low (all components exist) |

---

## Open Questions for Planning

- Optimal silence window: start at 45s, tune from Langfuse data after 5-10 real sessions
- Semantic drift and moderation thresholds: set conservative, calibrate empirically
- Vercel `TRANSFORMERS_CACHE` env var for HuggingFace model cache: validate in deployment
- Persona drift calibration interval: make configurable, validate with 100-turn synthetic sessions in Phase 5
- `messages_content_check` Postgres constraint name: check schema before migration

---

*Research synthesized: 2026-07-09*
