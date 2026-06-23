'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * MessageActionMenu — custom contextual action menu opened by long-press.
 *
 * Rewritten as a custom React component to avoid Radix UI pointer-events trapping
 * and focus delegation conflicts in React 19 environments.
 */

import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { GitFork, Pin } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useSessionStore } from '@/store/session-store'
import type { Branch } from '@panelito/types'

interface MessageActionMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  messageId: string
  messageRole: 'user' | 'assistant'
  sessionId: string
  setIsForking: (forking: boolean) => void
  bubbleRef: React.RefObject<HTMLDivElement | null>
}

export function MessageActionMenu({
  open,
  onOpenChange,
  messageId,
  messageRole,
  sessionId,
  setIsForking,
  bubbleRef,
}: MessageActionMenuProps): ReactNode {
  const handleFork = async () => {
    try {
      setIsForking(true)
      onOpenChange(false)
      
      const newBranch = await apiFetch<Branch>(`/api/sessions/${sessionId}/branches/fork`, {
        method: 'POST',
        body: JSON.stringify({ forkMessageId: messageId }),
      })

      // Add to store and auto-switch
      const store = useSessionStore.getState()
      store.addBranch(newBranch)
      store.setBranchId(newBranch.id)
    } catch (err: any) {
      console.error('[MessageActionMenu] Fork failed:', err)
      const msg = err?.body?.message || 'Error al bifurcar la conversación.'
      alert(msg)
    } finally {
      setIsForking(false)
    }
  }

  if (!open || !bubbleRef.current || typeof window === 'undefined') return null

  const isAI = messageRole === 'assistant'
  const rect = bubbleRef.current.getBoundingClientRect()

  return createPortal(
    <>
      {/* Invisible backdrop to capture clicks outside the menu and close it */}
      <div
        className="fixed inset-0 z-40 bg-transparent cursor-default"
        onClick={(e) => {
          e.stopPropagation()
          onOpenChange(false)
        }}
      />

      {/* Custom absolute dropdown positioned below the bubble area */}
      <div
        className="fixed z-50 min-w-[9rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md flex flex-col notranslate"
        translate="no"
        style={{
          top: `${rect.bottom + 4}px`,
          left: `${rect.left + 16}px`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fork option */}
        <button
          type="button"
          disabled={isAI}
          onClick={(e) => {
            e.stopPropagation()
            handleFork()
          }}
          className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none cursor-pointer transition-colors"
        >
          <GitFork className="h-3.5 w-3.5" />
          <span>Bifurcar</span>
        </button>

        {/* Pin to Panel option */}
        <button
          type="button"
          disabled
          className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs text-left text-muted-foreground opacity-50 pointer-events-none transition-colors"
        >
          <Pin className="h-3.5 w-3.5" />
          <span>Fijar al Panel</span>
        </button>
      </div>
    </>,
    document.body
  )
}
