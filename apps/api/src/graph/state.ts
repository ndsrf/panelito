/**
 * state.ts — LangGraph StateGraph state schema for Project Multiverse NSAI Engine (Phase 6)
 *
 * Uses Annotation.Root with custom reducers for message and canvas op accumulation.
 * Do NOT use MessagesAnnotation — it requires BaseMessage[], which is incompatible
 * with ProviderMessage (RESEARCH Pitfall 6 verified against @langchain/langgraph@1.4.7).
 *
 * D-08: blueprintId is the only Blueprint reference stored in the checkpoint.
 * D-09: The full Blueprint object is NOT in the checkpointed state — passed per-invocation via config.configurable.
 * D-10: messages, canvasOps, currentPhaseId are user-locked fields.
 */

import { Annotation } from '@langchain/langgraph'
import type { ProviderMessage, CanvasOp, ArgNode, ArgEdge, TriggerMetadata } from '@panelito/types'

export const GraphStateAnnotation = Annotation.Root({
  // -------------------------------------------------------------------------
  // Locked fields (D-08, D-10)
  // -------------------------------------------------------------------------

  /** The Blueprint id string (e.g. 'debate-strategy-v1'). Only reference stored in checkpoint. */
  blueprintId: Annotation<string>,

  /** Active Blueprint phase id (from sessions.current_phase). Drives BLUE-04 prompt mutation.
   *  NULL/undefined falls back to blueprint.phase_sequence[0].id in OrchestratorNode. */
  currentPhaseId: Annotation<string>,

  /** Conversation history. Custom concat reducer — ProviderMessage is a plain object,
   *  not BaseMessage; MessagesAnnotation is incompatible (RESEARCH Pitfall 6). */
  messages: Annotation<ProviderMessage[]>({
    reducer: (left: ProviderMessage[], right: ProviderMessage | ProviderMessage[]) =>
      left.concat(Array.isArray(right) ? right : [right]),
    default: () => [],
  }),

  /** Canvas mutations accumulated per invocation. MutationGateNode appends here. */
  canvasOps: Annotation<CanvasOp[]>({
    reducer: (left: CanvasOp[], right: CanvasOp | CanvasOp[]) =>
      left.concat(Array.isArray(right) ? right : [right]),
    default: () => [],
  }),

  // -------------------------------------------------------------------------
  // Claude-designed intermediate node outputs
  // Overwrite-style fields use a simple identity reducer so a default can be set.
  // LangGraph's Annotation<T>() (no-arg) creates a LastValue channel (overwrite)
  // but does not support a default value — so we use reducer: (_, v) => v instead.
  // -------------------------------------------------------------------------

  /** Classification result from OrchestratorNode (ORCH-02). */
  guardrailResult: Annotation<'DOMAIN_MATCH' | 'DOMAIN_BRIDGE' | 'DOMAIN_DRIFT' | null>({
    reducer: (_: 'DOMAIN_MATCH' | 'DOMAIN_BRIDGE' | 'DOMAIN_DRIFT' | null, v: 'DOMAIN_MATCH' | 'DOMAIN_BRIDGE' | 'DOMAIN_DRIFT' | null) => v,
    default: () => null,
  }),

  /** Confidence score from AgentNode tool use output (ORCH-04). */
  agentConfidence: Annotation<number | null>({
    reducer: (_: number | null, v: number | null) => v,
    default: () => null,
  }),

  /** Drift handling outcome set by OrchestratorNode on DOMAIN_DRIFT (D-03). */
  driftAction: Annotation<'replied' | 'ignored' | null>({
    reducer: (_: 'replied' | 'ignored' | null, v: 'replied' | 'ignored' | null) => v,
    default: () => null,
  }),

  /** Parsed CanvasOp emitted by AgentNode — consumed by MutationGateNode for threshold routing. */
  agentOutput: Annotation<CanvasOp | null>({
    reducer: (_: CanvasOp | null, v: CanvasOp | null) => v,
    default: () => null,
  }),

  /** Whether OrchestratorNode approved steering text on DOMAIN_BRIDGE (D-11).
   *  null = not a DOMAIN_BRIDGE steering path; true/false = probability roll result. */
  steeringTextEnabled: Annotation<boolean | null>({
    reducer: (_: boolean | null, v: boolean | null) => v,
    default: () => null,
  }),

  /** phase_signal from AgentNode tool output — advisory only; human must confirm phase advancement (HUMAN-02, D-09). */
  phase_signal: Annotation<boolean | null>({
    reducer: (_: boolean | null, v: boolean | null) => v,
    default: () => null,
  }),

  // -------------------------------------------------------------------------
  // Bot infrastructure fields (Phase 10 — BOT-05)
  // -------------------------------------------------------------------------

  /** Argument graph accumulated by ArgGraphBuilderNode (Phase 11).
   *  Overwrite-style: each invocation replaces the full graph.
   *  Default: empty graph — safe for human thread invocations that never populate it. */
  argGraph: Annotation<{ nodes: ArgNode[]; edges: ArgEdge[] }>({
    reducer: (_: { nodes: ArgNode[]; edges: ArgEdge[] }, v: { nodes: ArgNode[]; edges: ArgEdge[] }) => v,
    default: () => ({ nodes: [], edges: [] }),
  }),

  /** Trigger metadata map keyed by trigger type (e.g. 'silence_gate').
   *  Overwrite-style: trigger implementations replace specific keys in Phase 11+.
   *  Default: empty record — safe for human thread invocations. */
  triggerMetadata: Annotation<TriggerMetadata>({
    reducer: (_: TriggerMetadata, v: TriggerMetadata) => v,
    default: () => ({}),
  }),

  /** Routing carrier read by the conditional START edge (Plan 05) BEFORE any node runs
   *  (Phase 11 Task 3). NOT the same as triggerMetadata (a per-trigger cooldown record
   *  with no trigger_type key) — this is a single overwrite-style field set by the
   *  invoker (silence-scan.ts or the /invoke route) prior to graph.invoke().
   *  null = human /invoke path — routes to 'orchestrator' (existing behavior unchanged).
   *  Any other value is a trigger-type string the router must recognize explicitly;
   *  an unrecognized-but-defined value is a bug and must be console.error'd, not
   *  silently routed to 'orchestrator' (Finding 6). */
  triggerType: Annotation<string | null>({
    reducer: (_: string | null, v: string | null) => v,
    default: () => null,
  }),

  // -------------------------------------------------------------------------
  // Skill / TriggerGateNode fields (Phase 12 Task 2 — D-01, D-05, D-06, GRAPH-03)
  // Set by TriggerGateNode (Plan 06) when one of the four new synchronous Skills
  // (drift-redirect, orphan-edge, fact-check, moderation) fires. Consumed by the
  // conditional edge routing into FacilitationAgentNode (Coach) / AnalyticsAgentNode
  // (Analyst) and by those nodes' buildPromptGuidance() injection slot.
  // All overwrite-style, all default to null — safe for the human /invoke path and
  // for any Skill that does not fire.
  // -------------------------------------------------------------------------

  /** id of the firing Skill (e.g. 'drift-redirect', 'orphan-edge'), or null if none fired. */
  firingSkillId: Annotation<string | null>({
    reducer: (_: string | null, v: string | null) => v,
    default: () => null,
  }),

  /** Role that owns the firing Skill — routes the conditional edge to the matching Role node. */
  firingSkillRole: Annotation<'coach' | 'analyst' | null>({
    reducer: (_: 'coach' | 'analyst' | null, v: 'coach' | 'analyst' | null) => v,
    default: () => null,
  }),

  /** meta payload from the firing Skill's detect() result (e.g. { claimMessageId }). */
  skillMeta: Annotation<Record<string, unknown> | null>({
    reducer: (_: Record<string, unknown> | null, v: Record<string, unknown> | null) => v,
    default: () => null,
  }),

  /** Loop-guard read by TriggerGateNode's human-path wiring (Plan 06) — prevents the
   *  trigger gate from re-evaluating Skills more than once per invocation. */
  triggerGateComplete: Annotation<boolean | null>({
    reducer: (_: boolean | null, v: boolean | null) => v,
    default: () => null,
  }),
})

/** Full state type derived from the annotation root. */
export type GraphState = typeof GraphStateAnnotation.State
