import { createAdapter } from '../lib/adapter-factory'
import { TASK_MODELS } from '../lib/model-config'
import type { ProviderName } from '@panelito/types'

/**
 * generateBranchLabel — Auto-labeling via flash model (AI-09).
 * Takes the message content, provider, and API key, and returns a 2-3 word string label.
 */
export async function generateBranchLabel(
  messageContent: string,
  provider: ProviderName,
  apiKey: string
): Promise<string> {
  try {
    const adapter = createAdapter(provider, apiKey)
    const model = TASK_MODELS[provider].categorization

    const systemPrompt = `Eres un asistente que genera etiquetas cortas y semánticas para ramas de conversación.
Dado el mensaje del usuario, genera una etiqueta de 2 a 3 palabras en español que resuma el tema o la intención de bifurcación.
Responde ÚNICAMENTE con la etiqueta (2-3 palabras), sin comillas, sin punto final, sin explicaciones.
Ejemplo de entrada: "Quiero discutir la estrategia de marketing para el lanzamiento"
Ejemplo de salida: Estrategia de Marketing`

    const messages = [
      {
        role: 'user' as const,
        content: `Genera una etiqueta para el siguiente mensaje:\n\n"${messageContent}"`,
      },
    ]

    let label = ''
    const stream = adapter.stream(messages, [], {
      model,
      maxTokens: 20,
      system: systemPrompt,
    })

    for await (const event of stream) {
      if (event.type === 'text_delta') {
        label += event.text
      }
    }

    const trimmed = label.replace(/["'‘’.]$/g, '').trim()
    return trimmed || 'Nueva Rama'
  } catch (error) {
    console.error('[labeler] Error generating branch label:', error)
    return 'Nueva Rama'
  }
}
