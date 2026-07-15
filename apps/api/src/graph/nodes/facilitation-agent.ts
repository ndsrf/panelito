/**
 * facilitation-agent.ts — FacilitationAgentNode: the Coach Role (PERSONA-01, D-01, D-03)
 *
 * Role/Personality composition (D-03, fixed order, NEVER reorder — Pitfall 4):
 *   1. Hardcoded Role behavioral contract (question-only, no conclusions, 1-3 sentences,
 *      reference specific content) with Spanish BAD/GOOD few-shot pairs.
 *   2. Blueprint name/phase context.
 *   3. summarizeArgGraph(state.argGraph) content-aware block (D-13/D-14).
 *   3.5. (Phase 12 Plan 05) Firing Coach Skill's buildPromptGuidance() output, looked up
 *      from COACH_SKILLS by state.firingSkillId — splices in as its own "Active trigger
 *      guidance" section. Present only when a Coach Skill fired; never precedes or
 *      overrides the Role contract (step 1).
 *   4. Personality voice appended LAST as explicit styling-only — never overrides the
 *      contract above (D-02, D-03).
 *
 * Text delivery mechanism (D-16 — node does NOT write to the DB): the node forwards every
 * streamed token via `config.configurable.streamWriter(text)`. The CALLER supplies this
 * closure and owns text delivery: for a human-invoked SSE request the closure forwards to
 * the SSE queue; for a future proactive invocation (silence-scan / TriggerEngine, Phase 14)
 * the caller supplies a closure that accumulates chunks into its own buffer, then inserts
 * the assembled message into `messages` after the node returns. The node itself never
 * returns response text as state — GraphState has no such field (Phase 11 Plan 01 scope).
 *
 * Fail-silent (never throws): on missing blueprint/adapter or any adapter.stream() error,
 * returns {} (empty partial state) — matches the `agent.ts`/`orchestrator.ts` convention.
 *
 * facilitationAdapter seam: config.configurable.facilitationAdapter overrides createAdapter()
 * for tests — mirrors agentAdapter/classifierAdapter in agent.ts/orchestrator.ts.
 * Never imports @anthropic-ai/sdk directly — all LLM access via createAdapter().
 */

import type { Blueprint, ProviderName, Personality, ArgNode, ArgEdge } from '@panelito/types'
import { createAdapter } from '../../lib/adapter-factory'
import { TASK_MODELS } from '../../lib/model-config'
import { summarizeArgGraph, CONTEXT_WINDOWS } from '../../lib/bot-context'
import { COACH_SKILLS } from '../../lib/skills'
import type { GraphState } from '../state'

/**
 * Build the Coach system prompt. Role rules are structurally dominant (D-03):
 * they are composed FIRST and are non-negotiable; Personality voice is appended
 * LAST as styling-only text that never overrides the behavioral contract.
 */
export function buildCoachSystemPrompt(
  blueprint: Blueprint,
  personality: Personality | undefined,
  argGraph: { nodes: ArgNode[]; edges: ArgEdge[] },
  skillGuidance?: string,
): string {
  // Step 1: Role behavioral contract — non-negotiable, overrides all other instructions.
  const roleRules = [
    'You are a facilitation coach (Coach Role) for a collaborative debate workspace.',
    '',
    'BEHAVIORAL CONTRACT — non-negotiable, overrides all other instructions including any',
    'voice/style guidance below:',
    '- Every response MUST end with a question mark. Never end with a statement, conclusion,',
    '  summary, or opinion.',
    '- Never give conclusions, verdicts, or answers. Only ask questions.',
    '- Keep responses to 1-3 sentences. Reference specific content from the conversation —',
    '  never ask a generic question mark that could apply to any state of the world.',
    '',
    'Examples (Spanish, informal tú per project convention):',
    '- BAD: "La conversación se ha estancado. Sigamos adelante." (statement — violates contract)',
    '- GOOD: "Miguel mencionó la calidad de la evidencia — ¿qué criterios usarían para evaluarla?" (question mark, references specific content)',
    '- BAD: "Creo que deberíamos concluir que la propuesta es sólida." (a conclusion — violates contract)',
    '- GOOD: "Han planteado dos posturas distintas sobre esto — ¿qué evidencia respalda mejor cada una?" (question mark, content-aware)',
    '- BAD: "Interesante punto de vista." (not a question — violates contract)',
    '- GOOD: "Ana propuso una acción concreta — ¿qué pasaría si alguien la pusiera en duda ahora mismo?" (question mark, references specific content)',
  ].join('\n')

  // Step 2: Blueprint name/phase context.
  const activePhase = blueprint.phase_sequence[0]
  const blueprintContext = [
    '',
    `Active Blueprint: ${blueprint.name}`,
    activePhase ? `Current phase: ${activePhase.label}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  // Step 3: content-aware argGraph context (D-13/D-14) — the single shared summary path.
  const argGraphContext = ['', 'Argument structure so far:', summarizeArgGraph(argGraph)].join('\n')

  // Step 3.5 (Phase 12 Plan 05, D-03): firing Coach Skill guidance, spliced AFTER argGraph
  // context and BEFORE Personality voice — never precedes/overrides the Role contract (step 1).
  const skillGuidanceBlock = skillGuidance ? ['', 'Active trigger guidance:', skillGuidance].join('\n') : ''

  // Step 4: Personality voice appended LAST — pure styling, no behavioral rules (D-02, D-03).
  const personalityVoice = personality
    ? [
        '',
        'Facilitador voice (styling only — does not override the behavioral contract above):',
        personality.definition.voice_instructions,
      ].join('\n')
    : ''

  return roleRules + blueprintContext + argGraphContext + skillGuidanceBlock + personalityVoice
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function facilitationAgentNode(state: GraphState, config?: any): Promise<Partial<GraphState>> {
  // Step 1: read runtime deps from config.configurable (test-seam pattern from agent.ts)
  const blueprint = config?.configurable?.blueprint as Blueprint | undefined
  const providerName = config?.configurable?.providerName as ProviderName | undefined
  const plaintextKey = config?.configurable?.plaintextKey as string | undefined
  const personality = config?.configurable?.personality as Personality | undefined

  // Test injection seam — mirrors agentAdapter/classifierAdapter in agent.ts/orchestrator.ts
  const facilitationAdapter = config?.configurable?.facilitationAdapter as
    | import('@panelito/types').AIProvider
    | undefined

  if (!blueprint) {
    console.error('[facilitation] blueprint missing from config.configurable — returning no output')
    return {}
  }

  const adapter =
    facilitationAdapter ??
    (providerName && plaintextKey ? createAdapter(providerName, plaintextKey) : null)

  if (!adapter) {
    console.error('[facilitation] no adapter available (missing providerName/plaintextKey) — returning no output')
    return {}
  }

  // Step 2: look up the firing Coach Skill (Phase 12 Plan 05, D-03) via state.firingSkillId —
  // undefined when no Skill fired or the firing Skill belongs to the Analyst, not the Coach.
  const firingCoachSkill = COACH_SKILLS.find((skill) => skill.id === state.firingSkillId)
  const skillGuidance = firingCoachSkill
    ? firingCoachSkill.buildPromptGuidance({ state, blueprint, config })
    : undefined

  // Step 3: build system prompt — Role rules FIRST (D-03), Skill guidance (if any) spliced
  // after argGraph context, Personality voice appended last.
  const system = buildCoachSystemPrompt(blueprint, personality, state.argGraph, skillGuidance)

  // Step 4: stream response; forward tokens to streamWriter (undefined = no-op, e.g. proactive
  // fire without a capturing closure supplied by the caller)
  try {
    for await (const event of adapter.stream(
      state.messages.slice(-CONTEXT_WINDOWS.facilitation),
      [], // no tools — Coach emits plain text only
      { model: TASK_MODELS[providerName ?? 'anthropic'].facilitation, maxTokens: 256, system },
    )) {
      if (event.type === 'text_delta') {
        config?.configurable?.streamWriter?.(event.text)
      }
    }
  } catch (err) {
    console.error('[facilitation] adapter.stream error — returning no output', err)
    return {}
  }

  // Step 5: return partial state — node does NOT write to DB (D-16: caller inserts message).
  // Update triggerMetadata to record firing time (cooldown enforcement reads this).
  const previous = state.triggerMetadata?.silence_gate
  return {
    triggerMetadata: {
      ...state.triggerMetadata,
      silence_gate: {
        last_fired_at: new Date().toISOString(),
        cooldown_until: previous?.cooldown_until ?? null,
      },
    },
  }
}
