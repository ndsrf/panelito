'use client'

/**
 * BranchNavigator — 48px sticky bar between analytics panel and chat stream.
 *
 * LAYOUT-05: Physical divider with chromatic gradient + branch chips.
 * BRANCH-03: Renders all active branches in the session.
 * D-14: Horizontal Smart Scroll with auto-centering.
 */

import { type ReactNode, useEffect, useRef } from 'react'
import { PenLine } from 'lucide-react'
import { useSessionStore } from '@/store/session-store'

// Helper to convert hex to rgba
function hexToRgba(hex: string, opacity: number): string {
  const cleanHex = hex.replace('#', '')
  if (cleanHex.length !== 6) return `rgba(99, 102, 241, ${opacity})`
  const r = parseInt(cleanHex.substring(0, 2), 16)
  const g = parseInt(cleanHex.substring(2, 4), 16)
  const b = parseInt(cleanHex.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

export function BranchNavigator(): ReactNode {
  const branches = useSessionStore((s) => s.branches)
  const activeBranchId = useSessionStore((s) => s.activeBranchId)
  const setBranchId = useSessionStore((s) => s.setBranchId)
  const typingUsers = useSessionStore((s) => s.typingUsers)
  
  const containerRef = useRef<HTMLDivElement>(null)

  // Ensure Principal (main) is always present in the list
  const activeBranches = branches.filter((b) => !b.is_archived)
  if (!activeBranches.some((b) => b.path_id === 'main')) {
    activeBranches.unshift({
      id: 'main',
      label: 'Principal',
      color: '#6366f1',
      path_id: 'main',
      is_archived: false,
    })
  }

  const activeBranch = activeBranches.find((b) => b.id === activeBranchId) || activeBranches[0]
  const activeColor = activeBranch?.color || '#6366f1'

  // D-14: Smart scroll to auto-center the active branch chip
  useEffect(() => {
    if (!containerRef.current) return
    const activeEl = containerRef.current.querySelector('[data-active="true"]')
    if (activeEl) {
      activeEl.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      })
    }
  }, [activeBranchId, branches])

  return (
    <div
      ref={containerRef}
      className="branch-navigator flex items-center px-4 gap-2 overflow-x-auto select-none scrollbar-none h-[48px]"
      style={{
        background: `linear-gradient(90deg, ${hexToRgba(activeColor, 0.25)} 0%, #09090b 60%)`,
        transition: 'background 0.5s ease',
      }}
    >
      <div className="flex items-center gap-2 py-1.5 flex-shrink-0">
        {activeBranches.map((branch) => {
          const isActive = branch.id === activeBranchId
          return (
            <button
              key={branch.id}
              onClick={() => setBranchId(branch.id)}
              data-active={isActive ? 'true' : 'false'}
              className="flex items-center gap-2 rounded-full border px-3 py-1 min-h-[32px] cursor-pointer select-none hover:brightness-110 active:scale-95"
              style={{
                backgroundColor: hexToRgba(branch.color, isActive ? 0.30 : 0.08),
                borderColor: branch.color,
                color: branch.color,
                borderWidth: isActive ? '2px' : '1px',
                fontWeight: isActive ? 700 : 400,
                boxShadow: isActive ? `0 0 12px ${hexToRgba(branch.color, 0.5)}` : 'none',
                transform: isActive ? 'scale(1.05)' : 'scale(1)',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              {/* Branch status/indicator dot */}
              <span
                className="block w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: branch.color }}
                aria-hidden="true"
              />
              {/* Branch label */}
              <span style={{ fontSize: 13 }} className="truncate max-w-[150px]">
                {branch.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* CHAT-06: Typing indicator right slot */}
      <div className="ml-auto flex items-center gap-1.5 max-w-[180px] overflow-hidden flex-shrink-0 bg-zinc-950/80 pl-2 py-1 rounded-l-md">
        {typingUsers.length > 0 && (
          <>
            <PenLine className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" aria-hidden />
            <span className="text-[13px] text-muted-foreground truncate">
              {typingUsers.length === 1
                ? `${typingUsers[0]?.displayName ?? ''} está escribiendo...`
                : 'Varios están escribiendo...'}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
