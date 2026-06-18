/**
 * AI invoke route — provider-agnostic SSE streaming via the adapter factory.
 *
 * POST /api/sessions/:id/invoke
 *
 * AI-03: Streams AI text token-by-token via SSE (text_delta events)
 * AI-04: Dual-channel separation — text_delta for chat bubbles, panel_update for widgets
 * AI-05: PanelWidgetSchema.safeParse gate — invalid render_panel payloads dropped silently
 * AI-06: Branch-isolated context — message query filters .eq('path_id', 'main')
 * AI-07: Bot-activation matrix — returns 429 typing_hold while anyoneTyping=true (D-17)
 * AI-08: Sliding window — last 8 messages raw; older messages compressed via compressHistory
 * D-03: All tasks (analysis + compression) use the active provider's adapter + model
 * D-05: Provider selection from creator_settings.active_provider
 * PANEL-04: AI message row is inserted with canvas_snapshot_state = last panel_update payload
 *
 * T-02-05: Session ownership gate (creator_id === user.id → else 403)
 * T-02-06: API key decrypted server-side only — never written to any SSE event
 * T-02-07: Cap check before every invoke (429 if cap reached); cap increments only after stream
 * T-02-08: path_id filter prevents cross-branch context leakage
 * T-04-12: PanelWidgetSchema gate on render_panel tool_use input (malformed payloads dropped)
 * T-04-15: stream error emits generic 'stream_failed' — no provider-specific detail leaked
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { createServiceClient } from '../lib/supabase'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { assemblePromptArray, compressHistory, type Message } from '../lib/anthropic'
import { checkCap, incrementCount } from '../lib/cap-guard'
import { createAdapter } from '../lib/adapter-factory'
import { TASK_MODELS } from '../lib/model-config'
import { decryptKey } from '../lib/crypto'
import { env } from '../lib/env'
import { PERSONA_LIBRARY, renderPanelTool, PanelWidgetSchema } from '@panelito/types'
import type { ProviderName } from '@panelito/types'

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
 * Streams AI tokens (text_delta SSE events) + panel widget updates (panel_update SSE events).
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

  // D-17: Return 429 typing_hold BEFORE any AI call when a human is typing
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
  // 5. Fetch creator's active provider + plaintext key (D-03, D-05, T-02-06)
  // -------------------------------------------------------------------------
  const { data: creatorSettings, error: settingsErr } = await supabase
    .from('creator_settings')
    .select('anthropic_api_key, openai_api_key, gemini_api_key, active_provider')
    .eq('user_id', session.creator_id)
    .maybeSingle()

  if (settingsErr) {
    console.error('[ai] settings fetch error', settingsErr)
    return c.json({ error: 'server_error' }, 500)
  }

  // Resolve active provider (default 'anthropic' if not set)
  const providerName = ((creatorSettings?.active_provider) ?? 'anthropic') as ProviderName

  // Resolve the encrypted key column for the active provider
  const encryptedKey = creatorSettings?.[`${providerName}_api_key` as keyof typeof creatorSettings] as string | null | undefined

  if (!encryptedKey) {
    return c.json({ error: 'no_api_key' }, 400)
  }

  let plaintextKey: string
  try {
    plaintextKey = decryptKey(encryptedKey, env.KEY_ENCRYPTION_SECRET)
  } catch (err) {
    console.error('[ai] key decrypt error:', (err as Error).constructor.name)
    return c.json({ error: 'no_api_key' }, 400)
  }

  // -------------------------------------------------------------------------
  // 6. Instantiate the adapter ONCE — used for both compression and streaming (D-03)
  // -------------------------------------------------------------------------
  const adapter = createAdapter(providerName, plaintextKey)

  // -------------------------------------------------------------------------
  // 7. Fetch last 8 messages (AI-06: path_id filter) + older for compression (AI-08)
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
      historicalSummary = await compressHistory(adapter, TASK_MODELS[providerName].compression, olderMessages)
    } catch (err) {
      // Non-fatal: if compression fails, proceed without historical summary
      console.error('[ai] compressHistory error:', (err as Error).message)
      historicalSummary = ''
    }
  }

  // -------------------------------------------------------------------------
  // 8. Assemble prompt array (AI-11 cache breakpoint via AnthropicAdapter)
  // -------------------------------------------------------------------------
  const promptArray = assemblePromptArray({
    systemPrompt: BASE_SYSTEM_PROMPT,
    personaInstructions,
    historicalSummary,
    recentMessages,
    userMessage,
  })

  // -------------------------------------------------------------------------
  // 9. Open SSE stream
  // -------------------------------------------------------------------------
  return streamSSE(c, async (stream) => {
    let accumulatedText = ''
    let lastPanelUpdate: unknown = null

    try {
      for await (const event of adapter.stream(promptArray, [renderPanelTool], {
        model: TASK_MODELS[providerName].analysis,
        maxTokens: 2048,
        system: BASE_SYSTEM_PROMPT + '\n\n' + personaInstructions,
      })) {
        if (event.type === 'text_delta') {
          accumulatedText += event.text
          await stream.writeSSE({
            event: 'text_delta',
            data: JSON.stringify({ text: event.text }),
          })
        } else if (event.type === 'tool_use' && event.name === 'render_panel') {
          // AI-05 / T-04-12: validate render_panel payload through PanelWidgetSchema
          // before emitting panel_update SSE — malformed payloads are dropped silently
          const parsed = PanelWidgetSchema.safeParse(event.input)
          if (parsed.success) {
            lastPanelUpdate = parsed.data
            await stream.writeSSE({
              event: 'panel_update',
              data: JSON.stringify(parsed.data),
            })
          } else {
            // Drop the malformed payload — do not crash, do not write SSE
            console.error('[render_panel] schema validation failed', parsed.error.flatten())
          }
        }
        // done event breaks the iterator naturally
      }

      // -----------------------------------------------------------------------
      // Pitfall 4: insert AI message AFTER the stream completes — not during streaming
      // PANEL-04: canvas_snapshot_state = last panel_update payload
      // Guard: skip insert when content is empty (Anthropic error before first token)
      // to avoid violating messages_content_check (content length >= 1).
      // -----------------------------------------------------------------------
      if (accumulatedText.length > 0) {
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

        // T-02-07: increment cap ONLY after a completed real AI stream with content
        // (never on the typing_hold 429 path, during streaming, or on empty response)
        await incrementCount(supabase, sessionId)
      }

      await stream.writeSSE({ event: 'done', data: '{}' })
    } catch (err) {
      console.error('[ai] stream error:', (err as Error).message)
      // T-04-15: emit generic error — no provider-specific detail leaked to participants
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: 'stream_failed' }),
      })
    }
  })
})

export default aiRouter
