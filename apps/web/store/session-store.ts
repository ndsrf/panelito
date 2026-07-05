/**
 * Session Zustand store (Plan 05 + 07 + 09-02)
 *
 * Manages:
 * - messages: Message[] — de-duplicated by id (CHAT-01 addMessage invariant)
 * - typingUsers: TypingUser[] — presence state for CHAT-06 indicator
 * - session: Session | null — live session state (SESS-07, SESS-09, SESS-11, SESS-12)
 * - canvasNodes/canvasEdges: canvas state with merge + full-replace actions (CANVAS-02, Phase 9)
 */

import { create } from 'zustand'
import type { Message, Session, Branch, CanvasNode, CanvasEdge } from '@panelito/types'
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

  /** Mic lock state from Realtime broadcast — branch-scoped (HUMAN-01, D-04). */
  micLocked: boolean

  /** Current phase ID from session state or phase_advanced broadcast (HUMAN-02, D-09). */
  currentPhase: string | null

  /** Canvas nodes — committed + ghost rows from live broadcasts (CANVAS-02, Phase 9 D-01). */
  canvasNodes: CanvasNode[]

  /** Canvas edges — committed + ghost rows from live broadcasts (CANVAS-02, Phase 9 D-01). */
  canvasEdges: CanvasEdge[]

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

  /** Set mic lock state. Called by use-session-channel on mic_acquired (true) and mic_released (false). */
  setMicLocked: (locked: boolean) => void

  /** Set current phase ID. Called by use-session-channel on phase_advanced broadcast. */
  setCurrentPhase: (phase: string) => void

  /**
   * Full-replace canvas nodes and edges.
   * Use for branch-switch and Realtime reconnect (committed-only canonical state).
   * Do NOT use for live canvas_update broadcasts — use mergeCanvasData instead (Pitfall 3).
   */
  setCanvasData: (nodes: CanvasNode[], edges: CanvasEdge[]) => void

  /**
   * Upsert canvas nodes/edges by id — for live canvas_update broadcasts.
   * Incoming nodes/edges overwrite existing entries with the same id; new entries are appended.
   * Use setCanvasData for branch-switch/reconnect full replace.
   * Pitfall 3: live broadcasts carry only the current invocation's rows, not the full canvas —
   * merging preserves earlier nodes from prior invocations (D-02, D-14).
   */
  mergeCanvasData: (nodes: CanvasNode[], edges: CanvasEdge[]) => void
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  messages: [],
  typingUsers: [],
  session: null,
  activeBranchId: 'main',
  branches: [],
  micLocked: false,
  currentPhase: null,
  canvasNodes: [],
  canvasEdges: [],

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

  setBranches: (branches) =>
    set((state) => {
      let activeBranchId = state.activeBranchId
      if (activeBranchId === 'main') {
        const dbMain = branches.find((b) => b.path_id === 'main')
        if (dbMain) {
          activeBranchId = dbMain.id
        }
      }
      return { branches, activeBranchId }
    }),

  addBranch: (branch) =>
    set((state) => {
      if (state.branches.some((b) => b.id === branch.id)) return state
      return { branches: [...state.branches, branch] }
    }),

  updateBranch: (branch) =>
    set((state) => ({
      branches: state.branches.map((b) => (b.id === branch.id ? branch : b)),
    })),

  setMicLocked: (locked) => set({ micLocked: locked }),

  setCurrentPhase: (phase) => set({ currentPhase: phase }),

  setCanvasData: (nodes, edges) => set({ canvasNodes: nodes, canvasEdges: edges }),

  mergeCanvasData: (nodes, edges) =>
    set((state) => {
      // Build Maps keyed by id — existing entries as base, incoming entries overwrite (upsert semantics)
      const nodeMap = new Map(state.canvasNodes.map((n) => [n.id, n]))
      nodes.forEach((n) => nodeMap.set(n.id, n))

      const edgeMap = new Map(state.canvasEdges.map((e) => [e.id, e]))
      edges.forEach((e) => edgeMap.set(e.id, e))

      return {
        canvasNodes: Array.from(nodeMap.values()),
        canvasEdges: Array.from(edgeMap.values()),
      }
    }),
}))
