/**
 * ai-provider.test.ts — Unit tests for AIProvider interface + AnthropicAdapter + compressHistory.
 *
 * Tests from 02-01-PLAN.md Task 2 behavior:
 *   - AnthropicAdapter.stream() yields text_delta events, then tool_use, then done
 *   - Tool input JSON only emitted after contentBlock event (not from partial input_json_delta)
 *   - compressHistory([]) returns empty string
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// -----------------------------------------------------------------------
// Mock @anthropic-ai/sdk
// The stream mock captures 'text' and 'contentBlock' callbacks.
// Events are emitted synchronously when done() resolves.
// -----------------------------------------------------------------------

type EventCallback = (...args: unknown[]) => void

interface MockStreamController {
  textCallbacks: EventCallback[]
  blockCallbacks: EventCallback[]
  triggerText: (text: string) => void
  triggerBlock: (block: unknown) => void
  resolveDone: () => void
  donePromise: Promise<void>
}

function createMockController(): MockStreamController {
  let resolveDone!: () => void
  const donePromise = new Promise<void>((r) => { resolveDone = r })
  const textCallbacks: EventCallback[] = []
  const blockCallbacks: EventCallback[] = []

  return {
    textCallbacks,
    blockCallbacks,
    triggerText: (text: string) => textCallbacks.forEach((cb) => cb(text)),
    triggerBlock: (block: unknown) => blockCallbacks.forEach((cb) => cb(block)),
    resolveDone,
    donePromise,
  }
}

let ctrl: MockStreamController

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: vi.fn(() => ({
        on: vi.fn((event: string, cb: EventCallback) => {
          if (event === 'text') ctrl.textCallbacks.push(cb)
          if (event === 'contentBlock') ctrl.blockCallbacks.push(cb)
        }),
        done: vi.fn(() => ctrl.donePromise),
      })),
      create: vi.fn(),
    }
  }
  return { default: MockAnthropic }
})

import { AnthropicAdapter, renderPanelTool } from './ai-provider'
import { compressHistory } from './anthropic'

describe('AnthropicAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ctrl = createMockController()
  })

  it('yields text_delta, tool_use, done events in order', async () => {
    const adapter = new AnthropicAdapter('test-api-key')
    const messages = [{ role: 'user' as const, content: 'Hello' }]

    const gen = adapter.stream(messages, [renderPanelTool], {
      model: 'claude-sonnet-4-6',
      maxTokens: 2048,
    })

    // Start collection in background
    const collectPromise = (async () => {
      const events: unknown[] = []
      for await (const event of gen) {
        events.push(event)
      }
      return events
    })()

    // Wait a tick for the generator to start and register listeners
    await new Promise((r) => setTimeout(r, 0))

    // Now emit events — listeners are registered
    ctrl.triggerText('Hello from AI')
    ctrl.triggerBlock({
      type: 'tool_use',
      name: 'render_panel',
      input: { widget_type: 'bento', data: { cards: [] } },
    })
    ctrl.resolveDone()

    const events = await collectPromise

    expect(events[0]).toMatchObject({ type: 'text_delta', text: 'Hello from AI' })
    expect(events[1]).toMatchObject({ type: 'tool_use', name: 'render_panel' })
    expect(events[2]).toMatchObject({ type: 'done' })
  })

  it('does NOT emit tool_use for non-tool_use contentBlock events', async () => {
    const adapter = new AnthropicAdapter('test-api-key')
    const messages = [{ role: 'user' as const, content: 'Hello' }]

    const gen = adapter.stream(messages, [], {
      model: 'claude-sonnet-4-6',
      maxTokens: 2048,
    })

    const collectPromise = (async () => {
      const events: unknown[] = []
      for await (const event of gen) {
        events.push(event)
      }
      return events
    })()

    await new Promise((r) => setTimeout(r, 0))

    // Emit a non-tool_use block (text block should be ignored)
    ctrl.triggerBlock({ type: 'text', text: 'some text block' })
    ctrl.resolveDone()

    const events = await collectPromise
    // Only 'done' should be emitted
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'done' })
  })
})

describe('renderPanelTool', () => {
  it('has correct widget_type enum and required fields', () => {
    expect(renderPanelTool.name).toBe('render_panel')
    // Cast properties to any since Anthropic.Tool types input_schema.properties as unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = renderPanelTool.input_schema.properties as any
    expect(props.widget_type.enum).toEqual([
      'bento',
      'radar',
      'scatter',
      'pie',
    ])
    expect(renderPanelTool.input_schema.required).toContain('widget_type')
    expect(renderPanelTool.input_schema.required).toContain('data')
  })
})

describe('compressHistory', () => {
  it('returns empty string when messages array is empty', async () => {
    const mockClient = {
      messages: { create: vi.fn() },
    }

    const result = await compressHistory(mockClient as never, [])

    expect(result).toBe('')
    expect(mockClient.messages.create).not.toHaveBeenCalled()
  })
})
