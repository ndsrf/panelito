/**
 * bot-context.ts — shared argGraph summary helper + context window constants (Phase 11 Task 3, D-14, GRAPH-04)
 *
 * summarizeArgGraph() is the single shared context path used by BOTH the
 * FacilitationAgentNode (Coach) and AnalyticsAgentNode (Analyst) prompts —
 * neither node rebuilds its own argGraph summary independently (D-14).
 *
 * Pure function: no DB/adapter calls. "Open assertions" (Open Question 1,
 * 11-RESEARCH.md) are derived at query-time — nodes with no supporting or
 * contradicting edge — rather than stored as a schema field.
 */

import type { ArgNode, ArgEdge } from '@panelito/types'

/**
 * Context window sizes (message count) per consumer (11-AI-SPEC.md Section 4b.4).
 * facilitation: Coach — short-term context for question formulation.
 * analytics:    Analyst — needs more context for accurate citation.
 * argBuild:     ArgGraphBuilderNode — truncate at 100 messages max.
 */
export const CONTEXT_WINDOWS = {
  facilitation: 10,
  analytics: 20,
  argBuild: 100,
} as const

/**
 * Returns a compact text summary of the argument graph: nodes (speaker + label),
 * edges (relation), and "open assertions" — nodes with no supporting/contradicting
 * edge in either direction.
 */
export function summarizeArgGraph(argGraph: { nodes: ArgNode[]; edges: ArgEdge[] }): string {
  const { nodes, edges } = argGraph

  if (nodes.length === 0) {
    return 'No argument graph nodes yet.'
  }

  const nodeLines = nodes.map(
    (n) => `- [${n.type}] ${n.speaker}: "${n.label}" (id: ${n.id})`
  )

  const edgeLines = edges.map((e) => {
    const source = nodes.find((n) => n.id === e.source_id)
    const target = nodes.find((n) => n.id === e.target_id)
    const sourceLabel = source ? source.label : e.source_id
    const targetLabel = target ? target.label : e.target_id
    return `- "${sourceLabel}" ${e.relation} "${targetLabel}"`
  })

  const linkedNodeIds = new Set<string>()
  for (const e of edges) {
    linkedNodeIds.add(e.source_id)
    linkedNodeIds.add(e.target_id)
  }
  const openAssertions = nodes.filter((n) => !linkedNodeIds.has(n.id))
  const openAssertionLines = openAssertions.map(
    (n) => `- [${n.type}] ${n.speaker}: "${n.label}" (id: ${n.id}) — no supporting/contradicting edge`
  )

  const sections = [
    `Nodes (${nodes.length}):`,
    nodeLines.join('\n') || '(none)',
    `Edges (${edges.length}):`,
    edgeLines.join('\n') || '(none)',
    `Open assertions (${openAssertions.length}):`,
    openAssertionLines.join('\n') || '(none)',
  ]

  return sections.join('\n')
}
