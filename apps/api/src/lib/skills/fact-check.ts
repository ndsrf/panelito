/**
 * fact-check.ts — fact-check Analyst Skill: three-tier escalation gate (TRIGGER-05,
 * COST-01/COST-02, D-12/D-15).
 *
 * Tier 1 (D-12): `looksLikeCheckableClaim()` — a PURE, zero-I/O heuristic pre-filter
 * (numbers+units, dates/years, absolute qualifiers, capitalized entity-like phrases).
 * A non-match makes ZERO adapter calls (COST-01) — this is the cost-tier gate this
 * Skill exists to enforce; nothing here should ever let a message reach an LLM before
 * passing tier 1 first.
 *
 * Tier 2: only runs when tier 1 matched. Calls the injected classifier adapter with
 * `factCheckClassificationTool`, resolving `TASK_MODELS[provider].classification` (the
 * LIGHT tier) — never `.analysis`. Tool output is Zod-validated with ONE retry, then
 * fails CLOSED (mirrors arg-graph-builder.ts's attemptExtraction() retry-with-correction
 * idiom, scaled down for this cheap binary classifier).
 *
 * Tier 3 (D-06): detect() does NOT call tier 3 itself — it is detection-only. On a
 * confirmed positive it returns `{ fires: true, meta: { claimMessageId } }`; Plan 06's
 * TriggerGateNode routes into the EXISTING `analyticsAgentNode` (already resolving
 * `TASK_MODELS[provider].analysis`), which reads `config.configurable.factCheckFraming`
 * (Phase 11's seam, "a future trigger (Phase 12) sets it" — this Skill is that trigger,
 * wired live by Plan 05).
 *
 * T-12-09 (threat model): tier-2/tier-3 model resolution is a BYOK billing surface — a
 * reversed tier mapping silently inflates the creator's invoice with no type/runtime
 * signal otherwise. fact-check.test.ts asserts the correct per-provider mapping
 * deterministically (Pitfall 7, AI-SPEC Dimension 5).
 */

import { z } from 'zod'
import { factCheckClassificationTool } from '@panelito/types'
import type { AIProvider, ProviderName, ProviderMessage, SkillDetectionResult } from '@panelito/types'
import { createAdapter } from '../adapter-factory'
import { TASK_MODELS } from '../model-config'
import { summarizeArgGraph } from '../bot-context'
import type { Skill, SkillContext } from '../skills'

const MAX_ATTEMPTS = 2 // initial attempt + ONE retry, then fail closed

// ---------------------------------------------------------------------------
// Tier 1 — pure heuristic pre-filter (D-12). Zero I/O, zero adapter calls.
// ---------------------------------------------------------------------------

const NUMBER_UNIT_PATTERN =
  /\d+(?:[.,]\d+)?\s?(%|por ciento|millones?|miles?|mil|años?|kg|km|m2|m²|dólares?|usd|euros?|€|\$)/i
const DATE_YEAR_PATTERN = /\b(19|20)\d{2}\b/
const ABSOLUTE_QUALIFIER_PATTERN =
  /\b(siempre|nunca|jamás|nadie|todos saben que|todo el mundo sabe|todo el mundo dice)\b/i
// Two-or-more consecutive capitalized-word phrases — a lightweight entity-like signal
// (e.g. "Naciones Unidas", "Banco Mundial"). Deliberately requires 2+ words so ordinary
// sentence-initial capitalization alone doesn't trip tier 1 on every message.
const CAPITALIZED_ENTITY_PATTERN = /\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)+\b/

/**
 * looksLikeCheckableClaim — tier 1 of the escalation gate (D-12). Pure function: no
 * adapter/Supabase/embedding calls. Matches claim-shaped patterns; a false positive
 * here only costs a cheap tier-2 classifier call (COST-02), never an LLM directly.
 */
export function looksLikeCheckableClaim(text: string): boolean {
  return (
    NUMBER_UNIT_PATTERN.test(text) ||
    DATE_YEAR_PATTERN.test(text) ||
    ABSOLUTE_QUALIFIER_PATTERN.test(text) ||
    CAPITALIZED_ENTITY_PATTERN.test(text)
  )
}

// ---------------------------------------------------------------------------
// Tier 2 — light classifier escalation (COST-02: TASK_MODELS[provider].classification)
// ---------------------------------------------------------------------------

const ClassifyOutputSchema = z.object({
  needs_fact_check: z.boolean(),
  confidence: z.number().min(0).max(1),
})

type ClassifyOutput = z.infer<typeof ClassifyOutputSchema>

function buildTier2SystemPrompt(): string {
  return [
    'You are a lightweight pre-filter that decides whether a flagged message contains a',
    'concrete, verifiable factual claim worth escalating to a full fact-check response,',
    'or whether it is a false positive (an opinion, a rhetorical exaggeration, or a claim',
    'too vague to verify). Call classify_fact_check_need with your decision.',
  ].join('\n')
}

/**
 * classifyTier2 — calls the injected classifier adapter with factCheckClassificationTool,
 * Zod-validates the tool output (T-12-02), and retries ONCE on a missing/invalid tool
 * call or an adapter error before failing CLOSED (returns null — never throws).
 */
async function classifyTier2(
  adapter: AIProvider,
  model: string,
  claimText: string
): Promise<ClassifyOutput | null> {
  const messages: ProviderMessage[] = [{ role: 'user', content: claimText }]

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      let toolInput: unknown = null

      for await (const event of adapter.stream(messages, [factCheckClassificationTool], {
        model,
        maxTokens: 64,
        system: buildTier2SystemPrompt(),
      })) {
        if (event.type === 'tool_use' && event.name === 'classify_fact_check_need') {
          toolInput = event.input
          break
        }
      }

      if (toolInput === null) {
        console.warn(`[fact-check] tier-2: no tool_use event on attempt ${attempt}`)
        continue
      }

      const parsed = ClassifyOutputSchema.safeParse(toolInput)
      if (!parsed.success) {
        console.error('[fact-check] tier-2: tool output failed validation', {
          attempt,
          errors: parsed.error.flatten(),
        })
        continue
      }

      return parsed.data
    } catch (err) {
      console.error('[fact-check] tier-2: adapter.stream error on attempt', attempt, err)
    }
  }

  console.error('[fact-check] tier-2: MAX_ATTEMPTS exhausted — failing closed')
  return null
}

// ---------------------------------------------------------------------------
// WR-06 — untrusted-text escaping (mirrors bot-context.ts's escapeUntrustedText)
// ---------------------------------------------------------------------------

function escapeUntrustedText(value: string): string {
  return value.replace(/["\n\r]/g, ' ').replace(/<<<|>>>/g, '')
}

// ---------------------------------------------------------------------------
// Skill contract
// ---------------------------------------------------------------------------

async function detect(context: SkillContext): Promise<SkillDetectionResult> {
  const lastMessage = context.state.messages[context.state.messages.length - 1]
  if (!lastMessage) {
    return { fires: false, confidence: 0 }
  }

  // Tier 1 (D-12): pure heuristic, zero adapter calls (COST-01).
  if (!looksLikeCheckableClaim(lastMessage.content)) {
    return { fires: false, confidence: 0 }
  }

  // Tier 2: escalate to the light classifier — ONLY reached after tier 1 matched.
  const providerName = context.config?.configurable?.providerName as ProviderName | undefined
  const plaintextKey = context.config?.configurable?.plaintextKey as string | undefined
  const factCheckClassifierAdapter = context.config?.configurable?.factCheckClassifierAdapter as
    | AIProvider
    | undefined

  const adapter =
    factCheckClassifierAdapter ?? (providerName && plaintextKey ? createAdapter(providerName, plaintextKey) : null)

  if (!adapter) {
    console.error('[fact-check] tier-2: no adapter available (missing providerName/plaintextKey) — failing closed')
    return { fires: false, confidence: 0 }
  }

  const model = TASK_MODELS[providerName ?? 'anthropic'].classification
  const tier2Result = await classifyTier2(adapter, model, lastMessage.content)

  if (!tier2Result) {
    return { fires: false, confidence: 0 }
  }

  if (!tier2Result.needs_fact_check) {
    return { fires: false, confidence: tier2Result.confidence }
  }

  // D-06: tier 3 (analyticsAgentNode) is NOT invoked here — detection-only. TriggerGateNode
  // (Plan 06) routes into the existing analyticsAgentNode, which resolves
  // TASK_MODELS[provider].analysis and reads config.configurable.factCheckFraming /
  // state.firingSkillId (Plan 05 wiring).
  const claimMessageId = (context.config?.configurable?.lastMessageId as string | undefined) ?? null

  return {
    fires: true,
    confidence: tier2Result.confidence,
    meta: { claimMessageId },
  }
}

function buildPromptGuidance(context: SkillContext): string {
  const lastMessage = context.state.messages[context.state.messages.length - 1]
  const claimText = lastMessage ? escapeUntrustedText(lastMessage.content) : ''
  const argGraphContext = summarizeArgGraph(context.state.argGraph)

  return [
    'Fact-check guidance — uncertainty framing ONLY (D-15): never assert a confident',
    'counter-claim of your own.',
    `The claim that needs verification: <<<${claimText}>>>`,
    'Cite this specific claim by speaker (use the argument-graph context below to find',
    'the speaker/citation), then ask for a source or evidence. Do not declare the claim',
    'true or false yourself.',
    '',
    argGraphContext,
  ].join('\n')
}

export const factCheckSkill: Skill = {
  id: 'fact-check',
  role: 'analyst',
  detect,
  buildPromptGuidance,
}

// Exported for direct unit testing.
export { detect, buildPromptGuidance, classifyTier2, ClassifyOutputSchema }
