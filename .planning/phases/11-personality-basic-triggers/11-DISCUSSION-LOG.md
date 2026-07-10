# Phase 11: Personality + Basic Triggers - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-10
**Phase:** 11-Personality + Basic Triggers
**Areas discussed:** Bot voice & language, Silence-trigger content, Creator control & visibility, Live firing mechanism now, Extensibility for future personas (Role/Personality architecture)

---

## Bot voice & language

| Option | Description | Selected |
|--------|-------------|----------|
| Spanish, informal (tú) | Matches Analista Científico's tone and the rest of the UI | |
| Spanish, neutral/formal (usted) | More corporate-facilitator feel | |
| English | Diverges from existing persona/UI language | |

**User's choice:** "This needs to be configurable when we create the personas/bots. My aim is to even be able to recreate politicians, famous actors, etc. so we need to provide guidelines about how they should respond (tone, knowledge, behaviour etc)"

**Notes:** This answer reframed the whole area — it's what led to the Role/Personality architecture split later in the discussion. Follow-up locked a concrete default for Phase 11's two shipped personalities: **Spanish, informal (tú)**.

Follow-up: structured config (language, formality, socratic_discipline, knowledge_scope, catchphrases) vs single free-text string → **Yes, structured fields now**.

Follow-up: Spanish display names vs English role names → **Spanish names** (e.g. "Facilitador", "Analista/Verificador").

---

## Silence-trigger content

| Option | Description | Selected |
|--------|-------------|----------|
| Content-aware (reads recent messages/canvas) | References specific prior content | ✓ |
| Generic engagement prompt | "¿Alguien quiere añadir algo?" style | |
| You decide | Claude picks middle ground | |

**User's choice:** Content-aware

**Notes:** Follow-up on context source (argGraph summary vs raw recent messages vs both) → **Both**.

---

## Creator control & visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Toggleable, same drawer | Reuse "Analistas activos" Sheet pattern | ✓ (with modification) |
| Always-on for Blueprint sessions | No creator opt-out | |
| You decide | | |

**User's choice:** "Toggleable, same drawer. But the list of available bots, and the defaults (on/off) come from the blueprint."

**Notes:** This added a requirement beyond the original options — Blueprint must carry explicit per-Role default on/off state, not just presence in a list.

Cooldown visibility: **Read-only display in the same drawer** (not editable).

Follow-up: extend `active_persona_ids` semantics vs new explicit defaults map vs you-decide → **New explicit defaults map**.

---

## Live firing mechanism now

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal single-trigger scan loop now | setInterval in server.ts, same pattern as auto-freeze tracker | ✓ |
| Piggyback on existing message flow | setTimeout per branch after each message | |
| You decide | | |

**User's choice:** Minimal single-trigger scan loop now

**Notes:** Follow-up on delivery mechanism (SSE vs direct DB insert vs you-decide) → **Insert directly to messages table**, picked up via existing SSE-fallback/polling pattern (WSL2 precedent).

---

## Extensibility for future personas (became: Role/Personality architecture)

This area evolved significantly through clarifying dialogue rather than a single AskUserQuestion round.

**Initial question:** Should FacilitationAgentNode/AnalyticsAgentNode be two distinct node files, one generic parameterized node, or Claude's discretion?

**User's answer:** "Do whatever you think it will be easier. Maybe we should have node files for the Persona Types, while we can configure on top a personality. For example, I could have a Facilitation Agent Node with the personality of Brad Pitt. So we can code the behaviour and make it very specific for our use case, but also give the personal touch later in terms of personality."

**This introduced the Role vs. Personality split**, which the user then asked Claude to explain back conceptually (clarification exchange — "What is a persona? Are Personas the root core behaviours?"). Claude clarified: Role = fixed behavioral node type (code); Personality = voice/tone layer on top (data). User confirmed this matched their mental model using their own Einstein example ("Einstein Checker" = Fact-Checker Role + Einstein Personality).

**Follow-up questions and answers:**
- Should personalities live in isolation, decoupled from Roles, with Blueprint linking Personality→Role and Creator assigning via dropdown? → **Yes**, this became D-05.
- Is there anything that would preclude a Personality from being assigned to a particular Role? → Discussed; landed on: no hard preclusion needed IF Role behavioral contract always overrides Personality voice (see next).
- Personality storage: hardcoded TS list vs real Supabase table → **Real Supabase table now**.
- Precedence rule: does Role always override Personality, or can some future personality bend Role discipline? → **Yes — Role always wins.**
- Existing Analista Científico: migrate onto new Personality model now, or leave untouched? → **Migrate it onto the new personality config now** (data only — invocation path stays as-is per the user's original framing of this as a personality-data question).
- Shared PERSONA_LIBRARY vs separate registry for proactive bots → **not resolved via AskUserQuestion** (user interrupted this round to ask a clarifying conceptual question instead). Left as Claude's discretion in CONTEXT.md, since the DB-table decision (D-04) and Role/Personality decoupling (D-01/D-02) already answer the substance of this question — personalities are one list, referencing which Role(s) they can serve at the data level, not split into parallel registries.

---

## Claude's Discretion

- Exact copy/wording for "Facilitador" / "Analista/Verificador" display names and personality descriptions
- Exact Supabase schema for the new personalities table (columns, RLS)
- Exact Blueprint schema field name/shape for Role→default-Personality link and the bot_defaults-style map
- Exact session-level storage for creator's per-session Personality override per Role
- Scan loop interval/frequency and scope for the interim silence scanner
- How Fact-Checker framing mode within AnalyticsAgentNode gets triggered/tested absent a live fact-check trigger in Phase 11
- Two distinct node files (FacilitationAgentNode/AnalyticsAgentNode) vs shared internal helper — user said "do whatever is easier" as long as Role/Personality split is respected

## Deferred Ideas

- Full creator-facing personality creation/editing UI (custom personas, political/actor clones) — v3.0 out of scope per PROJECT.md
- Editable (not read-only) cooldown configuration UI — deferred past Phase 11
- Full TriggerEngine generalization (all 6 triggers) — Phase 14
- Migrating Analista Científico's invocation *mechanism* (not just its personality data) onto the new architecture — not requested
