# Phase 15: Message Evaluation Pipeline - Pattern Map

**Mapped:** 2026-07-20
**Files analyzed:** 8 (1 new, 7 modified)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|----------------|
| `apps/api/src/lib/message-evaluation.ts` (NEW) | service (background/fire-and-forget job) | event-driven | `apps/api/src/lib/trigger-engine.ts` (`scanBranch`) | exact (same "resolve blueprint → invoke graph → insert bot message" shape, per-message instead of per-tick) |
| `apps/api/src/routes/messages.ts` (CHANGED) | route/controller | request-response + fire-and-forget side effect | itself — `maybeAutoName` call site, same file | exact (existing precedent in same file) |
| `apps/api/src/graph/graph.ts` (CHANGED) | service (graph topology/router) | event-driven (StateGraph routing) | itself — `routeFromStart`/`routeAfterTriggerGate`/`routeAfterArgGraphBuilder` | exact (extend existing router functions, do not add new file) |
| `apps/api/src/lib/skills.ts` (CHANGED) | service (registry) | CRUD-like (array assembly) | itself — `COACH_SKILLS`/`ANALYST_SKILLS` | exact (same file, refactor call-sites only) |
| `apps/api/src/lib/skills/moderation.ts` (CHANGED) | service (heuristic/Skill) | transform (detect → SkillDetectionResult) | `apps/api/src/lib/skills/fact-check.ts` (for the factory-shape precedent) + itself | role-match (moderation.ts is refactor target; fact-check.ts's `detect`/`buildPromptGuidance` free-function-then-object-literal export shape is the closest existing precedent for factoring out shared logic) |
| `apps/api/src/lib/skills/fact-check.ts` (CHANGED, only if reused by a second Role) | service (heuristic/Skill) | transform | itself (already exports free `detect`/`buildPromptGuidance` functions — closest to the target factory shape of any existing Skill file) | exact |
| `apps/api/src/lib/bot-arbitrator.ts` (CHANGED, small) | service (arbitration primitive) | request-response (scoring call) | itself — `runArbitration`, `ArbContext.firingSkillRole` | exact (extension point already documented, just needs a caller-supplied param threaded in) |
| `apps/api/src/lib/message-evaluation.test.ts` (NEW) | test | — | `apps/api/src/lib/trigger-engine.test.ts` | exact (same mocking shape: blueprint-loader, crypto, bot-arbitrator, bot-budget, CallbackHandler) |

## Pattern Assignments

### `apps/api/src/lib/message-evaluation.ts` (NEW — service, event-driven)

**Analog:** `apps/api/src/lib/trigger-engine.ts` (`scanBranch`/`scanSession`, lines 207-383, 561-634)

This is the single most important analog in this phase — `message-evaluation.ts`'s shape should mirror `scanBranch` almost line-for-line, adapted from "per-tick, per-branch" to "per-message, called once from `messages.ts`."

**Imports pattern** (`trigger-engine.ts` lines 40-58):
```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Blueprint, Personality, ProviderMessage, ProviderName } from '@panelito/types'
import { PersonalitySchema, ProviderSchema } from '@panelito/types'
import { CallbackHandler } from '@langfuse/langchain'
import { resolveCreatorLangfuseUserId } from './langfuse-user'
import { runArbitration, releaseBotLock } from './bot-arbitrator'
import { checkBotBudget } from './bot-budget'
import { registerBots } from './bot-registration'
import { loadBlueprint } from './blueprint-loader'
import { decryptKey } from './crypto'
import { env } from './env'
import { CONTEXT_WINDOWS } from './bot-context'
import { createGraph } from '../graph/graph'
import type { GraphState } from '../graph/state'
```
The new module additionally needs `getCheckpointer` if not passed a pre-built graph, exactly as `startTriggerEngine` does at line 153: `graph ?? createGraph(await getCheckpointer())`.

**Session/blueprint/provider resolution pattern** (`trigger-engine.ts` lines 207-238, 561-609):
```typescript
// Defense-in-depth re-check (Pitfall 6, D-02/CONTEXT.md): status must be re-verified
// inside the fire-and-forget call even though the synchronous insert path already checked it.
if (session.status !== 'active') return
if (!session.blueprint_id) return

let blueprint: Blueprint
try {
  blueprint = await loadBlueprint(session.blueprint_id)
} catch (err) {
  console.error('[message-evaluation] blueprint load failed for session', session.id, (err as Error).message)
  return
}

// D-07 (trigger-gate.ts's exact role-gate pattern, reused): effective enablement =
// bot_overrides ?? bot_defaults ?? false
const coachEnabled = session.bot_overrides?.coach ?? blueprint.bot_defaults?.coach ?? false
const analystEnabled = session.bot_overrides?.analyst ?? blueprint.bot_defaults?.analyst ?? false
if (!coachEnabled && !analystEnabled) return // nothing could ever fire — skip entirely, no LLM/DB cost

const providerCtx = await resolveProviderContext(supabase, session.creator_id) // copy this helper verbatim
if (!providerCtx) return
```
`resolveProviderContext` (lines 561-590) and `resolveCoachPersonality` (lines 592-609) should be reused/imported or copied verbatim — they are already generic over Role except for the `role_personalities.coach` key, which the new Analyst-firing branch needs to generalize to `role_personalities[firingSkillRole]` (Pitfall 3 in RESEARCH.md — mint `ANALYST_AUTHOR_ID`, resolve `role_personalities.analyst` the same way).

**Per-request CallbackHandler construction** (`trigger-engine.ts` lines 304-315) — mirror exactly, only the tag changes:
```typescript
const callbackHandler = new CallbackHandler({
  userId: langfuseUserId,
  sessionId: session.id,
  tags: [`session:${session.id}`, `branch:${branch.id}`, 'trigger:passive-eval'],
})
```

**graph.invoke() call shape** (`trigger-engine.ts` lines 317-344) — new `triggerType` value (Claude's Discretion, D-03), `thread_id` should be the **human** thread (`${branchId}:human`, NOT `:bot` — this evaluates the human message itself, unlike `trigger-engine.ts`'s bot-thread silence path):
```typescript
await graph.invoke(
  {
    triggerType: 'passive_eval', // or planner's chosen name — see RESEARCH Open Question 1
    messages: recentMessages,
    blueprintId: blueprint.id,
    currentPhaseId: session.current_phase ?? blueprint.phase_sequence[0]?.id ?? '',
  },
  {
    configurable: {
      thread_id: `${branch.id}:human`,
      blueprint,
      providerName: providerCtx.providerName,
      plaintextKey: providerCtx.plaintextKey,
      personality, // resolved per firingSkillRole once known, or both pre-resolved
      streamWriter,
      supabase,
      serviceClient: supabase,
      branchId: branch.id,
      botOverrides: session.bot_overrides, // REQUIRED here (unlike trigger-engine.ts's
                                            // Pitfall 6 note) — this path DOES reach
                                            // TriggerGateNode's role-gate, so botOverrides
                                            // must be threaded through, not omitted.
      participantId: row.author_id, // Pitfall 5 (RESEARCH.md) — already known, no extra query
      lastMessageId: row.id,        // Pitfall 5 — same
    },
    callbacks: [callbackHandler],
  }
)
```

**Bot-message insert + broadcast pattern** (`trigger-engine.ts` lines 351-374) — reuse verbatim, but branch `author_id`/`display_name` on `firingSkillRole` from the graph's final state (`COACH_AUTHOR_ID`/`COACH_DISPLAY_NAME` vs. a new `ANALYST_AUTHOR_ID` sentinel — see Pitfall 3, RESEARCH.md, and `COACH_AUTHOR_ID`'s own definition at `trigger-engine.ts:103`):
```typescript
export const COACH_AUTHOR_ID = '00000000-0000-0000-0000-000000000b01' // trigger-engine.ts:103 — mint an analogous ANALYST_AUTHOR_ID
const COACH_DISPLAY_NAME = 'Facilitador' // trigger-engine.ts:104

const { data: row, error: insertError } = await supabase
  .from('messages')
  .insert({
    session_id: session.id,
    author_id: COACH_AUTHOR_ID, // or ANALYST_AUTHOR_ID per firingSkillRole
    display_name: COACH_DISPLAY_NAME, // or resolved analyst personality display name
    parent_id: null,
    path_id: branch.path_id,
    branch_id: branch.id,
    role: 'assistant',
    content: accumulatedText,
    canvas_snapshot_state: null,
  })
  .select()
  .single()

if (insertError || !row) {
  console.error('[message-evaluation] message insert error for branch', branch.id, insertError?.message)
} else {
  supabase
    .channel(`session:${session.id}`)
    .httpSend('new_message', row)
    .catch((err: unknown) => console.error('[message-evaluation] broadcast failed', err))
}
```

**Budget/arbitration wiring (D-11/D-12)** — `trigger-engine.ts` lines 281-291 is the exact call-site pattern to copy for the NEW reactive path (currently this pattern only exists on the proactive silence path — D-11 closes that gap):
```typescript
const winner = await runArbitration(branch.id, blueprint, supabase, firingSkillRole) // NEW 4th param, see bot-arbitrator.ts section below
if (winner !== firingSkillRole) {
  console.info('[message-evaluation] arbitration did not favor firing role — suppressing fire (D-12)', { branchId: branch.id, firingSkillRole, winner })
  return // D-12: silently suppressed, but Langfuse trace for the evaluation itself was already emitted by graph.invoke() above
}

const estimatedTokens = firingSkillRole === 'coach' ? ESTIMATED_COACH_FIRE_TOKENS : ESTIMATED_ANALYST_FIRE_TOKENS // new constant, see RESEARCH Open Question 3
const budget = await checkBotBudget(supabase, branch.id, estimatedTokens)
if (!budget.allowed) {
  console.warn('[message-evaluation] budget guard denied fire for branch', branch.id, { circuit_open: budget.circuit_open })
  return // D-12: silently suppressed
}
```
`finally { await releaseBotLock(branch.id, supabase) }` MUST wrap any code path that called `runArbitration` successfully — mirrors `trigger-engine.ts` lines 284-382's own `try { ... } finally { await releaseBotLock(...) }` structure exactly.

**Recent-messages fetch** (`trigger-engine.ts` lines 611-634, currently un-exported/local) — either export it from `trigger-engine.ts` and import it, or duplicate verbatim into `message-evaluation.ts` (RESEARCH.md's "Don't Hand-Roll" table recommends extracting to a shared helper — planner's discretion which module owns it):
```typescript
async function fetchRecentMessages(supabase: SupabaseClient, branchId: string): Promise<ProviderMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content')
    .eq('branch_id', branchId)
    .neq('role', 'system')
    .order('created_at', { ascending: false })
    .limit(CONTEXT_WINDOWS.facilitation)

  if (error) {
    console.error('[message-evaluation] fetchRecentMessages error for branch', branchId, error.message)
    return []
  }

  return ((data ?? []) as Array<{ role: string | null; content: string }>)
    .reverse()
    .map((m) => ({
      role: (m.role === 'assistant' || m.role === 'system' ? m.role : 'user') as ProviderMessage['role'],
      content: m.content,
    }))
}
```

**Error handling pattern:** fail-silent throughout — every early return is a plain `return` (no throw), every DB/adapter call site is wrapped in `try/catch` with `console.error('[message-evaluation] ...')`, matching D-02 and every helper in `trigger-engine.ts` verbatim (`resolveProviderContext` lines 583-589, `readCooldownUntil` lines 638-651, etc.).

---

### `apps/api/src/routes/messages.ts` (CHANGED — route/controller, request-response)

**Analog:** itself — the existing `maybeAutoName` fire-and-forget call site (lines 143-148), immediately before `return c.json(row, 201)` (line 150).

**Imports pattern** (line 19, add one more of the same shape):
```typescript
import { maybeAutoName } from '../lib/auto-name'
import { evaluateMessageAsync } from '../lib/message-evaluation' // NEW
```

**Fire-and-forget call pattern** (lines 143-150 — exact precedent, D-01/D-02 satisfied by this shape alone):
```typescript
// SESS-09: Auto-name session after 3rd message (fire-and-forget)
if (sessionId) {
  maybeAutoName(supabase, sessionId).catch((err) =>
    console.error('[messages] maybeAutoName error:', err)
  )
}

// NEW — Phase 15 D-01/D-02/D-10: same fire-and-forget shape, NOT awaited, fail-silent
evaluateMessageAsync(supabase, session, row).catch((err) =>
  console.error('[messages] evaluateMessageAsync error:', err)
)

return c.json(row, 201)
```
`session` (already fetched at lines 65-73, `select('id, status, creator_id')`) and `row` (the just-inserted message, lines 116-129) are already in scope at this point in the handler — no extra query needed (mirrors Pitfall 5 in RESEARCH.md: `row.author_id`/`row.id` are already known here).

**Validation pattern (unchanged, reference only):** `PostMessageBodySchema` (lines 26-32) — not modified by this phase, shown for context since `evaluateMessageAsync` receives the already-validated `row`, not raw body.

---

### `apps/api/src/graph/graph.ts` (CHANGED — service/router, event-driven)

**Analog:** itself — `routeFromStart` (lines 113-135), `routeAfterTriggerGate` (lines 205-212), `routeAfterArgGraphBuilder` (lines 185-187), and the `createGraph()` `addConditionalEdges` calls (lines 238-242, 269-272, 281-285).

**routeFromStart extension** (current shape, lines 113-135 — add a new `if` branch before the `null`/`undefined` check, following the exact `console.info` + early-return style already used for `'silence_gate'`/`'analysis_request'`):
```typescript
export function routeFromStart(
  state: GraphState
): 'facilitation' | 'analysis' | 'orchestrator' | 'triggerGate' { // extend return union
  const { triggerType } = state
  if (triggerType === 'silence_gate') { /* unchanged */ }
  if (triggerType === 'analysis_request') { /* unchanged */ }
  if (triggerType === 'passive_eval') { // NEW — name per D-03 discretion
    console.info('[graph] START → triggerGate (passive_eval trigger, zero-LLM entry)')
    return 'triggerGate'
  }
  if (triggerType === null || triggerType === undefined) { /* unchanged */ }
  console.error('[graph] unrecognized triggerType:', triggerType)
  throw new Error(`[graph] routeFromStart: unrecognized triggerType "${triggerType}"`)
}
```
`createGraph()`'s `addConditionalEdges(START, routeFromStart, {...})` pathsMap (lines 238-242) gains one entry: `triggerGate: 'triggerGate'`.

**routeAfterTriggerGate extension** (current shape, lines 205-212 — this function's existing doc comment at lines 189-204 already documents the CR-02 fix precedent to follow for the new branch):
```typescript
export function routeAfterTriggerGate(
  state: GraphState
): 'facilitation' | 'analysis' | 'argGraphBuilder' | 'end' { // extend return union
  if (state.firingSkillRole === null) return 'end'
  if (state.triggerType === 'passive_eval') return 'argGraphBuilder' // NEW — D-05's fired-case cost allowance
  if (state.firingSkillRole === 'coach') return 'facilitation'
  if (state.firingSkillRole === 'analyst') {
    return state.triggerType === 'analysis_request' ? 'end' : 'analysis'
  }
  return 'end'
}
```
`addConditionalEdges('triggerGate', routeAfterTriggerGate, {...})` pathsMap (lines 281-285) gains: `argGraphBuilder: 'argGraphBuilder'`.

**routeAfterArgGraphBuilder extension** (current shape, lines 185-187):
```typescript
export function routeAfterArgGraphBuilder(
  state: GraphState
): 'analysis' | 'profileBuilder' | 'facilitation' { // extend return union
  if (state.triggerType === 'passive_eval' && state.firingSkillRole !== null) {
    return state.firingSkillRole === 'coach' ? 'facilitation' : 'analysis'
  }
  return state.triggerType === 'analysis_request' ? 'analysis' : 'profileBuilder'
}
```
`addConditionalEdges('argGraphBuilder', routeAfterArgGraphBuilder, {...})` pathsMap (lines 269-272) gains: `facilitation: 'facilitation'`.

**Doc-comment convention:** every routing function in this file carries a substantial header comment explaining WHY each branch exists, citing the CONTEXT.md decision ID and any Pitfall/Finding it guards against (see lines 1-71, 103-112, 137-162, 170-184, 189-204). The new branches must follow this same convention — cite D-05 explicitly in `routeAfterTriggerGate`'s comment, matching the existing CR-02 citation style.

**Termination-safety note to preserve in comments:** `routeAfterMutationGate` (lines 163-168) is UNCHANGED by this phase — its existing `triggerGateComplete === true → 'end'` first-check (line 164) already guarantees the fired `passive_eval` sub-path (which re-enters `mutationGate` via the fixed `analysis → mutationGate` edge, line 293) terminates correctly with zero new loop-guard code, exactly as documented in RESEARCH.md's "Termination proof."

---

### `apps/api/src/lib/skills.ts` (CHANGED — service/registry)

**Analog:** itself (current full contents, lines 1-79).

**Current shape to refactor** (lines 52-79):
```typescript
export interface Skill {
  id: string
  role: 'coach' | 'analyst'
  detect(context: SkillContext): Promise<SkillDetectionResult>
  buildPromptGuidance(context: SkillContext): string
}

export const COACH_SKILLS: Skill[] = [silenceBreakSkill, moderationSkill, driftRedirectSkill]
export const ANALYST_SKILLS: Skill[] = [factCheckSkill, phaseReadinessSkill, orphanEdgeSkill]
```

**Target shape (D-07/D-08 — factory functions, per RESEARCH.md Pattern 3):**
```typescript
import { makeModerationSkill } from './skills/moderation' // CHANGED import

export const COACH_SKILLS: Skill[] = [
  silenceBreakSkill,
  makeModerationSkill('coach'), // was: moderationSkill
  driftRedirectSkill,
]
export const ANALYST_SKILLS: Skill[] = [
  factCheckSkill,
  phaseReadinessSkill,
  orphanEdgeSkill,
  // makeModerationSkill('analyst'), // only if Phase 15's new heuristics need Coach+Analyst reuse
]
```
`SkillContext` interface (lines 37-42) and `Skill` interface (lines 52-57) are UNCHANGED — D-08 explicitly keeps per-Role `Skill` instances with their own `role` field; only the construction call sites in `COACH_SKILLS`/`ANALYST_SKILLS` change shape. Registration-order-is-priority-order convention (doc comment lines 59-61, 65-77) is preserved and must be documented identically for any new Skill added this phase.

---

### `apps/api/src/lib/skills/moderation.ts` (CHANGED — service/heuristic)

**Analog:** itself (current full contents, lines 1-178) — refactor target. Closest sibling-file precedent for the target export shape: `apps/api/src/lib/skills/fact-check.ts` (already exports free `detect`/`buildPromptGuidance` functions plus the `Skill` object literal, lines 143-218).

**Current shape** (lines 99-101, object literal with inline methods):
```typescript
export const moderationSkill: Skill = {
  id: 'moderation',
  role: 'coach',
  async detect(context: SkillContext): Promise<SkillDetectionResult> { /* body, lines 103-136 */ },
  buildPromptGuidance(context: SkillContext): string { /* body, lines 138-176 */ },
}
```

**Target shape (D-08 factory, RESEARCH.md Pattern 3):**
```typescript
// checkModerationHeuristic() (lines 70-97) — UNCHANGED, already a pure standalone function.

async function detectModeration(context: SkillContext): Promise<SkillDetectionResult> {
  /* exact existing body from lines 103-136, unchanged */
}

function buildModerationPromptGuidance(context: SkillContext): string {
  /* exact existing body from lines 138-176, unchanged */
}

export function makeModerationSkill(role: 'coach' | 'analyst'): Skill {
  return {
    id: 'moderation',
    role,
    detect: detectModeration,
    buildPromptGuidance: buildModerationPromptGuidance,
  }
}

// Preserves the existing named export so any other current import site of
// `moderationSkill` (if any) does not need to change:
export const moderationSkill: Skill = makeModerationSkill('coach')
```
`fact-check.ts`'s own export block (lines 210-218) is the closest existing precedent for this exact "free functions + object literal + named exports for direct testing" shape — copy its convention, not moderation.ts's current inline-object shape.

---

### `apps/api/src/lib/skills/fact-check.ts` (CHANGED only if a heuristic needs Coach+Analyst reuse this phase — otherwise reference-only)

**Analog:** itself — already the closest-to-target shape in the codebase (lines 143-218). If a new heuristic needs multi-Role reuse, wrap its existing `detect`/`buildPromptGuidance` free functions (lines 143-208) in a `makeFactCheckSkill(role: 'coach' | 'analyst'): Skill` factory identical in shape to `makeModerationSkill` above, and change `export const factCheckSkill: Skill = { id: 'fact-check', role: 'analyst', detect, buildPromptGuidance }` (lines 210-215) to `export const factCheckSkill: Skill = makeFactCheckSkill('analyst')`. The final export block's testing convention (line 218: `export { detect, buildPromptGuidance, classifyTier2, ClassifyOutputSchema }`) should be preserved for any refactored Skill file — direct-function unit testing without going through the Skill wrapper.

---

### `apps/api/src/lib/bot-arbitrator.ts` (CHANGED, small — service/arbitration primitive)

**Analog:** itself — `ArbContext.firingSkillRole` (lines 24-37, already documented as an "additive extension point... a future Phase 14 TriggerEngine caller can thread a real value in") and `runArbitration` (lines 80-141).

**Current shape** (line 80-88):
```typescript
export async function runArbitration(
  branchId: string,
  blueprint: Blueprint,
  supabase: SupabaseClient
): Promise<string | null> {
  if (_registry.size === 0) return null
  const context: ArbContext = { branchId, blueprint, supabase }
  // ...
```

**Target shape (D-11, mechanical additive signature change — Pitfall 4 in RESEARCH.md):**
```typescript
export async function runArbitration(
  branchId: string,
  blueprint: Blueprint,
  supabase: SupabaseClient,
  firingSkillRole?: 'coach' | 'analyst' | null // NEW optional 4th param — backward-compatible,
                                                 // every EXISTING call site (trigger-engine.ts:281)
                                                 // is unaffected since the param is optional
): Promise<string | null> {
  if (_registry.size === 0) return null
  const context: ArbContext = { branchId, blueprint, supabase, firingSkillRole }
  // ... rest of function body UNCHANGED (lines 90-140)
```
`bot-registration.ts`'s `analystScorer` (lines 48-50) ALREADY reads `context.firingSkillRole === 'analyst' ? 10 : 0` — this file needs NO change; it is the reader this extension point was built for and Phase 15 is simply the first caller to supply a real value.

---

### `apps/api/src/lib/message-evaluation.test.ts` (NEW — test)

**Analog:** `apps/api/src/lib/trigger-engine.test.ts` (lines 1-70+) — mirror its exact `vi.mock` hoisting shape:
```typescript
vi.mock('./blueprint-loader', () => ({ loadBlueprint: vi.fn() }))
vi.mock('./crypto', () => ({ decryptKey: vi.fn().mockReturnValue('sk-test-plaintext-key') }))
vi.mock('./bot-arbitrator', () => ({ runArbitration: vi.fn(), releaseBotLock: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./bot-budget', () => ({ checkBotBudget: vi.fn() }))
vi.mock('./bot-registration', () => ({ registerBots: vi.fn() }))
vi.mock('@langfuse/langchain', () => ({ CallbackHandler: vi.fn().mockImplementation(() => ({})) }))
```
For `trigger-gate.ts`'s own Skill-mocking convention (needed if testing `COACH_SKILLS`/`ANALYST_SKILLS` candidate assembly post-refactor), mirror `trigger-gate.test.ts` lines 22-55 — "Suffix-Mock naming (not prefix)" for `vi.mock` hoisting safety (e.g. `coachSkillADetectMock`, not `mockCoachSkillADetect`).

---

## Shared Patterns

### Fail-silent / fail-open error handling
**Source:** every helper in `apps/api/src/lib/trigger-engine.ts` (e.g. `resolveProviderContext` lines 561-590, `readCooldownUntil` lines 638-651) and `apps/api/src/graph/nodes/trigger-gate.ts` (lines 62-71, fail-open missing-blueprint path).
**Apply to:** `message-evaluation.ts` in full — every early-return path is a plain `return` (never throw), every DB/adapter call wrapped in `try/catch` with a `[module-name]`-prefixed `console.error`.
```typescript
if (!blueprint) {
  console.error('[trigger-gate] blueprint missing from config.configurable — no skill fires')
  return { firingSkillId: null, firingSkillRole: null, skillMeta: null, triggerGateComplete: true, phaseGateProgress: null }
}
```

### `Promise.allSettled` fail-isolation for parallel Skill/scorer evaluation
**Source:** `apps/api/src/graph/nodes/trigger-gate.ts` lines 89-91 (Skills) and `apps/api/src/lib/bot-arbitrator.ts` lines 94-107 (scorers, sequential try/catch per iteration — same isolation principle).
**Apply to:** `TriggerGateNode` is REUSED as-is by the new path (not duplicated) — this pattern only needs to be preserved, not re-implemented, per RESEARCH.md's explicit Anti-Pattern warning against a second parallel Skills-iteration loop.
```typescript
const results = await Promise.allSettled(
  candidateSkills.map(async (skill) => ({ skill, result: await skill.detect(context) })),
)
for (const settled of results) {
  if (settled.status === 'rejected') {
    console.warn('[trigger-gate] skill.detect() threw — skipping', settled.reason)
    continue
  }
  // ...
}
```

### Per-request Langfuse `CallbackHandler` construction (never module-level)
**Source:** `apps/api/src/lib/trigger-engine.ts` lines 304-315.
**Apply to:** `message-evaluation.ts`'s `graph.invoke()` call — new `tags` entry `'trigger:passive-eval'` (or planner's chosen name) alongside the existing `session:`/`branch:` tag convention.
```typescript
const callbackHandler = new CallbackHandler({
  userId: langfuseUserId,
  sessionId: session.id,
  tags: [`session:${session.id}`, `branch:${branch.id}`, 'trigger:passive-eval'],
})
```

### `try { ... } finally { await releaseBotLock(...) }` — MUST wrap any post-arbitration work
**Source:** `apps/api/src/lib/trigger-engine.ts` lines 284-382, `apps/api/src/lib/bot-arbitrator.ts`'s own `releaseBotLock` doc comment (lines 143-153: "MUST be called in a finally block after bot execution completes or fails").
**Apply to:** `message-evaluation.ts`, any code path after a successful `runArbitration()` call that reaches `graph.invoke()`/DB insert.

### Fire-and-forget `.catch()`-only call site (D-01/D-02)
**Source:** `apps/api/src/routes/messages.ts` lines 143-148 (`maybeAutoName`).
**Apply to:** the new `evaluateMessageAsync` call site in the same file, and any other unawaited async side-effect this phase introduces.
```typescript
maybeAutoName(supabase, sessionId).catch((err) =>
  console.error('[messages] maybeAutoName error:', err)
)
```

### Role-activation gate: `bot_overrides ?? bot_defaults ?? false`
**Source:** `apps/api/src/graph/nodes/trigger-gate.ts` lines 75-78, also `apps/api/src/lib/trigger-engine.ts` line 227 (Coach-only variant).
**Apply to:** `message-evaluation.ts`'s early "does anything even need to run" check before doing any DB/LLM work — applies to both Coach and Analyst, generalizing `trigger-engine.ts`'s Coach-only version.
```typescript
const coachEnabled = sessionBotOverrides?.coach ?? blueprint.bot_defaults?.coach ?? false
const analystEnabled = sessionBotOverrides?.analyst ?? blueprint.bot_defaults?.analyst ?? false
```

### `[module-name]` console logging prefix convention
**Source:** every file read in this phase — `[trigger-gate]`, `[trigger-engine]`, `[messages]`, `[bot-arbitrator]`, `[bot-budget]`, `[fact-check]`, `[moderation]`, `[auto-name]`.
**Apply to:** `message-evaluation.ts` → `[message-evaluation]`; any new graph.ts log lines → `[graph]` (already the file's convention, lines 117, 121, 126, 133).

### Sentinel bot-author UUID with no FK constraint
**Source:** `apps/api/src/lib/trigger-engine.ts` lines 98-104 (`COACH_AUTHOR_ID`, `COACH_DISPLAY_NAME`).
**Apply to:** `message-evaluation.ts` needs a new `ANALYST_AUTHOR_ID` sentinel (RESEARCH.md Pitfall 3 / Open Question 2) — mint it in the same style, a fixed UUID, documented with the same Repudiation-threat rationale (`messages.author_id` has no FK to `auth.users`).
```typescript
export const COACH_AUTHOR_ID = '00000000-0000-0000-0000-000000000b01'
const COACH_DISPLAY_NAME = 'Facilitador'
```

## No Analog Found

None — every file this phase touches has a strong, directly-applicable analog already in the codebase (this phase is explicitly framed by RESEARCH.md as "wire existing infrastructure into a new cheap entry point," not "build new detection/cost-guard mechanisms").

## Metadata

**Analog search scope:** `apps/api/src/lib/`, `apps/api/src/lib/skills/`, `apps/api/src/graph/`, `apps/api/src/graph/nodes/`, `apps/api/src/routes/`
**Files read in full:** `graph.ts` (296 lines), `trigger-gate.ts` (130 lines), `skills.ts` (79 lines), `skills/moderation.ts` (178 lines), `skills/fact-check.ts` (218 lines), `trigger-engine.ts` (682 lines), `routes/messages.ts` (214 lines), `lib/auto-name.ts` (148 lines), `lib/bot-arbitrator.ts` (166 lines), `lib/bot-budget.ts` (72 lines), `graph/state.ts` (200 lines), `lib/bot-registration.ts` (71 lines), plus partial reads of `trigger-gate.test.ts` and `trigger-engine.test.ts` for test conventions.
**Pattern extraction date:** 2026-07-20
