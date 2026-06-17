/**
 * ai-provider.ts — Backward-compatible shim re-exporting provider-agnostic types
 * from @panelito/types and AnthropicAdapter from its own adapter file.
 *
 * D-03: Route logic imports from this shim; no route file needs to change.
 * No @anthropic-ai/sdk imports in this file.
 */

export type { AIProvider, AIStreamEvent, ProviderMessage, ProviderTool } from '@panelito/types'
export { renderPanelTool } from '@panelito/types'
export { AnthropicAdapter } from './adapters/anthropic'
