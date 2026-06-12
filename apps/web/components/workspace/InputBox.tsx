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
 *
 * Session status handling (D-03, SESS-05/06):
 *   - active: input enabled, send button active when non-empty
 *   - frozen: input disabled + "frozen" banner
 *   - closed: input disabled + "ended" banner
 */

import { useState, type ReactNode } from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useViewport } from '@/hooks/use-viewport'
import { useTypingPresence } from '@/hooks/use-typing-presence'
import { apiFetch } from '@/lib/api'
import { loadGuestSession } from '@/lib/guest-session'
import type { SessionStatus } from '@panelito/types'

interface InputBoxProps {
  sessionId: string
  sessionStatus: SessionStatus
  userId: string
  displayName: string
  shortCode?: string
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
}: InputBoxProps): ReactNode {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  // This is the single mount point for useViewport.
  // Sets --app-height once and wires --keyboard-height live updates.
  useViewport()

  // Typing presence hook — throttled to <=1 track()/sec (CHAT-06)
  const { setTyping } = useTypingPresence(sessionId, userId, displayName)

  const isReadOnly = sessionStatus !== 'active'
  const isFrozen = sessionStatus === 'frozen'
  const isClosed = sessionStatus === 'closed'

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
            ? 'Esta sesión está congelada — no puedes enviar mensajes.'
            : isClosed
              ? 'Esta sesión ha finalizado — no puedes enviar mensajes.'
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
          placeholder={isReadOnly ? 'Sesión pausada — entrada deshabilitada.' : 'Mensaje...'}
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
