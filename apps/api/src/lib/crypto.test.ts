/**
 * Tests for AES-256-GCM crypto helpers.
 *
 * Crypto Test 1: round-trip (encrypt then decrypt yields original plaintext)
 * Crypto Test 2: tampering with the ciphertext causes decryptKey to throw
 * Crypto Test 3: wrong secret causes decryptKey to throw
 * Crypto Test 4: 100 sequential encryptions produce 100 distinct ciphertexts (random IV)
 */

import { describe, it, expect } from 'vitest'
import { encryptKey, decryptKey } from './crypto'

const VALID_SECRET = 'a'.repeat(64) // 64 hex chars = 32 bytes

describe('encryptKey / decryptKey (AES-256-GCM)', () => {
  it('Crypto Test 1: round-trip for arbitrary UTF-8 strings', () => {
    const inputs = [
      'hello world',
      'sk-ant-api03-abc123xyz',
      'unicode: 日本語テスト',
      'x'.repeat(1024), // up to 1KB
    ]
    for (const plaintext of inputs) {
      const ciphertext = encryptKey(plaintext, VALID_SECRET)
      const recovered = decryptKey(ciphertext, VALID_SECRET)
      expect(recovered).toBe(plaintext)
    }
  })

  it('Crypto Test 2: tampering with any byte of the ciphertext causes decryptKey to throw', () => {
    const plaintext = 'my-anthropic-key-sk-ant-api03-test12345'
    const ciphertext = encryptKey(plaintext, VALID_SECRET)

    // Tamper: change last character to something different
    const parts = ciphertext.split('.')
    const lastPart = parts[2] ?? ''
    const iv = parts[0] ?? ''
    const authTag = parts[1] ?? ''
    const tampered = lastPart.slice(0, -1) + (lastPart.endsWith('A') ? 'B' : 'A')
    const tamperedCiphertext = [iv, authTag, tampered].join('.')

    expect(() => decryptKey(tamperedCiphertext, VALID_SECRET)).toThrow()
  })

  it('Crypto Test 3: wrong secret causes decryptKey to throw', () => {
    const plaintext = 'my-anthropic-key-sk-ant-api03-test12345'
    const ciphertext = encryptKey(plaintext, VALID_SECRET)
    const wrongSecret = 'b'.repeat(64)

    expect(() => decryptKey(ciphertext, wrongSecret)).toThrow()
  })

  it('Crypto Test 4: 100 sequential encryptions produce 100 distinct ciphertexts (random IV)', () => {
    const plaintext = 'same-plaintext-always'
    const ciphertexts = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ciphertexts.add(encryptKey(plaintext, VALID_SECRET))
    }
    expect(ciphertexts.size).toBe(100)
  })

  it('encryptKey rejects secret with wrong length', () => {
    expect(() => encryptKey('hello', 'short')).toThrow()
    expect(() => encryptKey('hello', 'a'.repeat(63))).toThrow()
    expect(() => encryptKey('hello', 'a'.repeat(65))).toThrow()
  })

  it('decryptKey rejects secret with wrong length', () => {
    const ciphertext = encryptKey('hello', VALID_SECRET)
    expect(() => decryptKey(ciphertext, 'short')).toThrow()
  })
})
