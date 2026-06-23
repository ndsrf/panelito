/**
 * Session Zustand store (Plan 05 + 07)
 *
 * Manages:
 * - messages: Message[] — de-duplicated by id (CHAT-01 addMessage invariant)
 * - typingUsers: TypingUser[] — presence state for CHAT-06 indicator
 * - session: Session | null — live session state (SESS-07, SESS-09, SESS-11, SESS-12)
 */

import { create } from 'zustand'
import type { Message, Session, Branch } from '@panelito/types'
import { usePanelStore } from './panel-store'

export interface TypingUser {
  userId: string
  displayName: string
}

interface SessionStoreState {
  messages: Message[]
  typingUsers: TypingUser[]

  /** Live session state — updated by useSessionStatus broadcast hook (Plan 07). */
  session: Session | null

  /** Phase 3: Active branch ID */
  activeBranchId: string

  /** Phase 3: List of all branches in the session */
  branches: Branch[]

  /** Add a single message. De-duplicates by id — idempotent on re-delivery. */
  addMessage: (msg: Message) => void

  /** Replace the entire messages array (used on initial history load). */
  setMessages: (msgs: Message[]) => void

  /** Update the typing users list from Presence state. */
  setTypingUsers: (users: TypingUser[]) => void

  /** Update live session state (status, title, etc.) from broadcast events. */
  setSession: (session: Session) => void

  /** Phase 3: Set active branch and sync with panel store (D-07, BRANCH-06) */
  setBranchId: (branchId: string) => void

  /** Phase 3: Set all branches */
  setBranches: (branches: Branch[]) => void

  /** Phase 3: Add a new branch dynamically */
  addBranch: (branch: Branch) => void

  /** Phase 3: Update an existing branch dynamically */
  updateBranch: (branch: Branch) => void
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  messages: [],
  typingUsers: [],
  session: null,
  activeBranchId: 'main',
  branches: [],

  addMessage: (msg) =>
    set((state) => {
      // CHAT-01: de-duplicate by id so Realtime re-delivery is idempotent
      if (state.messages.some((m) => m.id === msg.id)) return state
      
      const newMessages = [...state.messages, msg]

      // If the incoming message has a snapshot and is in the active branch ancestry, update the panel (PANEL-05)
      if (msg.role === 'assistant' && msg.canvas_snapshot_state != null) {
        const activeBranch = state.branches.find(b => b.id === state.activeBranchId)
        const activePath = activeBranch?.path_id || 'main'
        if (activePath === msg.path_id || activePath.startsWith(msg.path_id + '.')) {
          usePanelStore.getState().setWidget(msg.canvas_snapshot_state as any)
        }
      }

      return { messages: newMessages }
    }),

  setMessages: (msgs) => set({ messages: msgs }),

  setTypingUsers: (users) => set({ typingUsers: users }),

  setSession: (session) => set({ session }),

  setBranchId: (branchId) => {
    const { branches, messages } = get()
    const activeBranch = branches.find(b => b.id === branchId)
    const activePath = activeBranch?.path_id || 'main'

    // Find the latest snapshot in the selected branch's ancestry
    let latestSnapshot: any = null
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (!m) continue
      if (m.role === 'assistant' && m.canvas_snapshot_state != null) {
        if (activePath === m.path_id || activePath.startsWith(m.path_id + '.')) {
          latestSnapshot = m.canvas_snapshot_state
          break
        }
      }
    }

    set({ activeBranchId: branchId })
    usePanelStore.getState().setBranchId(branchId)
    usePanelStore.getState().hydrateFromSnapshot(latestSnapshot)
  },

  setBranches: (branches) => set({ branches }),

  addBranch: (branch) =>
    set((state) => {
      if (state.branches.some((b) => b.id === branch.id)) return state
      return { branches: [...state.branches, branch] }
    }),

  updateBranch: (branch) =>
    set((state) => ({
      branches: state.branches.map((b) => (b.id === branch.id ? branch : b)),
    })),
}))
