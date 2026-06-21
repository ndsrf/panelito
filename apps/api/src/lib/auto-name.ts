/**
 * auto-name.ts — Post-3rd-message session naming (SESS-09).
 *
 * Phase 1 strategy: deterministic — derive a 2-3 word label from the most
 * frequent non-stopword nouns/verbs using a simple word-count heuristic.
 *
 * Phase 2 swaps this implementation for a flash Claude call per AI-09's intent.
 * The function signature stays stable so the caller (messages route) needs no changes.
 *
 * Limitation: The deterministic heuristic does not handle all languages well.
 * Phase 2 replaces this with a flash Claude call for quality improvement.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** The message count threshold that triggers auto-naming (SESS-09). */
const AUTO_NAME_THRESHOLD = 3

/** Placeholder regex — matches null or common blank placeholders. */
const PLACEHOLDER_REGEX = /^(untitled|sin\s+titulo|sesion\s+sin\s+titulo|nueva\s+sesion)$/i

/** Stop words (Spanish + English) excluded from the word-frequency heuristic. */
const STOP_WORDS = new Set([
  // Spanish
  'de', 'la', 'el', 'en', 'y', 'a', 'los', 'las', 'un', 'una', 'para', 'con',
  'se', 'por', 'es', 'al', 'del', 'lo', 'le', 'su', 'que', 'no', 'si', 'me',
  'te', 'nos', 'lo', 'mi', 'tu', 'su', 'nos', 'pero', 'como', 'ya', 'mas',
  'muy', 'este', 'esta', 'ese', 'eso', 'esa', 'esto', 'hay', 'ser', 'tener',
  'vamos', 'hacer', 'todo', 'todos', 'otra', 'otro', 'puede', 'cuando',
  // English
  'the', 'a', 'an', 'of', 'to', 'in', 'is', 'it', 'that', 'and', 'or', 'but',
  'not', 'are', 'was', 'be', 'with', 'for', 'on', 'at', 'by', 'from', 'we',
  'he', 'she', 'they', 'you', 'i', 'my', 'our', 'your', 'this', 'its', 'as',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'could', 'should',
  'can', 'if', 'what', 'when', 'how', 'who', 'which', 'so', 'than', 'then',
])

/**
 * maybeAutoName — called after each successful message INSERT.
 *
 * Conditions:
 * - session.title is NULL OR matches the placeholder regex.
 * - message count for this session reached EXACTLY 3 (only the 3rd insert triggers).
 *
 * @param supabase - Service-role client.
 * @param sessionId - The session to maybe auto-name.
 */
export async function maybeAutoName(
  supabase: SupabaseClient,
  sessionId: string
): Promise<void> {
  // Check session title
  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .select('id, title')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !session) return

  const hasNoTitle = session.title === null || PLACEHOLDER_REGEX.test(session.title.trim())
  if (!hasNoTitle) return // Session already has a real title

  // Count messages for this session
  const { count, error: countErr } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)

  if (countErr || count === null) return

  // Only trigger on EXACTLY the 3rd message (SESS-09)
  if (count !== AUTO_NAME_THRESHOLD) return

  // Fetch the 3 messages to derive the label
  const { data: messages, error: msgsErr } = await supabase
    .from('messages')
    .select('content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(3)

  if (msgsErr || !messages || messages.length < 3) return

  const combinedText = messages.map((m: { content: string }) => m.content).join(' ')
  const title = deriveTitle(combinedText)

  // Update the session title
  const { error: updateErr } = await supabase
    .from('sessions')
    .update({ title })
    .eq('id', sessionId)

  if (updateErr) {
    console.error('[auto-name] title update error:', updateErr.message)
    return
  }

  // Broadcast the title change to all clients
  supabase
    .channel(`session-status:${sessionId}`)
    .httpSend('session_status_change', { title, status: 'active' })
    .catch((err: unknown) => console.error('[auto-name] broadcast error:', err))
}

/**
 * deriveTitle — Phase 1 deterministic 2-3 word label from text.
 *
 * Algorithm:
 * 1. Tokenize to lowercase words (alpha only).
 * 2. Remove stop words and short words (< 4 chars).
 * 3. Count word frequencies.
 * 4. Take top 2-3 words sorted by frequency then length.
 * 5. Title-case and join.
 * 6. Fallback to "Sesion sin titulo" if result is too short.
 */
export function deriveTitle(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-záéíóúüñ\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))

  if (words.length === 0) return 'Sesion sin titulo'

  // Count frequencies
  const freq = new Map<string, number>()
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1)
  }

  // Sort by frequency desc, then length desc for tie-breaking
  const sorted = [...freq.entries()]
    .sort(([a, fa], [b, fb]) => fb - fa || b.length - a.length)
    .slice(0, 3)
    .map(([w]) => w)

  const label = sorted.map(titleCase).join(' ')

  // Fallback if label is too short (< 6 chars total)
  if (label.replace(/\s/g, '').length < 6) return 'Sesion sin titulo'

  return label
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}
