/**
 * use-ai-stream.test.ts
 *
 * Tests the SSE consumer's multi-line buffering (Pitfall 1) and
 * the AI-05 Zod gate that discards invalid panel_update payloads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAIStream } from './use-ai-stream'
import { usePanelStore } from '@/store/panel-store'

// ------------------------------------------------------------------
// Mock createClient — returns a stub that yields a fake Supabase session
// ------------------------------------------------------------------
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  }),
}))

// ------------------------------------------------------------------
// Mock process.env for API URL
// ------------------------------------------------------------------
vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:8787')

// ------------------------------------------------------------------
// Helper: encode a string to Uint8Array
// ------------------------------------------------------------------
function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

// ------------------------------------------------------------------
// Helper: build a mock ReadableStream from an array of string chunks.
// Each chunk is what a single read() call would return.
// ------------------------------------------------------------------
function mockReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        const chunk = chunks[index++]!
        controller.enqueue(encode(chunk))
      } else {
        controller.close()
      }
    },
  })
}

// ------------------------------------------------------------------
// Helper: build a mock Response object with a given body stream and status
// ------------------------------------------------------------------
function mockResponse(stream: ReadableStream<Uint8Array>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: stream,
  } as unknown as Response
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('useAIStream — SSE buffering (Pitfall 1)', () => {
  beforeEach(() => {
    // Reset panelStore before each test
    usePanelStore.setState({
      widgetType: null,
      widgetData: null,
      branchId: 'main',
      snapshotState: null,
    })
    vi.resetAllMocks()
  })

  it('accumulates text tokens across multiple read() calls', async () => {
    // Two events split awkwardly: the first chunk contains a partial first event
    // and the beginning of the second; the second chunk contains the rest.
    const chunks = [
      // First chunk: complete text_delta + start of second text_delta
      'event: text_delta\ndata: {"text":"Hello"}\n\nevent: text_d',
      // Second chunk: rest of the second text_delta + done
      'elta\ndata: {"text":" world"}\n\nevent: done\ndata: {}\n\n',
    ]

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse(mockReadableStream(chunks))
    )

    const { result } = renderHook(() => useAIStream('session-1'))

    await act(async () => {
      await result.current.openAIStream('hello', false)
    })

    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(result.current.streamingText).toBe('Hello world')
    expect(result.current.status).toBe('done')
    expect(result.current.isAIStreaming).toBe(false)
  })

  it('handles all SSE events in a single chunk', async () => {
    const chunks = [
      'event: text_delta\ndata: {"text":"Single"}\n\nevent: done\ndata: {}\n\n',
    ]

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse(mockReadableStream(chunks))
    )

    const { result } = renderHook(() => useAIStream('session-2'))

    await act(async () => {
      await result.current.openAIStream('test', false)
    })

    expect(result.current.streamingText).toBe('Single')
    expect(result.current.status).toBe('done')
  })
})

describe('useAIStream — AI-05 Zod gate (panel_update validation)', () => {
  beforeEach(() => {
    usePanelStore.setState({
      widgetType: null,
      widgetData: null,
      branchId: 'main',
      snapshotState: null,
    })
    vi.resetAllMocks()
  })

  it('VALID panel_update updates panelStore', async () => {
    const validWidget = {
      widget_type: 'bento',
      title: 'Test',
      cards: [
        { category: 'Cat', concept: 'Concept A', relevance_score: 85 },
      ],
    }

    const chunks = [
      `event: panel_update\ndata: ${JSON.stringify(validWidget)}\n\nevent: done\ndata: {}\n\n`,
    ]

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse(mockReadableStream(chunks))
    )

    const { result } = renderHook(() => useAIStream('session-3'))

    await act(async () => {
      await result.current.openAIStream('test', false)
    })

    const storeState = usePanelStore.getState()
    expect(storeState.widgetType).toBe('bento')
    expect(storeState.widgetData).not.toBeNull()
  })

  it('INVALID panel_update is silently discarded — panelStore unchanged', async () => {
    // Malformed widget: bento but missing required "cards" field
    const invalidWidget = {
      widget_type: 'bento',
      title: 'Bad widget',
      // cards: missing — will fail Zod validation
    }

    const chunks = [
      `event: panel_update\ndata: ${JSON.stringify(invalidWidget)}\n\nevent: done\ndata: {}\n\n`,
    ]

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse(mockReadableStream(chunks))
    )

    const { result } = renderHook(() => useAIStream('session-4'))

    await act(async () => {
      await result.current.openAIStream('test', false)
    })

    // panelStore must be unchanged (silent discard per AI-05)
    const storeState = usePanelStore.getState()
    expect(storeState.widgetType).toBeNull()
    expect(storeState.widgetData).toBeNull()
    // Stream should still complete normally
    expect(result.current.status).toBe('done')
  })

  it('INVALID panel_update with completely unknown widget_type is discarded', async () => {
    const invalidWidget = {
      widget_type: 'unknown_widget',
      data: { foo: 'bar' },
    }

    const chunks = [
      `event: panel_update\ndata: ${JSON.stringify(invalidWidget)}\n\nevent: text_delta\ndata: {"text":"reply"}\n\nevent: done\ndata: {}\n\n`,
    ]

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse(mockReadableStream(chunks))
    )

    const { result } = renderHook(() => useAIStream('session-5'))

    await act(async () => {
      await result.current.openAIStream('test', false)
    })

    // panelStore unchanged
    const storeState = usePanelStore.getState()
    expect(storeState.widgetType).toBeNull()

    // Text accumulation continues despite the invalid panel event
    expect(result.current.streamingText).toBe('reply')
    expect(result.current.status).toBe('done')
  })

  it('returns typing_hold status on 429 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse(mockReadableStream([]), 429)
    )

    const { result } = renderHook(() => useAIStream('session-6'))

    await act(async () => {
      await result.current.openAIStream('test', true)
    })

    expect(result.current.status).toBe('typing_hold')
    expect(result.current.isAIStreaming).toBe(false)
  })
})
