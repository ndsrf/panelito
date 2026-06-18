/**
 * Unit tests for session Zustand store (Plan 05)
 *
 * Behavior 3: addMessage de-duplicates by id
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { Message } from '@panelito/types'
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

describe('useSessionStore', () => {
  beforeEach(() => {
    // Reset the store before each test
    useSessionStore.getState().setMessages([])
    useSessionStore.getState().setTypingUsers([])
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
})
