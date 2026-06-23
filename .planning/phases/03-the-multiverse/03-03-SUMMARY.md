---
phase: 03-the-multiverse
plan: 03
subsystem: web-app
tags: [fork, loading-overlay, opacity, visual-divider, input-indicator]

# Dependency graph
requires:
  - plan: 03-02
    provides: BranchNavigator, activeBranchId state

provides:
  - Bifurcar (Fork) action in MessageActionMenu (disabled for AI messages)
  - Bifurcando... loading state spinner overlay inside MessageBubble during fork
  - Visual dimming of ancestor messages in MessageList based on path_id comparison
  - BranchPointDivider in MessageList at the message's fork point
  - Active branch indicator (📍 Respondiendo en: [Branch Name]) in InputBox

affects:
  - 03-04 (management-hardening: needs to archive, restore, and rename branches using components and stores)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Absolute loading state overlay inside message bubbles to prevent interaction during active forks
    - Conditional rendering of branch dividers by indexing the msg.id against the active branch's fork_message_id

key-files:
  created:
    - .planning/phases/03-the-multiverse/03-03-SUMMARY.md
  modified:
    - apps/web/components/workspace/MessageBubble.tsx
    - apps/web/components/workspace/MessageList.tsx
    - apps/web/components/workspace/InputBox.tsx
    - apps/web/components/workspace/MessageActionMenu.tsx

key-decisions:
  - "restricted Bifurcar action to human messages (role === 'user') to prevent AI context bleeding and satisfy requirements (D-15)"
  - "used relative positioned bubble wrapper with overflow-hidden to cleanly confine the absolute loading overlay"
