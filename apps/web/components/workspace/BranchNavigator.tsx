'use client'

/**
 * BranchNavigator — 48px sticky bar between analytics panel and chat stream.
 *
 * LAYOUT-05: Physical divider with chromatic gradient + branch chip.
 * D-09: Renders a single "Main" chip from Phase 1.
 * CHAT-06: Right slot shows typing indicator from Presence state.
 *
 * Left side: "Main" chip — Indigo 500 at 20% opacity background, 1px Indigo 500 border,
 *            Indigo 300 text, 6px Indigo 500 left dot.
 *
 * Right side: "X esta escribiendo..." or "Varios estan escribiendo..." (CHAT-06)
 *
 * The gradient: linear-gradient(90deg, #312e81 0%, #09090b 60%)
 * = Indigo 900 fading into Zinc 950 — establishes ambient branch color awareness.
 */

import type { ReactNode } from 'react'
import { PenLine } from 'lucide-react'
import { useSessionStore } from '@/store/session-store'

export function BranchNavigator(): ReactNode {
  const typingUsers = useSessionStore((s) => s.typingUsers)

  return (
    <div
      className="branch-navigator flex items-center px-4 gap-2"
      style={{
        background: 'linear-gradient(90deg, #312e81 0%, #09090b 60%)',
      }}
    >
      {/* "Main" branch chip — Phase 1 static chip */}
      <div
        className="flex items-center gap-2 rounded-full border px-3 py-1 min-h-[44px] min-w-[44px] cursor-default select-none"
        style={{
          backgroundColor: 'rgba(99, 102, 241, 0.20)', /* Indigo 500 @ 20% — #6366f1 */
          borderColor: '#6366f1', /* Indigo 500 */
        }}
      >
        {/* 6px Indigo 500 dot */}
        <span
          className="block w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: '#6366f1' }}
          aria-hidden="true"
        />
        {/* Branch label — Indigo 300 */}
        <span
          style={{ color: '#a5b4fc', fontSize: 13 }}
        >
          Main
        </span>
      </div>

      {/* CHAT-06: Typing indicator right slot */}
      <div className="ml-auto flex items-center gap-1.5 max-w-[180px] overflow-hidden">
        {typingUsers.length > 0 && (
          <>
            <PenLine className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" aria-hidden />
            <span className="text-[13px] text-muted-foreground truncate">
              {typingUsers.length === 1
                ? `${typingUsers[0]?.displayName ?? ''} esta escribiendo...`
                : 'Varios estan escribiendo...'}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
