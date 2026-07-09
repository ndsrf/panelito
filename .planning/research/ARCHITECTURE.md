# Architecture: Proactive Bot Engine on LangGraph JS + Supabase

**Milestone:** v3.0 — The Bots Must Help the Conversation Flow
**Researched:** 2026-07-09
**Confidence:** HIGH (based on live codebase read + LangGraph JS 1.4.7 docs verified via Context7)

> This document supersedes the v2.0 ARCHITECTURE.md and focuses exclusively on v3.0's
> architectural additions. All v2.0 components described in the previous version are live
> and operational — the question here is what to add and where.

---

## Executive Summary

The key architectural insight for v3.0: **proactive bots are not a new invocation path; they
are a new trigger path that feeds the same invoke route**. The LangGraph graph, SSE streaming,
mic lock, and Supabase persistence all remain exactly as they are. What changes is:

1. A **Trigger Engine** (server-side timer + event classifier) decides _when_ a bot should
   speak without a human message.
2. A **Proactive Invoke function** (internal, no HTTP request) feeds an artificial input into
   the existing `graph.stream()` call with a synthetic trigger context.
3. A **Personality Dispatcher** (an evolution of the existing `activePersonas` config key)
   maps trigger type → persona → specialized prompt.
4. The **in-memory conversation graph** (argument structure) lives _inside_ the LangGraph
   thread state as a new field — not as a separate service — keeping it durable and
   branch-isolated automatically.
5. **Model routing** is already partially implemented in `model-config.ts`; v3.0 adds
   `'facilitation'` and `'graph_reasoning'` task types and routes them to the right tier.

---

## What Does NOT Change

These components are stable and require no modification:

| Component | Location | Why Stable |
|-----------|----------|------------|
| `graph.ts` `createGraph()` | `apps/api/src/graph/` | Graph topology sufficient; new nodes add via new edges |
| `state.ts` `GraphStateAnnotation` | `apps/api/src/graph/` | New fields are additive Annotation additions |
| `nodes/orchestrator.ts` | `apps/api/src/graph/nodes/` | Domain guardrail unchanged; trigger context bypasses it |
| `nodes/mutation-gate.ts` | `apps/api/src/graph/nodes/` | Confidence thresholds unchanged |
| `routes/ai.ts` (`/invoke` route) | `apps/api/src/routes/` | Mic lock, SSE, cap guard, canvas writes all reused |
| All Supabase CRUD routes | `apps/api/src/routes/` | No changes needed |
| `adapter-factory.ts` | `apps/api/src/lib/` | Multi-provider adapter seam already clean |
| `model-config.ts` | `apps/api/src/lib/` | Extended (new task types), not replaced |
| PostgresSaver checkpointer | `apps/api/src/lib/` | Thread-per-branch model works for proactive invocations too |
| `@panelito/types` canvas/blueprint types | `packages/types/` | Additive extensions only |
| Frontend (Next.js, xyflow, Zustand) | `apps/web/` | Canvas rendering already handles all node/edge status values |

---

## New Components

### 1. Trigger Engine (`apps/api/src/services/trigger-engine.ts`)

**Responsibility:** Detect trigger conditions across active sessions and emit trigger events
to the appropriate session's proactive invocation function.

**What it watches:**
- **Silence window**: tracks `last_message_at` per branch (already queryable from the
  `messages` table ordered by `created_at`). After N seconds of silence (N configured per
  Blueprint), fires a `silence` trigger.
- **Phase readiness**: evaluates the `phase_signal` field in the LangGraph thread state
  checkpoint. When `phase_signal === true` persists across messages without human confirmation,
  the Coach bot is triggered.
- **Semantic drift**: a lightweight classification call (reuses OrchestratorNode logic)
  on the last N messages; if majority is `DOMAIN_DRIFT`, fires a `drift` trigger.
- **Unlinked assertion**: reads the conversation graph (new `argGraph` state field) to detect
  nodes with no edges after a new message is processed.
- **Fact-check signal**: a claim-type classifier on the last message; fires if the message
  contains an empirically verifiable claim.
- **Moderation**: a safety classifier on the last message; fires if the message scores above
  a configured threshold.

**How it runs:** The Trigger Engine is a Node.js `setInterval`-based loop started at API
server startup (`apps/api/src/server.ts`). It runs every 5 seconds across all active sessions.
This is the simplest approach that works within the existing Hono/Node.js API — no separate
process, no pg_cron, no external scheduler. Vercel serverless does not support background
timers; this engine runs on the standalone Node.js server deployment (`server.ts`), not on
the Vercel/Next.js bridge.

**Why not pg_cron:** pg_cron fires SQL functions, not Hono route handlers. It cannot open
SSE streams or call the graph. Suitable for auto-freeze (which just runs SQL UPDATE), but
not for complex bot invocations.

**Why not a separate Vercel Edge Function:** The proactive invoke needs access to the
PostgresSaver checkpointer (direct Postgres connection), the LangGraph graph instance, and
the Supabase service client. All of these are already initialized in the API process.
Keeping the trigger engine in the same process avoids cross-service auth, cold starts, and
timeouts on a background trigger.

**Interface:**
```typescript
type TriggerType =
  | 'silence'
  | 'phase_readiness'
  | 'semantic_drift'
  | 'unlinked_assertion'
  | 'fact_check'
  | 'moderation'

interface TriggerEvent {
  sessionId: string
  branchId: string
  triggerType: TriggerType
  triggerContext: Record<string, unknown>  // type-specific metadata
}

function startTriggerEngine(): void
function stopTriggerEngine(): void
```

---

### 2. Proactive Invoke Function (`apps/api/src/services/proactive-invoker.ts`)

**Responsibility:** When the Trigger Engine fires an event, construct a synthetic bot turn
and run it through the LangGraph graph, then broadcast the result exactly as the `/invoke`
route does.

**Key insight:** This function replicates the inner SSE handler body from `routes/ai.ts`
but runs without an HTTP request. It calls `graph.stream()` with the same config shape,
reads from the same PostgresSaver checkpoint for the target `thread_id`, and writes to
Supabase + broadcasts via Realtime exactly as the human-invoked path does.

**What it does differently from `/invoke`:**
- No HTTP request/response cycle, no SSE stream (output goes directly to Supabase + Realtime)
- Mic lock: must acquire `try_acquire_mic` with `p_holder_id = 'system_trigger'` to prevent
  collision with human turns
- Message construction: instead of `userMessage` from HTTP body, the trigger context becomes
  a synthetic system input injected as a special message type (role: `'tool'` or a sentinel
  user message with a `[TRIGGER:silence]` prefix stripped before display)
- Cap guard: proactive triggers are not counted against the creator's AI cap (or counted at
  a reduced rate — configurable)
- Persona selection: determined by `PersonalityDispatcher` (see below), not by
  `session.active_personas`

**Retry and back-pressure:** The Trigger Engine checks if a mic lock is already held before
firing. If the mic is locked (human or previous bot is speaking), the trigger is deferred
and retried on the next 5-second scan. A trigger that cannot fire for more than 60 seconds
is dropped to prevent staleness.

```typescript
async function proactiveInvoke(
  event: TriggerEvent,
  graph: ReturnType<typeof createGraph>,
  checkpointer: PostgresSaver,
  supabase: SupabaseClient,
): Promise<void>
```

---

### 3. Personality Dispatcher (`apps/api/src/services/personality-dispatcher.ts`)

**Responsibility:** Given a TriggerType, return the persona id and specialized system prompt
instructions for the bot that should respond.

**Trigger → Persona mapping:**
| Trigger | Assigned Persona | Rationale |
|---------|-----------------|-----------|
| `silence` | Coach | Silence-breaking requires a Socratic, empathetic nudge — not a challenge |
| `phase_readiness` | Coach | Advancing phases is a facilitation move |
| `semantic_drift` | Coach | Gentle redirection, not an adversarial challenge |
| `unlinked_assertion` | Analyst | Identifying graph gaps is a structural/analytical task |
| `fact_check` | Analyst | Fact verification is neutral and data-driven by design |
| `moderation` | Coach | Moderation should be empathetic and de-escalating |

**Devil's Advocate persona** is NOT assigned to any proactive trigger. It responds only
when a human explicitly invokes it via a Power Reaction or when the Blueprint configures
it as a phase-specific participant. Unsolicited adversarial challenges destroy group
dynamics.

**Output per persona:**

The dispatcher returns `PersonaDispatch`:
```typescript
interface PersonaDispatch {
  personaId: string
  displayName: string
  systemPromptAddition: string  // appended to AgentNode's base system prompt
  taskType: 'facilitation' | 'graph_reasoning' | 'fact_check'
}
```

The `taskType` field drives model selection (see Model Routing section).

---

### 4. Argument Graph in LangGraph State (`apps/api/src/graph/state.ts` — extended)

**Responsibility:** Maintain a bots-internal model of the argument structure — typed,
directional edges between positions — for use in facilitation and unlinked-assertion detection.

**Critical design decision: argGraph lives in LangGraph thread state, not a separate service.**

Reasons:
- Branch isolation is free: thread_id = branch_id; each branch has its own argGraph
- Durability is free: PostgresSaver checkpoints it alongside messages and canvasOps
- Consistency: argGraph and canvas graph are always updated in the same graph execution;
  no possibility of the two falling out of sync across separate services
- Simplicity: no additional infrastructure, no new tables, no cross-service auth

**What is the argGraph and how does it differ from the canvas graph:**

| | Canvas Graph (xyflow/canvas_nodes+canvas_edges) | Argument Graph (argGraph in state) |
|---|---|---|
| Purpose | Visual display to users | Internal bot reasoning context |
| Who reads it | Frontend (xyflow), all session participants | LangGraph nodes only |
| Who writes it | MutationGateNode → route → Supabase | New ArgGraphNode in LangGraph |
| Persistence | Supabase tables (canvas_nodes, canvas_edges) | LangGraph checkpoint (Postgres) |
| Granularity | Committed + ghost nodes visible to users | All nodes including silent-tier ones |
| Schema | Blueprint-typed (node_type_id, edge_type_id from Blueprint vocabulary) | Argument-typed (SUPPORTS, CONTRADICTS, QUESTIONS, BUILDS_ON, CONCEDES) |
| Branch isolation | branch_id FK on every row | Automatic via thread_id |
| Temporal granularity | Created per-message per-node | Updated per-message (incremental) |

The argument graph is intentionally simpler and faster to update than the canvas graph: it
does not need to go through MutationGate confidence thresholds, and it does not produce
visual output.

**State field addition:**
```typescript
// In GraphStateAnnotation (state.ts)
argGraph: Annotation<ArgumentGraph>({
  reducer: (prev: ArgumentGraph, update: ArgumentGraphUpdate) => applyArgGraphUpdate(prev, update),
  default: () => ({ nodes: [], edges: [] }),
}),
```

Where:
```typescript
interface ArgGraphNode {
  id: string               // uuid
  label: string            // human assertion text (truncated to 80 chars)
  speakerId: string        // participant display_name or bot personaId
  messageTimestamp: string // ISO timestamp of source message
}

interface ArgGraphEdge {
  id: string
  sourceId: string
  targetId: string
  relation: 'SUPPORTS' | 'CONTRADICTS' | 'BUILDS_ON' | 'QUESTIONS' | 'CONCEDES'
}

interface ArgumentGraph {
  nodes: ArgGraphNode[]
  edges: ArgGraphEdge[]
}

type ArgumentGraphUpdate = {
  addNodes?: ArgGraphNode[]
  addEdges?: ArgGraphEdge[]
}
```

**ArgGraphBuilderNode** (new LangGraph node, `apps/api/src/graph/nodes/arg-graph-builder.ts`):
Runs after AgentNode on every message (including proactive bot turns). Makes a small,
fast LLM call with `graph_reasoning` model to identify:
1. The primary claim in the last message (→ new ArgGraphNode)
2. Relationships to existing ArgGraphNodes (→ new ArgGraphEdges)

It uses the Haiku-tier model (fast, cheap) and returns an `ArgumentGraphUpdate`. The
`applyArgGraphUpdate` reducer merges the update into the accumulated `argGraph` in state.

---

### 5. Per-Session User Profiles in LangGraph State (`apps/api/src/graph/state.ts` — extended)

**Responsibility:** Maintain an in-memory per-participant model for personalized bot facilitation.

**Same rationale as argGraph:** thread state = correct home for per-session in-memory data.
No new Supabase tables needed; checkpointed automatically.

```typescript
// In GraphStateAnnotation (state.ts)
participantProfiles: Annotation<ParticipantProfileMap>({
  reducer: (prev: ParticipantProfileMap, update: ParticipantProfileMapUpdate) =>
    mergeParticipantProfiles(prev, update),
  default: () => ({}),
}),
```

Where:
```typescript
interface ParticipantProfile {
  displayName: string
  statedPositions: string[]    // key assertions the participant has made
  engagementPattern: 'active' | 'quiet' | 'dominant'
  lastSeenTimestamp: string
}

type ParticipantProfileMap = Record<string, ParticipantProfile>  // key: displayName
type ParticipantProfileMapUpdate = Partial<ParticipantProfileMap>
```

The ArgGraphBuilderNode also handles profile updates (same LLM call, since it already reads
the last message). The Coach bot reads `participantProfiles` from state when constructing
its facilitation prompt: "You said earlier X — does this contradict what you just said?"

---

## Updated LangGraph Graph Topology

The v3.0 graph topology adds ArgGraphBuilderNode and branches on trigger type:

```
START
  │
  ▼
orchestratorNode
  │
  ├─ DOMAIN_DRIFT + driftAction='replied' → driftReplyNode → END
  ├─ DOMAIN_DRIFT + driftAction='ignored' → END
  │
  └─ DOMAIN_MATCH | DOMAIN_BRIDGE ──────────────────────────────┐
                                                                 │
                                                                 ▼
                                                          agentNode
                                                                 │
                                                                 ▼
                                                        mutationGateNode
                                                                 │
                                                                 ▼
                                                     argGraphBuilderNode  (NEW)
                                                                 │
                                                                 ▼
                                                               END

PROACTIVE PATH (bypasses orchestratorNode):

proactiveTriggerNode (NEW)
  │
  ├─ triggerType='silence' | 'phase_readiness' | 'semantic_drift'
  │     → personalityDispatch(Coach) → facilitationAgentNode → END
  │
  └─ triggerType='unlinked_assertion' | 'fact_check'
        → personalityDispatch(Analyst) → analyticsAgentNode → END
```

**How the proactive path bypasses OrchestratorNode:** Proactive bot turns set a new state
field `triggerType` on initial state. A conditional edge from START routes to either
`orchestratorNode` (when `triggerType === null`, i.e. normal human message) or to
`proactiveTriggerNode` (when `triggerType !== null`). This keeps the graph topology clean
and avoids polluting orchestratorNode with trigger-path logic.

New graph topology additions:
```typescript
// graph.ts additions
.addNode('proactiveTrigger', proactiveTriggerNode)
.addNode('facilitationAgent', facilitationAgentNode)
.addNode('analyticsAgent', analyticsAgentNode)
.addNode('argGraphBuilder', argGraphBuilderNode)

// Change START edge to conditional:
.addConditionalEdges(START, routeFromStart, {
  normal: 'orchestrator',
  proactive: 'proactiveTrigger',
})

// Proactive paths
.addConditionalEdges('proactiveTrigger', routeProactiveTrigger, {
  facilitation: 'facilitationAgent',
  analytics: 'analyticsAgent',
})
.addEdge('facilitationAgent', 'argGraphBuilder')
.addEdge('analyticsAgent', 'mutationGate')  // analytics bots CAN mutate canvas
.addEdge('mutationGate', 'argGraphBuilder')

// Normal path: agent → mutationGate → argGraphBuilder
.addEdge('agent', 'mutationGate')
.addEdge('mutationGate', 'argGraphBuilder')
.addEdge('argGraphBuilder', END)
.addEdge('driftReply', END)
```

---

## Data Flow: Silence Window → Bot Message

This is the end-to-end flow for the most representative trigger type.

```
1. TRIGGER DETECTION (server startup loop, every 5s)
   TriggerEngine.scan():
     SELECT session_id, branch_id, MAX(created_at) AS last_msg
     FROM messages
     WHERE session_id IN (active_sessions)
     GROUP BY session_id, branch_id

     if NOW() - last_msg > blueprint.silence_threshold_seconds:
       emit TriggerEvent { type: 'silence', sessionId, branchId }

2. MIC CHECK (Trigger Engine before emitting)
   supabase.rpc('try_acquire_mic', { p_branch_id, p_holder_id: 'system_trigger', p_expiry_seconds: 30 })
   if NOT acquired → defer trigger (will retry in 5s)

3. PERSONA DISPATCH (PersonalityDispatcher)
   personalityDispatch('silence') → { personaId: 'coach', taskType: 'facilitation', systemPromptAddition: '...' }

4. GRAPH INVOCATION (ProactiveInvoker)
   graph.stream(
     {
       blueprintId: session.blueprint_id,
       currentPhaseId: session.current_phase,
       messages: [...existingMessages],    // from PostgresSaver checkpoint
       triggerType: 'silence',             // NEW: routes START → proactiveTrigger
       argGraph: existingArgGraph,         // from checkpoint
       participantProfiles: existingProfiles,
       canvasOps: [],
     },
     {
       configurable: {
         thread_id: branchId,
         blueprint,
         providerName,
         plaintextKey,
         personaDispatch: { personaId: 'coach', taskType: 'facilitation', systemPromptAddition: '...' },
       }
     }
   )

5. PROACTIVE TRIGGER NODE EXECUTES
   proactiveTriggerNode reads triggerType + argGraph + participantProfiles from state
   Returns { routeKey: 'facilitation', proactiveContext: { silenceWindowMs: 45000 } }

6. FACILITATION AGENT EXECUTES
   facilitationAgentNode calls adapter.stream() with:
     - model: TASK_MODELS[provider].facilitation  (Haiku — no canvas mutations needed)
     - system: buildFacilitationPrompt(blueprint, triggerType, argGraph, participantProfiles)
   Streams text tokens → direct to Supabase message insert (no SSE stream to invoking client
   since there IS no invoking client for a proactive turn)

7. ARG GRAPH BUILDER EXECUTES
   argGraphBuilderNode calls adapter.stream() with:
     - model: TASK_MODELS[provider].facilitation  (Haiku)
     - input: the bot's just-emitted message
   Returns ArgumentGraphUpdate → merged into argGraph in state

8. RESULT BROADCAST
   ProactiveInvoker:
   - INSERT new AI message row into messages table (role: 'assistant', author_id: system bot uuid)
   - supabase.channel(`session:${sessionId}`).httpSend('new_message', row)   [Realtime to all]
   - supabase.rpc('release_mic', { p_branch_id: branchId })
   - if canvasOps.length > 0: upsert canvas_nodes/canvas_edges, broadcast canvas_update

9. FRONTEND RECEIVES
   All participants' useSessionChannel receives 'new_message' broadcast
   Chat displays bot message with Coach display name and avatar
   No SSE stream needed — Realtime handles all participants equally
```

---

## Model Routing Pattern

The existing `model-config.ts` uses four task types. v3.0 adds two more:

```typescript
// model-config.ts v3.0 extension
export type TaskType =
  | 'analysis'          // existing: AgentNode full canvas mutation call
  | 'compression'       // existing: history summarization
  | 'categorization'    // existing: branch labeler
  | 'classification'    // existing: OrchestratorNode domain guardrail
  | 'facilitation'      // NEW: Coach/facilitation bots (text only, no tool use)
  | 'graph_reasoning'   // NEW: ArgGraphBuilderNode (structured arg identification)

export const TASK_MODELS: Record<ProviderName, Record<TaskType, string>> = {
  anthropic: {
    analysis:        'claude-sonnet-4-6',              // existing
    compression:     'claude-haiku-4-5-20251001',      // existing
    categorization:  'claude-haiku-4-5-20251001',      // existing
    classification:  'claude-haiku-4-5-20251001',      // existing
    facilitation:    'claude-haiku-4-5-20251001',      // NEW: Coach text-only turns
    graph_reasoning: 'claude-haiku-4-5-20251001',      // NEW: ArgGraph structure extraction
  },
  // ... other providers mapped accordingly
}
```

**Routing decisions:**
- **Silence/drift facilitation**: Haiku. The Coach bot generates conversational text, not
  structured tool calls. Haiku is fast enough for real-time chat and far cheaper.
- **Unlinked assertion / fact-check (Analyst)**: Sonnet (`analysis` task type). The Analyst
  bot must reason about graph structure AND produce canvas mutations — same as the normal
  agent call.
- **ArgGraphBuilder**: Haiku. It produces a small structured JSON update; Haiku handles this
  well with a tightly scoped prompt.
- **Claim-type classifier (fact-check detector)**: Haiku / `classification`. Single label output,
  32 tokens max.
- **Moderation classifier**: Haiku / `classification`. Binary safe/unsafe output.

---

## Integration Points: What Changes in Existing Code

### `apps/api/src/graph/state.ts` — MODIFIED

Add three new fields to `GraphStateAnnotation`:

```typescript
// New fields (additive)
triggerType: Annotation<TriggerType | null>({
  reducer: (_, v) => v,
  default: () => null,
}),
argGraph: Annotation<ArgumentGraph>({
  reducer: (prev, update) => applyArgGraphUpdate(prev, update),
  default: () => ({ nodes: [], edges: [] }),
}),
participantProfiles: Annotation<ParticipantProfileMap>({
  reducer: (prev, update) => mergeParticipantProfiles(prev, update),
  default: () => ({}),
}),
```

These are backward-compatible: existing graph invocations don't set `triggerType` (defaults
to null), which routes to the normal orchestrator path. Existing checkpoints without these
fields deserialize with the default values.

### `apps/api/src/graph/graph.ts` — MODIFIED

- Change `START` edge to a `addConditionalEdges(START, routeFromStart, ...)` that checks
  `state.triggerType !== null`
- Add four new nodes: `proactiveTrigger`, `facilitationAgent`, `analyticsAgent`,
  `argGraphBuilder`
- Add new edges as described in the topology section
- Import new node functions

**Risk level: MEDIUM.** The conditional edge from START is a structural change that could
break routing if the `routeFromStart` function has a bug. Mitigate by testing both paths
(triggerType null → orchestrator, triggerType set → proactiveTrigger) before adding any
other new nodes.

### `apps/api/src/lib/model-config.ts` — MODIFIED

Add `facilitation` and `graph_reasoning` task types. Additive, zero risk of regression.

### `apps/api/src/server.ts` — MODIFIED

Add `startTriggerEngine()` call at startup (standalone Node.js only, not Vercel bridge).

```typescript
// server.ts
import { startTriggerEngine } from './services/trigger-engine'
startTriggerEngine()
```

This is the standalone server entry point. The Vercel bridge (`app/api/[[...route]]/route.ts`)
does not call this — proactive triggers do not run on the Vercel deployment in v3.0. This is
an acceptable constraint; the standalone deployment (local dev, Docker, or a persistent
Node.js host) is the v3.0 execution environment for proactive features.

### `apps/api/src/routes/ai.ts` — UNCHANGED (preferred)

The `/invoke` route is kept strictly human-invoked. The `ProactiveInvoker` function calls
the graph directly (internal function call), not via HTTP. This avoids the need to
authenticate a self-request, handle SSE in a background context, or touch the highest-risk
file in the codebase.

**The mic lock is the coordination point**, not the HTTP route.

---

## Highest-Risk Changes (Flagged for Phase-Level Attention)

### Risk 1: Conditional edge from START — CRITICAL SEAM
**File:** `apps/api/src/graph/graph.ts`
**Risk:** The `routeFromStart` function must not regress the `null`-triggerType path. Any
bug here breaks ALL invocations, human and proactive.
**Mitigation:** Write unit tests for `routeFromStart` before adding it. Keep the function
tiny (single `if` on `state.triggerType`). Merge this change alone, with no other graph
changes in the same phase.

### Risk 2: argGraph state field size growth
**File:** `apps/api/src/graph/state.ts` (argGraph reducer)
**Risk:** The argGraph accumulates indefinitely as the conversation grows. With long sessions,
the checkpoint payload may become very large, slowing PostgresSaver serialization.
**Mitigation:** Cap `argGraph.nodes` at the last 50 nodes and edges at the last 100. The
reducer should prune by age (oldest nodes dropped first). A long conversation has enough
recent context; older argument nodes are rarely referenced by bots.

### Risk 3: Trigger Engine scan query on messages table
**File:** `apps/api/src/services/trigger-engine.ts`
**Risk:** Scanning all active sessions every 5 seconds is a table scan. At scale this could
be slow.
**Mitigation:** Index `messages(session_id, branch_id, created_at DESC)` — likely already
covered by the `session_id` index. Add a `SELECT MAX(created_at) GROUP BY (session_id, branch_id)`
query with a WHERE on `sessions.status = 'active'`. This is a cheap aggregation query in
Postgres; not a concern until thousands of concurrent sessions.

### Risk 4: Proactive mic lock collision with human invoke
**Files:** `apps/api/src/services/proactive-invoker.ts`, `apps/api/src/routes/ai.ts`
**Risk:** A human sends a message exactly as the trigger engine fires. Both attempt to
acquire the mic simultaneously.
**Mitigation:** The existing `try_acquire_mic` RPC is already atomic (Postgres UPDATE with
WHERE). The Trigger Engine defers if `acquired = false`. The human path gets priority
(first-come-first-served at DB level). This is correct behavior — the bot's silence
intervention should yield to a human who just broke the silence.

### Risk 5: Proactive turns counted against cap
**File:** `apps/api/src/lib/cap-guard.ts`
**Risk:** Proactive bots could rapidly exhaust the creator's AI cap, especially with frequent
silence triggers on an idle session.
**Mitigation:** ProactiveInvoker skips `incrementCount()` for facilitation-tier calls (Haiku,
text only). Only Analyst-tier calls with canvas mutations count against the cap. Long-term:
add a separate `proactive_ai_count` column if finer billing control is needed.

---

## Suggested Build Order

Each phase must be independently testable. Dependencies are strict left-to-right.

### Phase A: State Extension (prerequisite for everything)

1. Add `triggerType`, `argGraph`, `participantProfiles` fields to `GraphStateAnnotation`
2. Implement `applyArgGraphUpdate()` and `mergeParticipantProfiles()` reducer helpers
3. Add `facilitation` and `graph_reasoning` to `model-config.ts`
4. Unit-test the new reducers in isolation

**Tests possible:** Pure function unit tests for reducers. No LangGraph invocation needed.
**Risk:** LOW — additive state fields with defaults.

### Phase B: Personality Dispatcher + Prompt System

1. Implement `PersonalityDispatcher` with trigger → persona mapping
2. Write personality-specific system prompts for Coach and Analyst
3. Write `buildFacilitationPrompt(blueprint, triggerType, argGraph, participantProfiles)`
4. Write `buildAnalysisPromptWithArgContext(blueprint, argGraph, participantProfiles)`
5. Unit-test prompts with snapshot tests

**Tests possible:** Prompt shape tests, PersonalityDispatcher mapping tests.
**Risk:** LOW — pure functions.

### Phase C: ArgGraphBuilderNode + FacilitationAgentNode + AnalyticsAgentNode

1. Implement `argGraphBuilderNode` (calls Haiku, returns `ArgumentGraphUpdate`)
2. Implement `facilitationAgentNode` (Coach persona, text-only, no tool use)
3. Implement `analyticsAgentNode` (Analyst persona, uses `canvasMutationTool`, same as
   existing `agentNode` but with different system prompt)
4. Unit-test with mock adapters

**Tests possible:** Node unit tests with mock adapters (same pattern as existing
`agent.ts` tests).
**Risk:** LOW — new nodes follow exact same seam pattern as existing nodes.

### Phase D: ProactiveTriggerNode + Graph Topology Change

1. Implement `proactiveTriggerNode` (reads `triggerType`, returns route key)
2. Add conditional edge from START (`routeFromStart`)
3. Wire new nodes into `graph.ts` with new edges
4. Update `createGraph()` to include new nodes
5. Integration-test: normal path (triggerType=null) unaffected; proactive path routes correctly

**Tests possible:** Graph integration tests with MemorySaver, testing both paths.
**Risk:** HIGH — the conditional edge from START touches the core routing logic. Must be
isolated in its own phase with thorough integration tests before ProactiveInvoker is built.

### Phase E: ProactiveInvoker (core proactive execution)

1. Implement `proactiveInvoke()` function (no HTTP, direct graph call)
2. Mic lock acquisition with `p_holder_id = 'system_trigger'`
3. Message insert + Realtime broadcast (reuse logic from route but as direct calls)
4. Canvas writes for Analyst-tier proactive calls
5. Integration-test: fire a proactive invocation on a real thread, verify message appears
   in DB and broadcasts via Realtime

**Tests possible:** Integration tests against real Supabase (or a local Supabase container).
**Risk:** MEDIUM — touches Supabase write paths and Realtime, but all patterns are copied
from the existing `/invoke` route.

### Phase F: Trigger Engine (the timer loop)

1. Implement `TriggerEngine` with `setInterval`-based scan loop
2. Implement silence-window detection first (simplest trigger, most visible)
3. Wire into `server.ts` startup
4. Manual smoke test: idle in a session for N seconds, watch Coach bot speak
5. Implement remaining triggers one at a time: phase readiness, drift, unlinked assertion,
   fact-check, moderation

**Tests possible:** Unit tests for each trigger condition function (evaluate trigger conditions
against mock data); integration test for the full scan loop is difficult to unit-test
(time-dependent) — rely on manual smoke testing.
**Risk:** MEDIUM — the timer loop itself is simple Node.js; the classification calls for
drift/fact-check/moderation add LLM cost per scan cycle. Must implement debouncing to prevent
repeated firing on the same trigger condition.

### Phase G: Per-Session User Profiles (personality personalization)

1. Implement `participantProfileUpdater` in ArgGraphBuilderNode (piggyback on existing Haiku call)
2. Inject `participantProfiles` into facilitation prompt construction
3. Test that Coach bot references earlier participant statements

**Tests possible:** Integration tests checking profile accumulation across multiple invocations.
**Risk:** LOW — additive feature, Coach bot can function without profiles (they default to `{}`).

### Phase H: Natural Bot Speech + No Artifact Policy

1. Audit all bot prompts for `[canvas updated]` and system artifact patterns
2. The existing `accumulatedText` fallback in `ai.ts` (`'[canvas updated]'`) must be replaced
   for bot-generated messages — use the bot's actual text or omit the message insert
3. Add prompt rule: "Never start your message with brackets, never mention canvas operations"
4. Add a post-processing filter on bot text output before message insert

**Risk:** LOW — prompt engineering + light post-processing.

---

## Deployment Constraint: Standalone Server Required for Proactive Features

The Trigger Engine cannot run on Vercel serverless because serverless functions are
request-scoped (no persistent process for `setInterval`). The proactive bot engine runs
on the **standalone Node.js server** (`apps/api/src/server.ts` with `@hono/node-server`).

The Vercel deployment (Next.js bridge) continues to serve the human `/invoke` path and all
CRUD routes. For a full v3.0 deployment, the standalone API server must be deployed
separately (e.g. Railway, Fly.io, or Docker on a VPS). This was already anticipated in the
project's architecture decision to keep `server.ts` and the Vercel bridge as separate entry
points.

---

## Component Map: All v3.0 Changes at a Glance

| Component | Location | Status | Nature of Change |
|-----------|----------|--------|-----------------|
| `state.ts` | `apps/api/src/graph/` | MODIFIED | Add `triggerType`, `argGraph`, `participantProfiles` fields |
| `graph.ts` | `apps/api/src/graph/` | MODIFIED | Conditional START edge, 4 new nodes, new edge wiring |
| `model-config.ts` | `apps/api/src/lib/` | MODIFIED | Add `facilitation`, `graph_reasoning` task types |
| `server.ts` | `apps/api/src/` | MODIFIED | Add `startTriggerEngine()` call |
| `nodes/proactive-trigger.ts` | `apps/api/src/graph/nodes/` | NEW | Routes proactive path, reads triggerType |
| `nodes/facilitation-agent.ts` | `apps/api/src/graph/nodes/` | NEW | Coach persona, text-only, Haiku model |
| `nodes/analytics-agent.ts` | `apps/api/src/graph/nodes/` | NEW | Analyst persona, canvas mutations, Sonnet model |
| `nodes/arg-graph-builder.ts` | `apps/api/src/graph/nodes/` | NEW | Argument graph extraction, Haiku model |
| `services/trigger-engine.ts` | `apps/api/src/services/` | NEW | setInterval scan loop, 6 trigger condition detectors |
| `services/proactive-invoker.ts` | `apps/api/src/services/` | NEW | Internal graph invocation, mic lock, broadcast |
| `services/personality-dispatcher.ts` | `apps/api/src/services/` | NEW | Trigger → persona + prompt mapping |
| `routes/ai.ts` | `apps/api/src/routes/` | UNCHANGED | Human invoke path preserved as-is |
| Supabase migrations | `supabase/migrations/` | NEW (optional) | Index on `messages(session_id, branch_id, created_at DESC)` if not exists |
| `@panelito/types` | `packages/types/` | MODIFIED | Add `TriggerType`, `ArgumentGraph`, `ParticipantProfile` types |

---

## What the Roadmap Planner Needs to Know

**Phase sequencing is hard-constrained by three dependencies:**

1. **State extension (Phase A) must come first.** Every subsequent phase depends on the
   new state fields. Without `triggerType`, the START edge cannot route.

2. **Graph topology change (Phase D) is the highest-risk phase.** It must be isolated,
   tested thoroughly, and NOT combined with ProactiveInvoker work (Phase E). If Phase D
   breaks something, Phase E tests will be impossible to interpret.

3. **TriggerEngine (Phase F) depends on ProactiveInvoker (Phase E).** The engine detects
   triggers; the invoker acts on them. Building the engine first would produce events with
   nowhere to go.

**The happy path for "smoke test" at each phase:**
- After Phase A: existing `/invoke` calls behave identically (no regression)
- After Phase C: unit tests pass for all new nodes
- After Phase D: integration test shows correct routing for both triggerType=null and
  triggerType='silence'
- After Phase E: manually POST to a debug endpoint that fires a proactive invocation;
  verify message in DB and Realtime broadcast
- After Phase F: idle in a session for 30 seconds; watch Coach speak

**Devil's Advocate bot is a v3.1 feature**, not v3.0. It requires a human-triggered
invocation mechanism (Power Reaction integration) that is separate from the proactive
trigger system. Do not include it in v3.0 scope.

---

## Sources

- LangGraph JS 1.4.7 docs (verified via Context7 `/websites/langchain_oss_javascript_langgraph`):
  - Conditional edges: https://langchain-ai.github.io/langgraphjs/how-tos/
  - Human-in-the-loop interrupt pattern: https://docs.langchain.com/oss/javascript/langgraph/interrupts
  - Graph invocation with null input (resume): https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance
- Existing codebase (read directly):
  - `apps/api/src/graph/graph.ts` — current topology
  - `apps/api/src/graph/state.ts` — current state schema
  - `apps/api/src/graph/nodes/agent.ts` — adapter seam pattern
  - `apps/api/src/routes/ai.ts` — full invoke route including mic lock, SSE, canvas writes
  - `apps/api/src/lib/model-config.ts` — existing task type → model mapping
  - `supabase/migrations/0004_auto_freeze_pg_cron.sql` — pg_cron precedent (auto-freeze)
  - `supabase/migrations/0010_mic_lock.sql` — mic lock RPC functions
