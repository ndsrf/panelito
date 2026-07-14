/**
 * arg-graph-builder.ts — ArgGraphBuilderNode: extraction, UUID substitution, merge (GRAPH-01, GRAPH-02)
 *
 * Follows the four-step node skeleton (agent.ts) with a [arg-graph-builder] log prefix:
 *   1. Read deps from config.configurable — argGraphAdapter test seam, providerName/plaintextKey,
 *      branchId (the branch this extraction is scoped to — required to populate ArgNode.branch_id;
 *      no existing GraphState/config field currently carries a branch id into node config, so this
 *      introduces the `branchId` name, matching the naming already used by silence-gate.ts /
 *      bot-arbitrator.ts / bot-budget.ts. Documented per the plan's "document the source" instruction.)
 *   2. Build the (trivial, fixed) extraction system prompt as a pure function.
 *   3. Stream via adapter inside try/catch — never throw.
 *   4. Return a Partial<GraphState> — merge (not overwrite) into state.argGraph.
 *
 * Finding 2 (11-RESEARCH.md) two-schema split:
 *   - argGraphExtractionTool (arg-graph-tool.ts) is the RAW tool-input JSON schema — id/type/label/
 *     message_id/speaker on nodes and id/source_ref/target_ref/relation on edges are plain strings,
 *     NOT uuid-constrained, because the model cannot reliably emit RFC4122 UUIDs.
 *   - ArgGraphSchema/ArgNodeSchema/ArgEdgeSchema (bot.ts) is the STRICT domain schema — id/branch_id/
 *     source_id/target_id keep `.uuid()`. This node performs the substitution step between the two:
 *     a per-call Map<ref, uuid> resolves each short ref (node id / edge source_ref / target_ref) to a
 *     crypto.randomUUID(), reusing the same UUID whenever the same ref string recurs within a single
 *     extraction call (e.g. an edge's source_ref matching a node's own id emitted in the same tool
 *     call) — no fuzzy/cross-call matching against prior state.argGraph content is attempted.
 *
 * message_id is passed through as emitted by the model (NOT substituted) — the task action text
 * only specifies ref substitution for node id / edge source_ref+target_ref. A model-emitted
 * message_id that isn't a real UUID legitimately fails ArgNodeSchema's .uuid() check and is handled
 * by the same retry-then-fail-silent path as any other post-substitution validation failure.
 *
 * Never throws (Pitfall 5 / Pattern 1) — the entire body is wrapped in try/catch.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { argGraphExtractionTool, ArgGraphSchema } from '@panelito/types'
import type { AIProvider, ArgEdge, ArgNode, ProviderMessage, ProviderName } from '@panelito/types'
import { createAdapter } from '../../lib/adapter-factory'
import { TASK_MODELS } from '../../lib/model-config'
import { CONTEXT_WINDOWS } from '../../lib/bot-context'
import type { GraphState } from '../state'

const MAX_RETRIES = 2

// -------------------------------------------------------------------------
// Raw tool-output shape (relaxed refs) — mirrors argGraphExtractionTool's JSON
// schema, NOT the strict domain schema. Validated BEFORE ID substitution.
// -------------------------------------------------------------------------

const RawArgNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  label: z.string(),
  message_id: z.string(),
  speaker: z.string(),
})

const RawArgEdgeSchema = z.object({
  id: z.string(),
  source_ref: z.string(),
  target_ref: z.string(),
  relation: z.string(),
})

const RawArgGraphSchema = z.object({
  nodes: z.array(RawArgNodeSchema),
  edges: z.array(RawArgEdgeSchema),
})

type RawArgGraph = z.infer<typeof RawArgGraphSchema>

/**
 * Build the (fixed) extraction system prompt. Kept as a pure function, separate
 * from the node body, for testability (Pattern 1).
 */
function buildArgGraphExtractionSystemPrompt(): string {
  return [
    'You are an argument-graph extraction engine for a collaborative debate workspace.',
    'Read the recent conversation and call extract_arg_graph with every claim, evidence,',
    'counterargument, or question raised, plus typed edges expressing how they relate',
    '(e.g. SUPPORTS, CONTRADICTS, BUILDS_ON, QUESTIONS).',
    'Use short, stable string refs for id/source_ref/target_ref — do not attempt to generate',
    'UUIDs yourself; the server substitutes real UUIDs after extraction.',
    'Every node must cite the message_id and speaker it was derived from.',
    'If nothing new can be extracted, call extract_arg_graph with empty nodes/edges arrays.',
  ].join('\n')
}

/** Append a correction user-message describing the validation failure (AI-SPEC 4b.1 retry pattern). */
function appendCorrection(messages: ProviderMessage[], errorDetail: string): ProviderMessage[] {
  return [
    ...messages,
    {
      role: 'user',
      content:
        `Your previous extract_arg_graph call failed validation: ${errorDetail}. ` +
        `Please call extract_arg_graph again with corrected output.`,
    },
  ]
}

/**
 * Substitute short model-supplied refs for real UUIDs. Builds a per-call ref→uuid map;
 * the same ref string always resolves to the same uuid within one extraction attempt.
 */
function substituteRefs(raw: RawArgGraph, branchId: string): unknown {
  const refToUuid = new Map<string, string>()

  function uuidFor(ref: string): string {
    let id = refToUuid.get(ref)
    if (!id) {
      id = randomUUID()
      refToUuid.set(ref, id)
    }
    return id
  }

  const nodes = raw.nodes.map((n) => ({
    id: uuidFor(n.id),
    type: n.type,
    label: n.label,
    branch_id: branchId,
    message_id: n.message_id,
    speaker: n.speaker,
  }))

  const edges = raw.edges.map((e) => ({
    id: uuidFor(e.id),
    source_id: uuidFor(e.source_ref),
    target_id: uuidFor(e.target_ref),
    relation: e.relation,
  }))

  return { nodes, edges }
}

/**
 * Single extraction attempt: stream + capture tool_use → raw-shape validate → ID substitution →
 * domain-schema validate. Retries (max MAX_RETRIES) with a correction message on validation
 * failure at either stage. Returns null (never throws) on exhaustion or a stream error.
 */
async function attemptExtraction(
  adapter: AIProvider,
  messages: ProviderMessage[],
  system: string,
  model: string,
  branchId: string,
  attempt: number,
): Promise<{ nodes: ArgNode[]; edges: ArgEdge[] } | null> {
  let rawInput: unknown = null

  try {
    for await (const event of adapter.stream(messages, [argGraphExtractionTool], {
      model,
      maxTokens: 256,
      system,
    })) {
      if (event.type === 'tool_use' && event.name === 'extract_arg_graph') {
        rawInput = event.input
        break
      }
    }
  } catch (err) {
    console.error('[arg-graph-builder] adapter.stream error on attempt', attempt, err)
    return null
  }

  if (rawInput === null) {
    console.warn('[arg-graph-builder] no tool_use event received on attempt', attempt)
    return null
  }

  const rawParsed = RawArgGraphSchema.safeParse(rawInput)
  if (!rawParsed.success) {
    console.error('[arg-graph-builder] raw tool output failed shape validation', {
      attempt,
      errors: rawParsed.error.flatten(),
    })
    if (attempt < MAX_RETRIES) {
      return attemptExtraction(
        adapter,
        appendCorrection(messages, JSON.stringify(rawParsed.error.flatten())),
        system,
        model,
        branchId,
        attempt + 1,
      )
    }
    console.error('[arg-graph-builder] MAX_RETRIES exhausted — dropping arg graph extraction')
    return null
  }

  const substituted = substituteRefs(rawParsed.data, branchId)
  const parsed = ArgGraphSchema.safeParse(substituted)
  if (parsed.success) {
    return parsed.data
  }

  console.error('[arg-graph-builder] ArgGraphSchema.safeParse failed after substitution', {
    attempt,
    errors: parsed.error.flatten(),
  })

  if (attempt < MAX_RETRIES) {
    return attemptExtraction(
      adapter,
      appendCorrection(messages, JSON.stringify(parsed.error.flatten())),
      system,
      model,
      branchId,
      attempt + 1,
    )
  }

  console.error('[arg-graph-builder] MAX_RETRIES exhausted — dropping arg graph extraction')
  return null
}

/** Union-merge by id — de-duplicates, prior entries are overwritten by same-id new entries. */
function mergeById<T extends { id: string }>(prior: T[], next: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of prior) map.set(item.id, item)
  for (const item of next) map.set(item.id, item)
  return Array.from(map.values())
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function argGraphBuilderNode(state: GraphState, config?: any): Promise<Partial<GraphState>> {
  try {
    const providerName = config?.configurable?.providerName as ProviderName | undefined
    const plaintextKey = config?.configurable?.plaintextKey as string | undefined
    const branchId = config?.configurable?.branchId as string | undefined

    // Test injection seam: allows passing a deterministic mock adapter (Pattern 2)
    const argGraphAdapter = config?.configurable?.argGraphAdapter as AIProvider | undefined

    const adapter =
      argGraphAdapter ??
      (providerName && plaintextKey ? createAdapter(providerName, plaintextKey) : null)

    if (!adapter) {
      console.error(
        '[arg-graph-builder] no adapter available (missing providerName/plaintextKey) — returning no output',
      )
      return {}
    }

    if (!branchId) {
      console.error('[arg-graph-builder] branchId missing from config.configurable — returning no output')
      return {}
    }

    const model = TASK_MODELS[providerName ?? 'anthropic'].classification
    const system = buildArgGraphExtractionSystemPrompt()
    const messages = state.messages.slice(-CONTEXT_WINDOWS.argBuild)

    const extracted = await attemptExtraction(adapter, messages, system, model, branchId, 0)

    if (!extracted) {
      return {}
    }

    return {
      argGraph: {
        nodes: mergeById(state.argGraph.nodes, extracted.nodes),
        edges: mergeById(state.argGraph.edges, extracted.edges),
      },
    }
  } catch (err) {
    console.error('[arg-graph-builder] unexpected error — returning no output', err)
    return {}
  }
}
