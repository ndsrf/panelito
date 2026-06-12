'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import Link from 'next/link'
import { SessionCreateInputSchema, type SessionCreateInput, type Session } from '@panelito/types'
import { apiFetch, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type ModeOption = {
  value: 'strategy' | 'debate' | 'red_team'
  label: string
  description: string
}

const MODE_OPTIONS: ModeOption[] = [
  {
    value: 'strategy',
    label: 'Estrategia',
    description: 'Exploración estructurada de una pregunta estratégica',
  },
  {
    value: 'debate',
    label: 'Debate',
    description: 'Desafío deliberado de posiciones opuestas',
  },
  {
    value: 'red_team',
    label: 'Equipo Rojo',
    description: 'Prueba de estrés adversarial de una idea o plan',
  },
]

/**
 * NewSessionForm — client component for the session creation form.
 *
 * SESS-02: Creator can fill title (optional) and select mode, then submit.
 * D-06: No AI response cap field — cap is global in /settings.
 *
 * Form uses react-hook-form + zod via SessionCreateInputSchema.
 * On success: router.push to /sessions/[id].
 */
export function NewSessionForm() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<SessionCreateInput>({
    resolver: zodResolver(SessionCreateInputSchema),
    defaultValues: {
      title: null,
      mode: 'strategy',
    },
  })

  const selectedMode = watch('mode')

  const onSubmit = async (data: SessionCreateInput) => {
    setServerError(null)
    try {
      const session = await apiFetch<Session>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      router.push(`/sessions/${session.id}`)
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(`Error al crear la sesión (${err.status})`)
      } else {
        setServerError('Algo salió mal. Inténtalo de nuevo.')
      }
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-6">
      <h1 className="text-[20px] font-semibold text-foreground">Nueva sesión</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Title field */}
        <div className="space-y-1.5">
          <label
            htmlFor="session-title"
            className="text-[15px] text-foreground"
          >
            Título de la sesión
          </label>
          <Input
            id="session-title"
            placeholder="p. ej., Revisión de estrategia Q3"
            {...register('title')}
            className="h-10"
          />
          <p className="text-[13px] text-muted-foreground">
            Déjalo en blanco para nombrarla automáticamente a partir de la conversación.
          </p>
          {errors.title && (
            <p className="text-[13px] text-destructive">{errors.title.message}</p>
          )}
        </div>

        {/* Mode selector — 3 radio cards */}
        <div className="space-y-2">
          <label className="text-[15px] text-foreground">Modo</label>
          <div className="space-y-2">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setValue('mode', option.value)}
                className={cn(
                  'w-full rounded-md border p-4 text-left transition-colors',
                  'bg-card hover:bg-muted',
                  selectedMode === option.value
                    ? 'border-primary ring-2 ring-primary ring-offset-0'
                    : 'border-border'
                )}
              >
                <div className="text-[15px] font-medium text-foreground">
                  {option.label}
                </div>
                <div className="text-[13px] text-muted-foreground mt-0.5">
                  {option.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Server error */}
        {serverError && (
          <p className="text-[13px] text-destructive">{serverError}</p>
        )}

        {/* Submit */}
        <Button
          type="submit"
          className="w-full h-12 text-[15px]"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Creando...' : 'Crear sesión'}
        </Button>

        <div className="text-center">
          <Link
            href="/"
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Volver
          </Link>
        </div>
      </form>
    </div>
  )
}
