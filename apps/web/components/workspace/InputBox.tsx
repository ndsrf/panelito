'use client'

/**
 * InputBox — message input anchored to the visual viewport bottom.
 *
 * LAYOUT-04: .input-box class positions the box absolutely at
 *            bottom: calc(var(--keyboard-height, 0px)) — rises with the keyboard.
 *
 * This component is the single mount point for useViewport().
 * It calls the hook once, which sets --app-height and wires the
 * visualViewport listener for --keyboard-height.
 *
 * Plan 04: Renders the UI shell (textarea + Send button).
 * Plan 05: Wired — sends via POST /api/sessions/:id/messages; sets typing presence.
 * Plan 07: Reads live status from session store; shows auto-freeze reason banner.
 *
 * Session status handling (D-03, SESS-05/06, SESS-07):
 *   - active: input enabled, send button active when non-empty
 *   - frozen: input disabled + frozen banner (with reason if auto_freeze)
 *   - closed: input disabled + "ended" banner
 */

import { useState, type ReactNode } from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useViewport } from '@/hooks/use-viewport'
import { useTypingPresence } from '@/hooks/use-typing-presence'
import { useSessionStore } from '@/store/session-store'
import { apiFetch } from '@/lib/api'
import { loadGuestSession } from '@/lib/guest-session'
import type { SessionStatus } from '@panelito/types'

interface InputBoxProps {
  sessionId: string
  /** Initial status from server component — overridden by live store value. */
  sessionStatus: SessionStatus
  userId: string
  displayName: string
  shortCode?: string
  /** Reason set when auto-freeze fires, from the session_status_change broadcast. */
  autoFreezeReason?: string
}

/**
 * InputBox — chat message input anchored to the keyboard-aware visual viewport.
 */
export function InputBox({
  sessionId,
  sessionStatus,
  userId,
  displayName,
  shortCode,
  autoFreezeReason,
}: InputBoxProps): ReactNode {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  // This is the single mount point for useViewport.
  // Sets --app-height once and wires --keyboard-height live updates.
  useViewport()

  // Typing presence hook — throttled to <=1 track()/sec (CHAT-06)
  const { setTyping } = useTypingPresence(sessionId, userId, displayName)

  // SESS-07/11/12: read live status from store; fall back to prop if store not yet set
  const liveSession = useSessionStore((s) => s.session)
  const status = liveSession?.status ?? sessionStatus

  const isReadOnly = status !== 'active'
  const isFrozen = status === 'frozen'
  const isClosed = status === 'closed'

  // SESS-07: Use auto-freeze reason from broadcast payload if available
  const isAutoFreeze = autoFreezeReason === 'auto_freeze_creator_absent'

  const handleSend = async () => {
    if (!draft.trim() || isReadOnly || sending) return

    const content = draft.trim()
    setDraft('')
    setTyping(false)
    setSending(true)

    try {
      // Load guest session display_name if applicable
      const guestSession = shortCode ? loadGuestSession(shortCode) : null
      const guestDisplayName = guestSession?.display_name

      await apiFetch(`/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content,
          ...(guestDisplayName ? { display_name: guestDisplayName } : {}),
        }),
      })
    } catch (err) {
      console.error('[InputBox] send failed', err)
      // Restore draft on error so user does not lose their message
      setDraft(content)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setDraft(val)
    // Trigger typing presence (throttled internally to 1/sec — CHAT-06)
    setTyping(val.length > 0)
  }

  const frozenBannerText = isFrozen
    ? isAutoFreeze
      ? 'Esta sesion se congelo automaticamente por inactividad del creador.'
      : 'Esta sesion esta congelada — no puedes enviar mensajes.'
    : null

  return (
    <div className="input-box bg-muted border-t border-border flex flex-col">
      {/* Read-only banner — shown when session is frozen or closed */}
      {isReadOnly && (
        <div
          className="flex items-center justify-center px-3 text-[13px] text-destructive"
          style={{
            height: 36,
            backgroundColor: 'rgba(239, 68, 68, 0.10)', /* Destructive @ 10% */
          }}
          role="status"
          aria-live="polite"
        >
          {isFrozen
            ? frozenBannerText
            : isClosed
              ? 'Esta sesion ha finalizado — no puedes enviar mensajes.'
              : null}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-center gap-2 px-3 flex-1">
        <textarea
          className={cn(
            'flex-1 bg-transparent outline-none text-[15px] text-foreground resize-none',
            'placeholder:text-muted-foreground py-2',
            isReadOnly && 'opacity-50 cursor-not-allowed'
          )}
          placeholder={isReadOnly ? 'Sesion pausada — entrada deshabilitada.' : 'Mensaje...'}
          disabled={isReadOnly}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={1}
          aria-label="Entrada de mensaje"
        />
        <button
          type="button"
          aria-label="Enviar mensaje"
          disabled={!draft.trim() || isReadOnly || sending}
          onClick={handleSend}
          className={cn(
            'w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors',
            draft.trim() && !isReadOnly && !sending
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          )}
        >
          <ArrowUp size={18} />
        </button>
      </div>
    </div>
  )
}
