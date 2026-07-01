# Phase 5: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 5-Foundation
**Areas discussed:** Blueprint JSON schema, vercel.json runtime config, LangGraph checkpointer tables

---

## Blueprint JSON Schema

| Option | Description | Selected |
|--------|-------------|----------|
| All inline | Node types, edge types, persona configs embedded in Blueprint JSON | |
| Hybrid — vocab inline, personas by ID | Node/edge vocabulary inline; active_persona_ids[] references PERSONA_LIBRARY | ✓ |
| Fully normalized | FKs to separate tables for node_types, edge_types, personas | |

**User's choice:** Hybrid — vocab inline, personas by ID

---

| Option | Description | Selected |
|--------|-------------|----------|
| id + label + color | Minimal node type entry | |
| id + label + color + description | Adds description for LLM system prompt injection | ✓ |
| id + label + color + description + icon | All of above plus Lucide icon name | |

**User's choice:** id + label + color + description — description feeds LLM system prompt injection in Phase 6

---

| Option | Description | Selected |
|--------|-------------|----------|
| id + label + llm_instructions | Phase entry with LLM instructions only | |
| id + label + llm_instructions + allowed_node_types | Also restricts which node types LLM can emit per phase | ✓ |

**User's choice:** id + label + llm_instructions + allowed_node_types — tighter control per conversation phase

---

| Option | Description | Selected |
|--------|-------------|----------|
| id + label + color | Simpler edge type entry | ✓ |
| id + label + color + description | Same structure as node types | |

**User's choice:** id + label + color — edge semantics implied by id/label, description redundant

---

| Option | Description | Selected |
|--------|-------------|----------|
| Platform-global only | No creator_id FK; all creators share the platform Blueprint library | ✓ |
| Creator-owned with platform defaults | Optional creator_id; creators can define private Blueprints | |

**User's choice:** Platform-global only — RLS: readable by all authenticated, writable by service role only

---

| Option | Description | Selected |
|--------|-------------|----------|
| sessions.blueprint_id FK (nullable) | Nullable FK; NULL = no Blueprint (legacy v1 behavior) | |
| Separate session_blueprints table | Join table for Blueprint history per session | |
| In sessions.config JSON column | Store blueprint_id in JSONB config column | |
| NOT NULL FK (user's own answer) | Delete all beta sessions; make blueprint_id NOT NULL | ✓ |

**User's choice (free text):** "Delete all the existing sessions as we are still in beta mode. Add the foreign key and make the relationship NOT NULL"
**Notes:** User explicitly requested wiping all session data (beta). Migration 0008 must cascade-truncate sessions and all dependent tables before adding the NOT NULL constraint.

---

## vercel.json runtime config

| Option | Description | Selected |
|--------|-------------|----------|
| All /api/* routes | Declare all API routes as Node.js runtime | ✓ |
| Only streaming routes (/api/sessions/*/invoke) | Granular per-route config | |

**User's choice:** All /api/* routes — consistency over micro-optimization

---

| Option | Description | Selected |
|--------|-------------|----------|
| 60s (Vercel Hobby) | Free tier cap; maxDuration: 60 | ✓ |
| 300s (Vercel Pro) | Pro tier max; maxDuration: 300 | |
| You decide | Claude sets a reasonable default | |

**User's choice:** 60s — Vercel Hobby tier

---

| Option | Description | Selected |
|--------|-------------|----------|
| Single Vercel project (unified) | Both apps/web and apps/api in one Vercel project | ✓ |
| Two separate Vercel projects | Separate project per app | |

**User's choice:** Single unified Vercel project — one vercel.json at monorepo root

---

## LangGraph checkpointer tables

| Option | Description | Selected |
|--------|-------------|----------|
| checkpointer.setup() only | Runtime setup, not in migrations | |
| Supabase migration 0008 creates the tables | Explicit SQL in migration; setup() becomes no-op | ✓ |
| Hybrid: migration creates schema, setup() creates tables | Split responsibility | |

**User's choice:** Supabase migration 0008 creates the tables — versioned alongside app tables, visible in dashboard

---

| Option | Description | Selected |
|--------|-------------|----------|
| New env var in apps/api/.env | Add SUPABASE_DIRECT_URL alongside existing Supabase vars | ✓ |
| Same as DATABASE_URL if it already exists | Reuse existing var | |

**User's choice:** New env var in apps/api/.env (SUPABASE_DIRECT_URL)

---

## Claude's Discretion

- Exact Debate Blueprint `phase_sequence` definitions (phase ids, labels, llm_instructions per phase, allowed_node_types per phase) — Claude designs based on Debate/Strategy domain knowledge
- Exact `vercel.json` structure for Turborepo monorepo with Hono + Next.js — Claude researches the correct Node.js runtime config pattern
- Whether checkpointer tables go in migration 0008 alongside app tables, or in a separate 0009 migration — Claude decides based on migration scope

## Deferred Ideas

None — discussion stayed within phase scope.
