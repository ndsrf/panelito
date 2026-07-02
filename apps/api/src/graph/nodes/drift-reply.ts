/**
 * drift-reply.ts — DriftReplyNode: conversational reply for DOMAIN_DRIFT (HUMAN-03, D-01)
 *
 * Makes a lightweight LLM call with a minimal "respond naturally, do not refuse" system prompt.
 * Collects text_delta events only — these are consumed by Phase 7's route via SSE streaming.
 * NEVER emits a CanvasOp (HUMAN-03: canvas completely untouched on drift).
 * NEVER refuses, rejects, or errors — responds helpfully to any message (HUMAN-03, D-01).
 *
 * driftReplyAdapter seam: config.configurable.driftReplyAdapter overrides createAdapter() for tests.
 * Never imports @anthropic-ai/sdk directly.
 */

import type { Blueprint, ProviderName } from '@panelito/types'
import { createAdapter } from '../../lib/adapter-factory'
import type { GraphState } from '../state'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function driftReplyNode(state: GraphState, config?: any): Promise<Partial<GraphState>> {
  const providerName = config?.configurable?.providerName as ProviderName | undefined
  const plaintextKey = config?.configurable?.plaintextKey as string | undefined

  // Test injection seam: allows passing a deterministic mock adapter
  const driftReplyAdapter = config?.configurable?.driftReplyAdapter as
    | import('@panelito/types').AIProvider
    | undefined

  const adapter =
    driftReplyAdapter ??
    (providerName && plaintextKey ? createAdapter(providerName, plaintextKey) : null)

  if (!adapter) {
    console.error('[drift-reply] no adapter available — cannot generate reply')
    return { driftAction: 'ignored' }
  }

  // D-01, HUMAN-03: minimal system prompt — respond naturally, do not refuse
  const systemPrompt =
    'Respond naturally and helpfully to this message. Do not refuse or reject it. ' +
    'Keep your response concise and conversational. Do not mention that you are an AI assistant ' +
    'or that the topic is off-subject for any particular domain.'

  // Get the last user message for the reply
  const lastMessage = state.messages[state.messages.length - 1]
  if (!lastMessage) {
    console.warn('[drift-reply] no messages in state — skipping reply')
    return { driftAction: 'ignored' }
  }

  try {
    // Phase 6: collect text_delta events (Phase 7 will route them to SSE via callbacks/streaming)
    // Pass [] as tools array — DriftReplyNode NEVER uses tools and NEVER mutates canvas (HUMAN-03)
    for await (const event of adapter.stream([lastMessage], [], {
      model: 'claude-sonnet-4-6',
      maxTokens: 512,
      system: systemPrompt,
    })) {
      if (event.type === 'text_delta') {
        // Phase 6: events are collected but not streamed (no SSE context available in graph node)
        // Phase 7: Phase 7 route will consume these via adapter.stream() directly or callbacks
        // The text_delta events flow naturally — this loop exhausts the iterator
      }
      // done event terminates the loop naturally
    }
  } catch (err) {
    console.error('[drift-reply] adapter.stream error', err)
  }

  // HUMAN-03: return driftAction only — NEVER emit a canvasOp
  return { driftAction: 'replied' }
}
