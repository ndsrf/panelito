/**
 * Session Zustand store (Plan 05)
 *
 * Manages:
 * - messages: Message[] — de-duplicated by id (CHAT-01 addMessage invariant)
 * - typingUsers: TypingUser[] — presence state for CHAT-06 indicator
 */

import { create } from 'zustand'
import type { Message } from '@panelito/types'

export interface TypingUser {
  userId: string
  displayName: string
}

interface SessionStoreState {
  messages: Message[]
  typingUsers: TypingUser[]

  /** Add a single message. De-duplicates by id — idempotent on re-delivery. */
  addMessage: (msg: Message) => void

  /** Replace the entire messages array (used on initial history load). */
  setMessages: (msgs: Message[]) => void

  /** Update the typing users list from Presence state. */
  setTypingUsers: (users: TypingUser[]) => void
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  messages: [],
  typingUsers: [],

  addMessage: (msg) =>
    set((state) => {
      // CHAT-01: de-duplicate by id so Realtime re-delivery is idempotent
      if (state.messages.some((m) => m.id === msg.id)) return state
      return { messages: [...state.messages, msg] }
    }),

  setMessages: (msgs) => set({ messages: msgs }),

  setTypingUsers: (users) => set({ typingUsers: users }),
}))
