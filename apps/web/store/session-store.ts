/**
 * Session Zustand store (Plan 05 + 07)
 *
 * Manages:
 * - messages: Message[] — de-duplicated by id (CHAT-01 addMessage invariant)
 * - typingUsers: TypingUser[] — presence state for CHAT-06 indicator
 * - session: Session | null — live session state (SESS-07, SESS-09, SESS-11, SESS-12)
 */

import { create } from 'zustand'
import type { Message, Session } from '@panelito/types'

export interface TypingUser {
  userId: string
  displayName: string
}

interface SessionStoreState {
  messages: Message[]
  typingUsers: TypingUser[]

  /** Live session state — updated by useSessionStatus broadcast hook (Plan 07). */
  session: Session | null

  /** Add a single message. De-duplicates by id — idempotent on re-delivery. */
  addMessage: (msg: Message) => void

  /** Replace the entire messages array (used on initial history load). */
  setMessages: (msgs: Message[]) => void

  /** Update the typing users list from Presence state. */
  setTypingUsers: (users: TypingUser[]) => void

  /** Update live session state (status, title, etc.) from broadcast events. */
  setSession: (session: Session) => void
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  messages: [],
  typingUsers: [],
  session: null,

  addMessage: (msg) =>
    set((state) => {
      // CHAT-01: de-duplicate by id so Realtime re-delivery is idempotent
      if (state.messages.some((m) => m.id === msg.id)) return state
      return { messages: [...state.messages, msg] }
    }),

  setMessages: (msgs) => set({ messages: msgs }),

  setTypingUsers: (users) => set({ typingUsers: users }),

  setSession: (session) => set({ session }),
}))
