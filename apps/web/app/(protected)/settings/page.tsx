/**
 * Settings page — D-05.
 *
 * Dedicated /settings route (not a drawer) for managing:
 * - Multi-provider API key management (Anthropic, OpenAI, Gemini) — D-09
 * - Click-to-activate provider selection — D-05
 * - Global AI response cap (D-06)
 *
 * Max-width 640px, sections in cards.
 */

import { requireUser } from '@/lib/auth'
import { getCreatorSettings, getKeyStatus } from '@/lib/creator-settings'
import { SettingsForm } from './settings-form'

export default async function SettingsPage() {
  await requireUser()
  const [settings, keyStatus] = await Promise.all([
    getCreatorSettings(),
    getKeyStatus(),
  ])

  return (
    <main className="flex flex-1 flex-col p-6 md:p-8">
      <div className="w-full max-w-[640px] mx-auto space-y-6">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground">Settings</h1>
          <p className="text-[14px] text-muted-foreground mt-1">
            Configura tu integración con AI y los límites de respuestas.
          </p>
        </div>

        <SettingsForm settings={settings} keyStatus={keyStatus} />
      </div>
    </main>
  )
}
