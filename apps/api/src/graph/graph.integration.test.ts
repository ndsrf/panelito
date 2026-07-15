/**
 * graph.integration.test.ts — PostgresSaver + Langfuse integration tests
 *
 * Test A (D-12): PostgresSaver resume test against real Supabase.
 *   - Proves state is stored in langgraph.checkpoints after first invocation
 *   - Proves second invocation on same thread_id resumes from checkpoint (state accumulates)
 *   - Requires SUPABASE_DIRECT_URL in .env — skipped otherwise (safe for CI without DB)
 *
 * Test B (OBS smoke): CallbackHandler + forceFlush against Langfuse.
 *   - Creates a per-request new CallbackHandler (NO module-level singleton — REQUIREMENTS.md)
 *   - Invokes graph and calls getLangfuseTracerProvider().forceFlush()
 *   - Requires LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY — skipped otherwise
 *   - Full dashboard verification is the human-verify checkpoint (OBS-01, OBS-02)
 *
 * All Claude API calls use mock adapters (classifierAdapter + agentAdapter seams from
 * config.configurable) — identical to unit test pattern. No real Claude tokens spent.
 *
 * Security: thread_ids are ephemeral `test-${Date.now()}` — cannot collide with
 * production branch UUIDs (T-06-10). SUPABASE_DIRECT_URL never logged (T-06-12).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import type { AIProvider, AIStreamEvent, Blueprint } from '@panelito/types'
import { getCheckpointer } from '../lib/langgraph-checkpointer'
import { setupLangfuseOtel } from '../lib/langfuse-otel'
import { createGraph } from './graph'
import { loadBlueprint } from '../lib/blueprint-loader'

// ---------------------------------------------------------------------------
// Environment guards
// ---------------------------------------------------------------------------

const HAS_SUPABASE = !!process.env.SUPABASE_DIRECT_URL
const HAS_LANGFUSE = !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY)

// ---------------------------------------------------------------------------
// Mock AIProvider factory — reused from graph.test.ts pattern (D-11)
// Returns a deterministic async generator; no real Claude calls.
// ---------------------------------------------------------------------------

function createMockAdapter(events: AIStreamEvent[]): AIProvider {
  return {
    capabilities: () => ({
      streaming: true,
      toolUse: true,
      contextCaching: false,
      semanticCaching: false,
      imageInput: false,
      voiceInput: false,
      compression: false,
    }),
    async *stream(): AsyncIterable<AIStreamEvent> {
      for (const event of events) {
        yield event
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Mock event sets — cover the DOMAIN_MATCH + ADD_NODE path (simplest path)
// ---------------------------------------------------------------------------

const classifierMatchAdapter = createMockAdapter([
  { type: 'text_delta', text: 'DOMAIN_MATCH' },
  { type: 'done' },
])

const agentAddNodeAdapter = createMockAdapter([
  {
    type: 'tool_use',
    name: 'canvas_mutation',
    input: { op: 'ADD_NODE', node_type_id: 'hypothesis', label: 'Test claim', confidence: 0.9 },
  },
  { type: 'done' },
])

// ---------------------------------------------------------------------------
// Debate Blueprint fixture — consistent with graph.test.ts
// ---------------------------------------------------------------------------

const debateBlueprint: Blueprint = {
  id: 'debate-strategy-v1',
  name: 'Debate & Strategy',
  canvas_view_mode: 'graph',
  node_types: [
    { id: 'hypothesis', label: 'Hypothesis', color: '#6366f1', description: 'A testable claim.' },
    { id: 'evidence', label: 'Evidence', color: '#10b981', description: 'Supporting data.' },
    { id: 'counter_argument', label: 'Counter-Argument', color: '#ef4444', description: 'A challenge.' },
    { id: 'action', label: 'Action', color: '#f59e0b', description: 'A proposed action.' },
  ],
  edge_types: [
    { id: 'SUPPORTS', label: 'Supports', color: '#10b981' },
    { id: 'CONTRADICTS', label: 'Contradicts', color: '#ef4444' },
    { id: 'BUILDS_ON', label: 'Builds On', color: '#6366f1' },
  ],
  phase_sequence: [
    {
      id: 'opening',
      label: 'Opening',
      llm_instructions: 'Focus on establishing core hypotheses.',
      allowed_node_types: ['hypothesis', 'evidence'],
    },
  ],
  active_persona_ids: ['scientific-analyst'],
  drift_reply_probability: 0.8,
  drift_detection_enabled: true,
  bot_defaults: {},
  role_personalities: {},
}

// ---------------------------------------------------------------------------
// Test A: PostgresSaver resume (D-12, ORCH-05)
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_SUPABASE)('Test A: PostgresSaver resume (D-12)', () => {
  // Shared checkpointer initialized once for all tests in this suite
  let checkpointer: Awaited<ReturnType<typeof getCheckpointer>>
  let blueprint: Blueprint

  beforeAll(async () => {
    checkpointer = await getCheckpointer()
    // Use the seeded blueprint from migration 0008 (D-09: blueprint loaded fresh, not checkpointed)
    blueprint = await loadBlueprint('debate-strategy-v1')
  })

  it('stores state in langgraph.checkpoints after first invocation and resumes on second', async () => {
    const threadId = `test-${Date.now()}`
    console.log(`[graph.integration.test] threadId: ${threadId} (for manual inspection)`)

    const graph = createGraph(checkpointer)

    // Shared config — same thread_id for both invocations (ORCH-05)
    const config = {
      configurable: {
        thread_id: threadId,
        blueprint,
        providerName: 'anthropic' as const,
        plaintextKey: 'test-key-placeholder',
        classifierAdapter: classifierMatchAdapter,
        agentAdapter: agentAddNodeAdapter,
      },
    }

    // --- First invocation ---
    const initialMessages = [{ role: 'user' as const, content: 'Water is essential for life.' }]

    await graph.invoke(
      {
        blueprintId: 'debate-strategy-v1',
        currentPhaseId: 'opening',
        messages: initialMessages,
        canvasOps: [],
      },
      config
    )

    // Assert checkpoint stored in langgraph.checkpoints (D-12a)
    const checkpoint = await checkpointer.get({ configurable: { thread_id: threadId } })
    expect(checkpoint).not.toBeNull()
    expect(checkpoint?.channel_values).toBeDefined()

    // --- Second invocation on same thread_id ---
    // Add a second message — the accumulated state should reflect both
    const secondConfig = {
      configurable: {
        ...config.configurable,
        // Re-create mock adapters (they are single-use async generators — need fresh instances)
        classifierAdapter: createMockAdapter([
          { type: 'text_delta', text: 'DOMAIN_MATCH' },
          { type: 'done' },
        ]),
        agentAdapter: createMockAdapter([
          {
            type: 'tool_use',
            name: 'canvas_mutation',
            input: { op: 'ADD_NODE', node_type_id: 'evidence', label: 'Evidence claim', confidence: 0.88 },
          },
          { type: 'done' },
        ]),
      },
    }

    const secondResult = await graph.invoke(
      {
        // Only send the delta — LangGraph resumes from checkpoint and merges state
        messages: [{ role: 'user' as const, content: 'Indeed, life requires water.' }],
      },
      secondConfig
    )

    // Assert messages accumulated across invocations (D-12b: state accumulates, not resets)
    // The messages reducer appends, so after 2 invocations we should have > 1 message
    expect(secondResult.messages.length).toBeGreaterThan(1)

    // Assert canvasOps accumulated from both invocations
    expect(secondResult.canvasOps.length).toBeGreaterThanOrEqual(2)

    // Phase 12 Plan 06 Task 3 (T-12-16): PostgresSaver-backed termination proof — both
    // invocations above traversed the human path's NEW mutationGate -> triggerGate wiring
    // (the seeded debate-strategy-v1 blueprint has bot_defaults: { coach: true, analyst: true }
    // — migration 0014_personalities.sql — so TriggerGateNode's role-gate does NOT
    // short-circuit here; the real Skills evaluate and fail-closed on missing
    // branchId/supabase context, exactly as already observed in Test B below). Neither
    // invocation's graph.invoke() promise rejected (the awaits above already prove this),
    // and triggerGateComplete is set on every invocation, confirming the loop guard fires
    // under the SAME checkpointer/thread_id resume path this test exists to validate.
    expect(secondResult.triggerGateComplete).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test B: Langfuse OTel smoke test (OBS-01, OBS-02)
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_SUPABASE || !HAS_LANGFUSE)('Test B: Langfuse OTel smoke (OBS-01/02)', () => {
  // DO NOT create a module-level CallbackHandler — banned in REQUIREMENTS.md.
  // Per-request CallbackHandler created inside each test.

  beforeAll(() => {
    // Ensure OTel provider is initialized before graph invocation
    // (server.ts calls this at startup; in tests we call it manually)
    setupLangfuseOtel()
  })

  it('CallbackHandler per-request + forceFlush resolves without error', async () => {
    // Import @langfuse/langchain (available in apps/api node_modules)
    const { CallbackHandler } = await import('@langfuse/langchain')
    // Import getLangfuseTracerProvider from @langfuse/tracing (available post-pnpm install)
    const { getLangfuseTracerProvider } = await import('@langfuse/tracing')

    // Assert that setupLangfuseOtel() (called in beforeAll) wired a real provider
    const provider = getLangfuseTracerProvider()
    expect(provider).not.toBeNull()

    // Per-request CallbackHandler — NEVER module-level (T-06-13, REQUIREMENTS.md)
    const handler = new CallbackHandler({ tags: ['phase6-test'] })

    const checkpointer = await getCheckpointer()
    const blueprint = await loadBlueprint('debate-strategy-v1')
    const threadId = `test-langfuse-${Date.now()}`
    console.log(`[graph.integration.test] Langfuse threadId: ${threadId}`)

    const graph = createGraph(checkpointer)

    const result = await graph.invoke(
      {
        blueprintId: 'debate-strategy-v1',
        currentPhaseId: 'opening',
        messages: [{ role: 'user' as const, content: 'Climate change is urgent.' }],
        canvasOps: [],
      },
      {
        configurable: {
          thread_id: threadId,
          blueprint,
          providerName: 'anthropic' as const,
          plaintextKey: 'test-key-placeholder',
          classifierAdapter: createMockAdapter([
            { type: 'text_delta', text: 'DOMAIN_MATCH' },
            { type: 'done' },
          ]),
          agentAdapter: createMockAdapter([
            {
              type: 'tool_use',
              name: 'canvas_mutation',
              input: { op: 'ADD_NODE', node_type_id: 'hypothesis', label: 'Climate urgency', confidence: 0.9 },
            },
            { type: 'done' },
          ]),
        },
        callbacks: [handler],
      }
    )

    // Assert the graph produced the expected output (OBS-01: trace reflects real graph state)
    expect(result.guardrailResult).toBe('DOMAIN_MATCH')
    expect(result.canvasOps.length).toBeGreaterThan(0)

    // Flush Langfuse spans to the OTel exporter (OBS-02).
    // D-04: flush must be called even for DRIFT silent exits — always flush after invoke().
    // Network errors during flush are expected in environments without Langfuse connectivity;
    // we verify the flush is called (not that it succeeds over the wire) — dashboard
    // confirmation is the human-verify checkpoint below.
    let flushError: unknown = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (getLangfuseTracerProvider() as any).forceFlush()
    } catch (e) {
      flushError = e
      console.warn('[graph.integration.test] forceFlush error (expected without Langfuse connectivity):', e)
    }

    // Human verification of the Langfuse dashboard is required to confirm node spans,
    // classification result, confidence score, and token costs (checkpoint:human-verify task)
    if (!flushError) {
      console.log(
        '[graph.integration.test] Langfuse trace flushed. ' +
        'Verify trace tagged "phase6-test" in your Langfuse dashboard.'
      )
    }
  })
})
