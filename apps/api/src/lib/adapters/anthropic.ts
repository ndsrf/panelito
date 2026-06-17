/**
 * adapters/anthropic.ts — AnthropicAdapter implementing the provider-agnostic AIProvider interface.
 *
 * Key implementation details:
 *   - Accepts ProviderMessage[] and ProviderTool[] from route; converts internally to Anthropic SDK types
 *   - ProviderTool.parameters → Anthropic.Tool.input_schema (conversion happens here, not in route)
 *   - AI-11: cache_control: 'ephemeral' applied to the FIRST user message's content blocks
 *     (the static prefix: systemPrompt + personaInstructions + historicalSummary)
 *   - RESEARCH.md Pitfall 4: entire stream() body wrapped in try/finally; done emitted exactly once
 *   - Text deltas forwarded via 'text' event (research Pattern 1)
 *   - Tool input JSON emitted after 'contentBlock' (fully accumulated, never from partial chunks)
 */

import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources'
import type {
  AIProvider,
  AIStreamEvent,
  ProviderMessage,
  ProviderTool,
  ProviderCapabilities,
} from '@panelito/types'

// ---------------------------------------------------------------------------
// AnthropicAdapter — bridges Anthropic SDK streaming to AsyncIterable<AIStreamEvent>
// ---------------------------------------------------------------------------

export class AnthropicAdapter implements AIProvider {
  constructor(private readonly apiKey: string) {}

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: true,
      contextCaching: false,
      semanticCaching: false,
      imageInput: false,
      voiceInput: false,
      compression: false,
    }
  }

  async *stream(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    options: { model: string; maxTokens: number; system?: string; systemPromptOverride?: string }
  ): AsyncIterable<AIStreamEvent> {
    const client = new Anthropic({ apiKey: this.apiKey })

    // Convert ProviderTool[] → Anthropic.Tool[]
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        ...(t.parameters as Record<string, unknown>),
      },
    }))

    // Convert ProviderMessage[] → MessageParam[]
    // AI-11: Apply cache_control: 'ephemeral' to the last content block of the first
    // user message (the static prefix: systemPrompt + personaInstructions + historicalSummary).
    // The first user message from assemblePromptArray contains the static prefix as a
    // multi-block concatenated string — we apply cache_control there.
    const anthropicMessages: MessageParam[] = messages.map((m, idx) => {
      // Skip system role (Anthropic uses top-level system param, not a message)
      const role = m.role === 'system' ? 'user' : (m.role as 'user' | 'assistant')

      // AI-11: First user message gets cache_control on its single text block
      if (idx === 0 && role === 'user') {
        return {
          role: 'user',
          content: [
            {
              type: 'text',
              text: m.content,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              cache_control: { type: 'ephemeral' } as any,
            },
          ],
        }
      }

      return {
        role,
        content: m.content,
      }
    })

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
      tools: anthropicTools,
      messages: anthropicMessages,
    }

    if (options.system) {
      streamParams.system = options.system
    }

    // RESEARCH.md Pitfall 4: wrap entire body in try/finally; yield done exactly once
    try {
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
    } finally {
      // Emit done exactly once regardless of success or error (Pitfall 4)
      yield { type: 'done' }
    }
  }
}
