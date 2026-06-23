/**
 * ai.test.ts — Tests for provider-agnostic AI types (04-01-PLAN.md Task 1 behavior).
 *
 * Behavior assertions:
 *   - ProviderSchema.parse('openai') returns 'openai'; ProviderSchema.parse('xai') throws
 *   - renderPanelTool.name === 'render_panel'
 *   - renderPanelTool.parameters.required includes 'widget_type'
 *   - renderPanelTool.parameters.properties.widget_type.enum deep-equals ['bento','radar','scatter','pie','bar','layout']
 *   - AIProvider interface compile-time check via typed mock
 */

import { describe, it, expect } from 'vitest'
import { ProviderSchema, renderPanelTool } from './ai'
import type { AIProvider, AIStreamEvent, ProviderMessage, ProviderTool, ProviderCapabilities } from './ai'

describe('ProviderSchema', () => {
  it('parses valid provider names', () => {
    expect(ProviderSchema.parse('openai')).toBe('openai')
    expect(ProviderSchema.parse('anthropic')).toBe('anthropic')
    expect(ProviderSchema.parse('gemini')).toBe('gemini')
  })

  it('throws for unknown provider names', () => {
    expect(() => ProviderSchema.parse('xai')).toThrow()
    expect(() => ProviderSchema.parse('')).toThrow()
    expect(() => ProviderSchema.parse('gpt4')).toThrow()
  })
})

describe('renderPanelTool', () => {
  it('has name render_panel', () => {
    expect(renderPanelTool.name).toBe('render_panel')
  })

  it('uses parameters key (not input_schema)', () => {
    expect(renderPanelTool).toHaveProperty('parameters')
    // Ensure it does NOT have input_schema
    expect(renderPanelTool).not.toHaveProperty('input_schema')
  })

  it('required includes widget_type', () => {
    const required = (renderPanelTool.parameters as Record<string, unknown>).required as string[]
    expect(required).toContain('widget_type')
  })

  it('widget_type enum deep-equals bento radar scatter pie bar layout', () => {
    const props = (renderPanelTool.parameters as Record<string, unknown>).properties as Record<string, { enum?: string[] }>
    expect(props['widget_type']?.enum).toEqual(['bento', 'radar', 'scatter', 'pie', 'bar', 'layout'])
  })
})

describe('AIProvider compile-time interface check', () => {
  it('accepts a typed mock implementing AIProvider', () => {
    // Compile-time assertion: if this compiles, the interface contract is correct.
    const mockCapabilities: ProviderCapabilities = {
      streaming: true,
      toolUse: true,
      contextCaching: false,
      semanticCaching: false,
      imageInput: false,
      voiceInput: false,
      compression: false,
    }

    const mockAdapter: AIProvider = {
      capabilities: () => mockCapabilities,
      stream: async function* (
        _messages: ProviderMessage[],
        _tools: ProviderTool[],
        _options: { model: string; maxTokens: number; system?: string; systemPromptOverride?: string }
      ): AsyncIterable<AIStreamEvent> {
        yield { type: 'done' }
      },
    }

    expect(mockAdapter.capabilities()).toEqual(mockCapabilities)
  })
})
