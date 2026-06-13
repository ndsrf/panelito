import type { MiddlewareHandler } from 'hono'
import type { User } from '@supabase/supabase-js'
import { createServiceClient } from '../lib/supabase'

/**
 * AuthVariables — typed context variables set by requireAuth.
 *
 * Usage in a route: const user = c.get('user')
 */
export interface AuthVariables {
  user: User
}

/**
 * requireAuth — Hono middleware that validates a Supabase Bearer JWT.
 *
 * Reads the `Authorization: Bearer <token>` header, validates the JWT
 * against Supabase Auth using the service-role client, and sets
 * `c.set('user', data.user)` for downstream handlers.
 *
 * On missing or invalid token: returns 401 { error: 'unauthorized' }.
 *
 * Security: uses supabase.auth.getUser(token) which does a server-side
 * round-trip to validate the JWT — never trusts the token payload alone.
 *
 * T-03-02: creator_id ownership checks are done per-route in addition to this
 * middleware because RLS still applies to service-role writes on status updates.
 */
export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const authorization = c.req.header('Authorization')

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const token = authorization.slice(7) // Remove "Bearer " prefix

  const supabase = createServiceClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  c.set('user', user)
  return next()
}
