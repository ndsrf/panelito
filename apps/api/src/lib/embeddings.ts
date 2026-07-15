/**
 * embeddings.ts — Local ONNX embedding singleton + cosine similarity + domain centroid (TRIGGER-03, GRAPH-03).
 *
 * Provides a lazily-initialized `@huggingface/transformers` feature-extraction pipeline
 * (`Xenova/all-MiniLM-L6-v2`), shared by the drift-redirect (TRIGGER-03) and orphan-edge
 * (GRAPH-03) Skills. All inference is local/in-process — $0 API cost (COST-01/02).
 *
 * Singleton idiom copied verbatim from langgraph-checkpointer.ts's getCheckpointer():
 * the in-flight PROMISE is assigned synchronously (before any await), never the resolved
 * value. This prevents the race where two Skills' detect() calls both run inside the same
 * TriggerGateNode Promise.allSettled fan-out, both see the singleton as unset, and both
 * call pipeline(), double-loading the ~90MB model (RESEARCH.md Pitfall 2).
 */

import { pipeline } from '@huggingface/transformers'
import type { FeatureExtractionPipeline } from '@huggingface/transformers'
import type { Blueprint, NodeTypeConfig, EdgeTypeConfig } from '@panelito/types'

/**
 * Module-level singleton — stores the in-flight Promise so concurrent callers
 * (drift-redirect + orphan-edge, racing inside the same Promise.allSettled batch)
 * all await the same initialization and receive the same pipeline instance.
 * Using a Promise (not the resolved value) prevents the double-load race.
 */
let _extractorPromise: Promise<FeatureExtractionPipeline> | null = null

/**
 * getExtractor — lazily initializes the feature-extraction pipeline singleton.
 *
 * CRITICAL: the Promise itself is assigned synchronously, before any `await` in this
 * function body — this is what makes the check-then-assign atomic from the caller's
 * perspective. Concurrent callers all read the same non-null Promise and await it.
 */
export function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (_extractorPromise === null) {
    console.log('[embeddings] Initializing feature-extraction pipeline (Xenova/all-MiniLM-L6-v2)')
    _extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as Promise<FeatureExtractionPipeline>
  }
  return _extractorPromise
}

/**
 * embed — computes a unit-normalized sentence embedding for the given text.
 *
 * Uses mean pooling + L2 normalization ({ pooling: 'mean', normalize: true }) so
 * cosineSimilarity() below can reduce to a plain dot product (no separate magnitude
 * division needed).
 */
export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getExtractor()
  const output = await extractor(text, { pooling: 'mean', normalize: true })
  return output.data as Float32Array
}

/**
 * cosineSimilarity — dot product of two unit-normalized vectors.
 *
 * Vectors produced by embed() are already unit-normalized ({normalize:true}), so a
 * plain dot product IS the cosine similarity — no magnitude division required.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0)
  }
  return dot
}

/**
 * Domain centroid cache — computed once per Blueprint.id (D-08), not per message.
 * In-memory only; process-local. On Vercel serverless this is rebuilt on every cold
 * start (acceptable — a single cheap embed call); on the standalone server.ts process
 * it persists for the process lifetime. This is the ONE explicit exception to the
 * "all bot state in PostgresSaver/Postgres" rule — the computation is deterministic
 * and cheap to recompute, not authoritative state.
 */
const _centroidCache = new Map<string, Promise<Float32Array>>()

/**
 * getDomainCentroid — returns the cached (or newly computed) domain centroid embedding
 * for a Blueprint. Embeds `[blueprint.name, ...node_types labels, ...edge_types labels]`
 * joined with '. ' (D-08), cached keyed by blueprint.id so repeated calls for the same
 * Blueprint within a process never re-embed.
 */
export function getDomainCentroid(blueprint: Blueprint): Promise<Float32Array> {
  let cached = _centroidCache.get(blueprint.id)
  if (!cached) {
    const text = [
      blueprint.name,
      ...blueprint.node_types.map((n: NodeTypeConfig) => n.label),
      ...blueprint.edge_types.map((e: EdgeTypeConfig) => e.label),
    ].join('. ')
    cached = embed(text)
    _centroidCache.set(blueprint.id, cached)
  }
  return cached
}
