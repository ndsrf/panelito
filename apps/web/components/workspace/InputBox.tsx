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
 *          Send onClick is a no-op (wired in Plan 05).
 * Plan 05: Replaces no-op with Supabase Realtime broadcast.
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
import type { SessionStatus } from '@panelito/types'

interface InputBoxProps {
  sessionId: string
  sessionStatus: SessionStatus
}

/**
 * InputBox — chat message input anchored to the keyboard-aware visual viewport.
 */
export function InputBox({ sessionId: _sessionId, sessionStatus }: InputBoxProps): ReactNode {
  const [value, setValue] = useState('')

  // This is the single mount point for useViewport.
  // Sets --app-height once and wires --keyboard-height live updates.
  useViewport()

  const isReadOnly = sessionStatus !== 'active'
  const isFrozen = sessionStatus === 'frozen'
  const isClosed = sessionStatus === 'closed'

  const handleSend = () => {
    if (!value.trim() || isReadOnly) return
    // Plan 05 wires the actual send action via Supabase Realtime
    console.warn('[InputBox] send wired in Plan 05')
    setValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
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
          placeholder={isReadOnly ? 'Session is paused — input disabled.' : 'Message...'}
          disabled={isReadOnly}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          aria-label="Message input"
        />
        <button
          type="button"
          aria-label="Send message"
          disabled={!value.trim() || isReadOnly}
          onClick={handleSend}
          className={cn(
            'w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors',
            value.trim() && !isReadOnly
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
