import { notFound } from 'next/navigation'
import { requireUser, getUser } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import { apiFetch } from '@/lib/api'
import { getCreatorSettings } from '@/lib/creator-settings'
import type { Session, Branch, Blueprint } from '@panelito/types'
import { BlueprintSchema } from '@panelito/types'
import { Workspace } from './workspace'

/**
 * Workspace page — server component.
 *
 * Plan 04: Replaces the Plan 03 placeholder with the production 40/60 split-screen layout.
 *
 * Server responsibilities:
 * 1. Authenticate the user (requireUser)
 * 2. Fetch the session from the API
 * 3. Pass session + hasApiKey + currentUserId to <Workspace> (client component)
 *
 * Plan 04: hasApiKey is hardcoded false — Plan 06 wires the real value
 * from creator_settings.
 *
 * Phase 9 (09-02, D-08, CANVAS-04):
 * 4. Load active Blueprint from domain_blueprints via Supabase server client
 * 5. Extract canvas_view_mode ('graph' | 'chart'); default 'chart' on failure (fail-silent)
 * 6. Pass canvasViewMode to <Workspace> — same pattern as hasApiKey
 *
 * SESS-02: Session data fetched and passed to workspace.
 * SESS-05/06: session.status passed — Workspace gates CreatorControls.
 */
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireUser()

  // Get current user for creator gate
  const user = await getUser()

  // Get the access token for the API call
  const supabase = await createServerClient()
  const { data: { session: authSession } } = await supabase.auth.getSession()
  const accessToken = authSession?.access_token

  // Plan 06: fetch real creator settings to wire hasApiKey (replaces hardcoded false)
  const creatorSettings = await getCreatorSettings()

  let session: Session | null = null
  try {
    session = await apiFetch<Session>(`/api/sessions/${id}`, {}, accessToken)
  } catch {
    notFound()
  }

  if (!session) {
    notFound()
  }

  // BYOK logic: If the current user is a guest (anonymous), we don't want to show
  // them the "Connect your API key" prompt in the analytics panel.
  // We only enforce the missing key state for the creator.
  const hasApiKey = user?.is_anonymous ? true : creatorSettings.has_api_key

  // Derive display name from user metadata (Plan 05: typing presence CHAT-06)
  const meta = user?.user_metadata as Record<string, unknown> | undefined
  const displayName =
    (meta?.full_name as string | undefined)?.trim() ||
    (meta?.name as string | undefined)?.trim() ||
    user?.email?.split('@')[0] ||
    'User'

  let branches: Branch[] = []
  try {
    branches = await apiFetch<Branch[]>(`/api/sessions/${id}/branches`, {}, accessToken)
  } catch (err) {
    console.error('Failed to fetch branches:', err)
  }

  // D-08, CANVAS-04: Resolve canvas_view_mode server-side from the session's Blueprint.
  // Also parse the full Blueprint definition so GraphCanvas can resolve node/edge colors client-side.
  // Queried directly from domain_blueprints via Supabase server client (no Blueprint HTTP API exists).
  // Fail-silent: default 'chart' / null Blueprint if blueprint_id absent or Blueprint load fails.
  // 'chart' default means no GraphCanvas shown — safe fallback for sessions without a Blueprint.
  let canvasViewMode: 'graph' | 'chart' = 'chart'
  let blueprint: Blueprint | null = null
  if (session.blueprint_id) {
    try {
      const { data: blueprintRow } = await supabase
        .from('domain_blueprints')
        .select('definition')
        .eq('id', session.blueprint_id)
        .single()

      if (blueprintRow?.definition && typeof blueprintRow.definition === 'object') {
        const def = blueprintRow.definition as Record<string, unknown>
        if (def.canvas_view_mode === 'graph' || def.canvas_view_mode === 'chart') {
          canvasViewMode = def.canvas_view_mode
        }
        // Parse full Blueprint for client-side color resolution in GraphCanvas
        const parsed = BlueprintSchema.safeParse(def)
        if (parsed.success) {
          blueprint = parsed.data
        }
      }
    } catch {
      // fail-silent — no graph canvas shown for this session; existing chart panel behavior
    }
  }

  return (
    <Workspace
      session={session}
      hasApiKey={hasApiKey}
      currentUserId={user?.id ?? ''}
      currentUserDisplayName={displayName}
      shortCode={session.short_code}
      initialBranches={branches}
      canvasViewMode={canvasViewMode}
      blueprint={blueprint}
    />
  )
}
