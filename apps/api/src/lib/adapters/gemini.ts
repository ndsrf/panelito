/**
 * adapters/gemini.ts — GeminiAdapter implementing the provider-agnostic AIProvider interface.
 *
 * @google/genai v2 — do NOT use @google/generative-ai (legacy v1 SDK)
 *
 * Key implementation details:
 *   - System prompt goes to config.systemInstruction (NOT in contents) — Pattern 3
 *   - ProviderMessage role 'system' filtered out of contents — Pitfall 5
 *   - ProviderMessage role 'assistant' mapped to 'model' in contents — Pitfall 5
 *   - functionDeclarations use parametersJsonSchema (v2 API field name)
 *   - chunk.functionCalls returns COMPLETE objects (no JSON.parse needed) — Pitfall 4
 *   - Accumulate functionCalls across chunks, emit tool_use AFTER the for-await loop
 *   - RESEARCH.md Pitfall 4: entire stream() body wrapped in try/finally; done emitted exactly once
 */

// @google/genai v2 — do NOT use @google/generative-ai (legacy v1 SDK)
import { GoogleGenAI } from '@google/genai'
import type {
  AIProvider,
  AIStreamEvent,
  ProviderMessage,
  ProviderTool,
  ProviderCapabilities,
} from '@panelito/types'

// ---------------------------------------------------------------------------
// GeminiAdapter — bridges @google/genai v2 SDK streaming to AsyncIterable<AIStreamEvent>
// ---------------------------------------------------------------------------

export class GeminiAdapter implements AIProvider {
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
      const ai = new GoogleGenAI({ apiKey: this.apiKey })

      // Pattern 3 / Pitfall 5: filter out 'system' role; map 'assistant' → 'model'
      // Gemini does not support 'system' role in contents — use config.systemInstruction instead
      const contents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }))

      // Convert ProviderTool[] → Gemini FunctionDeclaration[] using parametersJsonSchema (v2 API)
      const functionDeclarations = tools.map((t) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.parameters,
      }))

      const responseStream = await ai.models.generateContentStream({
        model: options.model,
        contents,
        config: {
          maxOutputTokens: options.maxTokens,
          // System prompt via systemInstruction in config (not in contents)
          ...(options.system ? { systemInstruction: options.system } : {}),
          // Only include tools if there are any function declarations
          ...(functionDeclarations.length > 0
            ? { tools: [{ functionDeclarations }] }
            : {}),
        },
      })

      // Gemini: functionCalls returns COMPLETE objects (not partial JSON strings)
      // Accumulate across chunks, emit tool_use events AFTER the loop (Pitfall 4)
      const accumulatedFunctionCalls: Array<{ name: string; args: unknown }> = []

      for await (const chunk of responseStream) {
        // Yield text deltas immediately
        if (chunk.text) {
          yield { type: 'text_delta', text: chunk.text }
        }

        // Accumulate complete function call objects (do NOT JSON.parse — args is already an object)
        for (const fc of chunk.functionCalls ?? []) {
          accumulatedFunctionCalls.push({ name: fc.name ?? '', args: fc.args ?? {} })
        }
      }

      // Emit tool_use events AFTER the loop (all function calls accumulated)
      for (const fc of accumulatedFunctionCalls) {
        yield { type: 'tool_use', name: fc.name, input: fc.args }
      }
    } finally {
      // Emit done exactly once regardless of success or error (Pitfall 4)
      yield { type: 'done' }
    }
  }
}
