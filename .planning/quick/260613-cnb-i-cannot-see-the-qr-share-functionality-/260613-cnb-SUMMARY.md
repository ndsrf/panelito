---
quick_id: 260613-cnb
status: complete
commit: 6a19fb1
date: 2026-06-13
---

# Summary: Wire missing Share button into workspace

## Root cause

`ShareButton` and `ShareModal` were built in plan 01-03 and exist at:
- `apps/web/app/(protected)/sessions/[id]/share-button.tsx`
- `apps/web/app/(protected)/sessions/[id]/share-modal.tsx`

Plan 01-04 replaced the Plan 03 workspace placeholder with the production `Workspace` + `CreatorControls` layout but never imported `ShareButton`. The component was orphaned — fully functional but unreachable from the UI.

## Fix (2 files, 11 lines)

**`apps/web/components/workspace/CreatorControls.tsx`**
- Added `shortCode: string` and `sessionTitle: string | null` props
- Imported `ShareButton` from the sessions `[id]` directory
- Rendered `<ShareButton>` as the first button in both the desktop row and the mobile Sheet (before the destructive Freeze/Close buttons)

**`apps/web/app/(protected)/sessions/[id]/workspace.tsx`**
- Passed `shortCode={shortCode ?? liveSession.short_code}` and `sessionTitle={liveSession.title}` to `<CreatorControls>`

## Result

The "Compartir" (Share) button now appears in the creator controls overlay on both desktop and mobile. Clicking it opens the QR modal with the join URL and a scannable QR code.
