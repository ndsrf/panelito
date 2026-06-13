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

import type { ReactNode } from 'react'
import { AnalyticsPanel } from '@/components/workspace/AnalyticsPanel'
import { BranchNavigator } from '@/components/workspace/BranchNavigator'
import { ChatStream } from '@/components/workspace/ChatStream'
import { InputBox } from '@/components/workspace/InputBox'
import { MessageBubble } from '@/components/workspace/MessageBubble'
import { CreatorControls } from '@/components/workspace/CreatorControls'
import { useSessionStatus } from '@/hooks/use-session-status'
import { useCreatorPresence } from '@/hooks/use-creator-presence'
import { useAIStream } from '@/hooks/use-ai-stream'
import { useSessionStore } from '@/store/session-store'
import type { Session, Message } from '@panelito/types'

/** Regex to detect @analista mention (case-insensitive, AI-07) */
const ANALISTA_PATTERN = /@analista/i

interface WorkspaceProps {
  session: Session
  hasApiKey: boolean
  currentUserId: string
  currentUserDisplayName: string
  shortCode?: string
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
 */
export function Workspace({
  session,
  hasApiKey,
  currentUserId,
  currentUserDisplayName,
  shortCode,
}: WorkspaceProps): ReactNode {
  const isCreator = currentUserId === session.creator_id

  // SESS-07/09/11/12: Subscribe to live session_status_change broadcasts
  useSessionStatus(session.id, session)

  // SESS-07: Publish creator presence heartbeats (creator only; no-op for guests)
  useCreatorPresence(session.id, isCreator)

  // Read live session from store; fall back to server-fetched session if not yet set
  const liveSession = useSessionStore((s) => s.session) ?? session

  // Phase 2 (D-01): SSE consumer hook for the AI invoke stream.
  // localAIStreaming: true on THIS client while it is the invoking client streaming.
  // The session-wide isAIStreaming (all participants) is derived in InputBox from presence.
  const { isAIStreaming: localAIStreaming, streamingText, openAIStream } = useAIStream(liveSession.id)

  /**
   * handleAfterSend — called by InputBox after a successful message POST.
   * Detects @analista mention and opens the AI invoke SSE stream (AI-07).
   * anyoneTyping: false at this point since the user just sent (their typing state cleared).
   * The server independently checks the global typing gate.
   */
  const handleAfterSend = (content: string) => {
    if (ANALISTA_PATTERN.test(content)) {
      openAIStream(content, false).catch((err) => {
        console.error('[Workspace] openAIStream failed:', err)
      })
    }
  }

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
    path_id: 'main',
    parent_id: null,
    role: 'assistant',
    canvas_snapshot_state: null,
    created_at: new Date().toISOString(),
  } as unknown as Message

  return (
    <div className="workspace-shell relative">
      {/* Top 40%: Analytics Panel with Error Boundary (LAYOUT-02, LAYOUT-07) */}
      <div className="relative">
        {/* isStreaming: shows "Analizando..." in panel header while AI is streaming (Plan 04) */}
        <AnalyticsPanel hasApiKey={hasApiKey} isStreaming={localAIStreaming} />

        {/* Creator controls: overlayed at top-right of analytics panel */}
        {isCreator && (
          <div className="absolute top-3 right-3 z-10">
            <CreatorControls
              session={liveSession}
              shortCode={shortCode ?? liveSession.short_code}
              sessionTitle={liveSession.title}
            />
          </div>
        )}
      </div>

      {/* 48px sticky Branch Navigator divider (LAYOUT-05, CHAT-06) */}
      <BranchNavigator />

      {/* Chat column: flex:1 area, relative for absolute InputBox positioning */}
      <div className="flex-1 relative overflow-hidden">
        {/* Chat stream fills remaining space (LAYOUT-03, CHAT-01..05) */}
        <ChatStream sessionId={liveSession.id} currentUserId={currentUserId} />

        {/* Ephemeral streaming AI bubble (D-02):
            Shown only on the invoking client while localAIStreaming is true.
            All other participants see the final message via Realtime when the stream ends. */}
        {localAIStreaming && (
          <div className="px-0">
            <MessageBubble
              message={streamingMessage}
              isOwn={false}
              isAI={true}
              isStreaming={true}
              streamingText={streamingText}
            />
          </div>
        )}

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
        />
      </div>
    </div>
  )
}
