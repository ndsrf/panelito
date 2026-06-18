/**
 * adapter-factory.ts — createAdapter(provider, apiKey) → AIProvider
 *
 * Factory function that returns the matching adapter instance for a given ProviderName.
 * The `satisfies never` on the default branch ensures TypeScript enforces exhaustive
 * switching — adding a new ProviderName without a case becomes a compile error.
 */

import type { AIProvider, ProviderName } from '@panelito/types'
import { AnthropicAdapter } from './adapters/anthropic'
import { OpenAIAdapter } from './adapters/openai'
import { GeminiAdapter } from './adapters/gemini'

export function createAdapter(provider: ProviderName, apiKey: string): AIProvider {
  switch (provider) {
    case 'anthropic':
      return new AnthropicAdapter(apiKey)
    case 'openai':
      return new OpenAIAdapter(apiKey)
    case 'gemini':
      return new GeminiAdapter(apiKey)
    default:
      throw new Error(`Unknown provider: ${provider satisfies never}`)
  }
}
