'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import type { ApiKeyVerifyRequest, ApiKeyVerifyResponse, ProviderName } from '@panelito/types'
import { ApiKeyVerifyRequestSchema } from '@panelito/types'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_key: 'Clave API inválida. Verifica que sea correcta y esté activa.',
  rate_limited: 'Servicio de verificación ocupado. Intenta de nuevo en unos segundos.',
  network_error: 'No se pudo contactar al proveedor. Revisa tu conexión.',
}

const PROVIDERS: Array<{
  id: ProviderName
  label: string
  placeholder: string
  hint: string
  url: string
}> = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    placeholder: 'sk-ant-api03-...',
    hint: 'Empieza con sk-ant-',
    url: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    placeholder: 'sk-...',
    hint: 'Empieza con sk-',
    url: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    placeholder: 'AI...',
    hint: 'Empieza con AI',
    url: 'https://aistudio.google.com/apikey',
  },
]

export function ApiKeyForm() {
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>('anthropic')

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
  } = useForm<ApiKeyVerifyRequest>({
    resolver: zodResolver(ApiKeyVerifyRequestSchema),
    defaultValues: { provider: 'anthropic' },
  })

  const handleProviderChange = (p: ProviderName) => {
    setSelectedProvider(p)
    setValue('provider', p)
    setValue('key', '')
    setServerError(null)
  }

  const onSubmit = async (values: ApiKeyVerifyRequest) => {
    setServerError(null)
    setLoading(true)
    try {
      await apiFetch<ApiKeyVerifyResponse>('/api/keys/verify', {
        method: 'POST',
        body: JSON.stringify({ provider: values.provider, key: values.key }),
      })
      router.push('/')
      router.refresh()
    } catch (err) {
      const message = (err as { status?: number; body?: { error?: string } })?.body?.error
      const errorMsg =
        (message ? ERROR_MESSAGES[message] : undefined) ??
        ERROR_MESSAGES['network_error'] ??
        'Error inesperado.'
      setServerError(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  const providerMeta = PROVIDERS.find((p) => p.id === selectedProvider)!

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Provider selector */}
      <div className="grid grid-cols-3 gap-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => handleProviderChange(p.id)}
            className={`rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${
              selectedProvider === p.id
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Hidden provider field — keeps react-hook-form in sync */}
      <input type="hidden" {...register('provider')} />

      {/* Key input */}
      <div className="space-y-1.5">
        <label htmlFor="api-key-input" className="text-[14px] font-medium text-foreground">
          Clave API de {providerMeta.label}
        </label>
        <div className="relative">
          <Input
            id="api-key-input"
            type={visible ? 'text' : 'password'}
            placeholder={providerMeta.placeholder}
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
        <p className="text-[12px] text-muted-foreground">{providerMeta.hint}</p>
        {errors.key && (
          <p className="text-[13px] text-destructive">{errors.key.message}</p>
        )}
      </div>

      {serverError && (
        <p className="text-[13px] text-destructive" role="alert">
          {serverError}
        </p>
      )}

      <Button
        type="submit"
        disabled={loading}
        className="w-full h-12 text-[15px] bg-primary text-primary-foreground"
      >
        {loading ? 'Verificando...' : 'Verificar y guardar'}
      </Button>
    </form>
  )
}
