'use client'

/**
 * MessageList — scrollable chat message list with real-time updates (CHAT-03)
 *
 * CHAT-03: Auto-scrolls to the latest message when the user is within 64px of bottom.
 *          Preserves scroll position when the user has scrolled up to read history.
 * CHAT-01: Initial history loaded from GET /api/sessions/:id/messages on mount.
 *          Live updates delivered via useSessionChannel (broadcast subscription).
 *
 * Plan 07: Renders system messages (display_name === 'system') with distinct styling.
 *
 * Phase 2 additions (REACT-01–05):
 * - useReactions(sessionId, currentUserId) — optimistic reaction state + Realtime sync
 * - Passes getReactionCounts(message.id) to each MessageBubble (Surface 3 badges)
 * - Passes onOptimisticReaction/onRevertReaction/onPostReaction callbacks per message
 * - When postReaction returns triggersAI, calls openAIStream (D-09)
 * - AI bubbles are also reactable — no human-only gate (Surface 3 spec)
 *
 * Phase 2 additions (chart restore):
 * - AI messages with canvas_snapshot_state get hasSnapshot + onChartRestore props
 */

import { useEffect, useRef, useCallback, useState, type ReactNode } from 'react'
import { useSessionStore } from '@/store/session-store'
import { useSessionChannel } from '@/hooks/use-session-channel'
import { usePanelStore } from '@/store/panel-store'
import { useReactions } from '@/hooks/use-reactions'
import { apiFetch } from '@/lib/api'
import { PanelWidgetSchema } from '@panelito/types'
import { MessageBubble } from './MessageBubble'
import type { Message } from '@panelito/types'

/** Sentinel display_name used for system messages (set in API by sessions-helpers.ts). */
const SYSTEM_DISPLAY_NAME = 'system'

/** All-zeros UUID — system author sentinel (matches SYSTEM_AUTHOR_ID in API). */
const SYSTEM_AUTHOR_ID = '00000000-0000-0000-0000-000000000000'

interface MessageListProps {
  sessionId: string
  currentUserId: string
  /** Phase 2: called when a 🔥/📌/🎯 reaction triggers an AI follow-up (D-09) */
  onTriggerAIStream?: () => void
  /** Phase 2: true while the AI stream is in flight (shows streaming bubble) */
  isAIStreaming?: boolean
  /** Phase 2: ephemeral streaming message object */
  streamingMessage?: Message
  /** Phase 2: AI stream error feedback (no_api_key, error, no_persona) */
  aiErrorMessage?: string | null
}

/**
 * SystemMessageBubble — renders a system notification (cap warning, freeze notice, etc.)
 * with no avatar, italic text, and muted foreground color.
 */
function SystemMessageBubble({ message }: { message: Message }): ReactNode {
  return (
    <div className="flex justify-center px-4 py-1">
      <div
        className="text-[13px] italic text-muted-foreground text-center max-w-[80%] px-3 py-1.5 rounded-md bg-muted/40"
        role="status"
        aria-live="polite"
      >
        {message.content}
      </div>
    </div>
  )
}

/**
 * MessageList — renders all messages and manages auto-scroll + initial history.
 */
export function MessageList({
  sessionId,
  currentUserId,
  onTriggerAIStream,
  isAIStreaming,
  streamingMessage,
  aiErrorMessage,
}: MessageListProps): ReactNode {
  const messages = useSessionStore((s) => s.messages)
  const addMessage = useSessionStore((s) => s.addMessage)
  const setMessages = useSessionStore((s) => s.setMessages)
  const setWidget = usePanelStore((s) => s.setWidget)

  const [showEphemeral, setShowEphemeral] = useState(false)
  const knownMessageIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!isAIStreaming) {
      knownMessageIdsRef.current = new Set(messages.map((m) => m.id))
    }
  }, [isAIStreaming, messages])

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined
    if (isAIStreaming) {
      const hasNewMsg = messages.some(
        (m) => m.role === 'assistant' && !knownMessageIdsRef.current.has(m.id)
      )
      if (hasNewMsg) {
        setShowEphemeral(false)
      } else {
        setShowEphemeral(true)
      }
    } else {
      const hasAssistantMessage = messages.length > 0 && messages[messages.length - 1]?.role === 'assistant'
      if (hasAssistantMessage) {
        setShowEphemeral(false)
      } else {
        timer = setTimeout(() => {
          setShowEphemeral(false)
        }, 2000)
      }
    }
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [isAIStreaming, messages])

  const handleChartRestore = useCallback((snapshot: unknown) => {
    const parsed = PanelWidgetSchema.safeParse(snapshot)
    if (parsed.success) setWidget(parsed.data)
  }, [setWidget])

  // REACT-01–05: Reaction state hook — optimistic, Realtime-synced
  const {
    getReactionCounts,
    applyOptimistic,
    revert,
    postReaction,
    ingest,
  } = useReactions(sessionId, currentUserId)

  const containerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)

  const handleScroll = () => {
    const container = containerRef.current
    if (!container) return
    const threshold = 100
    const atBottom =
      container.scrollTop + container.clientHeight >= container.scrollHeight - threshold
    shouldAutoScrollRef.current = atBottom
  }

  const scrollToBottom = useCallback(() => {
    if (shouldAutoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [])

  // Subscribe to live messages and reactions via Supabase Realtime broadcast
  useSessionChannel(sessionId, useSessionStore.getState().addMessage, ingest)

  // Load initial message history on mount
  useEffect(() => {
    apiFetch<Message[]>(`/api/sessions/${sessionId}/messages`)
      .then((msgs) => {
        setMessages(msgs)
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight
          }
        })
      })
      .catch((err) => console.error('[MessageList] history load failed', err))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Automatically sync the panel to the latest snapshot in the message history when messages load or update
  useEffect(() => {
    const latestSnapshotMsg = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.canvas_snapshot_state != null)

    if (latestSnapshotMsg?.canvas_snapshot_state) {
      usePanelStore.getState().setWidget(latestSnapshotMsg.canvas_snapshot_state as any)
    }
  }, [messages])

  // Polling fallback
  useEffect(() => {
    const poll = async () => {
      try {
        const msgs = await apiFetch<Message[]>(`/api/sessions/${sessionId}/messages`)
        const knownIds = new Set(useSessionStore.getState().messages.map((m) => m.id))
        const newMsgs = msgs.filter((m) => !knownIds.has(m.id))
        if (newMsgs.length > 0) {
          newMsgs.forEach(useSessionStore.getState().addMessage)
        }
      } catch {
        // ignore
      }
    }
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // CHAT-03: Auto-scroll to bottom if the flag is set.
  useEffect(() => {
    scrollToBottom()
    // Double-tap scroll to handle delayed height changes (images, etc)
    const id = requestAnimationFrame(scrollToBottom)
    return () => cancelAnimationFrame(id)
  }, [messages, isAIStreaming, streamingMessage?.content, scrollToBottom])

  // ResizeObserver to handle auto-scroll when container size changes (keyboard, etc)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => {
      if (shouldAutoScrollRef.current) {
        container.scrollTop = container.scrollHeight
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Prevent re-adding addMessage to session channel subscription deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  void addMessage

  /**
   * Build per-message reaction callbacks bound to that message's id.
   * These are stable closures that delegate to the useReactions hook.
   */
  const makeReactionCallbacks = useCallback(
    (messageId: string) => ({
      onOptimisticReaction: (emoji: string) => applyOptimistic(messageId, emoji),
      onRevertReaction: (emoji: string) => revert(messageId, emoji),
      onPostReaction: async (emoji: string): Promise<boolean> => {
        const triggersAI = await postReaction(messageId, emoji)
        return triggersAI
      },
      onTriggerAI: onTriggerAIStream,
    }),
    [applyOptimistic, revert, postReaction, onTriggerAIStream]
  )

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="chat-stream flex-1 overflow-y-auto"
      style={{ overscrollBehavior: 'contain' }}
    >
      {messages.length === 0 && !isAIStreaming ? (
        <div className="flex items-center justify-center h-full text-muted-foreground text-[15px] px-8 text-center">
          No hay mensajes todavia. Se el primero en escribir.
        </div>
      ) : (
        <div className="py-2">
          {messages.map((msg) => {
            const isSystemMessage =
              msg.display_name === SYSTEM_DISPLAY_NAME ||
              msg.author_id === SYSTEM_AUTHOR_ID
            if (isSystemMessage) {
              return <SystemMessageBubble key={msg.id} message={msg} />
            }
            const isAI = msg.role === 'assistant'
            const hasSnapshot = isAI && msg.canvas_snapshot_state != null
            const callbacks = makeReactionCallbacks(msg.id)
            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                isOwn={msg.author_id === currentUserId}
                isAI={isAI}
                hasSnapshot={hasSnapshot}
                onChartRestore={hasSnapshot ? () => handleChartRestore(msg.canvas_snapshot_state) : undefined}
                reactions={getReactionCounts(msg.id)}
                sessionId={sessionId}
                onOptimisticReaction={callbacks.onOptimisticReaction}
                onRevertReaction={callbacks.onRevertReaction}
                onPostReaction={callbacks.onPostReaction}
                onTriggerAI={callbacks.onTriggerAI}
              />
            )
          })}

          {/* Ephemeral streaming AI bubble (D-02): moved inside MessageList for scrolling flow */}
          {showEphemeral && streamingMessage && !messages.some(m => m.role === 'assistant' && !knownMessageIdsRef.current.has(m.id)) && (
            <MessageBubble
              message={streamingMessage}
              isOwn={false}
              isAI={true}
              isStreaming={isAIStreaming}
              streamingText={streamingMessage.content}
            />
          )}

          {/* AI stream error feedback (no_api_key, error, no_persona) */}
          {aiErrorMessage && (
            <div className="px-4 py-2 text-[13px] text-destructive" role="alert">
              {aiErrorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
