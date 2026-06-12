'use client'

/**
 * Re-export ApiKeyForm from the shared components location.
 *
 * The form is used from two places:
 * 1. /onboarding/api-key (this route group) — initial BYOK gate
 * 2. /settings — key rotation dialog
 *
 * The canonical implementation lives at @/components/byok/api-key-form.
 * This file re-exports it so the onboarding page can import it locally.
 */

export { ApiKeyForm } from '@/components/byok/api-key-form'
