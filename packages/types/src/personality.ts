import { z } from 'zod'

// -----------------------------------------------------------------------
// Personality — voice/tone data for a bot Role (Coach, Analyst, ...) (D-04)
//
// Mirrors domain_blueprints' jsonb-definition shape: a `personalities` DB table
// with { id text PK, name text, definition jsonb }. `id` is z.string() (DB text
// PK, runtime-resolved) — NOT a compile-time enum, matching blueprint.ts's
// active_persona_ids precedent ("text IDs resolved at runtime, not compile-time
// enum" — blueprint.ts line ~50-52).
//
// Per D-02/D-03: Personality carries NO behavioral rules — voice/tone ONLY.
// Behavioral rules (e.g. "Coach never gives answers, only asks questions") live
// in the Role's system prompt discipline block (facilitation-agent.ts, Plan 04),
// hardcoded and composed BEFORE the Personality voice text (Pitfall 4 —
// recency bias means Personality text must never precede Role rules).
//
// D-06: this is a DISTINCT system from packages/types/src/persona.ts's
// PersonaConfig/PERSONA_LIBRARY (the older, hardcoded single-persona system).
// Do NOT converge or rename either system in this phase.
// -----------------------------------------------------------------------

export const PersonalitySchema = z.object({
  id: z.string(),
  name: z.string(),
  definition: z.object({
    language: z.string(),
    formality: z.string(),
    voice_instructions: z.string(),
    catchphrases: z.array(z.string()).default([]),
    knowledge_scope: z.string().optional(),
  }),
})

export type Personality = z.infer<typeof PersonalitySchema>
