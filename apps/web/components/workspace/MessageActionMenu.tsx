'use client'

/**
 * MessageActionMenu — contextual action menu opened by long-press (LAYOUT-06)
 *
 * Phase 3: "Fork" is wired to branch creation.
 * Phase 2: "Pin to Panel" is wired to canvas panel attachment (disabled/placeholder).
 */

import { type ReactNode } from 'react'
import { GitFork, Pin } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
}

export function MessageActionMenu({
  open,
  onOpenChange,
  messageId,
  messageRole,
  sessionId,
  setIsForking,
}: MessageActionMenuProps): ReactNode {
  const handleFork = async () => {
    try {
      setIsForking(true)
      onOpenChange(false)
      
      const newBranch = await apiFetch<Branch>(`/sessions/${sessionId}/branches/fork`, {
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

  const isAI = messageRole === 'assistant'

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <span className="sr-only" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start">
        {/* Fork — human messages only (D-15) */}
        <DropdownMenuItem
          disabled={isAI}
          onClick={handleFork}
          className="flex items-center gap-2 cursor-pointer"
        >
          <GitFork className="h-4 w-4" />
          <span>Bifurcar</span>
          {isAI && (
            <span className="ml-auto text-[11px] text-muted-foreground/60">Solo humanos</span>
          )}
        </DropdownMenuItem>

        {/* Pin to Panel — disabled/placeholder */}
        <DropdownMenuItem
          disabled
          className="flex items-center gap-2 text-muted-foreground"
        >
          <Pin className="h-4 w-4" />
          <span>Fijar al Panel</span>
          <span className="ml-auto text-[11px] text-muted-foreground/60">Phase 2</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
