---
phase: quick-260720-oha
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/routes/ai.ts
  - apps/api/src/graph/nodes/facilitation-agent.ts
  - apps/api/src/graph/nodes/analytics-agent.ts
  - apps/api/src/graph/nodes/facilitation-agent.test.ts
autonomous: true
requirements: [PERSONA-01]

must_haves:
  truths:
    - "When a Coach Skill fires on the human /invoke path, facilitationAgentNode receives the coach_default personality (voice_instructions/catchphrases) instead of undefined or the analyst's personality"
    - "When an Analyst Skill fires on the human /invoke path, analyticsAgentNode still receives the analyst_default personality (22c7cb1 behavior preserved)"
    - "trigger-engine.ts's proactive silence-gate path still delivers the coach personality to facilitationAgentNode unchanged"
  artifacts:
    - path: "apps/api/src/routes/ai.ts"
      provides: "resolveCoachPersonality helper + role-specific personality keys in graphConfig.configurable"
      contains: "resolveCoachPersonality"
    - path: "apps/api/src/graph/nodes/facilitation-agent.ts"
      provides: "role-aware personality read (coachPersonality first, generic fallback)"
      contains: "coachPersonality"
    - path: "apps/api/src/graph/nodes/analytics-agent.ts"
      provides: "role-aware personality read (analystPersonality first, generic fallback)"
      contains: "analystPersonality"
  key_links:
    - from: "apps/api/src/routes/ai.ts"
      to: "apps/api/src/graph/nodes/facilitation-agent.ts"
      via: "graphConfig.configurable.coachPersonality"
      pattern: "coachPersonality"
    - from: "apps/api/src/routes/ai.ts"
      to: "apps/api/src/graph/nodes/analytics-agent.ts"
      via: "graphConfig.configurable.analystPersonality"
      pattern: "analystPersonality"
---

<objective>
Fix the Coach (facilitationAgentNode) personality-wiring gap on the human `/invoke` path — a
near-exact repeat of the Analyst bug fixed in commit 22c7cb1
(`.planning/debug/resolved/analyst-personality-wiring.md`), for the Coach role.

Purpose: `facilitation-agent.ts:131` reads `config?.configurable?.personality`, expecting the
coach's resolved Personality (voice_instructions/catchphrases from the `coach_default` row). On the
human `/invoke` path the only config object that reaches it is `ai.ts`'s `graphConfig.configurable`,
which — after 22c7cb1 — hardcodes `personality` to the *analyst* personality. So when a Coach Skill
fires via `routeAfterTriggerGate`'s `'facilitation'` branch, the Coach silently renders either with
the wrong (analyst) voice or none at all, dropping its `role_personalities.coach`-resolved voice.

Root design fact (confirmed by reading the code, not assumed): `configurable.personality` is a
SINGLE shared key read by BOTH `facilitationAgentNode` (line 131) and `analyticsAgentNode`
(line 150). On the human `/invoke` path, exactly ONE of these two role nodes fires per turn, chosen
at graph *runtime* by `routeAfterTriggerGate` based on `state.firingSkillRole` — which `ai.ts`
cannot know when it builds `graphConfig` up front. A single shared personality key is therefore
fundamentally ambiguous and cannot serve both roles. The wiring MUST become role-aware: resolve
BOTH personalities and thread them under role-specific keys, and have each node read its own key.

Output: `ai.ts` gains a `resolveCoachPersonality` helper (mirror of the existing
`resolveAnalystPersonality`, keyed to `role_personalities.coach`) and threads both
`coachPersonality` and `analystPersonality` into `configurable`; each consumer node reads its own
role-specific key first, falling back to the generic `personality` key so trigger-engine's proactive
path and the existing node test seams stay intact.
</objective>

<execution_context>
@/home/jgm/dev/projects/web-projects/panelito/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/debug/resolved/analyst-personality-wiring.md

# The just-landed analyst fix to mirror (commit 22c7cb1)
@apps/api/src/routes/ai.ts

# The Coach node with the gap (reads config.configurable.personality at line 131)
@apps/api/src/graph/nodes/facilitation-agent.ts

# The Analyst node — its read must switch to the analyst-specific key (line 150)
@apps/api/src/graph/nodes/analytics-agent.ts

<interfaces>
<!-- The reference helper already in ai.ts (22c7cb1). resolveCoachPersonality is byte-for-byte
     identical except `.analyst` becomes `.coach`. trigger-engine.ts:591 already has the exact
     coach version — do NOT import from there (keep ai.ts self-contained, mirroring 22c7cb1). -->

From apps/api/src/routes/ai.ts (existing, keep):
```typescript
async function resolveAnalystPersonality(
  supabase: SupabaseClient,
  blueprint: Blueprint
): Promise<Personality | undefined> {
  const personalityId = blueprint.role_personalities?.analyst
  if (!personalityId) return undefined
  const { data, error } = await supabase
    .from('personalities')
    .select('id, name, definition')
    .eq('id', personalityId)
    .maybeSingle()
  if (error || !data) return undefined
  const parsed = PersonalitySchema.safeParse(data)
  return parsed.success ? parsed.data : undefined
}
```

Current graphConfig.configurable (ai.ts ~line 437-454) sets:
  personality: analystPersonality,   // <-- the ambiguous single shared key to replace

Consumers of config.configurable.personality (grep-confirmed, ONLY these two in production):
  - facilitation-agent.ts:131  const personality = config?.configurable?.personality as Personality | undefined
  - analytics-agent.ts:150     const personality = config?.configurable?.personality as Personality | undefined

trigger-engine.ts (DO NOT TOUCH) sets configurable.personality = coachPersonality on its own
proactive silence-gate path, and only ever routes to facilitation — so the generic-key fallback in
facilitation-agent.ts keeps that path working unchanged.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add resolveCoachPersonality + thread role-specific keys in ai.ts</name>
  <files>apps/api/src/routes/ai.ts</files>
  <action>
Mirror commit 22c7cb1 exactly for the coach role. (1) Add a `resolveCoachPersonality(supabase,
blueprint)` helper directly beside the existing `resolveAnalystPersonality` (after line ~83) —
byte-for-byte identical to `resolveAnalystPersonality` except it reads
`blueprint.role_personalities?.coach` instead of `.analyst`. Do NOT import trigger-engine.ts's
version — keep ai.ts self-contained per the 22c7cb1 pattern. Add a short doc comment noting it
mirrors trigger-engine.ts's resolveCoachPersonality and closes the same-pattern Coach gap flagged in
the analyst-personality-wiring blind_spots. (2) Inside the SSE handler, immediately after the
existing `const analystPersonality = await resolveAnalystPersonality(supabase, blueprint)` line
(~422), add `const coachPersonality = await resolveCoachPersonality(supabase, blueprint)`. (3) In the
`graphConfig.configurable` object literal (~437-454), REPLACE the single ambiguous
`personality: analystPersonality,` line with two role-specific keys: `coachPersonality,` and
`analystPersonality,` (shorthand). Update the inline comment to explain that the personality wiring
is now role-aware because `routeAfterTriggerGate` picks Coach OR Analyst at graph runtime — a single
shared key cannot serve both. Do not touch trigger-engine.ts or any other file in this task.
  </action>
  <verify>
    <automated>cd apps/api && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v '^#' | grep -c "src/routes/ai.ts" | grep -qx 0 && echo "ai.ts typechecks clean"</automated>
  </verify>
  <done>ai.ts defines resolveCoachPersonality (keyed to role_personalities.coach), resolves coachPersonality in the SSE handler, and graphConfig.configurable carries both `coachPersonality` and `analystPersonality` (no bare `personality:` key remaining on this path). apps/api typecheck reports no errors in ai.ts.</done>
</task>

<task type="auto">
  <name>Task 2: Make both consumer nodes read their role-specific key + lock with tests</name>
  <files>apps/api/src/graph/nodes/facilitation-agent.ts, apps/api/src/graph/nodes/analytics-agent.ts, apps/api/src/graph/nodes/facilitation-agent.test.ts</files>
  <action>
(1) In facilitation-agent.ts line 131, change the personality read to prefer the coach-specific key
with a fallback to the generic key:
`const personality = (config?.configurable?.coachPersonality ?? config?.configurable?.personality) as Personality | undefined`.
The `?? config?.configurable?.personality` fallback is load-bearing: it preserves trigger-engine.ts's
proactive path (which sets the generic `personality` = coach and only routes to facilitation) and the
existing node test seam. Add a one-line comment explaining the role-aware read and why the fallback
exists.
(2) In analytics-agent.ts line 150, symmetrically change to
`const personality = (config?.configurable?.analystPersonality ?? config?.configurable?.personality) as Personality | undefined`
with an equivalent comment. This is required because Task 1 renamed ai.ts's analyst key from the
generic `personality` to `analystPersonality`; the generic fallback preserves all existing analytics
test seams (which never set the generic key, so behavior is unchanged there).
(3) In facilitation-agent.test.ts, add ONE regression test that proves role-awareness: invoke
facilitationAgentNode with `configurable.coachPersonality` set to a coach personality fixture (reuse
the existing `casualPersonality`-style fixture pattern already in the file near line 250) AND
`configurable.analystPersonality` set to a DISTINCT/decoy personality, then assert the coach's
`voice_instructions` text reaches the built system prompt while the decoy analyst voice does NOT.
Keep the existing generic-`personality` test (line ~250) as-is to prove the fallback still works.
Do not touch trigger-engine.ts.
  </action>
  <verify>
    <automated>cd apps/api && npx vitest run src/graph/nodes/facilitation-agent.test.ts src/graph/nodes/analytics-agent.test.ts src/lib/trigger-engine.test.ts src/graph/graph.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>facilitation-agent.ts reads coachPersonality (generic fallback retained); analytics-agent.ts reads analystPersonality (generic fallback retained); the new facilitation regression test proves the coach voice — not the decoy analyst voice — reaches the Coach system prompt; the pre-existing generic-personality test still passes; facilitation/analytics/trigger-engine/graph test suites are green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| creator DB row → LLM system prompt | The `personalities.definition.voice_instructions` text is DB-owned creator content, spliced into the Coach system prompt as explicit styling-only guidance (facilitation-agent.ts step 4). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-oha-01 | Tampering | coach voice_instructions overriding the Coach behavioral contract | mitigate | No new mitigation needed — buildCoachSystemPrompt already composes the non-negotiable Role contract (step 1) FIRST and appends personality voice LAST as explicit "styling only — does not override the behavioral contract" text (facilitation-agent.ts:101-108, D-02/D-03). This fix only changes WHICH personality object is passed, not the composition order. |
| T-oha-02 | Information disclosure | wrong-role personality bleed (Coach rendered with Analyst voice) | mitigate | Role-specific config keys (coachPersonality/analystPersonality) + each node reading its own key eliminates the shared-key ambiguity that caused the bug. |
| T-oha-SC | Tampering | npm/pip/cargo installs | accept | No new packages installed — pure source edits reusing existing imports (PersonalitySchema, Personality, SupabaseClient, Blueprint all already imported in ai.ts). |
</threat_model>

<verification>
- `cd apps/api && npx tsc --noEmit` — clean (no new type errors introduced by the three edits).
- Coach path: a fired Coach Skill on the human /invoke path now yields a facilitationAgentNode
  system prompt containing the coach_default voice_instructions (asserted by the new node test).
- Analyst path: 22c7cb1 behavior preserved — analyticsAgentNode still receives analyst_default
  (analytics-agent + graph suites green).
- Proactive path untouched: trigger-engine.test.ts still passes (generic-key fallback intact).
- Known pre-existing gap (from 22c7cb1 notes): ai.test.ts SC-2/SC-3 fail independently of this change
  (buildSupabaseMock 'branches' returns not-found → 404 before graphConfig is built). Not a
  regression from this plan; do not attempt to fix here.
</verification>

<success_criteria>
- resolveCoachPersonality exists in ai.ts, mirroring resolveAnalystPersonality, keyed to `role_personalities.coach`.
- graphConfig.configurable threads both `coachPersonality` and `analystPersonality`; no ambiguous shared `personality` key remains on the human /invoke path.
- facilitationAgentNode reads coachPersonality (generic fallback); analyticsAgentNode reads analystPersonality (generic fallback).
- New regression test proves the Coach receives its own voice, not a decoy analyst voice.
- typecheck clean; facilitation/analytics/trigger-engine/graph test suites green.
- trigger-engine.ts is NOT modified.
</success_criteria>

<output>
Create `.planning/quick/260720-oha-fix-the-facilitation-agent-coach-persona/260720-oha-SUMMARY.md` when done.
</output>
