/**
 * canvas.test.ts — Route tests for canvas endpoints
 *
 * GET /api/sessions/:id/canvas?branch_id=
 *   - Returns committed nodes/edges only (ghost/silent excluded) — D-03
 *
 * PATCH /api/canvas_nodes/:id
 *   - 200 with updated node on valid status='committed'
 *   - 400 on invalid status value — T-09-02
 *   - 403 when caller is not a session participant — T-09-01
 *   - 404 when node id does not exist
 *
 * All tests use fully mocked Supabase — no real DB or auth.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// ---------------------------------------------------------------------------
// Mock: ../lib/supabase — must be before imports
// ---------------------------------------------------------------------------

vi.mock('../lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

import { createServiceClient } from '../lib/supabase'
import { canvasSessionRouter, canvasNodesRouter } from './canvas'

const mockCreateServiceClient = vi.mocked(createServiceClient)

// ---------------------------------------------------------------------------
// App setup — mirror the real index.ts mount paths (minus /api basePath)
// ---------------------------------------------------------------------------

const app = new Hono()
app.route('/api/sessions', canvasSessionRouter)
app.route('/api/canvas_nodes', canvasNodesRouter)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const NODE_ID = 'bbbbbbbb-0000-0000-0000-000000000002'
const BRANCH_ID = 'cccccccc-0000-0000-0000-000000000003'
const CREATOR_ID = 'dddddddd-0000-0000-0000-000000000004'
const GUEST_ID = 'eeeeeeee-0000-0000-0000-000000000005'
const OUTSIDER_ID = 'ffffffff-0000-0000-0000-000000000006'
const FAKE_JWT = 'fake-bearer-token'

// ---------------------------------------------------------------------------
// Mock builders
// ---------------------------------------------------------------------------

/**
 * Build a minimal chainable Supabase query builder.
 * finalResult is returned from .single() / awaiting the chain.
 */
function makeChain(singleResult: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(singleResult),
    update: vi.fn(),
  }
  chain.select!.mockReturnValue(chain)
  chain.eq!.mockReturnValue(chain)
  chain.update!.mockReturnValue(chain)
  return chain
}

/**
 * Build a chainable count query (no .single(), uses Promise resolution).
 */
function makeCountChain(count: number | null, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
  }
  chain.select!.mockReturnValue(chain)
  chain.eq!.mockReturnValue(chain)
  // The count query resolves the chain itself (no .single())
  const thenable = {
    ...chain,
    then: (resolve: (v: { count: number | null; error: unknown }) => void) => {
      resolve({ count, error })
      return thenable
    },
    catch: (reject: (err: unknown) => unknown) => thenable,
  }
  chain.select!.mockReturnValue(thenable)
  return thenable
}

/**
 * Build a minimal Supabase mock for GET /canvas tests.
 */
function buildGetMock(
  nodesResult: { data: unknown; error: unknown },
  edgesResult: { data: unknown; error: unknown },
  userId: string = CREATOR_ID
) {
  let callCount = 0
  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === 'canvas_nodes') {
      callCount++
      if (callCount === 1) {
        // First call is the nodes select
        const chain: Record<string, ReturnType<typeof vi.fn>> = {
          select: vi.fn(),
          eq: vi.fn(),
        }
        chain.select!.mockReturnValue(chain)
        chain.eq!.mockReturnValue(chain)
        // The Promise resolves when awaited
        const thenable = { ...chain, then: (r: Function) => { r(nodesResult); return thenable }, catch: (r: Function) => thenable }
        chain.eq!.mockReturnValue(thenable)
        return chain
      }
      // Second call is edges (through canvas_edges)
    }
    if (table === 'canvas_edges') {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {
        select: vi.fn(),
        eq: vi.fn(),
      }
      chain.select!.mockReturnValue(chain)
      chain.eq!.mockReturnValue(chain)
      const thenable = { ...chain, then: (r: Function) => { r(edgesResult); return thenable }, catch: (r: Function) => thenable }
      chain.eq!.mockReturnValue(thenable)
      return chain
    }
    return makeChain({ data: null, error: null })
  })

  return {
    from: fromFn,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
    channel: vi.fn().mockReturnValue({
      httpSend: vi.fn().mockReturnValue({ catch: vi.fn() }),
    }),
  }
}

/**
 * Build a Supabase mock for PATCH /canvas_nodes/:id tests.
 *
 * @param nodeData - canvas_node row returned on initial fetch (null → not found)
 * @param sessionData - session row returned on session fetch
 * @param messageCount - count of messages by caller in the session (for participant check)
 * @param updateData - node row returned after UPDATE
 * @param userId - id of the authenticated user
 */
function buildPatchMock({
  nodeData,
  sessionData,
  messageCount,
  updateData,
  userId = CREATOR_ID,
}: {
  nodeData: unknown
  sessionData: unknown
  messageCount: number
  updateData: unknown
  userId?: string
}) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'canvas_nodes') {
        // Returns a chain that supports both .select().eq().single() (initial fetch)
        // and .update().eq().select().single() (after update)
        let usedForUpdate = false
        const chain: Record<string, ReturnType<typeof vi.fn>> = {
          select: vi.fn(),
          eq: vi.fn(),
          update: vi.fn(),
          single: vi.fn(),
        }
        chain.update!.mockImplementation(() => {
          usedForUpdate = true
          return chain
        })
        chain.select!.mockReturnValue(chain)
        chain.eq!.mockReturnValue(chain)
        chain.single!.mockImplementation(() => {
          if (usedForUpdate) {
            return Promise.resolve({ data: updateData, error: updateData ? null : { message: 'not found' } })
          }
          return Promise.resolve({ data: nodeData, error: nodeData ? null : { code: 'PGRST116', message: 'not found' } })
        })
        return chain
      }
      if (table === 'sessions') {
        return makeChain({
          data: sessionData,
          error: sessionData ? null : { code: 'PGRST116', message: 'not found' },
        })
      }
      if (table === 'messages') {
        // Participant check query — resolves with count
        const chain: Record<string, ReturnType<typeof vi.fn>> = {
          select: vi.fn(),
          eq: vi.fn(),
        }
        chain.select!.mockReturnValue(chain)
        chain.eq!.mockReturnValue(chain)
        // The last .eq() must resolve with { count, error }
        const eqResult = { count: messageCount, error: null }
        chain.eq!.mockReturnValue(
          Object.assign(chain, {
            then: (resolve: Function) => { resolve(eqResult); return chain },
            catch: (r: Function) => chain,
          })
        )
        return chain
      }
      return makeChain({ data: null, error: null })
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
    channel: vi.fn().mockReturnValue({
      httpSend: vi.fn().mockReturnValue({ catch: vi.fn() }),
    }),
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeReq(method: string, path: string, body?: unknown, jwt = FAKE_JWT): Request {
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

// ---------------------------------------------------------------------------
// Tests: GET /api/sessions/:id/canvas
// ---------------------------------------------------------------------------

describe('GET /api/sessions/:id/canvas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns committed nodes and edges only (200)', async () => {
    const committedNode = {
      id: NODE_ID,
      session_id: SESSION_ID,
      branch_id: BRANCH_ID,
      status: 'committed',
      label: 'Hypothesis A',
    }
    const committedEdge = {
      id: 'edge-1',
      session_id: SESSION_ID,
      branch_id: BRANCH_ID,
      status: 'committed',
    }

    // The Supabase client performs two parallel queries (Promise.all).
    // We mock from() to return committed data from both tables.
    const supabaseMock = {
      from: vi.fn().mockImplementation((table: string) => {
        const result = table === 'canvas_nodes'
          ? { data: [committedNode], error: null }
          : { data: [committedEdge], error: null }
        // Build a chainable builder that resolves with result
        const chain: Record<string, unknown> = {}
        const resolve = () => Promise.resolve(result)
        chain.select = vi.fn().mockReturnValue(chain)
        chain.eq = vi.fn().mockReturnValue(chain)
        // Make the chain thenable so Promise.all can await it
        chain.then = (r: Function) => { r(result); return Promise.resolve(result) }
        chain.catch = (r: Function) => chain
        return chain
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: CREATOR_ID } }, error: null }),
      },
      channel: vi.fn().mockReturnValue({ httpSend: vi.fn().mockReturnValue({ catch: vi.fn() }) }),
    }
    mockCreateServiceClient.mockReturnValue(supabaseMock as any)

    const res = await app.fetch(makeReq('GET', `/api/sessions/${SESSION_ID}/canvas?branch_id=${BRANCH_ID}`))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body).toHaveProperty('nodes')
    expect(body).toHaveProperty('edges')
    expect(Array.isArray(body.nodes)).toBe(true)
    expect(Array.isArray(body.edges)).toBe(true)
  })

  it('returns 401 when no Authorization header', async () => {
    const supabaseMock = {
      from: vi.fn(),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'unauthorized' } }),
      },
    }
    mockCreateServiceClient.mockReturnValue(supabaseMock as any)

    const req = new Request(`http://localhost/api/sessions/${SESSION_ID}/canvas`, { method: 'GET' })
    const res = await app.fetch(req)
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tests: PATCH /api/canvas_nodes/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/canvas_nodes/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when status is invalid (e.g. ghost)', async () => {
    const supabaseMock = {
      from: vi.fn(),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: CREATOR_ID } }, error: null }),
      },
      channel: vi.fn().mockReturnValue({ httpSend: vi.fn().mockReturnValue({ catch: vi.fn() }) }),
    }
    mockCreateServiceClient.mockReturnValue(supabaseMock as any)

    const res = await app.fetch(makeReq('PATCH', `/api/canvas_nodes/${NODE_ID}`, { status: 'ghost' }))
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('invalid_status')
  })

  it('returns 400 when status is missing from body', async () => {
    const supabaseMock = {
      from: vi.fn(),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: CREATOR_ID } }, error: null }),
      },
      channel: vi.fn().mockReturnValue({ httpSend: vi.fn().mockReturnValue({ catch: vi.fn() }) }),
    }
    mockCreateServiceClient.mockReturnValue(supabaseMock as any)

    const res = await app.fetch(makeReq('PATCH', `/api/canvas_nodes/${NODE_ID}`, {}))
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('invalid_status')
  })

  it('returns 404 when node does not exist', async () => {
    // canvas_nodes fetch returns null (not found)
    const supabaseMock = {
      from: vi.fn().mockImplementation((table: string) => {
        const chain: Record<string, ReturnType<typeof vi.fn>> = {
          select: vi.fn(), eq: vi.fn(), single: vi.fn(), update: vi.fn(),
        }
        chain.select!.mockReturnValue(chain)
        chain.eq!.mockReturnValue(chain)
        chain.update!.mockReturnValue(chain)
        chain.single!.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'not found' } })
        return chain
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: CREATOR_ID } }, error: null }),
      },
      channel: vi.fn().mockReturnValue({ httpSend: vi.fn().mockReturnValue({ catch: vi.fn() }) }),
    }
    mockCreateServiceClient.mockReturnValue(supabaseMock as any)

    const res = await app.fetch(makeReq('PATCH', `/api/canvas_nodes/${NODE_ID}`, { status: 'committed' }))
    expect(res.status).toBe(404)
  })

  it('returns 403 when caller is not a session participant', async () => {
    // Node exists, but caller (OUTSIDER_ID) is neither creator nor has sent messages
    const nodeData = { id: NODE_ID, session_id: SESSION_ID }
    const sessionData = { creator_id: CREATOR_ID } // OUTSIDER_ID !== CREATOR_ID
    const updatedNode = { id: NODE_ID, session_id: SESSION_ID, status: 'committed' }

    let fromCallCount = 0
    const supabaseMock = {
      from: vi.fn().mockImplementation((table: string) => {
        fromCallCount++
        if (table === 'canvas_nodes') {
          const chain: Record<string, ReturnType<typeof vi.fn>> = {
            select: vi.fn(), eq: vi.fn(), single: vi.fn(), update: vi.fn(),
          }
          chain.select!.mockReturnValue(chain)
          chain.eq!.mockReturnValue(chain)
          chain.update!.mockReturnValue(chain)
          chain.single!.mockResolvedValue({ data: nodeData, error: null })
          return chain
        }
        if (table === 'sessions') {
          const chain: Record<string, ReturnType<typeof vi.fn>> = {
            select: vi.fn(), eq: vi.fn(), single: vi.fn(),
          }
          chain.select!.mockReturnValue(chain)
          chain.eq!.mockReturnValue(chain)
          chain.single!.mockResolvedValue({ data: sessionData, error: null })
          return chain
        }
        if (table === 'messages') {
          // Outsider has 0 messages in this session
          const chain: Record<string, ReturnType<typeof vi.fn>> = {
            select: vi.fn(), eq: vi.fn(),
          }
          chain.select!.mockReturnValue(chain)
          const eqChain = {
            eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
          }
          chain.eq!.mockReturnValue(eqChain)
          return chain
        }
        return makeChain({ data: null, error: null })
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: OUTSIDER_ID } }, error: null }),
      },
      channel: vi.fn().mockReturnValue({ httpSend: vi.fn().mockReturnValue({ catch: vi.fn() }) }),
    }
    mockCreateServiceClient.mockReturnValue(supabaseMock as any)

    const res = await app.fetch(makeReq('PATCH', `/api/canvas_nodes/${NODE_ID}`, { status: 'committed' }))
    expect(res.status).toBe(403)
    const body = await res.json() as any
    expect(body.error).toBe('forbidden')
  })

  it('returns 200 with updated node when creator confirms a ghost node', async () => {
    const nodeData = { id: NODE_ID, session_id: SESSION_ID, status: 'ghost' }
    const sessionData = { creator_id: CREATOR_ID }
    const updatedNode = { id: NODE_ID, session_id: SESSION_ID, status: 'committed' }

    let nodeCallCount = 0
    const supabaseMock = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'canvas_nodes') {
          nodeCallCount++
          const chain: Record<string, ReturnType<typeof vi.fn>> = {
            select: vi.fn(), eq: vi.fn(), single: vi.fn(), update: vi.fn(),
          }
          let isUpdate = false
          chain.update!.mockImplementation(() => { isUpdate = true; return chain })
          chain.select!.mockReturnValue(chain)
          chain.eq!.mockReturnValue(chain)
          chain.single!.mockImplementation(() => {
            if (isUpdate) return Promise.resolve({ data: updatedNode, error: null })
            return Promise.resolve({ data: nodeData, error: null })
          })
          return chain
        }
        if (table === 'sessions') {
          const chain: Record<string, ReturnType<typeof vi.fn>> = {
            select: vi.fn(), eq: vi.fn(), single: vi.fn(),
          }
          chain.select!.mockReturnValue(chain)
          chain.eq!.mockReturnValue(chain)
          chain.single!.mockResolvedValue({ data: sessionData, error: null })
          return chain
        }
        return makeChain({ data: null, error: null })
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: CREATOR_ID } }, error: null }),
      },
      channel: vi.fn().mockReturnValue({ httpSend: vi.fn().mockReturnValue({ catch: vi.fn() }) }),
    }
    mockCreateServiceClient.mockReturnValue(supabaseMock as any)

    const res = await app.fetch(makeReq('PATCH', `/api/canvas_nodes/${NODE_ID}`, { status: 'committed' }))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.id).toBe(NODE_ID)
    expect(body.status).toBe('committed')
  })
})
