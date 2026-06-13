'use client'

/**
 * useAIStream — fetch-based SSE consumer for the /invoke AI streaming endpoint (D-01).
 *
 * D-01: Uses fetch() + ReadableStream (NOT EventSource — EventSource is GET-only; cannot
 *       send POST body with session context).
 *
 * D-02: AI text tokens are accumulated as ephemeral local React state while streaming.
 *       No token-by-token DB writes — the server persists the final message after stream end.
 *
 * AI-05: Every panel_update SSE event is validated with PanelWidgetSchema.safeParse()
 *        before touching panelStore. Invalid payloads are silently discarded.
 *
 * Pitfall 1: ReadableStream read() does not guarantee one SSE event per chunk.
 *            A single read() may deliver partial events, multiple events, or events
 *            split across reads. Solution: buffer decoder output, split on \n\n boundary,
 *            process complete events, retain remainder in buffer.
 *
 * T-02-10: Panel_update Zod gate — invalid payloads silently discarded.
 * T-02-11: JSON.parse wrapped per event — a bad event is skipped, not fatal.
 */

import { useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PanelWidgetSchema } from '@panelito/types'
import { usePanelStore } from '@/store/panel-store'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787'

export type AIStreamStatus =
  | 'idle'
  | 'streaming'
  | 'done'
  | 'typing_hold'    // 429 — someone is typing
  | 'no_persona'     // 409 — no active persona
  | 'no_api_key'     // 400 — no API key configured
  | 'error'

interface UseAIStreamReturn {
  isAIStreaming: boolean
  streamingText: string
  status: AIStreamStatus
  /** Open the SSE invoke stream for the current session */
  openAIStream: (
    userMessage: string,
    anyoneTyping: boolean
  ) => Promise<void>
  /** Reset streaming state after the stream ends */
  resetStream: () => void
}

/**
 * Parse a single SSE event block (everything between \n\n boundaries).
 * Returns { event, data } or null if the block is incomplete / malformed.
 */
function parseSSEBlock(block: string): { event: string; data: string } | null {
  let event = 'message'
  let data = ''

  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) {
      event = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      data = line.slice(6)
    }
  }

  if (!data) return null
  return { event, data }
}

/**
 * Validate and dispatch a panel_update payload to panelStore (AI-05 / T-02-10).
 * Invalid payloads are silently discarded — last stable state is preserved.
 */
function handlePanelUpdate(raw: unknown): void {
  const result = PanelWidgetSchema.safeParse(raw)
  if (!result.success) {
    console.warn('[panel] schema invalid — discarded:', result.error.issues)
    return
  }
  usePanelStore.getState().setWidget(result.data)
}

export function useAIStream(sessionId: string): UseAIStreamReturn {
  const [isAIStreaming, setIsAIStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [status, setStatus] = useState<AIStreamStatus>('idle')
  const abortRef = useRef<AbortController | null>(null)

  const resetStream = useCallback(() => {
    setIsAIStreaming(false)
    setStreamingText('')
    setStatus('idle')
  }, [])

  const openAIStream = useCallback(
    async (userMessage: string, anyoneTyping: boolean): Promise<void> => {
      // Abort any previous in-flight stream
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      // Reset state for the new stream
      setStreamingText('')
      setIsAIStreaming(true)
      setStatus('streaming')

      try {
        // Get the current Supabase session token (D-01: reuse api.ts auth header pattern)
        let token: string | undefined
        if (typeof window !== 'undefined') {
          const supabase = createClient()
          const {
            data: { session },
          } = await supabase.auth.getSession()
          token = session?.access_token
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }

        const response = await fetch(`${API_URL}/api/sessions/${sessionId}/invoke`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ userMessage, anyoneTyping }),
          signal: controller.signal,
        })

        // Handle non-streaming error responses
        if (!response.ok) {
          if (response.status === 429) {
            setStatus('typing_hold')
          } else if (response.status === 409) {
            setStatus('no_persona')
          } else if (response.status === 400) {
            setStatus('no_api_key')
          } else {
            setStatus('error')
          }
          setIsAIStreaming(false)
          return
        }

        // D-01: Read response body as ReadableStream
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()

        // Pitfall 1: maintain a buffer across reads; split on \n\n (SSE event boundary)
        let buffer = ''
        let interrupted = false

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          // Append decoded chunk to buffer
          buffer += decoder.decode(value, { stream: true })

          // Split on the SSE event boundary \n\n
          const parts = buffer.split('\n\n')

          // The last part may be incomplete — retain it in buffer
          buffer = parts.pop() ?? ''

          for (const block of parts) {
            if (!block.trim()) continue

            const parsed = parseSSEBlock(block)
            if (!parsed) continue

            const { event, data } = parsed

            if (event === 'text_delta') {
              // T-02-11: wrap JSON.parse — skip malformed event, not fatal
              try {
                const payload = JSON.parse(data) as { text?: string }
                if (typeof payload.text === 'string') {
                  setStreamingText((prev) => prev + payload.text)
                }
              } catch {
                console.warn('[ai-stream] malformed text_delta:', data)
              }
            } else if (event === 'panel_update') {
              // AI-05: Zod gate — validate before touching panelStore
              try {
                const raw = JSON.parse(data)
                handlePanelUpdate(raw)
              } catch {
                console.warn('[ai-stream] malformed panel_update JSON:', data)
              }
            } else if (event === 'done') {
              // Stream complete — finalize state
              setIsAIStreaming(false)
              setStatus('done')
              return
            } else if (event === 'error') {
              interrupted = true
              break
            }
          }

          if (interrupted) break
        }

        // If we exited the loop without a 'done' event
        if (interrupted) {
          setStatus('error')
        } else {
          setStatus('done')
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          // Intentional abort — don't change status to error
          return
        }
        console.error('[ai-stream] stream error:', err)
        setStatus('error')
      } finally {
        setIsAIStreaming(false)
      }
    },
    [sessionId]
  )

  return { isAIStreaming, streamingText, status, openAIStream, resetStream }
}
