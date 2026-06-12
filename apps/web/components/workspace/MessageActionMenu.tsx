'use client'

/**
 * MessageActionMenu — contextual action menu opened by long-press (LAYOUT-06)
 *
 * Phase 1: "Fork" and "Pin to Panel" are disabled with tooltips explaining
 *          which Phase enables them.
 * Phase 3: "Fork" will be wired to branch creation.
 * Phase 2: "Pin to Panel" will be wired to canvas panel attachment.
 */

import { type ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface MessageActionMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * MessageActionMenu — long-press contextual menu with Phase 1 disabled items.
 */
export function MessageActionMenu({
  open,
  onOpenChange,
}: MessageActionMenuProps): ReactNode {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      {/* Invisible trigger — opened programmatically via useLongPress */}
      <DropdownMenuTrigger asChild>
        <span className="sr-only" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start">
        {/* Fork — disabled in Phase 1; wired in Phase 3 */}
        <DropdownMenuItem
          disabled
          title="Disponible en Phase 3"
          className="text-muted-foreground"
        >
          Fork
          <span className="ml-auto text-[11px] text-muted-foreground/60">Phase 3</span>
        </DropdownMenuItem>

        {/* Pin to Panel — disabled in Phase 1; wired in Phase 2 */}
        <DropdownMenuItem
          disabled
          title="Disponible en Phase 2"
          className="text-muted-foreground"
        >
          Pin to Panel
          <span className="ml-auto text-[11px] text-muted-foreground/60">Phase 2</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
