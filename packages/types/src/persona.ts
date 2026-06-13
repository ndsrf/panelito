import { z } from 'zod'

// -----------------------------------------------------------------------
// Persona IDs — const tuple for z.enum + type narrowing
// Phase 2 has 1 entry; Phase 3 adds more (Devil's Advocate, etc.)
// -----------------------------------------------------------------------

export const PERSONA_IDS = ['analista_cientifico'] as const
export type PersonaId = typeof PERSONA_IDS[number]

// -----------------------------------------------------------------------
// PersonaConfigSchema — single persona definition
// -----------------------------------------------------------------------

export const PersonaConfigSchema = z.object({
  id: z.enum(PERSONA_IDS),
  displayName: z.string(),
  description: z.string(),
  systemPromptAddition: z.string(),
  icon: z.string(), // Lucide icon name
  active: z.boolean(),
})

export type PersonaConfig = z.infer<typeof PersonaConfigSchema>

// -----------------------------------------------------------------------
// PERSONA_LIBRARY — hardcoded for Phase 2
// PERSONA-01: Analista Científico is available in all sessions by default
// -----------------------------------------------------------------------

export const PERSONA_LIBRARY: PersonaConfig[] = [
  {
    id: 'analista_cientifico',
    displayName: 'Analista Científico',
    description:
      'Analiza datos, detecta falacias y estructura la información cuantitativa.',
    systemPromptAddition:
      'You are the Analista Científico — a rigorous, neutral analytical persona. ' +
      'Your role is to analyze data presented in the conversation, detect logical fallacies ' +
      'and cognitive biases, quantify claims where possible, and structure information ' +
      'in a clear, evidence-based manner. Maintain a clinical, objective tone. ' +
      'When presenting analytics, prefer structured comparisons, percentages, and ranked lists. ' +
      'Do not take sides; surface both supporting data and contradicting evidence.',
    icon: 'FlaskConical',
    active: true,
  },
]
