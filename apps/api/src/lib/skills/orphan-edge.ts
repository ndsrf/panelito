/**
 * orphan-edge.ts — orphan-edge Analyst Skill (GRAPH-03/TRIGGER-04, D-13/D-14).
 *
 * Detects a committed CanvasNode with zero connecting edges, once at least 3 committed
 * nodes exist on the branch. Fires so TriggerGateNode (Plan 06) can route into the
 * Analyst (AnalyticsAgentNode), whose own LLM edge proposal is the primary mechanism;
 * this Skill additionally pre-computes a ghost-edge fallback target (D-13) — the most
 * cosine-similar OTHER committed node by label — for the Analyst to fall back on if its
 * own LLM proposal finds no strong connection (Plan 06 tier-3 wiring).
 *
 * CRITICAL (RESEARCH.md Pitfall 1): orphan detection reads Supabase `canvas_nodes` /
 * `canvas_edges` (CanvasNode/CanvasEdge — HAVE a `status` field: committed/ghost/silent).
 * It NEVER reads `state.argGraph` (ArgNode/ArgEdge — LangGraph state, no `status` field
 * at all). Conflating the two is the single most likely implementation bug this Skill
 * risks.
 *
 * D-14: only `status='committed'` nodes are eligible ghost-edge targets — ghost/silent
 * nodes are themselves unconfirmed and are never a target.
 *
 * Supabase client seam: `context.config.configurable.serviceClient` — mirrors the
 * `classifierAdapter`/`argGraphAdapter`-style test-injection seam already established for
 * AIProvider adapters (arg-graph-builder.ts, orchestrator.ts), applied here to the DB
 * client since this Skill is the first to need Supabase access from inside a Skill's
 * detect(). Falls back to `createServiceClient()` in production when not injected.
 *
 * Fail-closed on any Supabase or embedding error (silence-gate.ts posture): returns
 * `{ fires: false, confidence: 0 }`, never throws.
 */

import { createServiceClient } from '../supabase'
import { embed, cosineSimilarity } from '../embeddings'
import type { Skill, SkillContext } from '../skills'
import type { SkillDetectionResult } from '@panelito/types'

const MIN_COMMITTED_NODES = 3

interface CommittedNodeRow {
  id: string
  label: string
}

interface EdgeRow {
  source_node_id: string
  target_node_id: string
}

/**
 * WR-06 fix (mirrors bot-context.ts's escapeUntrustedText): node labels are freeform
 * chat-derived content, not trusted input — escape before splicing into a prompt.
 */
function escapeUntrustedText(value: string): string {
  return value.replace(/["\n\r]/g, ' ').replace(/<<<|>>>/g, '')
}

/**
 * findCommittedOrphan — queries canvas_nodes/canvas_edges for the branch (committed
 * status only) and returns the first committed node with zero connecting edges, plus
 * the full list of committed nodes (used for the ghost-edge candidate pool). Returns
 * null on any Supabase error (fail-closed) — the caller treats null as no-fire.
 */
async function findCommittedOrphan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  branchId: string
): Promise<{ orphan: CommittedNodeRow; committedNodes: CommittedNodeRow[] } | null | 'below_threshold'> {
  const { data: nodes, error: nodesError } = await supabase
    .from('canvas_nodes')
    .select('id, label')
    .eq('branch_id', branchId)
    .eq('status', 'committed')

  if (nodesError) {
    console.error('[orphan-edge] canvas_nodes query error:', nodesError.message)
    return null
  }

  const committedNodes = (nodes ?? []) as CommittedNodeRow[]

  if (committedNodes.length < MIN_COMMITTED_NODES) {
    return 'below_threshold'
  }

  const { data: edges, error: edgesError } = await supabase
    .from('canvas_edges')
    .select('source_node_id, target_node_id')
    .eq('branch_id', branchId)

  if (edgesError) {
    console.error('[orphan-edge] canvas_edges query error:', edgesError.message)
    return null
  }

  const connected = new Set<string>()
  for (const edge of (edges ?? []) as EdgeRow[]) {
    connected.add(edge.source_node_id)
    connected.add(edge.target_node_id)
  }

  const orphan = committedNodes.find((n) => !connected.has(n.id))
  if (!orphan) {
    return null
  }

  return { orphan, committedNodes }
}

/**
 * rankGhostTarget — D-13: embeds the orphan node's label and every OTHER committed
 * node's label, ranks by cosineSimilarity, returns the top match's id. Returns
 * undefined (never throws) if embedding fails or no candidates exist — the Skill still
 * fires without a pre-computed ghost target in that case.
 */
async function rankGhostTarget(
  orphan: CommittedNodeRow,
  committedNodes: CommittedNodeRow[]
): Promise<string | undefined> {
  const candidates = committedNodes.filter((n) => n.id !== orphan.id)
  if (candidates.length === 0) {
    return undefined
  }

  try {
    const orphanVec = await embed(orphan.label)
    let bestId: string | undefined
    let bestSim = -Infinity

    for (const candidate of candidates) {
      const candidateVec = await embed(candidate.label)
      const sim = cosineSimilarity(orphanVec, candidateVec)
      if (sim > bestSim) {
        bestSim = sim
        bestId = candidate.id
      }
    }

    return bestId
  } catch (err) {
    console.error('[orphan-edge] ghost-edge ranking error — proceeding without a ghost target', err)
    return undefined
  }
}

async function detect(context: SkillContext): Promise<SkillDetectionResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const injectedClient = context.config?.configurable?.serviceClient as any
    const supabase = injectedClient ?? createServiceClient()
    const branchId = context.config?.configurable?.branchId as string | undefined

    if (!branchId) {
      console.error('[orphan-edge] branchId missing from config.configurable — returning no-fire')
      return { fires: false, confidence: 0 }
    }

    const result = await findCommittedOrphan(supabase, branchId)

    if (result === null || result === 'below_threshold') {
      return { fires: false, confidence: 0 }
    }

    const { orphan, committedNodes } = result
    const ghostTargetNodeId = await rankGhostTarget(orphan, committedNodes)

    return {
      fires: true,
      confidence: 0.7,
      meta: {
        orphanNodeId: orphan.id,
        orphanLabel: orphan.label,
        ghostTargetNodeId: ghostTargetNodeId ?? null,
      },
    }
  } catch (err) {
    console.error('[orphan-edge] unexpected detect() error — failing closed', err)
    return { fires: false, confidence: 0 }
  }
}

function buildPromptGuidance(context: SkillContext): string {
  const meta = context.state.skillMeta as { orphanLabel?: string } | null
  const label = meta?.orphanLabel ? escapeUntrustedText(meta.orphanLabel) : 'a recently committed node'

  return [
    'Orphan-edge guidance: a committed canvas node currently has no connecting edge.',
    `Propose ONE typed edge (using a Blueprint edge_type) that connects the node <<<${label}>>> to another`,
    'already-committed node. Cite the node directly by its label — do not invent a new node, and do not',
    'propose more than one edge for this guidance.',
  ].join('\n')
}

export const orphanEdgeSkill: Skill = {
  id: 'orphan-edge',
  role: 'analyst',
  detect,
  buildPromptGuidance,
}

// Exported for direct unit testing.
export { detect, buildPromptGuidance, findCommittedOrphan, rankGhostTarget }
