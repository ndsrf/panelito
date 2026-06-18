'use client'

/**
 * SettingsForm — client component for /settings (D-05, D-09).
 *
 * Three provider cards (Anthropic, OpenAI, Gemini) + AI Response Cap card.
 *
 * D-05: Active provider visually distinguished (full-color vs opacity-40)
 * D-08: Provider switching only here in /settings — no mid-session switching exposed
 * D-09: Click-to-activate card changes active_provider via PUT /api/keys/active-provider
 * T-04-08: Per-provider prefix hint in validation error messages (sk-ant-/sk-/AI...)
 * Mobile-first: cards stack on mobile (grid-cols-1), expand to 3-col on md+
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import type { CreatorSettings, MultiProviderStatus, ProviderName } from '@panelito/types'

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

const PROVIDER_META: Record<ProviderName, {
  label: string
  placeholder: string
  prefix: string
}> = {
  anthropic: {
    label: 'Anthropic',
    placeholder: 'sk-ant-api03-...',
    prefix: 'sk-ant-',
  },
  openai: {
    label: 'OpenAI',
    placeholder: 'sk-...',
    prefix: 'sk-',
  },
  gemini: {
    label: 'Google Gemini',
    placeholder: 'AIzaSy...',
    prefix: 'AI',
  },
}

// ---------------------------------------------------------------------------
// Error copy — Spanish user-facing messages (AI-10)
// Maps verify error codes to Spanish copy with per-provider prefix hints
// ---------------------------------------------------------------------------

function getErrorMessages(provider: ProviderName): Record<string, string> {
  const { prefix } = PROVIDER_META[provider]
  return {
    invalid_key: `Clave API invalida. Verifica que la clave comience con "${prefix}" y este activa.`,
    rate_limited: 'Servicio de verificacion ocupado. Intenta de nuevo en unos segundos.',
    network_error: 'No se pudo contactar al proveedor. Revisa tu conexion.',
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SettingsFormProps {
  settings: CreatorSettings
  keyStatus: MultiProviderStatus
}

// ---------------------------------------------------------------------------
// Single provider card
// ---------------------------------------------------------------------------

interface ProviderCardProps {
  provider: ProviderName
  isActive: boolean
  hasKey: boolean
  last4: string | null
  onActivate: (provider: ProviderName) => Promise<void>
  activating: boolean
}

function ProviderCard({
  provider,
  isActive,
  hasKey,
  last4,
  onActivate,
  activating,
}: ProviderCardProps) {
  const router = useRouter()
  const meta = PROVIDER_META[provider]

  const [keyInput, setKeyInput] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifySuccess, setVerifySuccess] = useState(false)

  const maskedKey = hasKey && last4 ? `••••${last4}` : null

  const handleVerify = async () => {
    if (!keyInput.trim()) return
    setVerifyError(null)
    setVerifySuccess(false)
    setVerifying(true)
    try {
      await apiFetch('/api/keys/verify', {
        method: 'POST',
        body: JSON.stringify({ provider, key: keyInput.trim() }),
      })
      setVerifySuccess(true)
      setKeyInput('')
      router.refresh()
    } catch (err) {
      const message = (err as { status?: number; body?: { error?: string } })?.body?.error
      const errorMessages = getErrorMessages(provider)
      const errorMsg = (message ? errorMessages[message] : undefined) ?? errorMessages['network_error'] ?? 'Error inesperado.'
      setVerifyError(errorMsg)
    } finally {
      setVerifying(false)
    }
  }

  return (
    <Card
      className={`relative transition-all ${isActive ? 'ring-2 ring-primary' : 'opacity-80 hover:opacity-100'}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle
            className={`text-[14px] font-semibold ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            {meta.label}
          </CardTitle>
          {isActive && (
            <span className="text-[11px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              Activo
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Key status display */}
        <div className="text-[13px]">
          {hasKey && maskedKey ? (
            <code className="font-mono bg-muted px-2 py-0.5 rounded text-foreground">
              {maskedKey}
            </code>
          ) : (
            <span className="text-muted-foreground italic">Sin clave configurada</span>
          )}
        </div>

        {/* Key input + verify button */}
        <div className="space-y-2">
          <Input
            type="password"
            placeholder={meta.placeholder}
            value={keyInput}
            onChange={(e) => {
              setKeyInput(e.target.value)
              setVerifyError(null)
              setVerifySuccess(false)
            }}
            className="h-8 text-[13px]"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={verifying || !keyInput.trim()}
            onClick={handleVerify}
            className="w-full h-8 text-[12px]"
          >
            {verifying ? 'Verificando...' : 'Verificar y guardar'}
          </Button>
        </div>

        {/* Inline feedback */}
        {verifySuccess && (
          <p className="text-[12px] text-green-600" role="status">
            Clave guardada correctamente.
          </p>
        )}
        {verifyError && (
          <p className="text-[12px] text-destructive" role="alert">
            {verifyError}
          </p>
        )}

        {/* Click-to-activate — only shown when not already active */}
        {!isActive && (
          <Button
            size="sm"
            variant="ghost"
            disabled={activating}
            onClick={() => onActivate(provider)}
            className={`w-full h-7 text-[11px] text-muted-foreground hover:text-foreground`}
          >
            {activating ? 'Activando...' : 'Usar como proveedor activo'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main SettingsForm component
// ---------------------------------------------------------------------------

const PROVIDERS: ProviderName[] = ['anthropic', 'openai', 'gemini']

export function SettingsForm({ settings, keyStatus }: SettingsFormProps) {
  const router = useRouter()
  const [cap, setCap] = useState<number>(settings.api_response_cap)
  const [capSaving, setCapSaving] = useState(false)
  const [capError, setCapError] = useState<string | null>(null)
  const [capSaved, setCapSaved] = useState(false)
  const [activatingProvider, setActivatingProvider] = useState<ProviderName | null>(null)

  const handleActivate = async (provider: ProviderName) => {
    setActivatingProvider(provider)
    try {
      await apiFetch('/api/keys/active-provider', {
        method: 'PUT',
        body: JSON.stringify({ provider }),
      })
      router.refresh()
    } catch {
      // Silently refresh — user will see updated state
      router.refresh()
    } finally {
      setActivatingProvider(null)
    }
  }

  const handleSaveCap = async () => {
    setCapError(null)
    setCapSaved(false)
    if (cap < 1 || cap > 10000 || !Number.isInteger(cap)) {
      setCapError('El tope debe ser un entero entre 1 y 10000.')
      return
    }
    setCapSaving(true)
    try {
      await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ api_response_cap: cap }),
      })
      setCapSaved(true)
      router.refresh()
    } catch {
      setCapError('Error al guardar. Intenta de nuevo.')
    } finally {
      setCapSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Section: Provider Cards (D-05, D-09) */}
      <div>
        <h2 className="text-[15px] font-semibold text-foreground mb-1">Proveedor de AI</h2>
        <p className="text-[13px] text-muted-foreground mb-3">
          Conecta tu clave API y selecciona el proveedor activo. Solo el proveedor activo se usara en sesiones.
        </p>
        {/* Mobile-first: stack on mobile, 3-col on md+ */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {PROVIDERS.map((provider) => {
            const providerStatus = keyStatus.providers.find(p => p.provider === provider)
            return (
              <ProviderCard
                key={provider}
                provider={provider}
                isActive={keyStatus.active_provider === provider}
                hasKey={providerStatus?.has_key ?? false}
                last4={providerStatus?.last4 ?? null}
                onActivate={handleActivate}
                activating={activatingProvider === provider}
              />
            )
          })}
        </div>
      </div>

      {/* Card: AI Response Cap (D-06) — unchanged */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[16px]">
            Tope de respuestas AI por sesion
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">
              Limite global de respuestas AI por sesion (1–10,000). Por defecto: 150.
            </p>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={10000}
                value={cap}
                onChange={(e) => {
                  setCap(parseInt(e.target.value, 10) || 0)
                  setCapSaved(false)
                }}
                className="w-20 h-9"
              />
              <Button
                onClick={handleSaveCap}
                disabled={capSaving}
                variant="outline"
                className="h-9"
              >
                {capSaving ? 'Guardando...' : 'Guardar'}
              </Button>
              {capSaved && (
                <span className="text-[13px] text-muted-foreground">Guardado</span>
              )}
            </div>
            {capError && (
              <p className="text-[13px] text-destructive" role="alert">
                {capError}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
