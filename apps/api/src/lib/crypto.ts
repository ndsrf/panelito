/**
 * AES-256-GCM symmetric encryption for creator API keys.
 *
 * Security properties:
 * - Authenticated encryption: the auth tag detects any byte-level tampering.
 * - Random IV: each call generates a fresh 12-byte IV (NIST recommended for GCM).
 * - Format: base64(iv).base64(authTag).base64(ciphertext) — dot-separated for clarity.
 *
 * AI-01: encrypted_api_key is stored as this format in creator_settings.
 * T-06-04: any tamper attempt throws at decryptKey(); callers treat that as "no key".
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const IV_BYTES = 12    // GCM recommended IV length
const TAG_BYTES = 16   // GCM auth tag length (default)
const SECRET_HEX_LEN = 64  // 32 bytes as hex string

function validateSecret(secret: string): Buffer {
  if (secret.length !== SECRET_HEX_LEN) {
    throw new Error(
      `KEY_ENCRYPTION_SECRET must be ${SECRET_HEX_LEN} hex chars (32 bytes); got ${secret.length}`
    )
  }
  return Buffer.from(secret, 'hex')
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 *
 * @param plaintext - The value to encrypt (e.g., an Anthropic API key).
 * @param secret    - 64-character hex string representing a 32-byte key.
 * @returns         - Dot-separated base64 string: `iv.authTag.ciphertext`
 */
export function encryptKey(plaintext: string, secret: string): string {
  const key = validateSecret(secret)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.')
}

/**
 * Decrypt a payload produced by encryptKey().
 *
 * @param payload - Dot-separated base64 string: `iv.authTag.ciphertext`
 * @param secret  - 64-character hex string representing a 32-byte key.
 * @returns       - The original plaintext string.
 * @throws        - If the payload is malformed, the secret is wrong, or the
 *                  auth tag doesn't match (indicating tampering). T-06-04.
 */
export function decryptKey(payload: string, secret: string): string {
  const key = validateSecret(secret)
  const parts = payload.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format: expected 3 dot-separated base64 segments')
  }

  const ivB64 = parts[0]
  const authTagB64 = parts[1]
  const ciphertextB64 = parts[2]

  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Invalid encrypted payload: one or more segments are empty')
  }

  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')

  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: expected ${IV_BYTES} bytes`)
  }
  if (authTag.length !== TAG_BYTES) {
    throw new Error(`Invalid auth tag length: expected ${TAG_BYTES} bytes`)
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  // Any auth-tag mismatch (wrong key or tampered ciphertext) throws here.
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return plaintext.toString('utf8')
}
