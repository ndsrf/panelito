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
import type { ProviderMessage, CanvasOp } from '@panelito/types'

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
})

/** Full state type derived from the annotation root. */
export type GraphState = typeof GraphStateAnnotation.State
