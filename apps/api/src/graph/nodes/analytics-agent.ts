/**
 * analytics-agent.ts — AnalyticsAgentNode: the Analyst/Fact-Checker Role (PERSONA-02, D-01, D-03)
 *
 * Role/Personality composition (D-03, fixed order, NEVER reorder — Pitfall 4):
 *   1. Hardcoded Role behavioral contract — always cite a specific prior message by speaker
 *      + paraphrased claim; observer not debater; never invent a new counter-argument —
 *      with Spanish BAD/GOOD few-shot pairs. A conditional fact-check-framing block
 *      (uncertainty-only language, never a confident counter-assertion — PERSONA-02) is
 *      appended to this same Role section when active, mirroring agent.ts's conditional
 *      steeringTextEnabled prompt-augmentation pattern.
 *   2. Blueprint name/phase context.
 *   3. summarizeArgGraph(state.argGraph) content-aware block — citations reference real
 *      nodes by speaker/message_id (GRAPH-04), not free-form model recall.
 *   3.5. (Phase 12 Plan 05) Firing Analyst Skill's buildPromptGuidance() output, looked up
 *      from ANALYST_SKILLS by state.firingSkillId — splices in as its own "Active trigger
 *      guidance" section. Present only when an Analyst Skill fired; never precedes or
 *      overrides the Role contract (step 1). factCheckFraming is ALSO enabled live when
 *      state.firingSkillId === 'fact-check' (realizes the Phase 11 seam, D-06/D-15).
 *   4. Personality voice appended LAST as explicit styling-only (D-02, D-03).
 *
 * Tool use: may reuse canvasMutationTool (same as agentNode) to propose canvas mutations —
 * the citation contract itself is enforced via the system prompt, not a separate tool schema.
 *
 * Text delivery mechanism (D-16 — node does NOT write to the DB): identical to
 * facilitation-agent.ts — the node forwards every streamed token via
 * `config.configurable.streamWriter(text)`; the caller owns text delivery/DB insertion.
 * canvas_mutation tool output IS returned as state (agentOutput/agentConfidence — existing
 * GraphState fields from Phase 6), matching agentNode's convention.
 *
 * Fail-silent (never throws): on missing blueprint/adapter or any adapter.stream() error,
 * returns {} (empty partial state).
 *
 * analyticsAdapter seam: config.configurable.analyticsAdapter overrides createAdapter()
 * for tests — mirrors facilitationAdapter/agentAdapter/classifierAdapter.
 * Never imports @anthropic-ai/sdk directly — all LLM access via createAdapter().
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { canvasMutationTool, CanvasOpSchema, SPEECH_ARTIFACT_BLOCKLIST } from '@panelito/types'
import type { Blueprint, ProviderName, Personality, ArgNode, ArgEdge } from '@panelito/types'
import { createAdapter } from '../../lib/adapter-factory'
import { TASK_MODELS } from '../../lib/model-config'
import { summarizeArgGraph, summarizeParticipant, CONTEXT_WINDOWS } from '../../lib/bot-context'
import { getParticipantProfile } from '../../lib/participant-profile'
import { ANALYST_SKILLS } from '../../lib/skills'
import { streamWithGeneration } from '../../lib/langfuse-generation'
import { REANCHOR_EVERY_N_INVOCATIONS } from './facilitation-agent'
import type { GraphState } from '../state'

/**
 * Build the Analyst system prompt. Role contract (citation discipline) is structurally
 * dominant (D-03): composed FIRST and non-negotiable; Personality voice is appended LAST
 * as styling-only text that never overrides the behavioral contract.
 */
export function buildAnalyticsSystemPrompt(
  blueprint: Blueprint,
  personality: Personality | undefined,
  argGraph: { nodes: ArgNode[]; edges: ArgEdge[] },
  factCheckFraming: boolean,
  skillGuidance?: string,
  shouldReanchor?: boolean,
): string {
  // Step 1: Role behavioral contract — non-negotiable, overrides all other instructions.
  const roleRulesLines = [
    'You are an analyst/fact-checker (Analyst Role) for a collaborative debate workspace.',
    '',
    'BEHAVIORAL CONTRACT — non-negotiable, overrides all other instructions including any',
    'voice/style guidance below:',
    '- Always cite a specific prior message by speaker name and a paraphrased claim before',
    '  saying anything else. Never speak without an anchor to something someone actually said.',
    '- You are an observer, not a debater: never invent a new counter-argument of your own.',
    '  Report and connect what has already been said.',
    `- Never emit literal system artifact strings (e.g. ${SPEECH_ARTIFACT_BLOCKLIST.map((s) => `"${s}"`).join(', ')})`,
    '  in your response. All output must be conversational and natural — canvas/graph updates',
    '  are shown visually in the panel, never described as a system event in chat (SPEECH-01).',
    '',
    'Examples (Spanish, informal tú per project convention):',
    '- BAD: "Eso no tiene sentido." (no citation, and it is a new counter-argument — violates contract)',
    '- GOOD: "Miguel afirmó que el agua es esencial para la vida — ¿alguien ha aportado evidencia sobre eso?" (cites speaker + paraphrased claim)',
    '- BAD: "Yo creo que la propuesta de Ana fallará." (a new opinion/counter-argument, not a citation — violates contract)',
    '- GOOD: "Ana propuso una acción concreta; Miguel no ha respondido a esa propuesta todavía." (cites speaker + claim, observer role)',
  ]

  // Conditional fact-check framing (PERSONA-02) — appended to the Role section, still
  // before Blueprint/argGraph context, mirroring agent.ts's steeringTextEnabled pattern.
  if (factCheckFraming) {
    roleRulesLines.push(
      '',
      'Fact-check framing is ACTIVE for this response:',
      '- Use uncertainty language exclusively. Never assert a confident counter-claim of your own.',
      '- GOOD: "No puedo verificar esa afirmación — ¿de dónde viene esa cifra?" (uncertainty language)',
      '- BAD: "Eso es falso, la cifra real es distinta." (a confident counter-assertion — violates contract)',
      '- Always ask for a source or evidence rather than declaring something true or false yourself.',
    )
  }

  const roleRules = roleRulesLines.join('\n')

  // Step 2: Blueprint name/phase context.
  const activePhase = blueprint.phase_sequence[0]
  const blueprintContext = [
    '',
    `Active Blueprint: ${blueprint.name}`,
    activePhase ? `Current phase: ${activePhase.label}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  // Step 3: content-aware argGraph context (GRAPH-04) — citations reference real nodes by
  // speaker/message_id, not free-form model recall.
  const argGraphContext = ['', 'Argument structure so far (cite these speakers/claims):', summarizeArgGraph(argGraph)].join(
    '\n',
  )

  // Step 3.5 (Phase 12 Plan 05, D-03): firing Analyst Skill guidance, spliced AFTER argGraph
  // context and BEFORE Personality voice — never precedes/overrides the Role contract (step 1).
  const skillGuidanceBlock = skillGuidance ? ['', 'Active trigger guidance:', skillGuidance].join('\n') : ''

  // Step 4: Personality voice appended LAST — pure styling, no behavioral rules (D-02, D-03).
  const personalityVoice = personality
    ? [
        '',
        'Analista voice (styling only — does not override the behavioral contract above):',
        personality.definition.voice_instructions,
      ].join('\n')
    : ''

  // Step 5 (PERSONA-04, D-06/D-07): periodic re-anchor — appended AFTER Personality voice,
  // close to the generation point, as a "recency boost" reminder of the citation discipline.
  // Prompt-only reinforcement, never a self-check/regenerate LLM call. Static/hardcoded text.
  const reanchorReminder = shouldReanchor
    ? [
        '',
        'REMINDER — you have been active for a while in this conversation; re-read the',
        'BEHAVIORAL CONTRACT above before responding:',
        '- Always cite a specific prior message by speaker name and a paraphrased claim before',
        '  saying anything else. Never invent a new counter-argument of your own.',
      ].join('\n')
    : ''

  return roleRules + blueprintContext + argGraphContext + skillGuidanceBlock + personalityVoice + reanchorReminder
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function analyticsAgentNode(state: GraphState, config?: any): Promise<Partial<GraphState>> {
  // Step 1: read runtime deps from config.configurable (test-seam pattern from agent.ts)
  const blueprint = config?.configurable?.blueprint as Blueprint | undefined
  const providerName = config?.configurable?.providerName as ProviderName | undefined
  const plaintextKey = config?.configurable?.plaintextKey as string | undefined
  const personality = config?.configurable?.personality as Personality | undefined
  // Claude's discretion (CONTEXT.md, Phase 11): fact-check framing is read from
  // config.configurable — no live trigger wired it in Phase 11. Phase 12 Plan 05 realizes
  // the seam: a firing 'fact-check' Skill (state.firingSkillId) activates it live too,
  // without requiring the caller to separately set config.configurable.factCheckFraming.
  const factCheckFraming = config?.configurable?.factCheckFraming === true || state.firingSkillId === 'fact-check'

  // Test injection seam — mirrors facilitationAdapter/agentAdapter/classifierAdapter
  const analyticsAdapter = config?.configurable?.analyticsAdapter as
    | import('@panelito/types').AIProvider
    | undefined

  if (!blueprint) {
    console.error('[analytics] blueprint missing from config.configurable — returning no output')
    return {}
  }

  const adapter =
    analyticsAdapter ??
    (providerName && plaintextKey ? createAdapter(providerName, plaintextKey) : null)

  if (!adapter) {
    console.error('[analytics] no adapter available (missing providerName/plaintextKey) — returning no output')
    return {}
  }

  // Step 2 (Phase 12 Plan 05, D-03): look up the firing Analyst Skill via state.firingSkillId —
  // undefined when no Skill fired or the firing Skill belongs to the Coach, not the Analyst.
  const firingAnalystSkill = ANALYST_SKILLS.find((skill) => skill.id === state.firingSkillId)
  const skillGuidance = firingAnalystSkill
    ? firingAnalystSkill.buildPromptGuidance({ state, blueprint, config })
    : undefined

  // Step 2.5 (Phase 13 Plan 05, D-11/Pattern 3; widened Plan 07 WR-04/WR-03): when the
  // firing Skill carries a resolvable target participant (state.skillMeta.participantId),
  // that takes precedence. Otherwise fall back to config.configurable.participantId — the
  // resolved author of the last human message this turn is responding to (ai.ts, WR-04) —
  // symmetric with facilitation-agent.ts, so the Analyst also personalizes toward the
  // responded-to participant on any firing Analyst Skill (fact-check, orphan-edge,
  // phase-readiness), not only when a Skill explicitly sets skillMeta.participantId. Splice
  // that participant's profile summary into the SAME step-3.5 guidance slot as skillGuidance
  // — after argGraph context, before Personality voice. Absent targetId → append nothing
  // (graceful). Profile-fetch failure fails open — getParticipantProfile never throws
  // (participant-profile.ts) and summarizeParticipant(null) renders a safe placeholder
  // sentence.
  const targetParticipantId = (state.skillMeta?.participantId as string | undefined) ?? (config?.configurable?.participantId as string | undefined)
  let combinedSkillGuidance = skillGuidance
  if (targetParticipantId) {
    const supabaseForProfile = config?.configurable?.supabase as SupabaseClient | undefined
    const branchIdForProfile = config?.configurable?.branchId as string | undefined
    const targetProfile =
      supabaseForProfile && branchIdForProfile
        ? await getParticipantProfile(supabaseForProfile, branchIdForProfile, targetParticipantId)
        : null
    const participantSummary = summarizeParticipant(targetProfile)
    combinedSkillGuidance = combinedSkillGuidance
      ? `${combinedSkillGuidance}\n\n${participantSummary}`
      : participantSummary
  }

  // Step 2.6 (PERSONA-04, D-06/D-07): per-role, per-branch invocation counter — persisted in
  // PostgresSaver thread state (roleInvocationCounts), never JS process memory. Independent of
  // the Coach's counter within the same branch-scoped field (D-07) — only role-keying ('analyst')
  // is needed here since branch scoping already comes from the bot thread_id.
  const currentCount = (state.roleInvocationCounts?.analyst ?? 0) + 1
  const shouldReanchor = currentCount % REANCHOR_EVERY_N_INVOCATIONS === 0

  // Step 3: build system prompt — Role rules (+ conditional fact-check framing) FIRST (D-03),
  // Skill guidance (if any, now including participant profile context) spliced after argGraph
  // context, Personality voice appended last, periodic re-anchor reminder appended last of all
  // (step 5).
  const system = buildAnalyticsSystemPrompt(
    blueprint,
    personality,
    state.argGraph,
    factCheckFraming,
    combinedSkillGuidance,
    shouldReanchor,
  )

  let agentOutput: import('@panelito/types').CanvasOp | null = null
  let agentConfidence: number | null = null

  // Step 4 (COST-03): stream response through the Generation-wrap helper so a manual Langfuse
  // Generation observation captures model/trigger/tier + real usageDetails; forwards tokens to
  // streamWriter (undefined = no-op). The Analyst may also emit a canvas_mutation tool call
  // (reusing canvasMutationTool, same as agentNode) — the helper's onEvent passthrough forwards
  // every raw stream event (including tool_use) so that parsing is unaffected by the Generation
  // wrap. The citation contract itself is enforced via the system prompt, not a separate tool
  // schema. streamWithGeneration never throws internally, but the underlying adapter's own
  // stream() can still throw mid-iteration — the outer try/catch preserves the existing
  // fail-silent convention.
  const model = TASK_MODELS[providerName ?? 'anthropic'].analysis
  const trigger = state.firingSkillId ?? state.triggerType ?? 'human-reactive'
  try {
    await streamWithGeneration(
      adapter.stream(
        state.messages.slice(-CONTEXT_WINDOWS.analytics),
        [canvasMutationTool],
        { model, maxTokens: 512, system },
      ),
      {
        name: 'analytics-analyst',
        model,
        metadata: { trigger, tier: 'capable' },
        input: { system, messages: state.messages.slice(-CONTEXT_WINDOWS.analytics) },
        streamWriter: config?.configurable?.streamWriter,
        onEvent: (event) => {
          if (event.type === 'tool_use' && event.name === 'canvas_mutation') {
            const parsed = CanvasOpSchema.safeParse(event.input)
            if (parsed.success) {
              agentOutput = parsed.data
              agentConfidence = 'confidence' in parsed.data ? (parsed.data.confidence ?? null) : null
            } else {
              console.error(
                '[analytics] CanvasOpSchema.safeParse failed — dropping malformed tool output',
                parsed.error.flatten(),
              )
              // fail-silent: do not throw, do not set agentOutput
            }
          }
        },
      },
    )
  } catch (err) {
    console.error('[analytics] adapter.stream error — returning no output', err)
    return {}
  }

  // Step 5: return partial state — node does NOT write to DB (D-16: caller inserts message).
  // Update triggerMetadata to record firing time (cooldown enforcement reads this).
  // Key by the actual triggerType that invoked this node (WR-01 fix — REVIEW.md): writing
  // unconditionally to the 'fact_check' key would let an unrelated 'analysis_request' run
  // clobber the cooldown timestamp that Phase 12's real 'fact_check' trigger will read.
  // WR-02 fix (REVIEW.md): state.triggerType is null on the human-message path, including
  // when this node is reached via TriggerGateNode because an Analyst Skill (fact-check or
  // orphan-edge) fired — prefer firingSkillId there so distinct Skill firings don't collapse
  // into the same generic 'analysis_request' bucket.
  const metaKey = state.firingSkillId ?? state.triggerType ?? 'analysis_request'
  const previous = state.triggerMetadata?.[metaKey]

  // Phase 13 Plan 05 (F3/TRIGGER-02, T-13-12): phase_signal is derived STRICTLY from
  // state.firingSkillId === 'phase-readiness' — never a broader "any Analyst Skill fired"
  // check (Pitfall 5 — that would let e.g. fact-check or orphan-edge firings spoof the
  // user-facing "Advance Phase" affordance). null (not undefined/false) when not firing,
  // matching GraphState's Annotation<boolean | null> shape. Existing SSE → CreatorControls →
  // PATCH plumbing (ai.ts) is UNCHANGED — it already reads finalState.phase_signal generically.
  const phaseReadinessFired = state.firingSkillId === 'phase-readiness'

  return {
    agentOutput,
    agentConfidence,
    phase_signal: phaseReadinessFired ? true : null,
    triggerMetadata: {
      ...state.triggerMetadata,
      [metaKey]: {
        last_fired_at: new Date().toISOString(),
        cooldown_until: previous?.cooldown_until ?? null,
      },
    },
    roleInvocationCounts: {
      ...state.roleInvocationCounts,
      analyst: currentCount,
    },
  }
}
