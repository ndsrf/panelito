/**
 * canvas-tool.test.ts — Tests for canvasMutationTool (06-01-PLAN.md Task 1 behavior).
 *
 * Behavior assertions:
 *   - canvasMutationTool.name === 'canvas_mutation'
 *   - canvasMutationTool.parameters describes a discriminated union over `op`
 *   - Branches: ADD_NODE (node_type_id, label, confidence), ADD_EDGE (source_node_id, target_node_id, edge_type_id, confidence), NO_ACTION (reason)
 *   - canvasMutationTool uses `parameters` key (NOT `input_schema`)
 *   - canvasMutationTool is importable from '@panelito/types' (barrel re-export works)
 */

import { describe, it, expect } from 'vitest'
import { canvasMutationTool } from './canvas-tool'

describe('canvasMutationTool', () => {
  it('has name canvas_mutation', () => {
    expect(canvasMutationTool.name).toBe('canvas_mutation')
  })

  it('uses parameters key (not input_schema)', () => {
    expect(canvasMutationTool).toHaveProperty('parameters')
    expect(canvasMutationTool).not.toHaveProperty('input_schema')
  })

  it('has a description', () => {
    expect(typeof canvasMutationTool.description).toBe('string')
    expect(canvasMutationTool.description.length).toBeGreaterThan(0)
  })

  it('parameters has oneOf with three branches', () => {
    const params = canvasMutationTool.parameters as Record<string, unknown>
    expect(params.type).toBe('object')
    const oneOf = params.oneOf as unknown[]
    expect(Array.isArray(oneOf)).toBe(true)
    expect(oneOf).toHaveLength(3)
  })

  it('ADD_NODE branch has required fields including op, node_type_id, label, confidence', () => {
    const params = canvasMutationTool.parameters as Record<string, unknown>
    const oneOf = params.oneOf as Array<{ properties: Record<string, unknown>; required: string[] }>
    const addNodeBranch = oneOf.find((branch) => {
      const opProp = branch.properties?.['op'] as Record<string, unknown> | undefined
      return Array.isArray(opProp?.['enum']) && (opProp['enum'] as string[]).includes('ADD_NODE')
    })
    expect(addNodeBranch).toBeDefined()
    expect(addNodeBranch!.required).toContain('op')
    expect(addNodeBranch!.required).toContain('node_type_id')
    expect(addNodeBranch!.required).toContain('label')
    expect(addNodeBranch!.required).toContain('confidence')
  })

  it('ADD_EDGE branch has required fields including source_node_id, target_node_id, edge_type_id, confidence', () => {
    const params = canvasMutationTool.parameters as Record<string, unknown>
    const oneOf = params.oneOf as Array<{ properties: Record<string, unknown>; required: string[] }>
    const addEdgeBranch = oneOf.find((branch) => {
      const opProp = branch.properties?.['op'] as Record<string, unknown> | undefined
      return Array.isArray(opProp?.['enum']) && (opProp['enum'] as string[]).includes('ADD_EDGE')
    })
    expect(addEdgeBranch).toBeDefined()
    expect(addEdgeBranch!.required).toContain('op')
    expect(addEdgeBranch!.required).toContain('source_node_id')
    expect(addEdgeBranch!.required).toContain('target_node_id')
    expect(addEdgeBranch!.required).toContain('edge_type_id')
    expect(addEdgeBranch!.required).toContain('confidence')
  })

  it('NO_ACTION branch has only op in required (reason optional)', () => {
    const params = canvasMutationTool.parameters as Record<string, unknown>
    const oneOf = params.oneOf as Array<{ properties: Record<string, unknown>; required: string[] }>
    const noActionBranch = oneOf.find((branch) => {
      const opProp = branch.properties?.['op'] as Record<string, unknown> | undefined
      return Array.isArray(opProp?.['enum']) && (opProp['enum'] as string[]).includes('NO_ACTION')
    })
    expect(noActionBranch).toBeDefined()
    expect(noActionBranch!.required).toContain('op')
    // reason must NOT be in required (it's optional)
    expect(noActionBranch!.required).not.toContain('reason')
  })

  it('confidence fields on ADD_NODE and ADD_EDGE are type number with min 0 max 1', () => {
    const params = canvasMutationTool.parameters as Record<string, unknown>
    const oneOf = params.oneOf as Array<{ properties: Record<string, unknown>; required: string[] }>
    for (const opName of ['ADD_NODE', 'ADD_EDGE']) {
      const branch = oneOf.find((b) => {
        const opProp = b.properties?.['op'] as Record<string, unknown> | undefined
        return Array.isArray(opProp?.['enum']) && (opProp['enum'] as string[]).includes(opName)
      })
      expect(branch).toBeDefined()
      const confidenceProp = branch!.properties['confidence'] as Record<string, unknown>
      expect(confidenceProp.type).toBe('number')
      expect(confidenceProp.minimum).toBe(0)
      expect(confidenceProp.maximum).toBe(1)
    }
  })

  it('op enum values are ADD_NODE, ADD_EDGE, NO_ACTION', () => {
    const params = canvasMutationTool.parameters as Record<string, unknown>
    const oneOf = params.oneOf as Array<{ properties: Record<string, unknown> }>
    const ops = oneOf.map((branch) => {
      const opProp = branch.properties?.['op'] as Record<string, unknown> | undefined
      return (opProp?.['enum'] as string[] | undefined)?.[0]
    })
    expect(ops).toContain('ADD_NODE')
    expect(ops).toContain('ADD_EDGE')
    expect(ops).toContain('NO_ACTION')
  })
})
