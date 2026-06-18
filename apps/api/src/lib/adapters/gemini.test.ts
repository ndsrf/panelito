/**
 * gemini.test.ts — Unit tests for GeminiAdapter.
 *
 * Covers all behavior specified in 04-02-PLAN.md Task 2:
 *   - Text delta streaming (chunk.text)
 *   - ProviderMessage with role 'system' filtered OUT of contents
 *   - options.system goes to config.systemInstruction
 *   - ProviderMessage with role 'assistant' maps to 'model' role (NOT 'assistant')
 *   - functionCalls accumulation across chunks, emitted AFTER the loop
 *   - done is always the final event (try/finally)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @google/genai
// ---------------------------------------------------------------------------

type FunctionCall = { name?: string; args?: Record<string, unknown> }

type GeminiChunk = {
  text?: string
  functionCalls?: FunctionCall[]
}

// Captured config from the last generateContentStream call
let capturedConfig: {
  model?: string
  contents?: Array<{ role: string; parts: Array<{ text: string }> }>
  config?: {
    systemInstruction?: string
    maxOutputTokens?: number
    tools?: unknown
  }
} = {}

let mockChunks: GeminiChunk[] = []

vi.mock('@google/genai', () => {
  async function* makeStream() {
    for (const chunk of mockChunks) {
      yield chunk
    }
  }

  const MockGoogleGenAI = vi.fn().mockImplementation(() => ({
    models: {
      generateContentStream: vi.fn().mockImplementation((params: typeof capturedConfig) => {
        capturedConfig = params
        return makeStream()
      }),
    },
  }))

  return { GoogleGenAI: MockGoogleGenAI }
})

// ---------------------------------------------------------------------------
// Import adapter AFTER mock
// ---------------------------------------------------------------------------
import { GeminiAdapter } from './gemini'

// ---------------------------------------------------------------------------
// Helper: collect all events from the stream
// ---------------------------------------------------------------------------
async function collectEvents(
  chunks: GeminiChunk[],
  options?: {
    messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
    system?: string
  }
): Promise<Array<{ type: string; text?: string; name?: string; input?: unknown }>> {
  mockChunks = chunks
  capturedConfig = {}
  const adapter = new GeminiAdapter('test-key')
  const messages = options?.messages ?? [{ role: 'user' as const, content: 'hello' }]
  const events: Array<{ type: string; text?: string; name?: string; input?: unknown }> = []
  for await (const event of adapter.stream(messages, [], {
    model: 'gemini-2.5-flash',
    maxTokens: 100,
    ...(options?.system ? { system: options.system } : {}),
  })) {
    events.push(event)
  }
  return events
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockChunks = []
  capturedConfig = {}
  vi.clearAllMocks()
})

describe('GeminiAdapter.capabilities()', () => {
  it('returns streaming and toolUse true, all others false', () => {
    const adapter = new GeminiAdapter('test-key')
    const caps = adapter.capabilities()
    expect(caps.streaming).toBe(true)
    expect(caps.toolUse).toBe(true)
    expect(caps.contextCaching).toBe(false)
    expect(caps.semanticCaching).toBe(false)
    expect(caps.imageInput).toBe(false)
    expect(caps.voiceInput).toBe(false)
    expect(caps.compression).toBe(false)
  })
})

describe('GeminiAdapter.stream() — text deltas', () => {
  it('yields text_delta events for each chunk.text', async () => {
    const chunks: GeminiChunk[] = [{ text: 'Hi' }, { text: ' there' }]
    const events = await collectEvents(chunks)
    const textEvents = events.filter((e) => e.type === 'text_delta')
    expect(textEvents).toHaveLength(2)
    expect(textEvents[0]!.text).toBe('Hi')
    expect(textEvents[1]!.text).toBe(' there')
  })

  it('done is always the final event', async () => {
    const chunks: GeminiChunk[] = [{ text: 'hello' }]
    const events = await collectEvents(chunks)
    expect(events[events.length - 1]!.type).toBe('done')
  })

  it('emits exactly one done event', async () => {
    const chunks: GeminiChunk[] = [{ text: 'hello' }]
    const events = await collectEvents(chunks)
    const doneEvents = events.filter((e) => e.type === 'done')
    expect(doneEvents).toHaveLength(1)
  })
})

describe('GeminiAdapter.stream() — role mapping', () => {
  it('filters out ProviderMessage with role "system" from contents', async () => {
    const chunks: GeminiChunk[] = [{ text: 'ok' }]
    await collectEvents(chunks, {
      messages: [
        { role: 'system', content: 'You are a bot.' },
        { role: 'user', content: 'hello' },
      ],
    })
    const contents = capturedConfig.contents ?? []
    const systemMessages = contents.filter((c) => c.role === 'system')
    expect(systemMessages).toHaveLength(0)
  })

  it('maps "assistant" role to "model" in contents', async () => {
    const chunks: GeminiChunk[] = [{ text: 'ok' }]
    await collectEvents(chunks, {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ],
    })
    const contents = capturedConfig.contents ?? []
    const assistantMessages = contents.filter((c) => c.role === 'assistant')
    const modelMessages = contents.filter((c) => c.role === 'model')
    expect(assistantMessages).toHaveLength(0)
    expect(modelMessages).toHaveLength(1)
    expect(modelMessages[0]!.parts[0]!.text).toBe('world')
  })

  it('keeps "user" role as "user" in contents', async () => {
    const chunks: GeminiChunk[] = [{ text: 'ok' }]
    await collectEvents(chunks, {
      messages: [{ role: 'user', content: 'hello' }],
    })
    const contents = capturedConfig.contents ?? []
    expect(contents[0]!.role).toBe('user')
    expect(contents[0]!.parts[0]!.text).toBe('hello')
  })

  it('options.system goes to config.systemInstruction (not in contents)', async () => {
    const chunks: GeminiChunk[] = [{ text: 'ok' }]
    await collectEvents(chunks, {
      messages: [{ role: 'user', content: 'hello' }],
      system: 'You are an analyst.',
    })
    expect(capturedConfig.config?.systemInstruction).toBe('You are an analyst.')
    const contents = capturedConfig.contents ?? []
    const systemInContents = contents.filter((c) => c.role === 'system')
    expect(systemInContents).toHaveLength(0)
  })
})

describe('GeminiAdapter.stream() — functionCalls accumulation', () => {
  it('yields tool_use events AFTER the loop ends, not during chunk processing', async () => {
    // The function calls come in a chunk before the text, but tool_use should be emitted after
    const chunks: GeminiChunk[] = [
      {
        functionCalls: [{ name: 'render_panel', args: { widget_type: 'pie', data: {} } }],
      },
      { text: 'here is the analysis' },
    ]
    const events = await collectEvents(chunks)
    const toolUseIdx = events.findIndex((e) => e.type === 'tool_use')
    const lastTextIdx = events.reduce((last, e, i) => (e.type === 'text_delta' ? i : last), -1)
    // tool_use must appear AFTER all text_delta events
    expect(toolUseIdx).toBeGreaterThan(lastTextIdx)
  })

  it('accumulates functionCalls across multiple chunks and emits after loop', async () => {
    const chunks: GeminiChunk[] = [
      {
        functionCalls: [{ name: 'render_panel', args: { widget_type: 'pie' } }],
      },
      {
        functionCalls: [{ name: 'other_tool', args: { key: 'value' } }],
      },
    ]
    const events = await collectEvents(chunks)
    const toolEvents = events.filter((e) => e.type === 'tool_use')
    expect(toolEvents).toHaveLength(2)
    const names = toolEvents.map((e) => e.name)
    expect(names).toContain('render_panel')
    expect(names).toContain('other_tool')
  })

  it('passes fc.args directly as input (no JSON.parse — args is already an object)', async () => {
    const args = { widget_type: 'radar', labels: ['A', 'B'], values: [1, 2] }
    const chunks: GeminiChunk[] = [
      { functionCalls: [{ name: 'render_panel', args }] },
    ]
    const events = await collectEvents(chunks)
    const toolEvent = events.find((e) => e.type === 'tool_use')
    expect(toolEvent?.input).toEqual(args)
    // Verify it's the same reference shape (no parse/stringify round-trip corruption)
    expect((toolEvent?.input as typeof args).labels).toEqual(['A', 'B'])
  })

  it('done is still final event when functionCalls are present', async () => {
    const chunks: GeminiChunk[] = [
      { functionCalls: [{ name: 'render_panel', args: { widget_type: 'bento' } }] },
    ]
    const events = await collectEvents(chunks)
    expect(events[events.length - 1]!.type).toBe('done')
  })
})
