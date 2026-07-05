/**
 * Unit tests for session Zustand store (Plan 05 + Plan 09-02)
 *
 * Behavior 3: addMessage de-duplicates by id
 * Behavior 4: mergeCanvasData upsert-by-id semantics (Plan 09-02, Pitfall 3)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { Message, CanvasNode, CanvasEdge } from '@panelito/types'
import { useSessionStore } from './session-store'

// Helper: create a minimal Message for testing
function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-' + Math.random().toString(36).slice(2),
    session_id: 'sess-1',
    author_id: 'user-1',
    display_name: 'Test User',
    parent_id: null,
    path_id: 'main',
    role: 'user',
    content: 'hello',
    canvas_snapshot_state: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

// Helper: create a minimal CanvasNode for testing
function makeNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    session_id: '00000000-0000-0000-0000-000000000002',
    branch_id: '00000000-0000-0000-0000-000000000003',
    blueprint_id: 'debate-strategy-v1',
    node_type_id: 'hypothesis',
    label: 'Test Node',
    status: 'committed',
    position_x: null,
    position_y: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

// Helper: create a minimal CanvasEdge for testing
function makeEdge(overrides: Partial<CanvasEdge> = {}): CanvasEdge {
  return {
    id: '00000000-0000-0000-0000-000000000004',
    session_id: '00000000-0000-0000-0000-000000000002',
    branch_id: '00000000-0000-0000-0000-000000000003',
    blueprint_id: 'debate-strategy-v1',
    edge_type_id: 'SUPPORTS',
    source_node_id: '00000000-0000-0000-0000-000000000001',
    target_node_id: '00000000-0000-0000-0000-000000000005',
    status: 'committed',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('useSessionStore', () => {
  beforeEach(() => {
    // Reset the store before each test
    useSessionStore.getState().setMessages([])
    useSessionStore.getState().setTypingUsers([])
    useSessionStore.getState().setCanvasData([], [])
  })

  it('addMessage deduplicates by id — adding same message twice keeps length === 1', () => {
    const msg = makeMessage({ id: 'dedup-test-id' })

    useSessionStore.getState().addMessage(msg)
    useSessionStore.getState().addMessage(msg) // second time, same id

    const messages = useSessionStore.getState().messages
    expect(messages.length).toBe(1)
  })

  it('addMessage appends distinct messages', () => {
    const msg1 = makeMessage({ id: 'id-1' })
    const msg2 = makeMessage({ id: 'id-2' })

    useSessionStore.getState().addMessage(msg1)
    useSessionStore.getState().addMessage(msg2)

    const messages = useSessionStore.getState().messages
    expect(messages.length).toBe(2)
  })

  it('setMessages replaces the entire messages array', () => {
    const msgs = [makeMessage(), makeMessage()]

    useSessionStore.getState().setMessages(msgs)

    expect(useSessionStore.getState().messages.length).toBe(2)
  })

  it('setTypingUsers updates the typing users list', () => {
    const typingUsers = [{ userId: 'u1', displayName: 'Alice' }]

    useSessionStore.getState().setTypingUsers(typingUsers)

    expect(useSessionStore.getState().typingUsers).toEqual(typingUsers)
  })

  // ─── mergeCanvasData tests (Plan 09-02, Task 1) ───────────────────────────

  it('mergeCanvasData adds new nodes not previously in the store (union by id)', () => {
    const existing = makeNode({ id: '11111111-0000-0000-0000-000000000001', label: 'Existing' })
    useSessionStore.getState().setCanvasData([existing], [])

    const incoming = makeNode({ id: '22222222-0000-0000-0000-000000000001', label: 'New' })
    useSessionStore.getState().mergeCanvasData([incoming], [])

    const { canvasNodes } = useSessionStore.getState()
    expect(canvasNodes.length).toBe(2)
    expect(canvasNodes.some((n) => n.id === '11111111-0000-0000-0000-000000000001')).toBe(true)
    expect(canvasNodes.some((n) => n.id === '22222222-0000-0000-0000-000000000001')).toBe(true)
  })

  it('mergeCanvasData updates existing node in place when ids collide (incoming wins) without dropping other nodes', () => {
    const nodeA = makeNode({ id: 'aaaaaaaa-0000-0000-0000-000000000001', label: 'Original A' })
    const nodeB = makeNode({ id: 'bbbbbbbb-0000-0000-0000-000000000001', label: 'B' })
    useSessionStore.getState().setCanvasData([nodeA, nodeB], [])

    const updatedA = makeNode({ id: 'aaaaaaaa-0000-0000-0000-000000000001', label: 'Updated A' })
    useSessionStore.getState().mergeCanvasData([updatedA], [])

    const { canvasNodes } = useSessionStore.getState()
    expect(canvasNodes.length).toBe(2) // nodeB still present
    const resultA = canvasNodes.find((n) => n.id === 'aaaaaaaa-0000-0000-0000-000000000001')
    expect(resultA?.label).toBe('Updated A') // incoming wins
    expect(canvasNodes.some((n) => n.id === 'bbbbbbbb-0000-0000-0000-000000000001')).toBe(true) // nodeB preserved
  })

  it('mergeCanvasData with empty arrays leaves the store unchanged', () => {
    const node = makeNode({ id: 'cccccccc-0000-0000-0000-000000000001' })
    const edge = makeEdge({ id: 'dddddddd-0000-0000-0000-000000000001' })
    useSessionStore.getState().setCanvasData([node], [edge])

    useSessionStore.getState().mergeCanvasData([], [])

    const { canvasNodes, canvasEdges } = useSessionStore.getState()
    expect(canvasNodes.length).toBe(1)
    expect(canvasEdges.length).toBe(1)
  })

  it('mergeCanvasData merges edges by id with the same upsert semantics', () => {
    const existingEdge = makeEdge({ id: 'eeeeeeee-0000-0000-0000-000000000001', edge_type_id: 'SUPPORTS' })
    useSessionStore.getState().setCanvasData([], [existingEdge])

    const newEdge = makeEdge({ id: 'ffffffff-0000-0000-0000-000000000001', edge_type_id: 'CONTRADICTS' })
    const updatedEdge = makeEdge({ id: 'eeeeeeee-0000-0000-0000-000000000001', edge_type_id: 'BUILDS_ON' })
    useSessionStore.getState().mergeCanvasData([], [newEdge, updatedEdge])

    const { canvasEdges } = useSessionStore.getState()
    expect(canvasEdges.length).toBe(2)
    const resultA = canvasEdges.find((e) => e.id === 'eeeeeeee-0000-0000-0000-000000000001')
    expect(resultA?.edge_type_id).toBe('BUILDS_ON') // incoming wins
    expect(canvasEdges.some((e) => e.id === 'ffffffff-0000-0000-0000-000000000001')).toBe(true)
  })

  it('setCanvasData still performs a full replace (regression guard — merge did not change replace behavior)', () => {
    const initial = makeNode({ id: 'gggggggg-0000-0000-0000-000000000001', label: 'Initial' })
    useSessionStore.getState().setCanvasData([initial], [])

    const replacement = makeNode({ id: 'hhhhhhhh-0000-0000-0000-000000000001', label: 'Replacement' })
    useSessionStore.getState().setCanvasData([replacement], [])

    const { canvasNodes } = useSessionStore.getState()
    expect(canvasNodes.length).toBe(1)
    expect(canvasNodes[0]?.id).toBe('hhhhhhhh-0000-0000-0000-000000000001') // full replace — initial gone
    expect(canvasNodes.some((n) => n.id === 'gggggggg-0000-0000-0000-000000000001')).toBe(false)
  })
})
