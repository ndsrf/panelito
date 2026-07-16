/**
 * embeddings.test.ts — Unit tests for TRIGGER-03/GRAPH-03 embeddings.ts.
 *
 * Mocks '@huggingface/transformers' pipeline() so no real ~90MB ONNX model download
 * happens in CI (RESEARCH.md Environment Availability). Tests:
 *   1. getExtractor() calls pipeline() at most once across two concurrent callers
 *      (Pitfall 2 — singleton promise race).
 *   2. cosineSimilarity of two identical unit vectors ≈ 1, orthogonal ≈ 0.
 *   3. getDomainCentroid embeds once per distinct blueprint.id (cached by id).
 *
 * Module state (`_extractorPromise`, `_centroidCache`) is module-level, so each test
 * re-imports the module fresh via vi.resetModules() (same pattern as bot-arbitrator.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Blueprint } from '@panelito/types'

// -----------------------------------------------------------------------
// Mock '@huggingface/transformers' — pipeline() must never hit the network
// or load a real ONNX model in tests.
// -----------------------------------------------------------------------

const pipelineMock = vi.fn()

vi.mock('@huggingface/transformers', () => ({
  pipeline: (...args: unknown[]) => pipelineMock(...args),
}))

async function importFresh() {
  vi.resetModules()
  return import('./embeddings')
}

/** Deterministic fake extractor: returns a fixed unit vector per distinct input text. */
function buildFakeExtractor() {
  const seen = new Map<string, Float32Array>()
  let counter = 0
  const extractorFn = vi.fn(async (text: string) => {
    let vec = seen.get(text)
    if (!vec) {
      counter += 1
      // Deterministic pseudo-embedding — distinct texts get distinct unit vectors.
      vec = new Float32Array([Math.sin(counter), Math.cos(counter), 0])
      seen.set(text, vec)
    }
    return { data: vec }
  })
  return extractorFn
}

const blueprintStub: Blueprint = {
  id: 'bp-1',
  name: 'Test Blueprint',
  canvas_view_mode: 'graph',
  node_types: [{ id: 'claim', label: 'Claim', color: '#fff', description: 'A claim' }],
  edge_types: [{ id: 'supports', label: 'Supports', color: '#000' }],
  phase_sequence: [{ id: 'p1', label: 'Phase 1', llm_instructions: '...', allowed_node_types: ['claim'], phase_readiness_gate: { min_nodes: 3, min_messages_after: 5 } }],
  active_persona_ids: [],
  drift_reply_probability: 0.8,
  drift_detection_enabled: true,
  bot_defaults: {},
  role_personalities: {},
}

describe('embeddings', () => {
  beforeEach(() => {
    pipelineMock.mockReset()
  })

  it('getExtractor() calls pipeline() at most once across two concurrent callers', async () => {
    const { getExtractor } = await importFresh()
    const extractorFn = buildFakeExtractor()
    pipelineMock.mockImplementation(async () => extractorFn)

    const [a, b] = await Promise.all([getExtractor(), getExtractor()])

    expect(pipelineMock).toHaveBeenCalledTimes(1)
    expect(pipelineMock).toHaveBeenCalledWith('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
    expect(a).toBe(b)
  })

  it('cosineSimilarity of two identical unit vectors is approximately 1', async () => {
    const { cosineSimilarity } = await importFresh()
    const v = new Float32Array([0.6, 0.8, 0])
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5)
  })

  it('cosineSimilarity of two orthogonal unit vectors is approximately 0', async () => {
    const { cosineSimilarity } = await importFresh()
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([0, 1, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5)
  })

  it('getDomainCentroid embeds once per distinct blueprint.id (cached)', async () => {
    const { getDomainCentroid } = await importFresh()
    const extractorFn = buildFakeExtractor()
    pipelineMock.mockImplementation(async () => extractorFn)

    await getDomainCentroid(blueprintStub)
    await getDomainCentroid(blueprintStub)
    await getDomainCentroid(blueprintStub)

    // Same blueprint.id 3x — only 1 distinct embed call (extractorFn called once with
    // the same composed text; internal fake-extractor call count matches call count,
    // not distinct-text count — assert the underlying extractor was invoked exactly once).
    expect(extractorFn).toHaveBeenCalledTimes(1)

    const otherBlueprint: Blueprint = { ...blueprintStub, id: 'bp-2', name: 'Other Blueprint' }
    await getDomainCentroid(otherBlueprint)

    expect(extractorFn).toHaveBeenCalledTimes(2)
  })
})
