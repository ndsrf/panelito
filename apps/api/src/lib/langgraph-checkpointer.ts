/**
 * langgraph-checkpointer.ts — PostgresSaver singleton for LangGraph checkpointing (ORCH-05).
 *
 * Provides a lazily-initialized PostgresSaver bound to the `langgraph` schema in Supabase.
 * Uses SUPABASE_DIRECT_URL (port 5432 direct connection — pg statement caching
 * is fully supported; no extra pool options are needed or available in this version).
 *
 * `setup()` creates the following tables on first call (idempotent thereafter):
 *   langgraph.checkpoint_migrations
 *   langgraph.checkpoints
 *   langgraph.checkpoint_blobs
 *   langgraph.checkpoint_writes
 *
 * ORCH-05: thread_id = branch_id (UUID). The calling code is responsible for passing
 * the correct thread_id in config.configurable when invoking the graph.
 *
 * T-06-04: SUPABASE_DIRECT_URL is never logged; only the [langgraph-checkpointer] prefix
 * appears in log messages — never the connection string value.
 *
 * Usage:
 *   const checkpointer = await getCheckpointer()
 *   const graph = createGraph(checkpointer)
 */

import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { env } from './env'

/** Module-level singleton — null until first call to getCheckpointer(). */
let _checkpointer: PostgresSaver | null = null

/**
 * getCheckpointer — lazily initializes the PostgresSaver singleton.
 *
 * On the first call: creates the PostgresSaver via fromConnString() with the
 * `langgraph` schema (MANDATORY — default is 'public' which would create tables
 * in the wrong schema), then calls setup() to create the checkpoint tables.
 *
 * On subsequent calls: returns the cached instance immediately (setup() is skipped).
 *
 * @returns The initialized PostgresSaver bound to the langgraph schema.
 */
export async function getCheckpointer(): Promise<PostgresSaver> {
  if (!_checkpointer) {
    console.log('[langgraph-checkpointer] Initializing PostgresSaver (langgraph schema)')

    // fromConnString creates a new pg Pool internally using the connection string.
    // { schema: 'langgraph' } is MANDATORY: the default is 'public', which would
    // create tables in the wrong schema. The langgraph schema was pre-created by
    // migration 0008. See RESEARCH.md Pitfall 3.
    _checkpointer = PostgresSaver.fromConnString(env.SUPABASE_DIRECT_URL, {
      schema: 'langgraph',
    })

    // setup() creates checkpoint_migrations, checkpoints, checkpoint_blobs,
    // checkpoint_writes in the langgraph schema. Idempotent: checks the
    // checkpoint_migrations version table before applying each migration.
    // Do NOT pre-create these tables in SQL migrations (RESEARCH.md Pitfall 4).
    await _checkpointer.setup()

    console.log('[langgraph-checkpointer] PostgresSaver ready (langgraph schema)')
  }

  return _checkpointer
}
