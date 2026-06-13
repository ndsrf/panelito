'use client'

import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { devSignIn } from '@/app/auth/sign-in/actions'

export function DevSignInButton() {
  const [pending, startTransition] = useTransition()

  return (
    <form
      action={() => startTransition(() => devSignIn())}
      className="w-full"
    >
      <Button
        type="submit"
        variant="ghost"
        className="w-full h-10 text-xs text-muted-foreground border border-dashed"
        disabled={pending}
      >
        {pending ? 'Entrando...' : 'Dev Sign In (local only)'}
      </Button>
    </form>
  )
}
