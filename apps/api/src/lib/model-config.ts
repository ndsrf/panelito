/**
 * model-config.ts — TASK_MODELS task-to-model mapping per provider (D-04).
 *
 * Model IDs validated against provider documentation as of June 2026:
 *   - gpt-4o / gpt-4o-mini: DEPRECATED February 2026 — do NOT use
 *   - gemini-2.0-flash: SHUT DOWN June 1, 2026 — do NOT use
 *
 * TaskType legend:
 *   - analysis:       Full-context canvas mutation agent call (LangGraph AgentNode, DriftReplyNode)
 *   - compression:    History summarisation — context window trimming
 *   - categorization: Label assignment from a fixed tag set (labeler.ts)
 *   - classification: Low-token binary/enum classifier (OrchestratorNode DOMAIN_MATCH/BRIDGE/DRIFT)
 *                     Uses the cheapest/fastest model — maxTokens is typically 32.
 *
 * Sources:
 *   - AI-SPEC.md Section 4 (Implementation Guidance — Model Configuration)
 *   - OpenAI: gpt-5.4 replaces gpt-4o; gpt-5.4-mini replaces gpt-4o-mini
 *   - Gemini: gemini-2.5-flash replaces gemini-2.0-flash for all tasks
 */

import type { ProviderName } from '@panelito/types'

export type TaskType = 'analysis' | 'compression' | 'categorization' | 'classification'

export const TASK_MODELS: Record<ProviderName, Record<TaskType, string>> = {
  anthropic: {
    analysis: 'claude-sonnet-4-6',
    compression: 'claude-haiku-4-5-20251001',
    categorization: 'claude-haiku-4-5-20251001',
    classification: 'claude-haiku-4-5-20251001',
  },
  openai: {
    analysis: 'gpt-5.4',
    compression: 'gpt-5.4-mini',
    categorization: 'gpt-5.4-mini',
    classification: 'gpt-5.4-mini',
  },
  gemini: {
    analysis: 'gemini-2.5-flash',
    compression: 'gemini-2.5-flash',
    categorization: 'gemini-2.5-flash',
    classification: 'gemini-2.5-flash',
  },
} as const
