---
quick_id: 260613-cnb
slug: i-cannot-see-the-qr-share-functionality-
description: "I cannot see the QR share functionality that in theory was added at phase 1 - wave 2"
date: 2026-06-13
must_haves:
  truths:
    - "A session creator sees a Share (Compartir) button in the CreatorControls area of the workspace"
    - "Clicking the Share button opens the ShareModal with a QR code and a copyable join URL"
    - "The share functionality is available regardless of session status (active, frozen, closed)"
  artifacts:
    - path: "apps/web/components/workspace/CreatorControls.tsx"
      provides: "ShareButton wired alongside Freeze/Unfreeze/Close buttons"
      contains: "ShareButton"
---

# Quick Plan 260613-cnb: Wire missing Share button into workspace UI

## Root Cause

`ShareButton` and `ShareModal` were built in plan 01-03 and live at:
- `apps/web/app/(protected)/sessions/[id]/share-button.tsx`
- `apps/web/app/(protected)/sessions/[id]/share-modal.tsx`

Plan 01-04 replaced the workspace placeholder with the production `Workspace` + `CreatorControls` components, but **never imported or rendered `ShareButton`**. The share button is orphaned — the code exists but is unreachable from the UI.

## Fix

### Task 1: Add ShareButton to CreatorControls

**File:** `apps/web/components/workspace/CreatorControls.tsx`

1. Import `ShareButton` from `@/app/(protected)/sessions/[id]/share-button`
2. Add `shortCode` and `sessionTitle` props to `CreatorControlsProps`
3. Render `<ShareButton shortCode={shortCode} sessionTitle={sessionTitle} />` alongside the Freeze/Unfreeze/Close buttons — before the destructive buttons in both the desktop row and the mobile Sheet

**File:** `apps/web/app/(protected)/sessions/[id]/workspace.tsx`

Pass `session.short_code` and `session.title` to `<CreatorControls>`.

## Verification

- `grep "ShareButton" apps/web/components/workspace/CreatorControls.tsx` returns at least 1 line
- `grep "shortCode" apps/web/components/workspace/CreatorControls.tsx` returns at least 1 line
- TypeScript check: `pnpm --filter @panelito/web exec tsc --noEmit` exits 0
