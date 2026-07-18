/**
 * ai.test.ts — Route tests for POST /api/sessions/:id/invoke
 *
 * Three test blocks covering the Phase 7 automatable success criteria:
 *   SC-1: no_blueprint gate — sessions without blueprint_id return 400 before any AI call
 *   SC-2: SSE stream — Blueprint session delivers text_delta + done events via SSE
 *   SC-3: abort signal propagation — config.signal is passed to graph.stream() as AbortSignal
 *
 * All tests use:
 *   - Mocked Supabase client (no real DB or auth)
 *   - Mocked blueprint-loader (no Supabase round-trip)
 *   - Mocked createGraph() returning a fake compiled graph that calls streamWriter
 *   - Mocked crypto (decryptKey returns a fixed plaintext key)
 *   - No real PostgresSaver, no real Anthropic key
 *
 * Fast (< 60s total), no network/DB dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { MemorySaver } from '@langchain/langgraph'
import type { Blueprint } from '@panelito/types'

// ---------------------------------------------------------------------------
// Module-level variables for cross-test spy access.
// Set by beforeEach; read by the module mocks.
// ---------------------------------------------------------------------------

/** Config argument captured from graph.stream() for SC-3 assertion */
let _capturedStreamConfig: unknown = null

/** Whether graph.stream() should emit text_delta tokens (set per-test) */
let _emitTextTokens = false

/** Whether the final graph chunk should include a non-empty canvasOps array (set per-test) */
let _emitCanvasOps = false

/**
 * Spy on the messages-table `insert` call, shared across every `from('messages')`
 * invocation made within a single buildSupabaseMock() instance (there are several
 * SELECT calls against 'messages' before the potential INSERT). Reset per-test via
 * buildSupabaseMock(); read by the canvas-only-turn regression test.
 */
let _messagesInsertSpy: ReturnType<typeof vi.fn> | null = null

// ---------------------------------------------------------------------------
// Mock: ../lib/supabase
// ---------------------------------------------------------------------------

vi.mock('../lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock: ../lib/blueprint-loader
// ---------------------------------------------------------------------------

vi.mock('../lib/blueprint-loader', () => ({
  loadBlueprint: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock: ../lib/langgraph-checkpointer
// ---------------------------------------------------------------------------

vi.mock('../lib/langgraph-checkpointer', () => ({
  getCheckpointer: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock: ../lib/crypto — bypass real AES-256-GCM encryption in tests
// ---------------------------------------------------------------------------

vi.mock('../lib/crypto', () => ({
  decryptKey: vi.fn().mockReturnValue('sk-test-plaintext-key'),
  encryptKey: vi.fn((p: string) => p),
}))

// ---------------------------------------------------------------------------
// Mock: ../graph/graph — createGraph returns a lightweight fake compiled graph.
//
// The fake graph:
//   - Exposes a stream() method that captures config (for SC-3)
//   - Calls config.configurable.streamWriter() with "Hello from graph." (for SC-2)
//   - Returns an async iterable that yields one empty chunk then completes
//
// This avoids running real graph nodes (no LLM calls, no Postgres).
// ---------------------------------------------------------------------------

vi.mock('../graph/graph', () => ({
  createGraph: vi.fn().mockImplementation((_checkpointer?: unknown) => {
    return {
      stream: vi.fn().mockImplementation(async (_input: unknown, config: unknown) => {
        // SC-3: capture config for signal assertion
        _capturedStreamConfig = config

        // SC-2: emit a text token via streamWriter if configured
        const cfg = config as { configurable?: { streamWriter?: (text: string) => void } }
        if (_emitTextTokens && cfg?.configurable?.streamWriter) {
          cfg.configurable.streamWriter('Hello from graph.')
        }

        // WR-04: emit a "values"-mode chunk (full state object, not node-keyed updates).
        // LangGraph defaults to "values" stream mode, which yields the full state after
        // each node completes. The previous { agent: { canvasOps: [] } } shape was
        // "updates" mode and caused Object.assign(finalState, chunk) to produce
        // finalState.agent.canvasOps rather than finalState.canvasOps, hiding the
        // canvas-only-turn skip-insert path from all tests.
        async function* generateChunks() {
          yield {
            blueprintId: 'debate-strategy-v1',
            currentPhaseId: 'opening',
            messages: [],
            canvasOps: _emitCanvasOps
              ? [{ op: 'ADD_NODE', status: 'committed', node: { id: 'n1', type: 'hypothesis', label: 'Test' } }]
              : [],
            guardrailResult: 'DOMAIN_MATCH',
            agentConfidence: 0.9,
            driftAction: null,
            agentOutput: null,
            steeringTextEnabled: null,
          }
        }
        return generateChunks()
      }),
    }
  }),
}))

// ---------------------------------------------------------------------------
// Mock: @langfuse/langchain + @langfuse/tracing
// ---------------------------------------------------------------------------

vi.mock('@langfuse/langchain', () => ({
  CallbackHandler: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('@langfuse/tracing', () => ({
  getLangfuseTracerProvider: vi.fn().mockReturnValue({
    forceFlush: vi.fn().mockResolvedValue(undefined),
  }),
}))

// ---------------------------------------------------------------------------
// Import after vi.mock() declarations (hoisting ensures mocks are applied)
// ---------------------------------------------------------------------------

import { createServiceClient } from '../lib/supabase'
import { loadBlueprint } from '../lib/blueprint-loader'
import { getCheckpointer } from '../lib/langgraph-checkpointer'
import aiRouter from './ai'

const mockCreateServiceClient = vi.mocked(createServiceClient)
const mockLoadBlueprint = vi.mocked(loadBlueprint)
const mockGetCheckpointer = vi.mocked(getCheckpointer)

// ---------------------------------------------------------------------------
// Debate Blueprint fixture
// ---------------------------------------------------------------------------

const debateBlueprint: Blueprint = {
  id: 'debate-strategy-v1',
  name: 'Debate & Strategy',
  canvas_view_mode: 'graph',
  node_types: [
    { id: 'hypothesis', label: 'Hypothesis', color: '#6366f1', description: 'A testable claim.' },
    { id: 'evidence', label: 'Evidence', color: '#10b981', description: 'Supporting data.' },
  ],
  edge_types: [
    { id: 'SUPPORTS', label: 'Supports', color: '#10b981' },
  ],
  phase_sequence: [
    {
      id: 'opening',
      label: 'Opening',
      llm_instructions: 'Focus on establishing core hypotheses.',
      allowed_node_types: ['hypothesis', 'evidence'],
      phase_readiness_gate: { min_nodes: 3, min_messages_after: 5 },
    },
  ],
  active_persona_ids: ['analista_cientifico'],
  drift_reply_probability: 0.8,
  drift_detection_enabled: true,
  bot_defaults: {},
  role_personalities: {},
  silence_phase_readiness_coupling_enabled: false,
}

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

const app = new Hono()
app.route('/api/sessions', aiRouter)

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_SESSION_ID = 'test-session-00000000-0000-0000-0000-000000000001'
const TEST_USER_ID = 'test-user-00000000-0000-0000-0000-000000000001'
const FAKE_JWT = 'fake-bearer-token'

// ---------------------------------------------------------------------------
// Supabase mock factory
// ---------------------------------------------------------------------------

function buildSupabaseMock(sessionData: Record<string, unknown> | null) {
  let sessionsCallCount = 0

  // Shared across all from('messages') calls this test makes (several SELECTs precede
  // the potential INSERT) so the canvas-only-turn test can assert insert was never called.
  const messagesInsertSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: { id: 'ai-msg-test', content: 'Hello from graph.', role: 'assistant' },
        error: null,
      }),
    }),
  })
  _messagesInsertSpy = messagesInsertSpy

  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === 'sessions') {
      sessionsCallCount++
      if (sessionsCallCount === 1) {
        // Ownership + blueprint_id check
        return makeSelectSingleChain(
          sessionData,
          sessionData ? null : { code: 'PGRST116', message: 'not found' }
        )
      }
      // Cap check
      return makeSelectSingleChain({ ai_response_count: 0, ai_response_cap: 150 }, null)
    }
    if (table === 'creator_settings') {
      return makeMaybeSingleChain({
        anthropic_api_key: 'iv.tag.cipher',
        openai_api_key: null,
        gemini_api_key: null,
        active_provider: 'anthropic',
      })
    }
    if (table === 'messages') {
      return makeMessagesChain(messagesInsertSpy)
    }
    if (table === 'branches') {
      return makeSelectSingleChain(null, { message: 'not found' })
    }
    return makeSelectSingleChain(null, null)
  })

  return {
    from: fromFn,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: TEST_USER_ID } },
        error: null,
      }),
    },
    channel: vi.fn().mockReturnValue({
      httpSend: vi.fn().mockReturnValue({ catch: vi.fn() }),
    }),
    // try_acquire_mic (ai.ts Step 8.6) expects `data: [{ acquired: boolean }]` — default
    // to a granted lock so tests that reach this step (e.g. the canvas-only-turn test,
    // which supplies branchId to bypass the pre-existing branches-mock gap) don't 500.
    rpc: vi.fn().mockResolvedValue({ data: [{ acquired: true }], error: null }),
  }
}

function makeSelectSingleChain(data: unknown, error: unknown) {
  const self: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    range: vi.fn().mockResolvedValue({ data: [], error: null }),
    single: vi.fn().mockResolvedValue({ data, error }),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'ai-msg-test', content: 'Hello from graph.', role: 'assistant' },
          error: null,
        }),
      }),
    }),
  }
  // Make chainable methods return self
  ;['select', 'eq', 'in', 'order'].forEach((m) => {
    self[m]!.mockReturnValue(self)
  })
  return self
}

function makeMaybeSingleChain(data: unknown) {
  const self: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  }
  ;['select', 'eq'].forEach((m) => {
    self[m]!.mockReturnValue(self)
  })
  return self
}

function makeMessagesChain(insertSpy: ReturnType<typeof vi.fn>) {
  // `.limit(...)` is dual-purpose in real supabase-js: awaited directly as a terminal
  // (sliding-window fetch at ai.ts:213-219, resolves {data,error}) OR chained further
  // with `.maybeSingle()` (Step 8.55 last-human-author lookup at ai.ts:313-321). Mirror
  // that thenable-and-chainable shape here rather than a plain mockResolvedValue.
  const limitResult = {
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject),
  }
  const self: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    neq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn().mockReturnValue(limitResult),
    range: vi.fn().mockResolvedValue({ data: [], error: null }),
    insert: insertSpy,
  }
  ;['select', 'eq', 'in', 'neq', 'order'].forEach((m) => {
    self[m]!.mockReturnValue(self)
  })
  return self
}

// ---------------------------------------------------------------------------
// Setup: reset before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  _capturedStreamConfig = null
  _emitTextTokens = false
  _emitCanvasOps = false
  _messagesInsertSpy = null

  // Re-apply defaults after clearAllMocks()
  mockGetCheckpointer.mockResolvedValue(new MemorySaver() as any)
  mockLoadBlueprint.mockResolvedValue(debateBlueprint)
})

// ---------------------------------------------------------------------------
// SC-1: no_blueprint gate
// ---------------------------------------------------------------------------

describe('POST /api/sessions/:id/invoke — no_blueprint gate (SC-1)', () => {
  it('returns 400 no_blueprint when session has no blueprint_id', async () => {
    const sessionWithoutBlueprint = {
      id: TEST_SESSION_ID,
      creator_id: TEST_USER_ID,
      active_personas: ['analista_cientifico'],
      blueprint_id: null,
      current_phase: null,
    }

    mockCreateServiceClient.mockReturnValue(
      buildSupabaseMock(sessionWithoutBlueprint) as any
    )

    const req = new Request(`http://localhost/api/sessions/${TEST_SESSION_ID}/invoke`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FAKE_JWT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userMessage: 'Hello' }),
    })

    const res = await app.fetch(req)
    const body = await res.json() as { error: string }

    // SC-1: 400 no_blueprint before any AI call
    expect(res.status).toBe(400)
    expect(body.error).toBe('no_blueprint')

    // Verify gate fires before any blueprint/graph initialization
    expect(mockLoadBlueprint).not.toHaveBeenCalled()
    expect(mockGetCheckpointer).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// SC-2: SSE stream delivers text_delta + done events
// ---------------------------------------------------------------------------

describe('POST /api/sessions/:id/invoke — SSE stream (SC-2)', () => {
  it('delivers text_delta events and done event via SSE without hanging', async () => {
    // Configure graph mock to emit text tokens via streamWriter
    _emitTextTokens = true

    const sessionWithBlueprint = {
      id: TEST_SESSION_ID,
      creator_id: TEST_USER_ID,
      active_personas: ['analista_cientifico'],
      blueprint_id: 'debate-strategy-v1',
      current_phase: 'opening',
    }

    mockCreateServiceClient.mockReturnValue(
      buildSupabaseMock(sessionWithBlueprint) as any
    )

    const req = new Request(`http://localhost/api/sessions/${TEST_SESSION_ID}/invoke`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FAKE_JWT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userMessage: 'Water is essential for life.' }),
    })

    const res = await app.fetch(req)

    // Assert: SSE response
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    // Consume the SSE body and collect event names
    const body = res.body
    expect(body).not.toBeNull()

    const eventNames: string[] = []
    const reader = body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('SSE stream read timed out after 15s')), 15_000)
    )

    const readStream = async (): Promise<void> => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('event:')) {
            eventNames.push(trimmed.slice(6).trim())
          }
        }

        if (eventNames.includes('done')) break
      }
    }

    await Promise.race([readStream(), timeout])

    // SC-2 assertions: text_delta followed by done
    expect(eventNames).toContain('text_delta')
    expect(eventNames).toContain('done')
    expect(eventNames.indexOf('done')).toBeGreaterThan(eventNames.indexOf('text_delta'))
  })
})

// ---------------------------------------------------------------------------
// SC-3: abort signal propagation
// ---------------------------------------------------------------------------

describe('POST /api/sessions/:id/invoke — abort propagation (SC-3)', () => {
  it('passes c.req.raw.signal to graph.stream() config as an AbortSignal', async () => {
    // Emit text so the SSE stream has content (avoids empty response edge case)
    _emitTextTokens = true

    const sessionWithBlueprint = {
      id: TEST_SESSION_ID,
      creator_id: TEST_USER_ID,
      active_personas: ['analista_cientifico'],
      blueprint_id: 'debate-strategy-v1',
      current_phase: 'opening',
    }

    mockCreateServiceClient.mockReturnValue(
      buildSupabaseMock(sessionWithBlueprint) as any
    )

    const req = new Request(`http://localhost/api/sessions/${TEST_SESSION_ID}/invoke`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FAKE_JWT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userMessage: 'Abort signal test.' }),
    })

    const res = await app.fetch(req)
    expect(res.status).toBe(200)

    // Drain stream until done
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let foundDone = false

    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('SC-3 stream timed out after 15s')), 15_000)
    )

    const drain = async (): Promise<void> => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        if (text.includes('event: done')) {
          foundDone = true
          break
        }
      }
    }

    await Promise.race([drain(), timeout])
    expect(foundDone).toBe(true)

    // SC-3: config.signal must be an AbortSignal instance
    expect(_capturedStreamConfig).not.toBeNull()
    const config = _capturedStreamConfig as Record<string, unknown>
    expect(config.signal).toBeDefined()
    expect(config.signal).toBeInstanceOf(AbortSignal)
  })
})

// ---------------------------------------------------------------------------
// SPEECH-01/D-10/D-11: canvas-only bot turn writes NO message row
// ---------------------------------------------------------------------------

describe('POST /api/sessions/:id/invoke — canvas-only turn skip-insert (SPEECH-01)', () => {
  it('performs no messages INSERT and writes no placeholder text when the bot turn yields canvas ops but zero accumulated text', async () => {
    // No text tokens emitted; the final chunk carries a non-empty canvasOps array.
    _emitTextTokens = false
    _emitCanvasOps = true

    const sessionWithBlueprint = {
      id: TEST_SESSION_ID,
      creator_id: TEST_USER_ID,
      active_personas: ['analista_cientifico'],
      blueprint_id: 'debate-strategy-v1',
      current_phase: 'opening',
    }

    mockCreateServiceClient.mockReturnValue(
      buildSupabaseMock(sessionWithBlueprint) as any
    )

    const req = new Request(`http://localhost/api/sessions/${TEST_SESSION_ID}/invoke`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FAKE_JWT}`,
        'Content-Type': 'application/json',
      },
      // branchId supplied explicitly so the request skips the Step 8.5 "resolve main
      // branch" fallback query (ai.ts:288) — this test's shared buildSupabaseMock()
      // 'branches' chain always resolves not-found (pre-existing gap unrelated to
      // SPEECH-01; also affects SC-2/SC-3, tracked in deferred-items.md).
      body: JSON.stringify({ userMessage: 'Add a node to the canvas.', branchId: 'branch-00000000-0000-0000-0000-000000000001' }),
    })

    const res = await app.fetch(req)
    expect(res.status).toBe(200)

    // Drain the SSE stream to completion.
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let sseText = ''
    let foundDone = false

    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('canvas-only-turn stream timed out after 15s')), 15_000)
    )

    const drain = async (): Promise<void> => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        sseText += text
        if (text.includes('event: done')) {
          foundDone = true
          break
        }
      }
    }

    await Promise.race([drain(), timeout])
    expect(foundDone).toBe(true)

    // No placeholder string anywhere in the SSE payload.
    expect(sseText).not.toContain('canvas updated')

    // No messages INSERT was attempted — canvas-only turns write zero chat rows.
    expect(_messagesInsertSpy).not.toBeNull()
    expect(_messagesInsertSpy).not.toHaveBeenCalled()
  })
})
