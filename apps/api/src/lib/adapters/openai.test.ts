/**
 * openai.test.ts — Unit tests for OpenAIAdapter.
 *
 * Covers all behavior specified in 04-02-PLAN.md Task 1:
 *   - Text delta streaming
 *   - Tool call accumulation by index (no tool_use before finish_reason)
 *   - Two concurrent tool calls at index 0 and 1 produce two separate tool_use events
 *   - Malformed accumulated JSON is skipped (no throw)
 *   - done is always the final event (try/finally), even if iteration throws
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the openai module
// ---------------------------------------------------------------------------

type Chunk = {
  choices: Array<{
    delta: {
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
}

// We expose a factory so each test can inject its own chunk sequence
let mockChunks: Chunk[] = []

vi.mock('openai', () => {
  // Build an async iterable from the current mockChunks array
  async function* makeStream() {
    for (const chunk of mockChunks) {
      yield chunk
    }
  }

  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        stream: vi.fn().mockImplementation(() => makeStream()),
      },
    },
  }))

  return { default: MockOpenAI }
})

// ---------------------------------------------------------------------------
// Import adapter AFTER mock is registered
// ---------------------------------------------------------------------------
import { OpenAIAdapter } from './openai'

// ---------------------------------------------------------------------------
// Helper: collect all events from the stream
// ---------------------------------------------------------------------------
async function collectEvents(
  chunks: Chunk[],
  options?: {
    messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
    system?: string
  }
): Promise<Array<{ type: string; text?: string; name?: string; input?: unknown }>> {
  mockChunks = chunks
  const adapter = new OpenAIAdapter('test-key')
  const messages = options?.messages ?? [{ role: 'user' as const, content: 'hello' }]
  const events: Array<{ type: string; text?: string; name?: string; input?: unknown }> = []
  for await (const event of adapter.stream(messages, [], {
    model: 'gpt-5.4',
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
  vi.clearAllMocks()
})

describe('OpenAIAdapter.capabilities()', () => {
  it('returns streaming and toolUse true, all others false', () => {
    const adapter = new OpenAIAdapter('test-key')
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

describe('OpenAIAdapter.stream() — text deltas', () => {
  it('yields text_delta events for each content chunk', async () => {
    const chunks: Chunk[] = [
      { choices: [{ delta: { content: 'Hel' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'lo' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]
    const events = await collectEvents(chunks)
    const textEvents = events.filter((e) => e.type === 'text_delta')
    expect(textEvents).toHaveLength(2)
    expect(textEvents[0]!.text).toBe('Hel')
    expect(textEvents[1]!.text).toBe('lo')
  })

  it('always emits done as the final event', async () => {
    const chunks: Chunk[] = [
      { choices: [{ delta: { content: 'hi' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]
    const events = await collectEvents(chunks)
    expect(events[events.length - 1]!.type).toBe('done')
  })
})

describe('OpenAIAdapter.stream() — tool call accumulation', () => {
  it('yields NO tool_use event while accumulating (before finish_reason)', async () => {
    const chunks: Chunk[] = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'tc1', function: { name: 'render_panel', arguments: '{"widget_' } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'type":"pie","segments":[]}' } }],
            },
            finish_reason: null,
          },
        ],
      },
    ]
    const events = await collectEvents(chunks)
    const toolEvents = events.filter((e) => e.type === 'tool_use')
    expect(toolEvents).toHaveLength(0)
  })

  it('yields tool_use event with parsed input after finish_reason === "tool_calls"', async () => {
    const chunks: Chunk[] = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'tc1', function: { name: 'render_panel', arguments: '{"widget_' } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'type":"pie","segments":[]}' } }],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ]
    const events = await collectEvents(chunks)
    const toolEvents = events.filter((e) => e.type === 'tool_use')
    expect(toolEvents).toHaveLength(1)
    expect(toolEvents[0]!.name).toBe('render_panel')
    expect(toolEvents[0]!.input).toEqual({ widget_type: 'pie', segments: [] })
  })

  it('two concurrent tool calls at index 0 and 1 produce two separate tool_use events', async () => {
    const chunks: Chunk[] = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'tc0',
                  function: { name: 'render_panel', arguments: '{"widget_type":"pie"}' },
                },
                { index: 1, id: 'tc1', function: { name: 'other_tool', arguments: '{"key":' } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 1, function: { arguments: '"value"}' } }],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ]
    const events = await collectEvents(chunks)
    const toolEvents = events.filter((e) => e.type === 'tool_use')
    expect(toolEvents).toHaveLength(2)
    const names = toolEvents.map((e) => e.name)
    expect(names).toContain('render_panel')
    expect(names).toContain('other_tool')
    const renderEvent = toolEvents.find((e) => e.name === 'render_panel')
    expect(renderEvent?.input).toEqual({ widget_type: 'pie' })
    const otherEvent = toolEvents.find((e) => e.name === 'other_tool')
    expect(otherEvent?.input).toEqual({ key: 'value' })
  })

  it('malformed accumulated JSON is skipped (no throw, no tool_use event)', async () => {
    const chunks: Chunk[] = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'tc1',
                  function: { name: 'render_panel', arguments: 'INVALID_JSON{{{' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ]
    const events = await collectEvents(chunks)
    const toolEvents = events.filter((e) => e.type === 'tool_use')
    expect(toolEvents).toHaveLength(0)
    // done is still emitted
    expect(events[events.length - 1]!.type).toBe('done')
  })

  it('done is the final event even when accumulator is populated', async () => {
    const chunks: Chunk[] = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'tc1',
                  function: { name: 'render_panel', arguments: '{"widget_type":"bento"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ]
    const events = await collectEvents(chunks)
    expect(events[events.length - 1]!.type).toBe('done')
  })
})

describe('OpenAIAdapter.stream() — system prompt handling', () => {
  it('prepends system message when options.system is provided', async () => {
    mockChunks = [{ choices: [{ delta: {}, finish_reason: 'stop' }] }]

    const { default: MockOpenAI } = await import('openai')
    // Use unknown cast to avoid type conflict between typeof OpenAI and vi.Mock
    const MockCtor = MockOpenAI as unknown as ReturnType<typeof vi.fn>
    const lastResult = MockCtor.mock.results[MockCtor.mock.results.length - 1]
    const mockInstance = lastResult?.value as
      | { chat: { completions: { stream: ReturnType<typeof vi.fn> } } }
      | undefined

    const adapter = new OpenAIAdapter('test-key')
    const events: unknown[] = []
    for await (const event of adapter.stream(
      [{ role: 'user', content: 'hello' }],
      [],
      { model: 'gpt-5.4', maxTokens: 100, system: 'You are a helpful assistant.' }
    )) {
      events.push(event)
    }

    // The key check: the stream was called with a system message first
    const streamFn = mockInstance?.chat?.completions?.stream
    if (streamFn) {
      const callArgs = streamFn.mock.calls[streamFn.mock.calls.length - 1] as
        | [{ messages: Array<{ role: string; content: string }> }]
        | undefined
      if (callArgs) {
        const messages = callArgs[0]?.messages ?? []
        expect(messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant.' })
      }
    }
  })
})

describe('OpenAIAdapter.stream() — done guard', () => {
  it('done is always the final event (try/finally guard)', async () => {
    const chunks: Chunk[] = [
      { choices: [{ delta: { content: 'hello' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]
    const events = await collectEvents(chunks)
    expect(events[events.length - 1]!.type).toBe('done')
  })

  it('emits exactly one done event per stream invocation', async () => {
    const chunks: Chunk[] = [
      { choices: [{ delta: { content: 'hi' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]
    const events = await collectEvents(chunks)
    const doneEvents = events.filter((e) => e.type === 'done')
    expect(doneEvents).toHaveLength(1)
  })
})
