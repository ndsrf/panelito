/**
 * langfuse-generation.test.ts — Unit tests for streamWithGeneration (COST-03).
 *
 * Covers:
 *   - Collected text matches all text_delta events, forwarded to streamWriter
 *   - usage event captured into usageDetails { input, output } on generation.update()
 *   - Never throws when @langfuse/tracing's startObservation throws (non-fatal)
 *   - Returns text/usage even when Langfuse is effectively disabled (observation undefined)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AIStreamEvent } from '@panelito/types'

// ---------------------------------------------------------------------------
// Mock @langfuse/tracing
// ---------------------------------------------------------------------------

const mockUpdate = vi.fn()
const mockEnd = vi.fn()
const mockStartObservation = vi.fn()

vi.mock('@langfuse/tracing', () => ({
  startObservation: (...args: unknown[]) => mockStartObservation(...args),
}))

// ---------------------------------------------------------------------------
// Import AFTER vi.mock() declaration (hoisting ensures mock is applied)
// ---------------------------------------------------------------------------
import { streamWithGeneration } from './langfuse-generation'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function* fakeStream(): AsyncIterable<AIStreamEvent> {
  yield { type: 'text_delta', text: 'Hello, ' }
  yield { type: 'text_delta', text: 'world!' }
  yield { type: 'usage', inputTokens: 42, outputTokens: 17 }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStartObservation.mockReturnValue({
    update: mockUpdate,
    end: mockEnd,
  })
})

describe('streamWithGeneration', () => {
  it('collects the full text from text_delta events', async () => {
    const result = await streamWithGeneration(fakeStream(), {
      name: 'test-generation',
      model: 'claude-haiku-4-5-20251001',
      metadata: { trigger: 'human-reactive', tier: 'fast' },
    })
    expect(result.text).toBe('Hello, world!')
  })

  it('forwards each text_delta to streamWriter', async () => {
    const streamWriter = vi.fn()
    await streamWithGeneration(fakeStream(), {
      name: 'test-generation',
      model: 'claude-haiku-4-5-20251001',
      metadata: { trigger: 'human-reactive', tier: 'fast' },
      streamWriter,
    })
    expect(streamWriter).toHaveBeenCalledTimes(2)
    expect(streamWriter).toHaveBeenNthCalledWith(1, 'Hello, ')
    expect(streamWriter).toHaveBeenNthCalledWith(2, 'world!')
  })

  it('captures the usage event and passes usageDetails to generation.update()', async () => {
    await streamWithGeneration(fakeStream(), {
      name: 'test-generation',
      model: 'claude-haiku-4-5-20251001',
      metadata: { trigger: 'silence_gate', tier: 'fast' },
    })
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        usageDetails: { input: 42, output: 17 },
        model: 'claude-haiku-4-5-20251001',
        metadata: { trigger: 'silence_gate', tier: 'fast' },
      })
    )
    expect(mockEnd).toHaveBeenCalledTimes(1)
  })

  it('returns the usage in the result', async () => {
    const result = await streamWithGeneration(fakeStream(), {
      name: 'test-generation',
      model: 'claude-haiku-4-5-20251001',
      metadata: { trigger: 'human-reactive', tier: 'fast' },
    })
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 17 })
  })

  it('passes usageDetails: undefined when no usage event was emitted', async () => {
    async function* noUsageStream(): AsyncIterable<AIStreamEvent> {
      yield { type: 'text_delta', text: 'no usage here' }
    }
    const result = await streamWithGeneration(noUsageStream(), {
      name: 'test-generation',
      model: 'claude-haiku-4-5-20251001',
      metadata: { trigger: 'human-reactive', tier: 'fast' },
    })
    expect(result.usage).toBeUndefined()
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ usageDetails: undefined })
    )
  })

  it('never throws when startObservation throws — still returns text/usage', async () => {
    mockStartObservation.mockImplementation(() => {
      throw new Error('Langfuse SDK boom')
    })
    const result = await streamWithGeneration(fakeStream(), {
      name: 'test-generation',
      model: 'claude-haiku-4-5-20251001',
      metadata: { trigger: 'human-reactive', tier: 'fast' },
    })
    expect(result.text).toBe('Hello, world!')
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 17 })
  })

  it('never throws when generation.update()/end() throw', async () => {
    mockUpdate.mockImplementation(() => {
      throw new Error('update boom')
    })
    const result = await streamWithGeneration(fakeStream(), {
      name: 'test-generation',
      model: 'claude-haiku-4-5-20251001',
      metadata: { trigger: 'human-reactive', tier: 'fast' },
    })
    expect(result.text).toBe('Hello, world!')
  })
})
