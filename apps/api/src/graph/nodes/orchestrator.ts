/**
 * orchestrator.ts — OrchestratorNode: DOMAIN_MATCH / DOMAIN_BRIDGE / DOMAIN_DRIFT classification
 *
 * Reads blueprint + provider config from config.configurable.
 * Resolves the active Blueprint phase (BLUE-04): finds currentPhaseId in phase_sequence,
 * falls back to phase_sequence[0] if not found or missing.
 *
 * On DOMAIN_DRIFT: rolls Math.random() vs blueprint.drift_reply_probability (D-03).
 * Logs drift_probability / drift_roll / drift_action per D-04 — Langfuse span
 * capture is wired in plan 06-04 via CallbackHandler; Phase 6 uses console logging.
 *
 * Uses fail-open logging with [orchestrator] prefix per cap-guard.ts convention.
 * Never throws — on classification failure returns DOMAIN_BRIDGE as safe fallback.
 */

import type { Blueprint, ProviderName } from '@panelito/types'
import { createAdapter } from '../../lib/adapter-factory'
import type { GraphState } from '../state'

type GuardrailResult = 'DOMAIN_MATCH' | 'DOMAIN_BRIDGE' | 'DOMAIN_DRIFT'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function orchestratorNode(state: GraphState, config?: any): Promise<Partial<GraphState>> {
  const blueprint = config?.configurable?.blueprint as Blueprint | undefined
  const providerName = config?.configurable?.providerName as ProviderName | undefined
  const plaintextKey = config?.configurable?.plaintextKey as string | undefined

  // Seam for test injection: allow passing a pre-built adapter for the classifier
  const classifierAdapter = config?.configurable?.classifierAdapter as
    | import('@panelito/types').AIProvider
    | undefined

  if (!blueprint) {
    console.error('[orchestrator] blueprint missing from config.configurable — falling back to DOMAIN_BRIDGE')
    return { guardrailResult: 'DOMAIN_BRIDGE', driftAction: null }
  }

  // ---------------------------------------------------------------------------
  // BLUE-04: Resolve the active phase from blueprint.phase_sequence
  // Falls back to phase_sequence[0] when currentPhaseId is null/missing/unmatched
  // ---------------------------------------------------------------------------
  const resolvedPhase =
    blueprint.phase_sequence.find((p) => p.id === state.currentPhaseId) ??
    blueprint.phase_sequence[0]

  const resolvedPhaseId = resolvedPhase?.id ?? state.currentPhaseId

  // ---------------------------------------------------------------------------
  // Build classification system prompt
  // BLUE-03: inject blueprint node/edge type ids + active phase llm_instructions
  // ---------------------------------------------------------------------------
  const nodeTypeIds = blueprint.node_types.map((n) => n.id).join(', ')
  const edgeTypeIds = blueprint.edge_types.map((e) => e.id).join(', ')
  const phaseInstructions = resolvedPhase?.llm_instructions ?? ''

  const classificationSystemPrompt = [
    'You are a domain guardrail classifier for a collaborative knowledge-mapping workspace.',
    '',
    `Active Blueprint: ${blueprint.name}`,
    `Allowed node types: ${nodeTypeIds}`,
    `Allowed edge types: ${edgeTypeIds}`,
    `Active phase instructions: ${phaseInstructions}`,
    '',
    'Classify the last user message into exactly one of these categories:',
    '- DOMAIN_MATCH: The message clearly relates to the blueprint domain and can produce a canvas mutation.',
    '- DOMAIN_BRIDGE: The message is tangentially related and may be relevant to canvas mapping.',
    '- DOMAIN_DRIFT: The message is off-topic or unrelated to the blueprint domain.',
    '',
    'Respond with ONLY the classification label: DOMAIN_MATCH, DOMAIN_BRIDGE, or DOMAIN_DRIFT.',
  ].join('\n')

  // ---------------------------------------------------------------------------
  // Get last user message for classification
  // ---------------------------------------------------------------------------
  const lastMessage = state.messages[state.messages.length - 1]
  if (!lastMessage) {
    console.warn('[orchestrator] no messages in state — defaulting to DOMAIN_BRIDGE')
    return { guardrailResult: 'DOMAIN_BRIDGE', driftAction: null, currentPhaseId: resolvedPhaseId }
  }

  // ---------------------------------------------------------------------------
  // Classify via AIProvider adapter
  // ---------------------------------------------------------------------------
  let guardrailResult: GuardrailResult = 'DOMAIN_BRIDGE'

  try {
    const adapter =
      classifierAdapter ??
      (providerName && plaintextKey ? createAdapter(providerName, plaintextKey) : null)

    if (!adapter) {
      console.error('[orchestrator] no adapter available (missing providerName/plaintextKey) — defaulting to DOMAIN_BRIDGE')
      return {
        guardrailResult: 'DOMAIN_BRIDGE',
        driftAction: null,
        currentPhaseId: resolvedPhaseId,
      }
    }

    let classificationText = ''
    for await (const event of adapter.stream(
      [{ role: 'user', content: lastMessage.content }],
      [],
      {
        model: 'claude-sonnet-4-6',
        maxTokens: 32,
        system: classificationSystemPrompt,
      }
    )) {
      if (event.type === 'text_delta') {
        classificationText += event.text
      }
    }

    const normalized = classificationText.trim().toUpperCase()
    if (
      normalized === 'DOMAIN_MATCH' ||
      normalized === 'DOMAIN_BRIDGE' ||
      normalized === 'DOMAIN_DRIFT'
    ) {
      guardrailResult = normalized
    } else {
      // Partial match — extract first occurrence
      const match = normalized.match(/DOMAIN_(MATCH|BRIDGE|DRIFT)/)
      if (match) {
        guardrailResult = `DOMAIN_${match[1]}` as GuardrailResult
      } else {
        console.warn(
          `[orchestrator] unexpected classification response: "${classificationText}" — defaulting to DOMAIN_BRIDGE`
        )
        guardrailResult = 'DOMAIN_BRIDGE'
      }
    }
  } catch (err) {
    // Fail-open: classification error → treat as DOMAIN_BRIDGE (allow agent to run)
    console.error('[orchestrator] classification error — failing open to DOMAIN_BRIDGE', err)
    guardrailResult = 'DOMAIN_BRIDGE'
  }

  // ---------------------------------------------------------------------------
  // D-03: DOMAIN_DRIFT probability roll
  // D-04: Log drift_probability / drift_roll / drift_action for Langfuse span
  // ---------------------------------------------------------------------------
  let driftAction: 'replied' | 'ignored' | null = null

  if (guardrailResult === 'DOMAIN_DRIFT') {
    const driftProbability = blueprint.drift_reply_probability ?? 0.8
    const driftRoll = Math.random()
    driftAction = driftRoll < driftProbability ? 'replied' : 'ignored'

    // D-04: log for Langfuse span capture (Phase 6: console; Phase 7: CallbackHandler span attributes)
    console.info('[orchestrator] drift event', {
      drift_probability: driftProbability,
      drift_roll: driftRoll,
      drift_action: driftAction,
    })
  }

  return {
    guardrailResult,
    driftAction,
    currentPhaseId: resolvedPhaseId,
  }
}
