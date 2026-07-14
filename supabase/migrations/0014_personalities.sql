-- Migration: 0014_personalities
-- Adds the personalities table (voice/tone data for bot Roles), seeds three
-- personalities (coach_default, analyst_default, and the D-06 migrated
-- Analista Científico voice), extends the debate-strategy-v1 Blueprint with
-- bot_defaults / role_personalities / bot_cooldowns, and adds a per-session
-- bot on/off override column distinct from the existing active_personas.
--
-- Design: personalities mirrors domain_blueprints' shape exactly
-- (id text PK, name text, definition jsonb) — D-04 requires personalities
-- to live in a real table (not a hardcoded TS list) so a future management
-- feature needs no later migration. Each definition carries VOICE/TONE data
-- only (language, formality, voice_instructions, catchphrases,
-- knowledge_scope) — NO behavioral rules. Behavioral rules for each Role
-- (e.g. "Coach never gives answers, only asks questions") live in the
-- Role's hardcoded system prompt discipline block (facilitation-agent.ts,
-- Plan 04), composed BEFORE the Personality voice text.
--
-- D-06: analista_cientifico here is a DATA-ONLY migration of the existing
-- reactive persona's voice (see packages/types/src/persona.ts
-- PERSONA_LIBRARY). Its invocation path is untouched by this migration.
--
-- Trust boundary: personalities is readable by any authenticated user
-- (voice/tone strings only — no secrets or PII) but has NO INSERT/UPDATE/
-- DELETE policy, so writes require service role — same pattern as
-- domain_blueprints (migration 0008).

-- ---------------------------------------------------------------------------
-- SECTION 1: personalities
-- Platform-global personality library. Mirrors domain_blueprints shape.
-- RLS: any authenticated user can SELECT; no write policy means writes
-- require service role (bypasses RLS entirely).
-- T-11-04: Elevation of Privilege mitigation — SELECT-only RLS policy.
-- ---------------------------------------------------------------------------
CREATE TABLE public.personalities (
  id          text        PRIMARY KEY,
  name        text        NOT NULL,
  definition  jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.personalities IS
  'Voice/tone-only data for a bot Role (Coach, Analyst, ...). Distinct from '
  'the older persona.ts/PERSONA_LIBRARY system (D-06). Carries NO behavioral '
  'rules — those live in the Role''s hardcoded system prompt (facilitation-agent.ts).';

ALTER TABLE public.personalities ENABLE ROW LEVEL SECURITY;

-- SELECT allowed for all authenticated users; no INSERT/UPDATE/DELETE policy.
CREATE POLICY "personalities_select"
  ON public.personalities
  FOR SELECT
  USING (auth.uid() IS NOT NULL);


-- ---------------------------------------------------------------------------
-- SECTION 2: Seed three personalities
-- (1) coach_default — Socratic, empathetic Coach voice (PERSONA-01)
-- (2) analyst_default — neutral, data-driven Analyst voice (PERSONA-01)
-- (3) analista_cientifico — D-06 migration of the existing reactive
--     persona's voice (source: packages/types/src/persona.ts
--     PERSONA_LIBRARY 'analista_cientifico' displayName/description/
--     systemPromptAddition). Only the VOICE representation is migrated;
--     its invocation path stays on the old persona.ts system.
-- All three: Spanish, informal tú (D-07); no behavioral-rule keys (D-02/D-03).
-- ---------------------------------------------------------------------------
INSERT INTO public.personalities (id, name, definition) VALUES
(
  'coach_default',
  'Facilitador',
  '{
    "language": "es",
    "formality": "informal",
    "voice_instructions": "Habla en tono cercano y cálido, siempre de tú. Haz preguntas abiertas en vez de dar respuestas directas. Usa frases breves que inviten a la reflexión, como \"¿qué te hace pensar eso?\" o \"¿cómo se conecta esto con lo que decías antes?\". Evita sonar autoritario o dar la razón a nadie de forma explícita.",
    "catchphrases": ["¿qué opinas tú de eso?", "sigamos por ahí"],
    "knowledge_scope": "facilitación de conversación y dinámica de grupo"
  }'::jsonb
),
(
  'analyst_default',
  'Analista/Verificador',
  '{
    "language": "es",
    "formality": "informal",
    "voice_instructions": "Habla en tono neutral, claro y directo, siempre de tú. Prefiere frases cortas y estructuradas. Cuando compares posturas, usa listas o comparaciones explícitas (\"por un lado... por otro...\"). No tomes partido ni uses lenguaje emocional.",
    "catchphrases": ["vamos a verificar eso", "los datos dicen"],
    "knowledge_scope": "verificación de datos y seguimiento de acuerdos/desacuerdos"
  }'::jsonb
),
(
  'analista_cientifico',
  'Analista Científico',
  '{
    "language": "es",
    "formality": "informal",
    "voice_instructions": "Mantén un tono clínico, riguroso y objetivo, siempre de tú. Prefiere comparaciones estructuradas, porcentajes y listas ordenadas al presentar información. No tomes partido; muestra tanto la evidencia a favor como la que contradice.",
    "catchphrases": [],
    "knowledge_scope": "análisis de datos, detección de falacias y sesgos cognitivos, estructuración de información cuantitativa"
  }'::jsonb
);


-- ---------------------------------------------------------------------------
-- SECTION 3: Extend debate-strategy-v1 Blueprint with bot config (PERSONA-03)
-- Adds bot_defaults (which Roles run by default), role_personalities
-- (Role -> default Personality id), and bot_cooldowns (Coach 3/15,
-- Analyst 2/15) directly to the seeded Blueprint's definition jsonb
-- (D-05, D-10, D-11 — Finding 5: Blueprint is the real DB source of truth).
-- ---------------------------------------------------------------------------
UPDATE public.domain_blueprints
SET definition = definition || '{
  "bot_defaults": { "coach": true, "analyst": true },
  "role_personalities": { "coach": "coach_default", "analyst": "analyst_default" },
  "bot_cooldowns": {
    "coach": { "max": 3, "window_minutes": 15 },
    "analyst": { "max": 2, "window_minutes": 15 }
  }
}'::jsonb
WHERE id = 'debate-strategy-v1';


-- ---------------------------------------------------------------------------
-- SECTION 4: sessions.bot_overrides — per-session bot on/off override
-- Distinct from sessions.active_personas (migration 0005, the OLD reactive-
-- persona system, D-06). Resolution rule: effective on/off for a Role =
-- bot_overrides[role] if present, else blueprint.bot_defaults[role],
-- else false.
-- T-11-05: Tampering mitigation — write path (Plan 07 route) enforces
-- session.creator_id === user.id before writing; this migration adds the
-- column only.
-- ---------------------------------------------------------------------------
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS bot_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.sessions.bot_overrides IS
  'Per-session bot on/off override, keyed by Role id (coach/analyst). '
  'Distinct from active_personas (the older reactive-persona system, D-06). '
  'Resolution: effective on/off = bot_overrides[role] if present, else '
  'blueprint.bot_defaults[role], else false.';
