/**
 * ai.ts — Provider-agnostic AI interface and types.
 *
 * D-01: AIProvider interface owns no Anthropic SDK types.
 * D-02: ProviderCapabilities drives capabilities-based UI gating (D-17).
 * D-16: systemPromptOverride declared but unused in Phase 4.
 *
 * This file is the single source of truth for:
 *   - ProviderMessage / ProviderTool / ProviderCapabilities / AIProvider
 *   - Adapter-side AIStreamEvent (text_delta | tool_use | done)
 *   - renderPanelTool definition (uses `parameters`, NOT `input_schema`)
 *   - ProviderSchema / ProviderName
 *
 * No @anthropic-ai/sdk imports permitted in this file.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Provider names
// ---------------------------------------------------------------------------

export const ProviderSchema = z.enum(['anthropic', 'openai', 'gemini'])
export type ProviderName = z.infer<typeof ProviderSchema>

// ---------------------------------------------------------------------------
// ProviderMessage — plain message passed into adapters
// ---------------------------------------------------------------------------

export interface ProviderMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// ---------------------------------------------------------------------------
// ProviderTool — adapter-agnostic tool definition
// Uses `parameters` (not `input_schema`) — converted by each adapter internally
// ---------------------------------------------------------------------------

export interface ProviderTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// ProviderCapabilities — D-02 capability flags for UI gating (D-17)
// ---------------------------------------------------------------------------

export interface ProviderCapabilities {
  streaming: boolean
  toolUse: boolean
  contextCaching: boolean
  semanticCaching: boolean
  imageInput: boolean
  voiceInput: boolean
  compression: boolean
}

// ---------------------------------------------------------------------------
// AIStreamEvent — adapter-side stream events (NOT the frontend SSE shape)
// The route translates tool_use → panel_update for the frontend.
// ---------------------------------------------------------------------------

export type AIStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'done' }

// ---------------------------------------------------------------------------
// AIProvider interface — D-01
// ---------------------------------------------------------------------------

export interface AIProvider {
  capabilities(): ProviderCapabilities
  stream(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    options: {
      model: string
      maxTokens: number
      system?: string
      /** D-16: declared but unused in Phase 4 */
      systemPromptOverride?: string
    }
  ): AsyncIterable<AIStreamEvent>
}

// ---------------------------------------------------------------------------
// renderPanelTool — PANEL-01: AI selects appropriate widget type
// Uses `parameters` key (provider-agnostic); adapters convert to their format.
// ---------------------------------------------------------------------------

export const renderPanelTool: ProviderTool = {
  name: 'render_panel',
  description:
    'Renders a visual analytics widget in the analytics panel based on the conversation.',
  parameters: {
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
