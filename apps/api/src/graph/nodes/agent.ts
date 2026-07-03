/**
 * agent.ts — AgentNode: structured canvas mutation via canvasMutationTool (ORCH-03)
 *
 * Calls AIProvider.stream() with canvasMutationTool (D-05 — tool use, NOT withStructuredOutput).
 * Collects the canvas_mutation tool_use event, safeParses via CanvasOpSchema (T-06-08).
 * Parse failure is logged and dropped (fail-silent, no throw) per V5 Input Validation control.
 *
 * BLUE-03: Blueprint vocabulary injected into system prompt (node_types, edge_types).
 * BLUE-04: Active phase llm_instructions injected into system prompt.
 *
 * agentAdapter seam: config.configurable.agentAdapter overrides createAdapter() for tests.
 * Never imports @anthropic-ai/sdk directly — all LLM access via createAdapter().
 */

import { canvasMutationTool, CanvasOpSchema } from '@panelito/types'
import type { Blueprint, ProviderName } from '@panelito/types'
import { createAdapter } from '../../lib/adapter-factory'
import type { GraphState } from '../state'

/**
 * Build the agent system prompt.
 * BLUE-03: injects blueprint.node_types and edge_types ids + descriptions.
 * BLUE-04: injects the active phase's llm_instructions.
 * D-08: bans canvas meta-commentary in text output.
 * D-09: prefers silence when canvas mutation fully captures the insight.
 * D-10: accepts optional activePersonaInstructions appended after Blueprint phase instructions.
 */
export function buildAgentSystemPrompt(
  blueprint: Blueprint,
  currentPhaseId: string,
  activePersonaInstructions?: string,
): string {
  // Find the active phase (fallback to first)
  const activePhase =
    blueprint.phase_sequence.find((p) => p.id === currentPhaseId) ??
    blueprint.phase_sequence[0]

  const nodeTypeDescriptions = blueprint.node_types
    .map((n) => `  - ${n.id} (${n.label}): ${n.description}`)
    .join('\n')

  const edgeTypeDescriptions = blueprint.edge_types
    .map((e) => `  - ${e.id} (${e.label})`)
    .join('\n')

  const base = [
    'You are a knowledge-mapping agent for a collaborative workspace.',
    'Analyse the conversation and use the canvas_mutation tool to emit a structured canvas change.',
    '',
    `Blueprint: ${blueprint.name}`,
    '',
    'Allowed node types (use node_type_id from this list only):',
    nodeTypeDescriptions,
    '',
    'Allowed edge types (use edge_type_id from this list only):',
    edgeTypeDescriptions,
    '',
    `Active phase: ${activePhase?.label ?? 'Default'}`,
    `Phase instructions: ${activePhase?.llm_instructions ?? ''}`,
  ].join('\n')

  const rules = [
    'Rules:',
    '- Call canvas_mutation with op=ADD_NODE if a new concept matching a blueprint node type is introduced.',
    '- Call canvas_mutation with op=ADD_EDGE if a clear directional relationship between existing nodes is stated.',
    '- Call canvas_mutation with op=NO_ACTION if the message does not produce a clear canvas change.',
    '- Always include a confidence score (0.0–1.0). Be conservative: only commit-level confidence (>0.85) for very clear statements.',
    '- node_type_id and edge_type_id MUST exactly match a value from the allowed lists above.',
    // D-08: ban canvas meta-commentary
    '- NEVER describe your canvas operations in text. Do not say "I added a node", "I mapped this to",',
    '  "I connected", "I\'ve recorded", or describe what you did to the canvas.',
    // D-09: prefer silence
    '- Produce text output ONLY when the information cannot be fully represented in the canvas mutation.',
    '  If the canvas mutation fully captures the insight, produce NO text. Prefer silence.',
    '  When you do produce text, limit it to 1-2 sentences of substantive insight or implication.',
  ].join('\n')

  // D-10: append persona instructions after Blueprint phase instructions
  if (activePersonaInstructions) {
    return base + '\n\n' + rules + '\n\nPersona style:\n' + activePersonaInstructions
  }
  return base + '\n\n' + rules
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function agentNode(state: GraphState, config?: any): Promise<Partial<GraphState>> {
  const blueprint = config?.configurable?.blueprint as Blueprint | undefined
  const providerName = config?.configurable?.providerName as ProviderName | undefined
  const plaintextKey = config?.configurable?.plaintextKey as string | undefined

  // Test injection seam: allows passing a deterministic mock adapter
  const agentAdapter = config?.configurable?.agentAdapter as
    | import('@panelito/types').AIProvider
    | undefined

  if (!blueprint) {
    console.error('[agent] blueprint missing from config.configurable — returning no output')
    return {}
  }

  const adapter =
    agentAdapter ??
    (providerName && plaintextKey ? createAdapter(providerName, plaintextKey) : null)

  if (!adapter) {
    console.error('[agent] no adapter available (missing providerName/plaintextKey) — returning no output')
    return {}
  }

  // D-10: read activePersonas from config.configurable and build persona instructions
  const activePersonas = config?.configurable?.activePersonas as string[] | undefined
  const personaInstructions = activePersonas?.length ? activePersonas.join('\n') : undefined

  // D-11: read steeringTextEnabled from state — set by OrchestratorNode on DOMAIN_BRIDGE
  const steeringTextEnabled = state.steeringTextEnabled

  let system = buildAgentSystemPrompt(blueprint, state.currentPhaseId, personaInstructions)

  // D-11/D-12: when OrchestratorNode enabled steering text (DOMAIN_BRIDGE probability roll),
  // augment the system prompt with a facilitation instruction.
  // Steering text must be polite, redirective, and MUST NOT use "blueprint", "domain", or "ontology".
  if (steeringTextEnabled === true) {
    const activePhase =
      blueprint.phase_sequence.find((p) => p.id === state.currentPhaseId) ??
      blueprint.phase_sequence[0]
    system +=
      '\n\nSteering instruction: After your canvas mutation, produce a brief, friendly, facilitative sentence' +
      ' that gently guides participants back toward the active session goal.' +
      ` The active session goal is: ${activePhase?.llm_instructions ?? blueprint.name}.` +
      ' The steering text must be natural facilitation — polite and encouraging, never corrective or condescending.' +
      ' Do NOT use the words "blueprint", "domain", or "ontology" in your steering text.' +
      ' Example tone: "That\'s an interesting angle — it might help to frame this as a Hypothesis or Evidence."' +
      ' Limit the steering text to 1-2 sentences.'
  }

  let agentOutput: import('@panelito/types').CanvasOp | null = null
  let agentConfidence: number | null = null

  try {
    for await (const event of adapter.stream(state.messages, [canvasMutationTool], {
      model: 'claude-sonnet-4-6',
      maxTokens: 1024,
      system,
    })) {
      if (event.type === 'text_delta') {
        // D-05: Phase 7 streamWriter seam — routes tokens to SSE via route's async queue
        config?.configurable?.streamWriter?.(event.text)
      } else if (event.type === 'tool_use' && event.name === 'canvas_mutation') {
        // T-06-08: safeParse via CanvasOpSchema; parse failure logged and dropped (fail-silent)
        const parsed = CanvasOpSchema.safeParse(event.input)
        if (parsed.success) {
          agentOutput = parsed.data
          // Extract confidence from ADD_NODE and ADD_EDGE ops; NO_ACTION has none
          agentConfidence =
            'confidence' in parsed.data ? (parsed.data.confidence ?? null) : null
        } else {
          console.error(
            '[agent] CanvasOpSchema.safeParse failed — dropping malformed tool output',
            parsed.error.flatten()
          )
          // fail-silent: do not throw, do not set agentOutput
        }
        // Only process the first canvas_mutation tool call
        break
      }
    }
  } catch (err) {
    console.error('[agent] adapter.stream error — returning no output', err)
    return {}
  }

  return { agentOutput, agentConfidence }
}
