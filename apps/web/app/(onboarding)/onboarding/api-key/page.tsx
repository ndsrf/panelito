/**
 * Onboarding API key gate — D-04.
 *
 * Post-OAuth one-time focused screen. Creator must enter their Anthropic
 * API key before accessing any workspace functionality.
 *
 * - No nav, no sidebar (uses (onboarding) layout group)
 * - Max-width 440px centered column
 * - Masked input with eye toggle
 * - "Verify & Save" CTA button
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
          Necesitamos tu clave de API de Anthropic para que el AI pueda analizar
          tu sesion. Tu clave queda cifrada y solo se usa desde nuestro servidor
          — nunca se envia al navegador.
        </p>
      </div>

      {/* Form */}
      <ApiKeyForm />

      {/* Footer hint */}
      <p className="text-center text-[12px] text-muted-foreground">
        Obtén tu clave en{' '}
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          console.anthropic.com
        </a>
      </p>
    </div>
  )
}
