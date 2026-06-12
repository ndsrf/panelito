'use client'

/**
 * ApiKeyForm — client component for the D-04 onboarding gate.
 *
 * - Masked password input with eye toggle (aria-label "Show API key" / "Hide API key")
 * - react-hook-form + zod validation (sk-ant-* prefix, min 50 chars)
 * - Submits to POST /api/keys/verify
 * - On success: redirects to /
 * - On failure: shows inline error mapped to Spanish user copy (AI-10)
 * - CTA: 48px tall, primary indigo, "Verify & Save" label
 */

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import type { ApiKeyVerifyRequest, ApiKeyVerifyResponse } from '@panelito/types'
import { ApiKeyVerifyRequestSchema } from '@panelito/types'

// ---------------------------------------------------------------------------
// Error copy (AI-10 — Spanish user-facing messages)
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  invalid_key:
    'Clave API invalida. Verifica que la clave sea correcta y este activa.',
  rate_limited:
    'Servicio de verificacion ocupado. Intenta de nuevo en unos segundos.',
  network_error: 'No se pudo contactar a Anthropic. Revisa tu conexion.',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ApiKeyForm() {
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ApiKeyVerifyRequest>({
    resolver: zodResolver(ApiKeyVerifyRequestSchema),
  })

  const onSubmit = async (values: ApiKeyVerifyRequest) => {
    setServerError(null)
    setLoading(true)
    try {
      await apiFetch<ApiKeyVerifyResponse>('/api/keys/verify', {
        method: 'POST',
        body: JSON.stringify({ key: values.key }),
      })
      // On success: push to home and refresh server state
      router.push('/')
      router.refresh()
    } catch (err) {
      // ApiError: parse the error code from the response
      const message = (err as { status?: number; body?: { error?: string } })?.body?.error
      const errorMsg = (message ? ERROR_MESSAGES[message] : undefined) ?? ERROR_MESSAGES['network_error'] ?? 'Error inesperado.'
      setServerError(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Masked key input with eye toggle */}
      <div className="space-y-1.5">
        <label htmlFor="api-key-input" className="text-[14px] font-medium text-foreground">
          Clave API de Anthropic
        </label>
        <div className="relative">
          <Input
            id="api-key-input"
            type={visible ? 'text' : 'password'}
            placeholder="sk-ant-api03-..."
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="pr-10 h-11"
            {...register('key')}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide API key' : 'Show API key'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {errors.key && (
          <p className="text-[13px] text-destructive">{errors.key.message}</p>
        )}
      </div>

      {/* Server-side error (invalid_key, rate_limited, network_error) */}
      {serverError && (
        <p className="text-[13px] text-destructive" role="alert">
          {serverError}
        </p>
      )}

      {/* CTA — 48px tall, accent color */}
      <Button
        type="submit"
        disabled={loading}
        className="w-full h-12 text-[15px] bg-primary text-primary-foreground"
      >
        {loading ? 'Verificando...' : 'Verify & Save'}
      </Button>
    </form>
  )
}
