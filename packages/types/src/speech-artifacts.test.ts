/**
 * speech-artifacts.test.ts — Tests for the shared speech-artifact blocklist +
 * substring matcher (14-01-PLAN.md Task 2 behavior, SPEECH-01/02/03, D-08).
 *
 * Behavior assertions:
 *   - containsSpeechArtifact('Great, [canvas updated] — done') === true (substring match mid-message)
 *   - containsSpeechArtifact('[graph modified]') === true
 *   - containsSpeechArtifact('[node added]') === true
 *   - containsSpeechArtifact('Let us keep discussing the options') === false
 *   - containsSpeechArtifact('') === false
 *   - SPEECH_ARTIFACT_BLOCKLIST contains at least the three ROADMAP-named strings
 */

import { describe, it, expect } from 'vitest'
import { SPEECH_ARTIFACT_BLOCKLIST, containsSpeechArtifact } from './speech-artifacts'

describe('SPEECH_ARTIFACT_BLOCKLIST', () => {
  it('contains at least the three ROADMAP-named artifact strings', () => {
    expect(SPEECH_ARTIFACT_BLOCKLIST).toContain('[canvas updated]')
    expect(SPEECH_ARTIFACT_BLOCKLIST).toContain('[graph modified]')
    expect(SPEECH_ARTIFACT_BLOCKLIST).toContain('[node added]')
  })
})

describe('containsSpeechArtifact', () => {
  it('matches an artifact string embedded mid-sentence (substring, not whole-message equality)', () => {
    expect(containsSpeechArtifact('Great, [canvas updated] — done')).toBe(true)
  })

  it('matches an artifact string that is the entire message', () => {
    expect(containsSpeechArtifact('[graph modified]')).toBe(true)
    expect(containsSpeechArtifact('[node added]')).toBe(true)
  })

  it('returns false for ordinary conversation text', () => {
    expect(containsSpeechArtifact('Let us keep discussing the options')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(containsSpeechArtifact('')).toBe(false)
  })
})
