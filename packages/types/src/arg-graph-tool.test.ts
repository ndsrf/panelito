/**
 * arg-graph-tool.test.ts — Tests for argGraphExtractionTool (11-01-PLAN.md Task 1 behavior).
 *
 * Behavior assertions:
 *   - argGraphExtractionTool.name === 'extract_arg_graph'
 *   - argGraphExtractionTool uses `parameters` key (provider-agnostic ProviderTool shape,
 *     matching canvas-tool.ts's exact template — NOT `input_schema`)
 *   - nodes[].id / message_id / speaker / claim-label / type are plain "string" (NOT uuid-constrained) —
 *     Finding 2: the model cannot reliably emit RFC4122 UUIDs
 *   - edges[].source_ref / target_ref / relation are plain "string" (relaxed refs, Finding 2)
 */

import { describe, it, expect } from 'vitest'
import { argGraphExtractionTool } from './arg-graph-tool'

describe('argGraphExtractionTool', () => {
  it('has name extract_arg_graph', () => {
    expect(argGraphExtractionTool.name).toBe('extract_arg_graph')
  })

  it('uses parameters key (not input_schema)', () => {
    expect(argGraphExtractionTool).toHaveProperty('parameters')
    expect(argGraphExtractionTool).not.toHaveProperty('input_schema')
  })

  it('has a description', () => {
    expect(typeof argGraphExtractionTool.description).toBe('string')
    expect(argGraphExtractionTool.description.length).toBeGreaterThan(0)
  })

  it('parameters has flat top-level properties block with nodes and edges arrays', () => {
    const params = argGraphExtractionTool.parameters as Record<string, unknown>
    expect(params.type).toBe('object')
    expect(params).toHaveProperty('properties')
    expect(params).not.toHaveProperty('oneOf')
    const properties = params.properties as Record<string, unknown>
    expect(properties.nodes).toBeDefined()
    expect(properties.edges).toBeDefined()
  })

  it('node item id/message_id/speaker/type/label are plain string (not uuid-constrained)', () => {
    const params = argGraphExtractionTool.parameters as Record<string, unknown>
    const properties = params.properties as Record<string, Record<string, unknown>>
    const nodesSchema = properties.nodes as Record<string, unknown>
    expect(nodesSchema.type).toBe('array')
    const nodeItems = nodesSchema.items as Record<string, unknown>
    const nodeProps = nodeItems.properties as Record<string, Record<string, unknown>>
    for (const key of ['id', 'message_id', 'speaker', 'label', 'type']) {
      expect(nodeProps[key]).toBeDefined()
      expect(nodeProps[key].type).toBe('string')
      expect(nodeProps[key].format).toBeUndefined()
    }
  })

  it('edge item source_ref/target_ref/relation are plain string (relaxed refs, Finding 2)', () => {
    const params = argGraphExtractionTool.parameters as Record<string, unknown>
    const properties = params.properties as Record<string, Record<string, unknown>>
    const edgesSchema = properties.edges as Record<string, unknown>
    expect(edgesSchema.type).toBe('array')
    const edgeItems = edgesSchema.items as Record<string, unknown>
    const edgeProps = edgeItems.properties as Record<string, Record<string, unknown>>
    for (const key of ['source_ref', 'target_ref', 'relation']) {
      expect(edgeProps[key]).toBeDefined()
      expect(edgeProps[key].type).toBe('string')
      expect(edgeProps[key].format).toBeUndefined()
    }
  })

  it('requires nodes and edges at top level', () => {
    const params = argGraphExtractionTool.parameters as Record<string, unknown>
    const required = params.required as string[]
    expect(required).toContain('nodes')
    expect(required).toContain('edges')
  })
})
