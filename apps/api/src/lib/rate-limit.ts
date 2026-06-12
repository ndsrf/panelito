/**
 * rate-limit.ts — In-memory token bucket middleware for Hono (T-05-05).
 *
 * `rateLimit({ keyFn, limit, windowMs })` returns a Hono MiddlewareHandler
 * that returns 429 with a `Retry-After` header when the bucket overflows.
 *
 * Limitation: In-memory state is per-process and does not survive restarts or
 * scale horizontally. Phase 1 ships single-process. Post-MVP migrates to a
 * shared store (Redis or Upstash) for multi-process deployments.
 *
 * Applied to:
 * - POST /api/sessions/:id/messages — 60/min per user (T-05-05)
 * - POST /api/sessions — 10/min per user (T-03-05)
 * - POST /api/sessions/by-code/:code/guests — 20/min per IP (T-03-06)
 * - POST /api/keys/verify — 5/min per user (T-06-07)
 */

import type { Context, MiddlewareHandler, Next } from 'hono'

interface TokenBucket {
  tokens: number
  lastRefill: number
}

interface RateLimitOptions {
  /** Key function — returns a unique bucket key from the request context. */
  keyFn: (c: Context) => string
  /** Maximum requests allowed in the window. */
  limit: number
  /** Window duration in milliseconds. */
  windowMs: number
}

/**
 * rateLimit — creates a Hono middleware handler for token-bucket rate limiting.
 *
 * @param options.keyFn - Function to derive the bucket key from the context.
 * @param options.limit - Max requests per window.
 * @param options.windowMs - Window duration in ms.
 * @returns Hono middleware.
 */
export function rateLimit({ keyFn, limit, windowMs }: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, TokenBucket>()

  return async (c: Context, next: Next): Promise<Response | void> => {
    const key = keyFn(c)
    const now = Date.now()
    let bucket = buckets.get(key)

    if (!bucket) {
      bucket = { tokens: limit - 1, lastRefill: now }
      buckets.set(key, bucket)
      return next()
    }

    // Refill if window has expired
    const elapsed = now - bucket.lastRefill
    if (elapsed >= windowMs) {
      bucket.tokens = limit
      bucket.lastRefill = now
    }

    if (bucket.tokens <= 0) {
      // Return 429 with Retry-After
      const retryAfterSeconds = Math.ceil((windowMs - elapsed) / 1000)
      return c.json(
        { error: 'rate_limited', retryAfter: retryAfterSeconds },
        429,
        { 'Retry-After': String(retryAfterSeconds) }
      )
    }

    bucket.tokens--
    return next()
  }
}
