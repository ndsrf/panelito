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
 */

import type { ReactNode } from 'react'
import { AnalyticsPanel } from '@/components/workspace/AnalyticsPanel'
import { BranchNavigator } from '@/components/workspace/BranchNavigator'
import { ChatStream } from '@/components/workspace/ChatStream'
import { InputBox } from '@/components/workspace/InputBox'
import { CreatorControls } from '@/components/workspace/CreatorControls'
import { useSessionStatus } from '@/hooks/use-session-status'
import { useCreatorPresence } from '@/hooks/use-creator-presence'
import { useSessionStore } from '@/store/session-store'
import type { Session } from '@panelito/types'

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

  return (
    <div className="workspace-shell relative">
      {/* Top 40%: Analytics Panel with Error Boundary (LAYOUT-02, LAYOUT-07) */}
      <div className="relative">
        <AnalyticsPanel hasApiKey={hasApiKey} />

        {/* Creator controls: overlayed at top-right of analytics panel */}
        {isCreator && (
          <div className="absolute top-3 right-3 z-10">
            <CreatorControls session={liveSession} />
          </div>
        )}
      </div>

      {/* 48px sticky Branch Navigator divider (LAYOUT-05, CHAT-06) */}
      <BranchNavigator />

      {/* Chat column: flex:1 area, relative for absolute InputBox positioning */}
      <div className="flex-1 relative overflow-hidden">
        {/* Chat stream fills remaining space (LAYOUT-03, CHAT-01..05) */}
        <ChatStream sessionId={liveSession.id} currentUserId={currentUserId} />

        {/* Input box anchored to keyboard-aware visual viewport (LAYOUT-04) */}
        {/* InputBox mounts useViewport() — single hook consumer for the workspace */}
        <InputBox
          sessionId={liveSession.id}
          sessionStatus={liveSession.status}
          userId={currentUserId}
          displayName={currentUserDisplayName}
          shortCode={shortCode}
          autoFreezeReason={liveSession.status === 'frozen' ? (liveSession as Session & { auto_freeze_reason?: string }).auto_freeze_reason : undefined}
        />
      </div>
    </div>
  )
}
