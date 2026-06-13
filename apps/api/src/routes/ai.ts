/**
 * AI invoke route — real SSE streaming with Anthropic Claude.
 *
 * POST /api/sessions/:id/invoke
 *
 * AI-03: Streams Claude text token-by-token via SSE (text_delta events)
 * AI-04: Dual-channel separation — text_delta for chat bubbles, panel_update for widgets
 * AI-06: Branch-isolated context — message query filters .eq('path_id', 'main')
 * AI-07: Bot-activation matrix — returns 429 typing_hold while anyoneTyping=true (D-17)
 * AI-08: Sliding window — last 8 messages raw; older messages compressed via compressHistory
 * PANEL-04: AI message row is inserted with canvas_snapshot_state = last panel_update payload
 *
 * T-02-05: Session ownership gate (creator_id === user.id → else 403)
 * T-02-06: API key decrypted server-side only — never written to any SSE event
 * T-02-07: Cap check before every invoke (429 if cap reached); cap increments only after stream
 * T-02-08: path_id filter prevents cross-branch context leakage
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { createServiceClient } from '../lib/supabase'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { assemblePromptArray, compressHistory, type Message } from '../lib/anthropic'
import { checkCap, incrementCount } from '../lib/cap-guard'
import { AnthropicAdapter, renderPanelTool } from '../lib/ai-provider'
import { decryptKey } from '../lib/crypto'
import { env } from '../lib/env'
import Anthropic from '@anthropic-ai/sdk'
import { PERSONA_LIBRARY } from '@panelito/types'

// ---------------------------------------------------------------------------
// Base system prompt for the facilitator
// ---------------------------------------------------------------------------

const BASE_SYSTEM_PROMPT =
  'You are an AI facilitator for a collaborative discussion workspace. ' +
  'You analyze group conversations and provide structured insights. ' +
  'When the conversation contains quantifiable data or comparisons, use the render_panel tool ' +
  'to display a visual analytics widget. Choose the most appropriate widget type: ' +
  'bento for key concept cards, radar for multi-axis comparisons, scatter for consensus vs impact, ' +
  'pie for proportional breakdowns.'

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const aiRouter = new Hono<{ Variables: AuthVariables }>()

aiRouter.use('/*', requireAuth)

/**
 * POST /api/sessions/:id/invoke
 *
 * Streams Claude tokens (text_delta SSE events) + panel widget updates (panel_update SSE events).
 * After the stream completes, inserts the AI message row with canvas_snapshot_state.
 */
aiRouter.post('/:id/invoke', async (c) => {
  const user = c.get('user')
  const sessionId = c.req.param('id')
  const supabase = createServiceClient()

  // -------------------------------------------------------------------------
  // 1. Session ownership check (T-02-05) — add active_personas to select
  // -------------------------------------------------------------------------
  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .select('id, creator_id, active_personas')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !session) {
    return c.json({ error: 'session_not_found' }, 404)
  }

  if (session.creator_id !== user.id) {
    return c.json({ error: 'forbidden' }, 403)
  }

  // -------------------------------------------------------------------------
  // 2. Cap check (T-02-07) — 429 if cap reached
  // -------------------------------------------------------------------------
  const capCheck = await checkCap(supabase, sessionId)
  if (!capCheck.ok) {
    return c.json({ error: capCheck.reason }, 429)
  }

  // -------------------------------------------------------------------------
  // 3. Parse body — anyoneTyping gate (AI-07 / D-17)
  // -------------------------------------------------------------------------
  const body = await c.req.json().catch(() => ({})) as {
    userMessage?: string
    anyoneTyping?: boolean
  }

  // D-17: Return 429 typing_hold BEFORE any Claude call when a human is typing
  // Cap is NOT incremented on this path (T-02-07)
  if (body.anyoneTyping) {
    return c.json({ error: 'typing_hold' }, 429)
  }

  const userMessage = body.userMessage ?? ''

  // -------------------------------------------------------------------------
  // 4. Resolve active persona system prompt (PERSONA-02 server-side gate)
  // -------------------------------------------------------------------------
  const activePersonas = (session.active_personas as string[] | null) ?? []
  const matchedPersonas = PERSONA_LIBRARY.filter(p => activePersonas.includes(p.id))

  if (matchedPersonas.length === 0) {
    // PERSONA-02: AI does not respond when no persona is toggled on
    return c.json({ error: 'no_active_persona' }, 409)
  }

  const personaInstructions = matchedPersonas
    .map(p => p.systemPromptAddition)
    .join('\n\n')

  // -------------------------------------------------------------------------
  // 5. Fetch creator's plaintext Anthropic key (T-02-06)
  // -------------------------------------------------------------------------
  const { data: creatorSettings, error: settingsErr } = await supabase
    .from('creator_settings')
    .select('encrypted_api_key')
    .eq('user_id', session.creator_id)
    .maybeSingle()

  if (settingsErr) {
    console.error('[ai] settings fetch error', settingsErr)
    return c.json({ error: 'server_error' }, 500)
  }

  if (!creatorSettings?.encrypted_api_key) {
    return c.json({ error: 'no_api_key' }, 400)
  }

  let plaintextKey: string
  try {
    plaintextKey = decryptKey(creatorSettings.encrypted_api_key, env.KEY_ENCRYPTION_SECRET)
  } catch (err) {
    console.error('[ai] key decrypt error:', (err as Error).constructor.name)
    return c.json({ error: 'no_api_key' }, 400)
  }

  // -------------------------------------------------------------------------
  // 6. Fetch last 8 messages (AI-06: path_id filter) + older for compression (AI-08)
  // -------------------------------------------------------------------------
  // Recent 8 messages (sliding window) — path-filtered to prevent cross-branch leakage
  const { data: recentData } = await supabase
    .from('messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .eq('path_id', 'main')  // AI-06 / T-02-08: branch isolation
    .order('created_at', { ascending: false })
    .limit(8)

  const recentMessages: Message[] = (recentData ?? []).reverse().map(m => ({
    role: (m.role ?? 'user') as 'user' | 'assistant',
    content: m.content as string,
  }))

  // Older messages — for history compression (AI-08)
  const { data: olderData } = await supabase
    .from('messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .eq('path_id', 'main')
    .order('created_at', { ascending: false })
    .range(8, 58)  // up to 50 older messages to compress

  let historicalSummary = ''
  if (olderData && olderData.length > 0) {
    const olderMessages: Message[] = olderData.reverse().map(m => ({
      role: (m.role ?? 'user') as 'user' | 'assistant',
      content: m.content as string,
    }))
    try {
      const haiku = new Anthropic({ apiKey: plaintextKey })
      historicalSummary = await compressHistory(haiku, olderMessages)
    } catch (err) {
      // Non-fatal: if compression fails, proceed without historical summary
      console.error('[ai] compressHistory error:', (err as Error).message)
      historicalSummary = ''
    }
  }

  // -------------------------------------------------------------------------
  // 7. Assemble prompt array (AI-11 cache breakpoint)
  // -------------------------------------------------------------------------
  const promptArray = assemblePromptArray({
    systemPrompt: BASE_SYSTEM_PROMPT,
    personaInstructions,
    historicalSummary,
    recentMessages,
    userMessage,
  })

  // -------------------------------------------------------------------------
  // 8. Open SSE stream
  // -------------------------------------------------------------------------
  return streamSSE(c, async (stream) => {
    let accumulatedText = ''
    let lastPanelUpdate: unknown = null

    try {
      const provider = new AnthropicAdapter(plaintextKey)

      for await (const event of provider.stream(promptArray, [renderPanelTool], {
        model: 'claude-sonnet-4-6',
        maxTokens: 2048,
      })) {
        if (event.type === 'text_delta') {
          accumulatedText += event.text
          await stream.writeSSE({
            event: 'text_delta',
            data: JSON.stringify({ text: event.text }),
          })
        } else if (event.type === 'tool_use' && event.name === 'render_panel') {
          // AI-04: capture fully-accumulated tool_use input (never raw partial deltas)
          lastPanelUpdate = event.input
          await stream.writeSSE({
            event: 'panel_update',
            data: JSON.stringify(event.input),
          })
        }
        // done event breaks the iterator naturally
      }

      // -----------------------------------------------------------------------
      // Pitfall 4: insert AI message AFTER the stream completes — not during streaming
      // PANEL-04: canvas_snapshot_state = last panel_update payload
      // -----------------------------------------------------------------------
      const { error: insertError } = await supabase
        .from('messages')
        .insert({
          session_id: sessionId,
          author_id: session.creator_id, // AI rows attributed to session creator
          display_name: 'Analista Científico',
          parent_id: null,
          path_id: 'main',
          role: 'assistant',
          content: accumulatedText,
          canvas_snapshot_state: lastPanelUpdate ?? null,
        })

      if (insertError) {
        console.error('[ai] message insert error', insertError)
        // Stream already open — log only, don't abort the SSE connection
      }

      // T-02-07: increment cap ONLY after a completed real Claude stream
      // (never on the typing_hold 429 path or during streaming)
      await incrementCount(supabase, sessionId)

      await stream.writeSSE({ event: 'done', data: '{}' })
    } catch (err) {
      console.error('[ai] stream error:', (err as Error).message)
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: 'stream_failed' }),
      })
    }
  })
})

export default aiRouter
