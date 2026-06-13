/**
 * ai-provider.ts — Provider-agnostic AIProvider interface + AnthropicAdapter.
 *
 * D-03: The render_panel tool definition and streaming contract are wrapped behind
 *       a thin AIProvider interface (stream(messages, tools) -> AsyncIterable<AIStreamEvent>)
 *       so a Gemini/OpenAI adapter can be plugged in for v2 without touching Hono route logic.
 *
 * Key implementation detail:
 *   - AnthropicAdapter uses client.messages.stream() from the SDK
 *   - Text deltas are forwarded via the 'text' event (on('text', ...))
 *   - Tool input JSON is only emitted after 'contentBlock' fires (fully accumulated),
 *     NEVER from partial input_json_delta chunks (research "Don't Hand-Roll" pattern)
 */

import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources'

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface TextDeltaEvent {
  type: 'text_delta'
  text: string
}

export interface ToolUseEvent {
  type: 'tool_use'
  name: string
  input: unknown
}

export interface DoneEvent {
  type: 'done'
}

export type AIStreamEvent = TextDeltaEvent | ToolUseEvent | DoneEvent

// ---------------------------------------------------------------------------
// AIProvider interface — D-03 abstraction layer
// ---------------------------------------------------------------------------

export interface AIProvider {
  stream(
    messages: MessageParam[],
    tools: Anthropic.Tool[],
    options: { model: string; maxTokens: number; system?: string }
  ): AsyncIterable<AIStreamEvent>
}

// ---------------------------------------------------------------------------
// renderPanelTool — Anthropic tool definition for analytics panel updates
// PANEL-01: AI selects appropriate widget type via this tool
// ---------------------------------------------------------------------------

export const renderPanelTool: Anthropic.Tool = {
  name: 'render_panel',
  description:
    'Renders a visual analytics widget in the analytics panel based on the conversation.',
  input_schema: {
    type: 'object',
    properties: {
      widget_type: {
        type: 'string',
        enum: ['bento', 'radar', 'scatter', 'pie'],
        description: 'The type of widget to render',
      },
      title: {
        type: 'string',
        description: 'Brief panel header title',
      },
      data: {
        type: 'object',
        description: 'Widget-specific data payload (varies by widget_type)',
      },
    },
    required: ['widget_type', 'data'],
  },
}

// ---------------------------------------------------------------------------
// AnthropicAdapter — bridges Anthropic SDK streaming to AsyncIterable<AIStreamEvent>
// ---------------------------------------------------------------------------

export class AnthropicAdapter implements AIProvider {
  constructor(private readonly apiKey: string) {}

  async *stream(
    messages: MessageParam[],
    tools: Anthropic.Tool[],
    options: { model: string; maxTokens: number; system?: string }
  ): AsyncIterable<AIStreamEvent> {
    const client = new Anthropic({ apiKey: this.apiKey })

    // Internal queue bridging callback API to AsyncIterable
    const queue: AIStreamEvent[] = []
    let resolve: (() => void) | null = null
    let isDone = false

    function enqueue(event: AIStreamEvent) {
      queue.push(event)
      if (resolve) {
        const r = resolve
        resolve = null
        r()
      }
    }

    function waitForItem(): Promise<void> {
      if (queue.length > 0) return Promise.resolve()
      return new Promise<void>((r) => {
        resolve = r
      })
    }

    const streamParams: Anthropic.MessageStreamParams = {
      model: options.model,
      max_tokens: options.maxTokens,
      tools,
      messages,
    }

    if (options.system) {
      streamParams.system = options.system
    }

    const apiStream = client.messages.stream(streamParams)

    // Forward text deltas immediately (research Pattern 1)
    apiStream.on('text', (text: string) => {
      enqueue({ type: 'text_delta', text })
    })

    // Wait for fully-accumulated tool_use block (research Pattern 1 — contentBlock event)
    // IMPORTANT: Never parse input_json_delta chunks — only use contentBlock which fires
    // after content_block_stop with complete parsed JSON
    apiStream.on('contentBlock', (block: Anthropic.ContentBlock) => {
      if (block.type === 'tool_use') {
        enqueue({ type: 'tool_use', name: block.name, input: block.input })
      }
    })

    // Start the done resolution in parallel
    const donePromise = apiStream.done().then(() => {
      isDone = true
      if (resolve) {
        const r = resolve
        resolve = null
        r()
      }
    })

    // Yield events as they arrive
    while (true) {
      await waitForItem()
      while (queue.length > 0) {
        yield queue.shift()!
      }
      if (isDone && queue.length === 0) break
    }

    // Ensure done() has fully resolved before final event
    await donePromise

    yield { type: 'done' }
  }
}
