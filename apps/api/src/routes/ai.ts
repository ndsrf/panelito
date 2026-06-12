/**
 * AI prompt-assembly scaffold route.
 *
 * POST /api/sessions/:id/invoke
 *
 * Phase 1: assembles the prompt array and returns the scaffolded contract.
 * Returns 501 Not Implemented — Phase 2 replaces this body with the
 * streaming SSE call to Anthropic.
 *
 * AI-11: the prompt array is assembled with the cache_control breakpoint
 * at the END of the static prefix (see assemblePromptArray).
 */

import { Hono } from 'hono'
import { createServiceClient } from '../lib/supabase'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { assemblePromptArray, type Message } from '../lib/anthropic'
import { checkCap, incrementCount } from '../lib/cap-guard'

// ---------------------------------------------------------------------------
// Phase 1 static prefix constants
// Phase 2 will derive these from session config / AI persona records.
// ---------------------------------------------------------------------------

const PHASE1_SYSTEM_PROMPT =
  'You are an AI facilitator for a collaborative discussion workspace. ' +
  'You analyze group conversations and provide structured insights.'

const PHASE1_PERSONA_INSTRUCTIONS =
  'Be concise and analytical. Surface patterns, consensus, and divergence ' +
  'in the group conversation. Provide insights in clear, structured language.'

const PHASE1_HISTORICAL_SUMMARY =
  'No historical summary available. This is the beginning of the session.'

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const aiRouter = new Hono<{ Variables: AuthVariables }>()

aiRouter.use('/*', requireAuth)

/**
 * POST /api/sessions/:id/invoke
 *
 * Assembles the prompt array via assemblePromptArray() and returns the
 * scaffolded shape. Does NOT call the Anthropic API in Phase 1.
 *
 * Phase 2 replaces this body with the streaming SSE call to Anthropic.
 */
aiRouter.post('/:id/invoke', async (c) => {
  const user = c.get('user')
  const sessionId = c.req.param('id')
  const supabase = createServiceClient()

  // Verify the session belongs to this creator (authorization check)
  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .select('id, creator_id')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !session) {
    return c.json({ error: 'session_not_found' }, 404)
  }

  if (session.creator_id !== user.id) {
    return c.json({ error: 'forbidden' }, 403)
  }

  // SESS-12: Check cap before invocation — return 429 if cap reached
  const capCheck = await checkCap(supabase, sessionId)
  if (!capCheck.ok) {
    return c.json({ error: capCheck.reason }, 429)
  }

  // Fetch last 8 messages of the session for the dynamic tail (AI-11)
  const { data: messagesData } = await supabase
    .from('messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(8)

  const recentMessages: Message[] = (messagesData ?? [])
    .reverse()
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

  // Parse body for the current user message
  const body = await c.req.json().catch(() => ({})) as { userMessage?: string }
  const userMessage = body.userMessage ?? ''

  // Assemble the prompt array (AI-11 cache breakpoint wired here)
  const promptArray = assemblePromptArray({
    systemPrompt: PHASE1_SYSTEM_PROMPT,
    personaInstructions: PHASE1_PERSONA_INSTRUCTIONS,
    historicalSummary: PHASE1_HISTORICAL_SUMMARY,
    recentMessages,
    userMessage,
  })

  // Find the cache_control breakpoint position
  // The cache breakpoint is on the last content block of the static prefix message (index 0)
  let cbpIdx = -1
  for (let i = 0; i < promptArray.length; i++) {
    const msg = promptArray[i]
    if (msg && Array.isArray(msg.content)) {
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j] as { cache_control?: unknown }
        if (block && block.cache_control) {
          cbpIdx = i
        }
      }
    }
  }

  // SESS-12: Increment count after (successful) invocation scaffold
  // Phase 2: increment is called after the real Claude call completes.
  // Phase 1: increment here to allow E2E cap testing against the scaffold route.
  const countResult = await incrementCount(supabase, sessionId)

  // Phase 2 replaces this body with the streaming SSE call to Anthropic.
  return c.json(
    {
      status: 'scaffolded',
      prompt_array_length: promptArray.length,
      cache_breakpoint_position: cbpIdx,
      ai_response_count: countResult.count,
      threshold_crossed: countResult.threshold_crossed,
    },
    501
  )
})

export default aiRouter
