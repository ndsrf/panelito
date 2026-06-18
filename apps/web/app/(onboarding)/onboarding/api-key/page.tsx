/**
 * Onboarding API key gate — D-04.
 *
 * Post-OAuth one-time focused screen. Creator must verify a provider API key
 * before accessing any workspace functionality.
 *
 * - No nav, no sidebar (uses (onboarding) layout group)
 * - Max-width 440px centered column
 * - Provider selector (Anthropic / OpenAI / Gemini)
 * - Masked input with eye toggle
 * - "Verificar y guardar" CTA button
 * - Inline error on invalid key (AI-10)
 */

import { requireUser } from '@/lib/auth'
import { ApiKeyForm } from './api-key-form'

export default async function OnboardingApiKeyPage() {
  await requireUser()

  return (
    <div className="w-full max-w-[440px] space-y-8">
      {/* Wordmark */}
      <div className="text-center space-y-1">
        <h1 className="text-[22px] font-bold tracking-tight text-foreground">
          Multiverse
        </h1>
        <p className="text-[13px] text-muted-foreground">Collaborative AI Workspace</p>
      </div>

      {/* Explanation */}
      <div className="text-center">
        <p className="text-[15px] text-foreground leading-relaxed">
          Introduce tu clave de API para que el AI pueda analizar tu sesión.
          Tu clave queda cifrada y solo se usa desde nuestro servidor
          — nunca se envía al navegador.
        </p>
      </div>

      {/* Form — includes provider selector */}
      <ApiKeyForm />

      {/* Footer hint */}
      <p className="text-center text-[12px] text-muted-foreground">
        Puedes cambiar de proveedor en cualquier momento desde{' '}
        <span className="font-medium text-foreground">/configuración</span>.
      </p>
    </div>
  )
}
