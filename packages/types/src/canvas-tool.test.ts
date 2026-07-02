/**
 * canvas-tool.test.ts — Tests for canvasMutationTool (06-01-PLAN.md Task 1 behavior).
 *
 * Behavior assertions:
 *   - canvasMutationTool.name === 'canvas_mutation'
 *   - canvasMutationTool.parameters uses a flat top-level properties block (Anthropic API requirement)
 *   - No oneOf at root — all fields are in a single properties dict; op enum discriminates at runtime
 *   - Fields: op (enum), node_type_id, label, source_node_id, target_node_id, edge_type_id,
 *             confidence (number 0–1), reason
 *   - only op is required at schema level; CanvasOpSchema.safeParse() enforces op-conditional fields
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

  it('parameters has flat top-level properties block (no oneOf at root)', () => {
    const params = canvasMutationTool.parameters as Record<string, unknown>
    expect(params.type).toBe('object')
    // Anthropic API requires properties at root level — no oneOf-only schema
    expect(params).toHaveProperty('properties')
    expect(params).not.toHaveProperty('oneOf')
    const properties = params.properties as Record<string, unknown>
    expect(typeof properties).toBe('object')
  })

  it('op property is a string enum with ADD_NODE, ADD_EDGE, NO_ACTION', () => {
    const params = canvasMutationTool.parameters as Record<string, unknown>
    const properties = params.properties as Record<string, Record<string, unknown>>
    const opProp = properties['op']
    expect(opProp).toBeDefined()
    expect(opProp.type).toBe('string')
    const opEnum = opProp.enum as string[]
    expect(Array.isArray(opEnum)).toBe(true)
    expect(opEnum).toContain('ADD_NODE')
    expect(opEnum).toContain('ADD_EDGE')
    expect(opEnum).toContain('NO_ACTION')
    expect(opEnum).toHaveLength(3)
  })

  it('only op is in required (field-level constraints enforced by CanvasOpSchema at runtime)', () => {
    const params = canvasMutationTool.parameters as Record<string, unknown>
    const required = params.required as string[]
    expect(Array.isArray(required)).toBe(true)
    expect(required).toContain('op')
    expect(required).toHaveLength(1)
  })

  it('ADD_NODE fields (node_type_id, label) are present in properties', () => {
    const params = canvasMutationTool.parameters as Record<string, unknown>
    const properties = params.properties as Record<string, Record<string, unknown>>
    expect(properties['node_type_id']).toBeDefined()
    expect(properties['node_type_id'].type).toBe('string')
    expect(properties['label']).toBeDefined()
    expect(properties['label'].type).toBe('string')
  })

  it('ADD_EDGE fields (source_node_id, target_node_id, edge_type_id) are present in properties', () => {
    const params = canvasMutationTool.parameters as Record<string, unknown>
    const properties = params.properties as Record<string, Record<string, unknown>>
    expect(properties['source_node_id']).toBeDefined()
    expect(properties['source_node_id'].type).toBe('string')
    expect(properties['target_node_id']).toBeDefined()
    expect(properties['target_node_id'].type).toBe('string')
    expect(properties['edge_type_id']).toBeDefined()
    expect(properties['edge_type_id'].type).toBe('string')
  })

  it('confidence field is type number with min 0 max 1', () => {
    const params = canvasMutationTool.parameters as Record<string, unknown>
    const properties = params.properties as Record<string, Record<string, unknown>>
    const confidenceProp = properties['confidence']
    expect(confidenceProp).toBeDefined()
    expect(confidenceProp.type).toBe('number')
    expect(confidenceProp.minimum).toBe(0)
    expect(confidenceProp.maximum).toBe(1)
  })

  it('reason field is present in properties (optional, for NO_ACTION)', () => {
    const params = canvasMutationTool.parameters as Record<string, unknown>
    const properties = params.properties as Record<string, Record<string, unknown>>
    expect(properties['reason']).toBeDefined()
    expect(properties['reason'].type).toBe('string')
  })
})
