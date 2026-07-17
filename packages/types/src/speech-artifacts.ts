/**
 * speech-artifacts.ts — Shared speech-artifact blocklist + substring matcher.
 *
 * SPEECH-01/02/03: bot Roles occasionally speak "canvas mutation" phrasing
 * (e.g. "[canvas updated]") into the chat transcript instead of leaving that
 * language implicit in the panel/canvas sync. This module is the single
 * source of truth for the curated exact-string blocklist (D-08) and the
 * substring matcher both the frontend chat filter (SPEECH-02) and any
 * prompt/backend reference (SPEECH-01/03) import from `@panelito/types`.
 *
 * D-08: curated exact-string list, NOT a regex. No ReDoS surface (ASVS V5).
 *
 * Pitfall 3 (14-RESEARCH.md): the matcher MUST be a substring `.includes()`
 * check, never whole-message equality — an artifact can be embedded
 * mid-sentence (e.g. "Great, [canvas updated] — done") and a naive
 * `content === pattern` check would miss it.
 */

export const SPEECH_ARTIFACT_BLOCKLIST: readonly string[] = [
  '[canvas updated]',
  '[graph modified]',
  '[node added]',
]

export function containsSpeechArtifact(content: string): boolean {
  return SPEECH_ARTIFACT_BLOCKLIST.some((pattern) => content.includes(pattern))
}
