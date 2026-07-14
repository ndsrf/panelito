/**
 * silence-scan.ts — TDD RED stub. Real implementation lands in the GREEN commit.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createGraph } from '../graph/graph'

type CompiledGraph = ReturnType<typeof createGraph>

export const COACH_AUTHOR_ID = '00000000-0000-0000-0000-000000000b01'

export async function startSilenceScanLoop(_supabase: SupabaseClient, _graph?: CompiledGraph): Promise<void> {
  throw new Error('not implemented')
}

export async function runSilenceScan(_supabase: SupabaseClient, _graph: CompiledGraph): Promise<void> {
  throw new Error('not implemented')
}
