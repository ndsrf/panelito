import { z } from 'zod'

// -----------------------------------------------------------------------
// Power emoji enum — 4 reaction types (REACT-01 through REACT-04)
// -----------------------------------------------------------------------

const POWER_EMOJIS = ['🧠', '🔥', '📌', '🎯'] as const

// -----------------------------------------------------------------------
// ReactionSchema — matches public.reactions table exactly
// T-02-01: author_id enforced by RLS; T-02-02: emoji CHECK constraint mirrors this enum
// -----------------------------------------------------------------------

export const ReactionSchema = z.object({
  id: z.string().uuid(),
  message_id: z.string().uuid(),
  session_id: z.string().uuid(),
  author_id: z.string().uuid(),
  emoji: z.enum(POWER_EMOJIS),
  created_at: z.string(),
})

export type Reaction = z.infer<typeof ReactionSchema>

// -----------------------------------------------------------------------
// ReactionCountSchema — aggregated for MessageBubble display
// isOwn: whether the current user applied this reaction (REACT-05 optimistic UI)
// -----------------------------------------------------------------------

export const ReactionCountSchema = z.object({
  emoji: z.enum(POWER_EMOJIS),
  count: z.number().int().nonnegative(),
  isOwn: z.boolean(),
})

export type ReactionCount = z.infer<typeof ReactionCountSchema>
