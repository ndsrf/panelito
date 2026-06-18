/**
 * adapters/openai.ts — OpenAIAdapter implementing the provider-agnostic AIProvider interface.
 *
 * Key implementation details:
 *   - System prompt goes as messages[0] with role 'system' (Pattern 2 — NOT a top-level param)
 *   - Tool call arguments accumulated by tc.index (supports concurrent parallel_tool_calls)
 *   - tool_use events emitted ONLY after finish_reason === 'tool_calls' (all args complete)
 *   - Malformed accumulated JSON caught with try/catch + continue (no throw)
 *   - NEVER calls stream.finalMessage() — kills first-token latency (anti-pattern)
 *   - RESEARCH.md Pitfall 4: entire stream() body wrapped in try/finally; done emitted exactly once
 */

import OpenAI from 'openai'
import type {
  AIProvider,
  AIStreamEvent,
  ProviderMessage,
  ProviderTool,
  ProviderCapabilities,
} from '@panelito/types'

// ---------------------------------------------------------------------------
// OpenAIAdapter — bridges OpenAI SDK streaming to AsyncIterable<AIStreamEvent>
// ---------------------------------------------------------------------------

export class OpenAIAdapter implements AIProvider {
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
    // RESEARCH.md Pitfall 4: wrap entire body in try/finally; yield done exactly once
    try {
      const client = new OpenAI({ apiKey: this.apiKey })

      // Pattern 2: system prompt as first element of messages array (NOT a top-level param)
      const oaiMessages: OpenAI.ChatCompletionMessageParam[] = []
      if (options.system) {
        oaiMessages.push({ role: 'system', content: options.system })
      }
      // Map ProviderMessage[] to OpenAI format; skip system role (already handled above)
      for (const m of messages) {
        if (m.role === 'system') continue
        oaiMessages.push({ role: m.role as 'user' | 'assistant', content: m.content })
      }

      // Convert ProviderTool[] → OpenAI ChatCompletionTool format
      const oaiTools: OpenAI.ChatCompletionTool[] = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))

      // Use .stream() for the streaming interface (returns a stream iterable)
      // DO NOT call stream.finalMessage() — kills first-token latency (anti-pattern)
      const stream = client.chat.completions.stream({
        model: options.model,
        max_tokens: options.maxTokens,
        messages: oaiMessages,
        ...(oaiTools.length > 0 ? { tools: oaiTools } : {}),
      })

      // Tool call accumulator keyed by index — supports concurrent parallel_tool_calls
      // First delta for each index carries id + name; subsequent deltas carry only arguments
      const toolCallAccumulator: Record<number, { id: string; name: string; arguments: string }> =
        {}

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta
        if (!delta) continue

        // Yield text deltas immediately
        if (delta.content) {
          yield { type: 'text_delta', text: delta.content }
        }

        // Accumulate tool call argument fragments by index
        for (const tc of delta.tool_calls ?? []) {
          const idx = tc.index
          if (!toolCallAccumulator[idx]) {
            // First delta for this index: capture id and name
            toolCallAccumulator[idx] = {
              id: tc.id ?? '',
              name: tc.function?.name ?? '',
              arguments: '',
            }
          }
          // Append argument fragment (subsequent deltas only carry arguments)
          toolCallAccumulator[idx].arguments += tc.function?.arguments ?? ''
        }

        // Only parse and emit AFTER finish_reason === 'tool_calls'
        // At this point all argument strings are complete and JSON-parseable
        if (chunk.choices[0]?.finish_reason === 'tool_calls') {
          for (const tc of Object.values(toolCallAccumulator)) {
            let parsed: unknown
            try {
              parsed = JSON.parse(tc.arguments)
            } catch {
              // Malformed JSON from provider — skip this tool call (no throw)
              continue
            }
            yield { type: 'tool_use', name: tc.name, input: parsed }
          }
        }
      }
    } finally {
      // Emit done exactly once regardless of success or error (Pitfall 4)
      yield { type: 'done' }
    }
  }
}
