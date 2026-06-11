'use client'

import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ShareModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  shortCode: string
  sessionTitle: string | null
}

/**
 * ShareModal — QR code + copy URL modal for session sharing.
 *
 * SESS-03: Creator can share a QR code and copyable join URL.
 * T-03-SC: qrcode.react 4.2.0 pinned (verified approved in Plan 01 audit).
 *
 * Colors per UI-SPEC dark theme:
 * - bgColor: Zinc 950 (#09090b — background)
 * - fgColor: Zinc 50 (#fafafa — foreground)
 */
export function ShareModal({ open, onOpenChange, shortCode, sessionTitle }: ShareModalProps) {
  const [copied, setCopied] = useState(false)

  // Compute join URL client-side (requires window.location.origin)
  const joinUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/join/${shortCode}`
      : `/join/${shortCode}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl)
      setCopied(true)
      toast('Copied', { description: 'Join link copied to clipboard' })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copy failed', { description: 'Please copy the URL manually' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[20px] font-semibold">
            Share Session
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {sessionTitle && (
            <p className="text-[13px] text-muted-foreground">
              {sessionTitle}
            </p>
          )}

          {/* QR Code */}
          <div className="flex justify-center">
            <QRCodeSVG
              value={joinUrl}
              size={240}
              bgColor="#09090b"
              fgColor="#fafafa"
              level="M"
            />
          </div>

          {/* Copy URL */}
          <div className="space-y-2">
            <label className="text-[13px] text-muted-foreground">
              Join link
            </label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={joinUrl}
                className="text-[13px] h-9 bg-muted"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopy}
                className="h-9 px-3 shrink-0"
                aria-label="Copy join link"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <p className="text-[13px] text-muted-foreground text-center">
            Guests scan the QR code or open the link — no account required.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
