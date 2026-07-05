'use client'

/**
 * Workspace — composition root for the 40/60 split-screen layout.
 *
 * LAYOUT-01: workspace-shell class (height: var(--app-height))
 * LAYOUT-02: AnalyticsPanel (flex-shrink: 0, 40% height)
 * LAYOUT-03: ChatStream (flex: 1, keyboard-aware)
 * LAYOUT-04: InputBox (absolute, bottom: var(--keyboard-height))
 * LAYOUT-05: BranchNavigator (48px sticky between analytics and chat)
 * LAYOUT-07: Error Boundary wraps AnalyticsPanel (in AnalyticsPanel.tsx)
 *
 * Structure (top to bottom):
 *   workspace-shell
 *   ├── AnalyticsPanel (40% — contains ErrorBoundary)
 *   ├── BranchNavigator (48px sticky divider)
 *   └── chat-column (flex:1, relative — contains ChatStream + InputBox)
 *       ├── ChatStream (fills flex:1)
 *       └── InputBox (absolute bottom, keyboard-aware — mounts useViewport)
 *
 * CreatorControls is overlayed at the top-right of the analytics panel
 * when the current user is the session creator.
 *
 * Plan 07: Wires useSessionStatus + useCreatorPresence for live session state.
 *
 * Phase 2 — Plan 03: AI streaming integration (AI-03, AI-07, D-01, D-02, D-04)
 *
 * Phase 9 — Plan 09-02: Branch-switch canvas fetch (D-13).
 * - canvasViewMode: server-resolved Blueprint canvas_view_mode (D-08)
 * - fetchCanvas: fetches committed-only canvas on branch switch; fail-silent
 *
 * Responsibilities:
 * - useAIStream: SSE consumer hook for the /invoke endpoint (D-01)
 * - handleAfterSend: callback passed to InputBox; detects @analista and opens the stream
 * - Ephemeral streaming AI bubble: rendered below ChatStream while localAIStreaming is true (D-02)
 * - AnalyticsPanel.isStreaming: receives localAIStreaming so the panel header shows "Analizando..."
 *
 * InputBox owns:
 * - useTypingPresence: presence channel (only one subscriber per userId) — CHAT-06
 * - isAIStreaming read from presence (session-wide soft-lock for all participants)
 * - Streaming dots + placeholder swap (UI-SPEC Surface 6)
 */

import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { AnalyticsPanel } from '@/components/workspace/AnalyticsPanel'
import { BranchNavigator } from '@/components/workspace/BranchNavigator'
import { ChatStream } from '@/components/workspace/ChatStream'
import { InputBox } from '@/components/workspace/InputBox'
import { CreatorControls } from '@/components/workspace/CreatorControls'
import { useRouter } from 'next/navigation'
import { useSessionStatus } from '@/hooks/use-session-status'
import { useCreatorPresence } from '@/hooks/use-creator-presence'
import { useAIStream } from '@/hooks/use-ai-stream'
import { useSessionStore } from '@/store/session-store'
import { apiFetch } from '@/lib/api'
import type { Session, Message, Branch, CanvasNode, CanvasEdge } from '@panelito/types'

/** Regex to detect @analista mention (case-insensitive, AI-07) */
const ANALISTA_PATTERN = /@analista/i

interface WorkspaceProps {
  session: Session
  hasApiKey: boolean
  currentUserId: string
  currentUserDisplayName: string
  shortCode?: string
  initialBranches?: Branch[]
  /** Server-resolved Blueprint canvas_view_mode (D-08, CANVAS-04).
   *  Defaults to 'chart' if no Blueprint is set or Blueprint load fails.
   *  'graph' → GraphCanvas widget gating; 'chart' → existing Recharts panel. */
  canvasViewMode?: 'graph' | 'chart'
}

/**
 * Workspace — 40/60 split-screen composition root.
 *
 * @param session - The fetched session object from the server component.
 * @param hasApiKey - Whether the creator has a verified Anthropic API key.
 *                   Plan 04: hardcoded false. Plan 06: wires real value from creator_settings.
 * @param currentUserId - The authenticated user's ID (for creator gate + isOwn bubbles).
 * @param currentUserDisplayName - The user's display name for typing presence (CHAT-06).
 * @param shortCode - Session short code for guest session localStorage lookup.
 * @param initialBranches - Initial branches array to populate store.
 * @param canvasViewMode - Blueprint-resolved canvas view mode (D-08). Defaults to 'chart'.
 */
export function Workspace({
  session,
  hasApiKey,
  currentUserId,
  currentUserDisplayName,
  shortCode,
  initialBranches = [],
  canvasViewMode = 'chart',
}: WorkspaceProps): ReactNode {
  const router = useRouter()
  const isCreator = currentUserId === session.creator_id

  const [panelHeight, setPanelHeight] = useState<number | null>(null)
  const isDraggingRef = useRef(false)
  const startYRef = useRef(0)
  const startHeightRef = useRef(0)
  const workspaceRef = useRef<HTMLDivElement>(null)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = true
    startYRef.current = e.clientY

    const panelEl = workspaceRef.current?.querySelector('.analytics-panel')
    if (panelEl) {
      startHeightRef.current = panelEl.getBoundingClientRect().height
    }
  }

  const handleResetHeight = () => {
    setPanelHeight(null)
  }

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return

      const deltaY = e.clientY - startYRef.current
      let newHeight = startHeightRef.current + deltaY

      if (workspaceRef.current) {
        const workspaceHeight = workspaceRef.current.getBoundingClientRect().height
        const minHeight = 80
        const maxHeight = workspaceHeight - 120
        if (newHeight < minHeight) newHeight = minHeight
        if (newHeight > maxHeight) newHeight = maxHeight
      }

      setPanelHeight(newHeight)
    }

    const handlePointerUp = () => {
      isDraggingRef.current = false
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [])

  // Hydrate branches into Zustand store
  useEffect(() => {
    useSessionStore.getState().setBranches(initialBranches)
  }, [initialBranches])

  // SESS-07/09/11/12: Subscribe to live session_status_change broadcasts
  useSessionStatus(session.id, session)

  // SESS-07: Publish creator presence heartbeats (creator only; no-op for guests)
  useCreatorPresence(session.id, isCreator)

  // Read live session from store; fall back to server-fetched session if not yet set
  const liveSession = useSessionStore((s) => s.session) ?? session

  const activeBranchId = useSessionStore((s) => s.activeBranchId)
  const branches = useSessionStore((s) => s.branches)
  const activeBranch = branches.find((b) => b.id === activeBranchId)
  const activePath = activeBranch?.path_id || 'main'

  // Auto-unfreeze: when the server says the session is frozen and the creator opens it,
  // reactivate immediately. Uses `session` (server prop) not `liveSession` (store) so it
  // fires based on server truth even when the client store has stale state.
  const didAutoUnfreeze = useRef(false)
  useEffect(() => {
    if (isCreator && session.status === 'frozen' && !didAutoUnfreeze.current) {
      didAutoUnfreeze.current = true
      apiFetch<Session>(`/api/sessions/${session.id}/unfreeze`, { method: 'POST' })
        .then((updatedSession) => {
          if (updatedSession) {
            useSessionStore.getState().setSession(updatedSession)
            router.refresh()
          }
        })
        .catch((err) => console.error('[Workspace] Auto-unfreeze failed:', err))
    }
  }, [isCreator, session.id, session.status, router])

  // WSL-02: shared re-fetch helper — called from both onMessagesRefresh and handleAfterSend.
  // Closes the Supabase LongPoll timing gap in WSL dev. In production it is idempotent
  // (Realtime has already delivered the same messages). Non-fatal: errors are swallowed.
  const refreshMessages = () => {
    apiFetch<Message[]>(
      `/api/sessions/${liveSession.id}/messages?branchId=${activeBranchId}`
    )
      .then((msgs) => useSessionStore.getState().setMessages(msgs))
      .catch(() => {})  // non-fatal — Realtime may have already delivered
  }

  // D-13, CANVAS-03: Fetch committed-only canvas snapshot for a given branch.
  // Full replace (setCanvasData) — not merge. Fail-silent: leaves existing canvas state
  // unchanged on error (branch switch still completes, canvas may show stale state).
  const fetchCanvas = useCallback((branchId: string) => {
    apiFetch<{ nodes: CanvasNode[]; edges: CanvasEdge[] }>(
      `/api/sessions/${liveSession.id}/canvas?branch_id=${branchId}`
    )
      .then(({ nodes, edges }) => {
        useSessionStore.getState().setCanvasData(nodes, edges)
      })
      .catch(() => {}) // fail-silent — leave existing canvas state unchanged on error
  }, [liveSession.id])

  // Branch switch handler: sets active branch + fetches committed canvas snapshot (D-13).
  // Passed to BranchNavigator so both actions fire atomically on branch chip click.
  const handleBranchSwitch = useCallback((newBranchId: string) => {
    useSessionStore.getState().setBranchId(newBranchId)
    fetchCanvas(newBranchId) // D-13: fetch committed-only canvas for new branch
  }, [fetchCanvas])

  // Phase 2 (D-01): SSE consumer hook for the AI invoke stream.
  // localAIStreaming: true on THIS client while it is the invoking client streaming.
  // The session-wide isAIStreaming (all participants) is derived in InputBox from presence.
  //
  // WSL-01: onMessagesRefresh calls refreshMessages when SSE 'done' fires.
  // WSL-02: handleAfterSend also calls refreshMessages (with 300ms delay) for non-@analista messages.
  const { isAIStreaming: localAIStreaming, streamingText, status: aiStatus, openAIStream, phaseSignal, pendingPhaseId, resetStream } = useAIStream(liveSession.id, {
    onMessagesRefresh: refreshMessages,
  })

  /**
   * handleAfterSend — called by InputBox after a successful message POST.
   * Detects @analista mention and opens the AI invoke SSE stream (AI-07).
   * anyoneTyping: false at this point since the user just sent (their typing state cleared).
   * The server independently checks the global typing gate.
   *
   * WSL-02: always schedules a refreshMessages() call with a 300ms delay so the user's
   * own message appears in chat immediately, without waiting for Supabase Realtime.
   */
  const handleAfterSend = (content: string) => {
    if (ANALISTA_PATTERN.test(content)) {
      openAIStream(content, false, activeBranchId).catch((err) => {
        console.error('[Workspace] openAIStream failed:', err)
      })
    }
    // WSL-02: always refresh after send — closes Supabase Realtime gap in WSL2.
    // 300ms delay ensures the message POST has committed before re-fetch.
    setTimeout(refreshMessages, 300)
  }

  // Map AI stream error states to user-visible messages (shown briefly below the input)
  const aiErrorMessage =
    aiStatus === 'no_api_key'
      ? (isCreator
          ? 'Conecta tu API key en Configuración para activar el Analista.'
          : 'El Analista no está disponible en este momento.')
      : aiStatus === 'no_persona' ? 'El Analista está desactivado. Actívalo en los controles de sesión.' :
      aiStatus === 'error' ? 'El Analista no pudo responder. Verifica tu conexión e inténtalo de nuevo.' :
      null

  // Build an ephemeral streaming AI message object for the bubble (D-02).
  // While localAIStreaming is true, this ephemeral bubble renders below the message list.
  // Once the 'done' event fires, the server persists the AI message and Realtime broadcasts
  // it to all clients — the real message replaces this ephemeral bubble automatically.
  const streamingMessage: Message = {
    id: '__streaming__',
    session_id: liveSession.id,
    author_id: liveSession.creator_id,
    display_name: 'Analista Científico',
    content: streamingText,
    path_id: activePath,
    parent_id: null,
    role: 'assistant',
    canvas_snapshot_state: null,
    created_at: new Date().toISOString(),
  } as unknown as Message

  return (
    <div
      ref={workspaceRef}
      className="workspace-shell relative"
      style={
        {
          '--analytics-panel-height': panelHeight !== null ? `${panelHeight}px` : undefined,
        } as React.CSSProperties
      }
    >
      {/* Top 40%: Analytics Panel with Error Boundary (LAYOUT-02, LAYOUT-07) */}
      <div className="relative">
        {/* isStreaming: shows "Analizando..." in panel header while AI is streaming (Plan 04) */}
        <AnalyticsPanel hasApiKey={hasApiKey} isStreaming={localAIStreaming} isCreator={isCreator} />

        {/* Creator controls: overlayed at top-right of analytics panel */}
        {isCreator && (
          <div className="absolute top-3 right-3 z-10">
            <CreatorControls
              session={liveSession}
              shortCode={shortCode ?? liveSession.short_code}
              sessionTitle={liveSession.title}
              phaseSignal={phaseSignal}
              pendingPhaseId={pendingPhaseId}
              onPhaseConsumed={resetStream}
            />
          </div>
        )}
      </div>

      {/* 48px sticky Branch Navigator divider (LAYOUT-05, CHAT-06) */}
      <BranchNavigator
        onPointerDown={handlePointerDown}
        onResetHeight={handleResetHeight}
        onBranchSwitch={handleBranchSwitch}
      />

      {/* Chat column: flex:1 area, relative for absolute InputBox positioning */}
      <div className="flex-1 relative overflow-hidden flex flex-col">
        {/* Chat stream fills remaining space (LAYOUT-03, CHAT-01..05) */}
        <ChatStream
          sessionId={liveSession.id}
          currentUserId={currentUserId}
          onTriggerAIStream={() => openAIStream('', false).catch(console.error)}
          isAIStreaming={localAIStreaming}
          streamingMessage={streamingMessage}
          aiErrorMessage={aiErrorMessage}
        />

        {/* Input box anchored to keyboard-aware visual viewport (LAYOUT-04) */}
        {/* InputBox mounts useViewport() — single hook consumer for the workspace.
            InputBox owns useTypingPresence (typing + ai_streaming presence channel).
            isAIStreaming is read from presence inside InputBox for the session-wide soft-lock. */}
        <InputBox
          sessionId={liveSession.id}
          sessionStatus={liveSession.status}
          userId={currentUserId}
          displayName={currentUserDisplayName}
          shortCode={shortCode}
          autoFreezeReason={liveSession.status === 'frozen' ? (liveSession as Session & { auto_freeze_reason?: string }).auto_freeze_reason : undefined}
          onAfterSend={handleAfterSend}
          localAIStreaming={localAIStreaming}
        />
      </div>
    </div>
  )
}
