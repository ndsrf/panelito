'use client'

import { useState } from 'react'
import { Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ShareModal } from './share-modal'

interface ShareButtonProps {
  shortCode: string
  sessionTitle: string | null
}

/**
 * ShareButton — triggers the share modal.
 *
 * Client component that manages the modal open/closed state.
 * The actual QR code and copy logic is in ShareModal.
 */
export function ShareButton({ shortCode, sessionTitle }: ShareButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-9 gap-2"
      >
        <Share2 className="h-4 w-4" />
        Share
      </Button>

      <ShareModal
        open={open}
        onOpenChange={setOpen}
        shortCode={shortCode}
        sessionTitle={sessionTitle}
      />
    </>
  )
}
