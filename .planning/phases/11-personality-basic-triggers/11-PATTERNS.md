# Phase 11: Personality + Basic Triggers - Pattern Map

**Mapped:** 2026-07-10
**Files analyzed:** 14 new/modified files
**Analogs found:** 14 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `apps/api/src/graph/nodes/facilitation-agent.ts` (NEW) | graph node (controller-like) | request-response | `apps/api/src/graph/nodes/agent.ts` | role-match (existing node, different tool-use payload) |
| `apps/api/src/graph/nodes/analytics-agent.ts` (NEW) | graph node (controller-like) | request-response | `apps/api/src/graph/nodes/agent.ts` + `apps/api/src/graph/nodes/orchestrator.ts` (fail-open pattern) | role-match |
| `apps/api/src/graph/nodes/arg-graph-builder.ts` (NEW) | graph node / transform (extraction) | transform | `apps/api/src/graph/nodes/agent.ts` (tool_use extraction) + `packages/types/src/canvas-tool.ts` (tool schema shape) | role-match |
| `apps/api/src/graph/graph.ts` (MODIFY) | route/topology config | event-driven (conditional dispatch) | same file, `routeAfterOrchestrator` (existing conditional edge) | exact (extend existing pattern in-place) |
| `packages/types/src/bot.ts` (MODIFY — extend `ArgNode`/`ArgEdge`) | model (Zod schema) | CRUD/transform | same file (additive to existing schema) | exact |
| `packages/types/src/personality.ts` (NEW) | model (Zod schema) | CRUD | `packages/types/src/persona.ts` (`PersonaConfigSchema`/`PERSONA_LIBRARY`) | role-match (same "typed list" pattern, new table-backed variant) |
| `packages/types/src/blueprint.ts` (MODIFY — add `bot_defaults`, Role→Personality map) | model (Zod schema) | CRUD | same file (additive to `BlueprintSchema`) | exact |
| `apps/api/src/lib/silence-scan.ts` (NEW) | service (scan loop) | event-driven / batch | `apps/api/src/lib/auto-freeze.ts` (`startAutoFreezeTracker`, timer registration) | role-match |
| `apps/api/src/server.ts` (MODIFY) | config/bootstrap | event-driven (startup registration) | same file, `startAutoFreezeTracker(...)` call site | exact |
| `apps/api/src/lib/model-config.ts` (MODIFY — add `facilitation` TaskType) | config | CRUD (static map) | same file (additive to `TASK_MODELS`) | exact |
| `supabase/migrations/0014_personalities.sql` (NEW) | migration | CRUD (DDL) | `supabase/migrations/0008_nsai_foundation.sql` (`domain_blueprints`) + `supabase/migrations/0012_bot_infrastructure.sql` (service-role-only table + RLS pattern) | role-match |
| `apps/api/src/routes/personas.ts` (MODIFY, or new sibling route for Role toggle) | route (controller) | request-response | same file (`POST /` toggle handler) | exact |
| `apps/web/components/workspace/CreatorControls.tsx` (MODIFY) | component | request-response (UI + fetch) | same file (`personaCard` / `handlePersonaToggle`) | exact |
| `apps/api/src/graph/graph.test.ts` (MODIFY — extend) | test | request-response (graph invoke assertions) | same file (`makeConfig`, `describe(...)` blocks) | exact |
| `apps/api/src/lib/silence-scan.test.ts` (NEW) | test | event-driven | `apps/api/src/lib/bot-arbitrator.test.ts` / `apps/api/src/lib/auto-freeze.test.ts` | role-match |

## Pattern Assignments

### `apps/api/src/graph/nodes/facilitation-agent.ts` (graph node, request-response)

**Analog:** `apps/api/src/graph/nodes/agent.ts` (full file read, 182 lines)

**Imports pattern** (`agent.ts` lines 15-19):
```typescript
import { canvasMutationTool, CanvasOpSchema } from '@panelito/types'
import type { Blueprint, ProviderName } from '@panelito/types'
import { createAdapter } from '../../lib/adapter-factory'
import { TASK_MODELS } from '../../lib/model-config'
import type { GraphState } from '../state'
```
For `facilitation-agent.ts`, adapt to: no `canvasMutationTool`/`CanvasOpSchema` (Coach produces plain text, not a tool call — see D-01, "every output ends in a question"); import `Personality`/`PersonalitySchema` from `@panelito/types` instead; import `checkBotBudget` from `../../lib/bot-budget` (see Shared Patterns below — budget guard is mandatory per RESEARCH.md Security Domain).

**Config-seam pattern** (`agent.ts` lines 87-109, `orchestrator.ts` lines 24-37):
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function agentNode(state: GraphState, config?: any): Promise<Partial<GraphState>> {
  const blueprint = config?.configurable?.blueprint as Blueprint | undefined
  const providerName = config?.configurable?.providerName as ProviderName | undefined
  const plaintextKey = config?.configurable?.plaintextKey as string | undefined

  // Test injection seam: allows passing a deterministic mock adapter
  const agentAdapter = config?.configurable?.agentAdapter as
    | import('@panelito/types').AIProvider
    | undefined

  if (!blueprint) {
    console.error('[agent] blueprint missing from config.configurable — returning no output')
    return {}
  }

  const adapter =
    agentAdapter ??
    (providerName && plaintextKey ? createAdapter(providerName, plaintextKey) : null)

  if (!adapter) {
    console.error('[agent] no adapter available (missing providerName/plaintextKey) — returning no output')
    return {}
  }
```
Copy this exact shape for `facilitationAgentNode`: rename the console prefix to `[facilitation]`, add a `facilitationAdapter` seam name (per RESEARCH.md Pattern 2), add a `personality` read from `config.configurable.personality` (the resolved Personality record — resolution itself happens in the caller/silence-scan, not in the node, mirroring how `blueprint` is resolved upstream of `agentNode`).

**System prompt builder as pure function** (`agent.ts` lines 29-84 is the template shape — a `buildXSystemPrompt(...)` function kept separate from the node body for testability). For `facilitation-agent.ts`, build `buildFacilitationSystemPrompt(personality, argGraphSummary, recentMessages)` following D-03's **fixed composition order**: Role discipline rules first (hardcoded, non-negotiable — "every output must end in a question, never give conclusions"), then Blueprint/argGraph context, then Personality voice appended last (see Pitfall 4 in RESEARCH.md — recency bias means Personality text must never precede Role rules).

**Fail-open fallback pattern** (`orchestrator.ts` lines 136-140):
```typescript
} catch (err) {
  // Fail-open: classification error → treat as DOMAIN_BRIDGE (allow agent to run)
  console.error('[orchestrator] classification error — failing open to DOMAIN_BRIDGE', err)
  guardrailResult = 'DOMAIN_BRIDGE'
}
```
`facilitationAgentNode`/`analyticsAgentNode` must never `throw` — wrap the `adapter.stream()` call in try/catch exactly like `agent.ts` lines 140/174-177, and return `{}` (empty partial state) on any adapter error, consistent with the "never throw from a graph node" convention (RESEARCH.md Pattern 1).

**Streaming loop + `[nodename]` log prefix** (`agent.ts` lines 140-177) — copy the `for await (const event of adapter.stream(...))` shape; route the model through `TASK_MODELS[providerName ?? 'anthropic'].facilitation` (new TaskType — see `model-config.ts` pattern below), not a hardcoded model string (RESEARCH.md Anti-Pattern, Finding 4/Pitfall 2).

---

### `apps/api/src/graph/nodes/analytics-agent.ts` (graph node, request-response)

**Analog:** `apps/api/src/graph/nodes/agent.ts` (tool-use extraction shape) + `apps/api/src/graph/nodes/orchestrator.ts` (classification-style fail-open behavior for the fact-check "uncertainty language" framing mode)

Same config-seam / adapter / fail-open / `[analytics]` log-prefix conventions as above. Key difference from Facilitation: PERSONA-02 requires the Analyst to "always cite a specific prior message" — this means `analyticsAgentNode` reads `state.argGraph` (populated by `ArgGraphBuilderNode`, see below) to resolve a citable `message_id`/`speaker` pair, following the same "read from `state.X`, don't rebuild it" discipline `agentNode` shows when reading `state.messages`/`state.steeringTextEnabled` (`agent.ts` lines 116, 137).

**Fact-check framing branch** (Claude's discretion per CONTEXT.md, no live trigger yet in Phase 11) — model this as an additional prompt-branch inside `buildAnalyticsSystemPrompt`, the same way `agent.ts` lines 120-135 conditionally append a "Steering instruction" block when `steeringTextEnabled === true`:
```typescript
// agent.ts lines 123-135 — conditional prompt augmentation pattern to copy
if (steeringTextEnabled === true) {
  const activePhase = /* ... */
  system += '\n\nSteering instruction: ...'
}
```
Replace the condition with `factCheckFraming === true` (read from `config.configurable` or a new state field, per CONTEXT.md's Claude's Discretion note) and the appended text with the uncertainty-language-only instruction from D-01.

---

### `apps/api/src/graph/nodes/arg-graph-builder.ts` (transform node, extraction)

**Analog:** `apps/api/src/graph/nodes/agent.ts` tool-use extraction block (lines 140-172) + `packages/types/src/canvas-tool.ts` (tool schema shape) for the `argGraphExtractionTool` definition.

**Tool schema (raw JSON schema, NOT the Zod domain schema)** — `canvas-tool.ts` lines 26-80 is the exact template:
```typescript
// packages/types/src/canvas-tool.ts lines 26-41 (excerpt)
export const canvasMutationTool: ProviderTool = {
  name: 'canvas_mutation',
  description: '...',
  parameters: {
    type: 'object',
    properties: {
      op: { type: 'string', enum: ['ADD_NODE', 'ADD_EDGE', 'NO_ACTION'], description: '...' },
      node_type_id: { type: 'string', description: 'Required for ADD_NODE. Must match a Blueprint node_types[].id.' },
      // ... flat properties block, no oneOf at root (Anthropic API requirement)
    },
    required: ['op'],
  },
}
```
Per RESEARCH.md Finding 2: define `argGraphExtractionTool` the same way, with `id`/`source_ref`/`target_ref` typed as plain `string` (NOT UUID-constrained) in this raw tool schema — the model cannot reliably emit RFC4122 UUIDs. Create it in a new `packages/types/src/arg-graph-tool.ts` sibling to `canvas-tool.ts` (same directory convention), exported from `index.ts` the same way `canvasMutationTool` is (`index.ts` line 51).

**Tool-use extraction + two-schema split (raw tool schema vs. domain Zod schema)** — `agent.ts` lines 149-169:
```typescript
} else if (event.type === 'tool_use' && event.name === 'canvas_mutation') {
  const rawInput = event.input as Record<string, unknown>
  // ... read advisory fields from rawInput BEFORE safeParse (safeParse silently drops unknowns)
  const parsed = CanvasOpSchema.safeParse(event.input)
  if (parsed.success) {
    agentOutput = parsed.data
  } else {
    console.error('[agent] CanvasOpSchema.safeParse failed — dropping malformed tool output', parsed.error.flatten())
  }
}
```
For `arg-graph-builder.ts`: after `event.name === 'arg_graph_extraction'`, validate the raw tool output shape first (short refs allowed), THEN perform server-side `crypto.randomUUID()` substitution for `id`/`source_ref`→`source_id`/`target_ref`→`target_id` (per RESEARCH.md Finding 2 recommendation), THEN `safeParse` against the real `ArgNodeSchema`/`ArgEdgeSchema` from `bot.ts` (which keep `.uuid()` constraints — do not relax the domain schema, only the raw tool-input schema). Fail-silent on `safeParse` failure exactly like `agent.ts` line 163-168 — log and drop, never throw.

---

### `apps/api/src/graph/graph.ts` (route/topology, event-driven)

**Analog:** same file — `routeAfterOrchestrator` conditional edge (lines 39-45) and the `createGraph()` factory (lines 53-70) are the exact templates to extend, not replace.

**Existing conditional-edge pattern to copy for `routeFromStart`:**
```typescript
// graph.ts lines 39-45 — existing conditional-edge shape
export function routeAfterOrchestrator(state: GraphState): 'agent' | 'driftReply' | 'end' {
  if (state.guardrailResult === 'DOMAIN_DRIFT') {
    return state.driftAction === 'replied' ? 'driftReply' : 'end'
  }
  // DOMAIN_MATCH, DOMAIN_BRIDGE, or null (fail-open fallback) → route to agent
  return 'agent'
}
```
```typescript
// graph.ts lines 53-70 — factory registration shape
export function createGraph(checkpointer?: BaseCheckpointSaver) {
  const graph = new StateGraph(GraphStateAnnotation)
    .addNode('orchestrator', orchestratorNode)
    .addNode('agent', agentNode)
    .addNode('mutationGate', mutationGateNode)
    .addNode('driftReply', driftReplyNode)
    .addEdge(START, 'orchestrator')
    .addConditionalEdges('orchestrator', routeAfterOrchestrator, {
      agent: 'agent',
      driftReply: 'driftReply',
      end: END,
    })
    .addEdge('agent', 'mutationGate')
    .addEdge('mutationGate', END)
    .addEdge('driftReply', END)

  return graph.compile({ checkpointer: checkpointer ?? new MemorySaver() })
}
```
**CRITICAL per RESEARCH.md Anti-Patterns and Pitfall 3:** the new conditional `addConditionalEdges(START, routeFromStart, {...})` REPLACES the fixed `.addEdge(START, 'orchestrator')` — both cannot coexist (the fixed edge silently wins). Every `routeFromStart` return value must be enumerated as a pathsMap key (LangGraph has no runtime exhaustiveness check — an unmapped return silently drops the invocation with no error). Per Finding 6 / ROADMAP success criterion 2: distinguish `triggerMetadata.trigger_type === undefined` (valid human path, routes to `'orchestrator'`) from a **defined but unrecognized** `trigger_type` string (bug — must `console.error`, not `console.info`, and route to a distinguishable path, not silently fall through to `'orchestrator'`).

---

### `packages/types/src/bot.ts` (model, additive extension — do NOT create a competing file)

**Analog:** same file, extend the existing `ArgNodeSchema`/`ArgEdgeSchema` in place (lines 9-27):
```typescript
// packages/types/src/bot.ts lines 9-27 — EXISTING, already imported by graph/state.ts
export const ArgNodeSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),          // e.g. 'claim', 'evidence', 'rebuttal'
  label: z.string(),
  branch_id: z.string().uuid(),
});

export const ArgEdgeSchema = z.object({
  id: z.string().uuid(),
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  relation: z.string(),      // e.g. 'SUPPORTS', 'CONTRADICTS'
});
```
Per RESEARCH.md Finding 1 (HIGH confidence, verified against `state.ts` line 14/94-97 which imports `ArgNode`/`ArgEdge` from `@panelito/types`): **do not create `arg-graph.ts`.** Add fields additively — `message_id: z.string().uuid()` and `speaker: z.string()` on `ArgNodeSchema` (required by PERSONA-02's citation contract, currently absent), decide `confidence` as optional discretion. Keep `.uuid()` constraints on the domain schema — the ID-substitution step (see `arg-graph-builder.ts` above) happens before this schema is applied, not by relaxing it.

---

### `packages/types/src/personality.ts` (NEW model — Zod schema + type)

**Analog:** `packages/types/src/persona.ts` (full file, 47 lines) — same "typed const list + Zod schema" project convention, now backed by a real table (D-04) instead of a hardcoded array.

```typescript
// packages/types/src/persona.ts lines 1-24 — exact structural template
import { z } from 'zod'

export const PERSONA_IDS = ['analista_cientifico'] as const
export type PersonaId = typeof PERSONA_IDS[number]

export const PersonaConfigSchema = z.object({
  id: z.enum(PERSONA_IDS),
  displayName: z.string(),
  description: z.string(),
  systemPromptAddition: z.string(),
  icon: z.string(), // Lucide icon name
  active: z.boolean(),
})

export type PersonaConfig = z.infer<typeof PersonaConfigSchema>
```
For `personality.ts`: id is `z.string()` (DB primary key, text — NOT a compile-time enum, matching `blueprint.ts`'s D-05 principle of "text IDs resolved at runtime" — `blueprint.ts` line 50-52 comment is the explicit rationale to cite), `display_name`, `language`, `formality`, `voice_description`/`catchphrases`, `knowledge_scope` fields per D-02/D-07/D-08. Per D-04, follow `domain_blueprints`' jsonb-`definition`-column shape (see migration pattern below) rather than separate typed columns — so the TS type should mirror `{ id: string, name: string, definition: {...} }` the same way `Blueprint` mirrors `domain_blueprints`.

**Barrel export pattern** (`index.ts` lines 57-59):
```typescript
// Persona types + library (PERSONA-01)
export type { PersonaConfig, PersonaId } from "./persona";
export { PersonaConfigSchema, PERSONA_LIBRARY, PERSONA_IDS } from "./persona";
```
Add a new grouped comment block for `Personality` types immediately after, per RESEARCH.md's "Zod schema + inferred type co-located, exported from index.ts in a grouped comment block" established pattern (also cited in `10-PATTERNS.md`). **Per Pitfall 5: name everything `Personality`/`personalities` distinctly from `PersonaConfig`/`PERSONA_LIBRARY` — do not converge or rename either system in this phase (D-06 boundary).**

---

### `packages/types/src/blueprint.ts` (model, additive extension for `bot_defaults` + Role→Personality map)

**Analog:** same file — `BlueprintSchema` (lines 56-68), additive field pattern already demonstrated by `drift_reply_probability` (line 67, added with a Zod `.default(...)` for backward-DB-compatibility):
```typescript
// blueprint.ts line 67 — precedent for adding an optional-with-default field to an existing seeded schema
drift_reply_probability: z.number().min(0).max(1).default(0.8),
```
Per RESEARCH.md Finding 5 (do NOT follow `bot_cooldowns`'s TS-only-intersection-type anti-pattern — it does not satisfy D-10's requirement that Blueprint be the actual DB source of truth): add `bot_defaults` and the Role→default-Personality map as real fields in `BlueprintSchema` itself, and populate them in the seeded `debate-strategy-v1` Blueprint JSON (inside `domain_blueprints.definition`, following the `active_persona_ids` precedent at line 63 — "text IDs resolved at runtime, not compile-time enum").

---

### `apps/api/src/lib/silence-scan.ts` (NEW service, event-driven scan loop)

**Analog:** `apps/api/src/lib/auto-freeze.ts` (full file, 229 lines) — `startAutoFreezeTracker` registration shape (lines 76-93) is the D-15-cited direct template.

```typescript
// auto-freeze.ts lines 76-93 — registration-at-boot pattern to copy
export async function startAutoFreezeTracker(supabase: SupabaseClient): Promise<void> {
  const { data: activeSessions, error } = await supabase
    .from('sessions')
    .select('id, creator_id')
    .eq('status', 'active')

  if (error) {
    console.error('[auto-freeze] Failed to load active sessions:', error.message)
    return
  }

  for (const session of activeSessions ?? []) {
    subscribeToSessionPresence(supabase, session.id, session.creator_id)
  }

  console.log(`[auto-freeze] Tracking ${activeSessions?.length ?? 0} active sessions`)
}
```
Note: `auto-freeze.ts` itself uses per-session `setTimeout` chains + Presence subscriptions, NOT a single `setInterval` loop — for `silence-scan.ts`, follow the **async-`setInterval`-with-try/catch** shape from `11-AI-SPEC.md` Section 4b.2 instead (cross-verified safe in RESEARCH.md "Code Examples" — the exact snippet to copy):
```typescript
// 11-AI-SPEC.md Section 4b.2 (cross-verified against auto-freeze.ts's error-handling style)
const intervalHandle = setInterval(async () => {
  try {
    await runSilenceScan(supabase, graph)
  } catch (err) {
    console.error('[silence-scan] uncaught error in scan tick', err)
  }
}, SCAN_INTERVAL_MS)
// WRONG — fire-and-forget allows overlapping ticks (re-fire during cooldown):
// setInterval(() => { runSilenceScan(...) }, SCAN_INTERVAL_MS)
```
**Reuse, do not rebuild** (RESEARCH.md "Don't Hand-Roll" table): call `checkSilenceGate()` (`silence-gate.ts`, full two-signal gate already built), `runArbitration()`/`registerBot()` (`bot-arbitrator.ts`), and `checkBotBudget()` (`bot-budget.ts`) from inside each scan tick — see Shared Patterns below for exact call shapes. Also: **the scan loop itself must check `sessions.status === 'active'` before invoking the graph** — none of the three reused Phase 10 primitives perform this check (RESEARCH.md Security Domain finding, verified by reading all three files in full).

**Env-var timer override pattern** (`auto-freeze.ts` lines 29-47) — copy for `SCAN_INTERVAL_MS`:
```typescript
const GRACE_MS = parseInt(process.env.AUTO_FREEZE_GRACE_MS ?? '30000', 10)
if (GRACE_MS < 30_000) {
  console.warn(`[auto-freeze] WARNING: AUTO_FREEZE_GRACE_MS=${GRACE_MS} is below the production minimum...`)
}
```

**Test analog:** `apps/api/src/lib/auto-freeze.test.ts` and `apps/api/src/lib/bot-arbitrator.test.ts` (both exist) are the closest test-file templates for `silence-scan.test.ts` — mock `SupabaseClient`, assert on timer/RPC call sequencing, not real DB.

---

### `apps/api/src/server.ts` (config/bootstrap, event-driven registration)

**Analog:** same file, full 26 lines — the exact registration call site:
```typescript
// server.ts lines 1-25 — full file, existing registration pattern
import { startAutoFreezeTracker } from "./lib/auto-freeze";
import { createServiceClient } from "./lib/supabase";
// ...
serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
  console.log(`[panelito/api] Standalone server listening on port ${info.port}`);
  setupLangfuseOtel();
  startAutoFreezeTracker(createServiceClient()).catch((err) =>
    console.error("[panelito/api] auto-freeze tracker startup error:", err)
  );
});
```
Add `import { startSilenceScanLoop } from "./lib/silence-scan"` and a sibling call `startSilenceScanLoop(createServiceClient()).catch(...)` inside the same `serve(...)` callback, alongside (not replacing) `startAutoFreezeTracker`.

---

### `apps/api/src/lib/model-config.ts` (config, additive `facilitation` TaskType)

**Analog:** same file — `TASK_MODELS` (lines 25-44), additive-field pattern:
```typescript
// model-config.ts lines 23-44 — full existing matrix; facilitation must be added to ALL THREE providers
export type TaskType = 'analysis' | 'compression' | 'categorization' | 'classification'

export const TASK_MODELS: Record<ProviderName, Record<TaskType, string>> = {
  anthropic: {
    analysis: 'claude-sonnet-4-6',
    compression: 'claude-haiku-4-5-20251001',
    categorization: 'claude-haiku-4-5-20251001',
    classification: 'claude-haiku-4-5-20251001',
  },
  openai: { analysis: 'gpt-5.4', compression: 'gpt-5.4-mini', categorization: 'gpt-5.4-mini', classification: 'gpt-5.4-mini' },
  gemini: { analysis: 'gemini-2.5-flash', compression: 'gemini-2.5-flash', categorization: 'gemini-2.5-flash', classification: 'gemini-2.5-flash' },
} as const
```
Per RESEARCH.md Finding 4/Pitfall 2 (this is a `Record<ProviderName, Record<TaskType, string>>` fully-required matrix — a TypeScript compile error if any provider is skipped): add `facilitation` to the `TaskType` union AND to all three provider objects in the same edit. Reuse existing fast-tier model IDs already in the file: `'claude-haiku-4-5-20251001'` (anthropic), `'gpt-5.4-mini'` (openai), `'gemini-2.5-flash'` (gemini) — no new model ID sourcing needed.

---

### `supabase/migrations/0014_personalities.sql` (NEW migration)

**Analog A — table shape:** `supabase/migrations/0008_nsai_foundation.sql` lines 33-46 (`domain_blueprints`, D-04's explicitly-named closest analog):
```sql
-- 0008_nsai_foundation.sql lines 33-46
CREATE TABLE public.domain_blueprints (
  id          text        PRIMARY KEY,
  name        text        NOT NULL,
  definition  jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.domain_blueprints ENABLE ROW LEVEL SECURITY;

-- SELECT allowed for all authenticated users; no INSERT/UPDATE/DELETE policy.
CREATE POLICY "blueprints_select"
  ON public.domain_blueprints
  FOR SELECT
  USING (auth.uid() IS NOT NULL);
```
Copy this exact shape for `personalities`: `id text PRIMARY KEY, name text NOT NULL, definition jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()`, RLS enabled, `SELECT` policy for any authenticated user, no INSERT/UPDATE/DELETE policy (writes are service-role-only, matching D-04's platform-global/no-editor-UI scope for Phase 11).

**Analog B — file header/section-comment convention and service-role-only trust boundary note:** `supabase/migrations/0012_bot_infrastructure.sql` lines 1-16 (header comment explaining design rationale + trust boundary) and lines 22-40 (`bot_arbitration` table + unique index + `COMMENT ON TABLE` + `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) — copy the header-comment-block convention (migration purpose, design rationale, trust boundary) and the `COMMENT ON TABLE public.X IS '...'` documentation habit.

**Migration numbering:** `0014` is confirmed next-in-sequence as of this session (`0013_revoke_public_execute.sql` is latest on disk per RESEARCH.md Finding 3) — **re-verify immediately before executing**, since intervening merges can change this.

**Seed data location:** the Role→default-Personality map and `bot_defaults` values, if added to `BlueprintSchema` (see above), get seeded into the existing `debate-strategy-v1` row's `definition` jsonb via an `UPDATE public.domain_blueprints SET definition = definition || '{"bot_defaults": {...}}'::jsonb WHERE id = 'debate-strategy-v1';` statement in this same migration — follow `0008_nsai_foundation.sql` line 222's `INSERT INTO public.domain_blueprints (id, name, definition) VALUES (...)` seeding convention for the two shipped Personality rows.

---

### `apps/api/src/routes/personas.ts` (route, request-response) — Role toggle (D-09) analog

**Analog:** same file, full 77 lines — the exact creator-only toggle pattern to copy for the new Role (Coach/Analyst) toggle route.
```typescript
// personas.ts lines 1-20, 31-46 — imports + creator-only check (V4 Access Control, must-copy verbatim per RESEARCH.md Security Domain)
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { createServiceClient } from '../lib/supabase'
import type { AuthVariables } from '../middleware/auth'

const personasRouter = new Hono<{ Variables: AuthVariables }>()
personasRouter.use('*', requireAuth)

personasRouter.post('/', async (c) => {
  const sessionId = c.req.param('id')
  const user = c.get('user')
  const supabase = createServiceClient()
  // ... parse + validate body via zod .parse() in try/catch, 400 on failure ...

  const { data: session, error: fetchError } = await supabase
    .from('sessions')
    .select('id, creator_id, active_personas')
    .eq('id', sessionId)
    .single()

  if (fetchError || !session) {
    return c.json({ error: 'not_found', message: 'Session not found' }, 404)
  }

  // T-02-18: Elevation of Privilege protection
  if (session.creator_id !== user.id) {
    return c.json({ error: 'forbidden', message: 'Only the creator can toggle personas' }, 403)
  }
  // ... compute new array, update, return 200 ...
})
```
Add/extend a route (either a new endpoint on this router or a sibling `roles.ts`/`bots.ts` route, planner's call) that toggles Coach/Analyst per session (D-09) reading/writing whatever session-level field D-10/D-11 lands on. **Copy the `session.creator_id !== user.id → 403` check verbatim** — RESEARCH.md Security Domain explicitly flags this as "a direct, must-copy pattern, not a design choice."

---

### `apps/web/components/workspace/CreatorControls.tsx` (component, request-response)

**Analog:** same file — `personaCard` (lines 372-400) + `handlePersonaToggle` (lines 315-333) + the "Analistas activos" `Sheet` (lines 488-501).

```typescript
// CreatorControls.tsx lines 315-333 — optimistic-toggle-with-rollback pattern to copy
const handlePersonaToggle = async (checked: boolean) => {
  setLocalAnalistaActive(checked)
  setToggling(true)
  try {
    await apiFetch(`/api/sessions/${session.id}/personas`, {
      method: 'POST',
      body: JSON.stringify({ personaId: 'analista_cientifico', active: checked }),
    })
    router.refresh()
  } catch {
    setLocalAnalistaActive(!checked)
    toast.error('No se pudo cambiar el analista. Inténtalo de nuevo.')
  } finally {
    setToggling(false)
  }
}
```
```typescript
// CreatorControls.tsx lines 372-401 — card UI shape (icon box + label + description + Switch)
const personaCard = (
  <div className="flex items-center justify-between p-4 rounded-lg border bg-card gap-3 text-left">
    <div className="flex items-center gap-3">
      <div className={cn("w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 transition-opacity", isChecked ? "opacity-100" : "opacity-60")} style={{...}}>
        <FlaskConical size={20} className={isChecked ? "text-indigo-400" : "text-zinc-400"} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-medium text-foreground">Analista Científico</div>
        <div className="text-[13px] text-muted-foreground mt-0.5 line-clamp-2 leading-tight">...</div>
      </div>
    </div>
    <Switch checked={isChecked} disabled={toggling} onCheckedChange={handlePersonaToggle} aria-label={...} />
  </div>
)
```
Add two new cards ("Facilitador"/Coach, "Analista/Verificador"/Analyst) inside the same `Sheet` (lines 488-501, `SheetTitle>Analistas activos</SheetTitle>`) using this exact card shape, each with its own toggle state + `handleXToggle` mirroring `handlePersonaToggle`'s optimistic-update-with-rollback shape. Per D-12, add a read-only cooldown display line (e.g. "3 respuestas / 15 min") inside each new card's description area — no new interactive element needed, just static text sourced from the Blueprint's cooldown config (already resolved server-side by `runArbitration`'s `bot_cooldowns`-style lookup — read-only display, no new API call required if the value is already present in `session`/`blueprint` props).

---

### `apps/api/src/graph/graph.test.ts` (test, extend in place)

**Analog:** same file — `makeConfig` helper (lines 146-164) and `describe(...)` block structure (line 170 onward).

```typescript
// graph.test.ts lines 146-164 — config-builder helper to extend with new adapter seams
function makeConfig(
  options: { classifierAdapter: AIProvider; agentAdapter?: AIProvider; driftReplyAdapter?: AIProvider }
) {
  return {
    configurable: {
      thread_id: `test-${Math.random().toString(36).slice(2)}`,
      blueprint: debateBlueprint,
      providerName: 'anthropic' as const,
      plaintextKey: 'test-key',
      classifierAdapter: options.classifierAdapter,
      agentAdapter: options.agentAdapter,
      driftReplyAdapter: options.driftReplyAdapter,
    },
  }
}
```
Extend with `facilitationAdapter`/`analyticsAdapter`/`argGraphAdapter` options plus a `triggerMetadata` initial-state field (per RESEARCH.md Pattern 3), and add new `describe(...)` blocks for the 3 new conditional-START paths (facilitation / analysis+argGraphBuilder / orchestrator-fallback) rather than creating new per-node test files — this codebase has zero per-node unit test files by established convention (RESEARCH.md Pattern 3, verified: no `agent.test.ts`/`orchestrator.test.ts`/etc. exist).

---

## Shared Patterns

### Test-seam adapter injection via `config.configurable`
**Source:** `apps/api/src/graph/nodes/agent.ts` lines 93-96 (`agentAdapter`), `apps/api/src/graph/nodes/orchestrator.ts` lines 30-32 (`classifierAdapter`)
**Apply to:** `facilitation-agent.ts`, `analytics-agent.ts`, `arg-graph-builder.ts` — each needs its own named seam (`facilitationAdapter`, `analyticsAdapter`, `argGraphAdapter`).
```typescript
const classifierAdapter = config?.configurable?.classifierAdapter as
  | import('@panelito/types').AIProvider
  | undefined
```

### `[nodename]` fail-open/fail-silent logging, never throw from a node
**Source:** `apps/api/src/graph/nodes/agent.ts` lines 98, 107, 164-168, 174-177; `orchestrator.ts` lines 35-36, 93, 138-139
**Apply to:** every new graph node — always `console.error('[nodename] <what/why>', err)` then `return {}` or a safe partial state; never `throw`.

### Never import `@anthropic-ai/sdk` directly — always `createAdapter()`
**Source:** `apps/api/src/lib/adapter-factory.ts` (`createAdapter(providerName, plaintextKey)`), used by every existing node.
**Apply to:** `facilitation-agent.ts`, `analytics-agent.ts`, `arg-graph-builder.ts` — same abstraction, no exceptions.

### Silence gate → arbitration → budget guard call chain (Phase 10 primitives, reuse verbatim)
**Source:** `apps/api/src/lib/silence-gate.ts` (`checkSilenceGate`), `apps/api/src/lib/bot-arbitrator.ts` (`registerBot`/`runArbitration`/`releaseBotLock`), `apps/api/src/lib/bot-budget.ts` (`checkBotBudget`)
**Apply to:** `silence-scan.ts` (the scan-tick body) and any future trigger loop (Phase 14 will generalize the same chain).
```typescript
// bot-arbitrator.ts lines 67-69 — registration at module load
export function registerBot(botId: string, scorer: ScorerFn): void {
  _registry.set(botId, scorer)
}
// Coach/Analyst modules call registerBot('coach', scorerFn) / registerBot('analyst', scorerFn)
// at module import time — mirrors how the registry was designed empty in Phase 10 for this purpose.
```
```typescript
// bot-budget.ts lines 43-56 — fail-closed RPC wrapper, call before every LLM invocation
export async function checkBotBudget(supabase: SupabaseClient, branchId: string, tokensUsed: number): Promise<BotBudgetResult> {
  const { data, error } = await supabase.rpc('check_and_record_bot_budget', { p_branch_id: branchId, p_tokens_used: tokensUsed })
  if (error || !data || !Array.isArray(data) || data.length === 0) {
    console.error('[bot-budget] check_and_record_bot_budget error:', error?.message ?? 'no rows returned')
    return FAIL_CLOSED
  }
  // ...
}
```
`releaseBotLock` MUST be called in a `finally` block after every bot execution (`bot-arbitrator.ts` lines 130-143 doc comment) — this is a documented must-copy contract, not optional.

### Direct message insert + Realtime broadcast (D-16 delivery mechanism)
**Source:** `apps/api/src/routes/ai.ts` lines 428-454 (assistant-message insert), `apps/api/src/lib/sessions-helpers.ts` lines 46-70 (`freezeSession`'s system-message insert, same shape for a proactive/non-request-triggered insert)
**Apply to:** the silence-scan loop's Coach message delivery.
```typescript
// ai.ts lines 428-454 (excerpt) — exact insert + broadcast shape to copy
const { data: row, error: insertError } = await supabase
  .from('messages')
  .insert({
    session_id: sessionId,
    author_id: session.creator_id,        // OPEN QUESTION — see below, do not blindly reuse
    display_name: matchedPersonas[0]?.displayName ?? 'AI',
    parent_id: null,
    path_id: activePathId,
    branch_id: activeBranchId,
    role: 'assistant',
    content: accumulatedText,
    canvas_snapshot_state: null,
  })
  .select()
  .single()

if (!insertError && row) {
  supabase.channel(`session:${sessionId}`).httpSend('new_message', row)
    .catch((err) => console.error('[silence-scan] broadcast failed', err))
}
```
**Open decision for planning (RESEARCH.md Pattern 4 / Assumption A3):** what `author_id` to use for a bot-authored message — `session.creator_id` (existing AI-message precedent, `role:'assistant'`) does not cleanly represent "bot speaking as itself"; `SYSTEM_AUTHOR_ID` from `sessions-helpers.ts` line 16 (`'00000000-0000-0000-0000-000000000000'`) is always paired with `display_name:'system'` and `role` left at default `'user'` (NOT `'assistant'`) — also not a clean fit. RESEARCH.md recommends deciding a dedicated bot-author strategy explicitly in planning rather than silently reusing either.

### Creator-only route guard (V4 Access Control — must-copy verbatim)
**Source:** `apps/api/src/routes/personas.ts` lines 42-45
```typescript
// T-02-18: Elevation of Privilege protection
if (session.creator_id !== user.id) {
  return c.json({ error: 'forbidden', message: 'Only the creator can toggle personas' }, 403)
}
```
**Apply to:** any new Role-toggle route (D-09).

### Zod schema + inferred type, grouped barrel export
**Source:** `packages/types/src/index.ts` lines 57-67 (grouped comment blocks per feature area — `Persona`, `Canvas`, `Blueprint`)
```typescript
// Persona types + library (PERSONA-01)
export type { PersonaConfig, PersonaId } from "./persona";
export { PersonaConfigSchema, PERSONA_LIBRARY, PERSONA_IDS } from "./persona";
```
**Apply to:** every new type file (`personality.ts`, extended `bot.ts`, extended `blueprint.ts`) — add a new grouped block, follow the `export type { ... }` / `export { ...Schema }` split exactly.

## No Analog Found

None. All 14 files/edits have at least a role-match analog in the existing codebase (Phase 6/7/8/10 infrastructure covers every architectural shape Phase 11 needs — controller-like graph nodes, Zod-typed models, service-loop registration, migration DDL, toggle routes, and UI toggle cards all have direct precedent).

## Metadata

**Analog search scope:** `apps/api/src/graph/nodes/`, `apps/api/src/graph/`, `apps/api/src/lib/`, `apps/api/src/routes/`, `apps/web/components/workspace/`, `packages/types/src/`, `supabase/migrations/` — all directories named in `11-CONTEXT.md`'s canonical_refs and `11-RESEARCH.md`'s Sources section.
**Files read in full this session:** `agent.ts`, `orchestrator.ts`, `graph.ts`, `state.ts`, `bot.ts`, `persona.ts`, `blueprint.ts`, `silence-gate.ts`, `bot-arbitrator.ts`, `bot-budget.ts`, `auto-freeze.ts`, `model-config.ts`, `server.ts`, `personas.ts`, `sessions-helpers.ts`, `canvas-tool.ts`, plus targeted reads of `CreatorControls.tsx`, `ai.ts` (message-insert section), `graph.test.ts` (makeConfig + fixtures), `index.ts` (barrel exports), `0008_nsai_foundation.sql`, `0012_bot_infrastructure.sql`.
**Pattern extraction date:** 2026-07-10
