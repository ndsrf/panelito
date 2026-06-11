'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { saveGuestSession, loadGuestSession } from '@/lib/guest-session'
import { joinSession } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const DisplayNameSchema = z.object({
  display_name: z.string().min(1, 'Name is required').max(40, 'Max 40 characters').trim(),
})

type DisplayNameInput = z.infer<typeof DisplayNameSchema>

interface JoinFormProps {
  sessionId: string
  shortCode: string
  sessionStatus: 'active' | 'frozen' | 'closed'
}

/**
 * JoinForm — client component for the guest join flow.
 *
 * SESS-04: Guest enters display name and clicks Join to enter the workspace.
 * SESS-10: On mount, checks localStorage for a saved guest session — if found,
 *          silently restores the session and redirects without showing the form.
 * D-02: No interstitial — direct router.push to workspace on submit.
 * D-03: Frozen/closed sessions show a note but still allow join (read-only in workspace).
 */
export function JoinForm({ sessionId, shortCode, sessionStatus }: JoinFormProps) {
  const router = useRouter()
  const [isCheckingSaved, setIsCheckingSaved] = useState(true)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<DisplayNameInput>({
    resolver: zodResolver(DisplayNameSchema),
  })

  // SESS-10: Check localStorage for saved guest session on mount
  useEffect(() => {
    const checkSavedSession = async () => {
      const saved = loadGuestSession(shortCode)
      if (saved) {
        try {
          // Restore the Supabase session from saved tokens
          const supabase = createClient()
          await supabase.auth.setSession({
            access_token: saved.access_token,
            refresh_token: saved.refresh_token,
          })
          // Silent re-entry — no display name form shown (SESS-10)
          router.replace(`/sessions/${saved.session_id}`)
          return
        } catch {
          // Saved session is invalid — show the form
        }
      }
      setIsCheckingSaved(false)
    }

    checkSavedSession()
  }, [shortCode, router])

  const onSubmit = async (data: DisplayNameInput) => {
    setServerError(null)

    try {
      const result = await joinSession({ code: shortCode, display_name: data.display_name })

      if ('error' in result) {
        setServerError(result.error)
        return
      }

      // Set the anonymous Supabase session on the browser client
      const supabase = createClient()
      await supabase.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      })

      // Persist to localStorage BEFORE router.push (RESEARCH.md Pitfall 8, SESS-10)
      saveGuestSession(shortCode, {
        guest_user_id: result.guest_user_id,
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        display_name: data.display_name,
        session_id: result.session_id,
      })

      // D-02: Instant redirect — no interstitial
      router.push(`/sessions/${result.session_id}`)
    } catch {
      setServerError('Something went wrong. Please try again.')
    }
  }

  // Show loading state while checking for saved session
  if (isCheckingSaved) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <p className="text-[13px] text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      {sessionStatus !== 'active' && (
        <p className="text-[13px] text-muted-foreground">
          {sessionStatus === 'frozen'
            ? 'This session is paused — you can view the conversation but cannot send messages.'
            : 'This session has ended — you can view the conversation in read-only mode.'}
        </p>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="display-name"
            className="text-[15px] text-foreground"
          >
            Your display name
          </label>
          <Input
            id="display-name"
            placeholder="Your display name"
            maxLength={40}
            {...register('display_name')}
            className="h-10"
          />
          {errors.display_name && (
            <p className="text-[13px] text-destructive">{errors.display_name.message}</p>
          )}
        </div>

        {serverError && (
          <p className="text-[13px] text-destructive">{serverError}</p>
        )}

        <Button
          type="submit"
          className="w-full h-12 text-[15px]"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Joining...' : 'Join Session'}
        </Button>
      </form>
    </div>
  )
}
