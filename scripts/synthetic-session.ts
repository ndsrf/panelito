/**
 * scripts/synthetic-session.ts — 100-turn synthetic-session harness (14-07-PLAN.md Task 1)
 *
 * Purpose (ROADMAP Phase 14 success criteria 2 & 3): drives a synthetic bot thread through
 * ~100 Coach/Analyst invocations against a REAL BYOK provider key and asserts the output
 * discipline the Role node system prompts (facilitation-agent.ts / analytics-agent.ts) claim
 * to enforce:
 *   (a) every Coach output ends with a trailing question mark
 *   (b) every Analyst output cites a specific prior message (heuristic: mentions a known
 *       participant name from the synthetic argGraph it was given as citation material)
 *   (c) no output — Coach or Analyst — contains any `containsSpeechArtifact()` string
 *       (SPEECH-01/02/03), across all 6 trigger types exercised
 *   (d) logs the invocation numbers at which the PERSONA-04 periodic re-anchor fires
 *       (every 15th invocation, per role, per branch — facilitation-agent.ts
 *       REANCHOR_EVERY_N_INVOCATIONS), read back from the authoritative checkpointed
 *       `roleInvocationCounts` state (never a locally-tracked counter — a turn that throws
 *       or returns empty output does NOT increment the real counter, so only the
 *       checkpoint's own value is trustworthy).
 *
 * ---------------------------------------------------------------------------------------
 * COST WARNING (T-14-07a): this script makes REAL LLM API calls against the provider key
 * you configure via environment variable. A full 100-turn run performs roughly 100 Role-node
 * generations PLUS one extra argGraph-extraction call for every Analyst turn (the
 * 'analysis_request' route — the only real graph.invoke() path to AnalyticsAgentNode — runs
 * ArgGraphBuilderNode first), i.e. ~150 total LLM calls at default settings. Budget
 * accordingly. Set SYNTHETIC_SESSION_TURNS to a smaller number for a cheaper smoke run.
 * ---------------------------------------------------------------------------------------
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/synthetic-session.ts
 *   SYNTHETIC_SESSION_PROVIDER=openai OPENAI_API_KEY=sk-... npx tsx scripts/synthetic-session.ts
 *   SYNTHETIC_SESSION_TURNS=20 ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/synthetic-session.ts
 *
 *   (tsx is a devDependency of apps/api, not the workspace root — if a bare `tsx` is not on
 *   your PATH, run via the api package's own binary instead, e.g.:
 *     pnpm --filter @panelito/api exec tsx ../../scripts/synthetic-session.ts
 *   )
 *
 * Without a provider key configured (see resolveProviderKey() below) this script prints a
 * clear diagnostic and exits 0 without making any network call — safe to dry-invoke in CI.
 *
 * ---------------------------------------------------------------------------------------
 * Design notes (why graph.invoke, not a mocked adapter):
 *
 * - Routing (graph.ts routeFromStart): the conditional START edge only recognizes
 *   triggerType 'silence_gate' (→ facilitation/Coach, single hop, mirrors trigger-engine.ts's
 *   own production invocation exactly), 'analysis_request' (→ argGraphBuilder → analysis/
 *   Analyst — the only real START-reachable path to AnalyticsAgentNode), or null (human path,
 *   not used here). Any other triggerType string throws by design (Finding 6) — so this
 *   harness does NOT attempt to fabricate the other four trigger tags as literal
 *   `triggerType` values. Instead it cycles `firingSkillId` (silence-break / moderation /
 *   drift-redirect for Coach; fact-check / phase-readiness / orphan-edge for Analyst — the
 *   exact 6 Skill ids registered in COACH_SKILLS/ANALYST_SKILLS, lib/skills.ts) through each
 *   turn's initial state input. Both Role nodes read `state.firingSkillId` directly to look
 *   up Skill-specific prompt guidance (buildPromptGuidance()) and to tag the Langfuse
 *   `trigger` metadata field — exactly the same lookup a live TriggerGateNode-driven fire
 *   would populate — so each of the 6 trigger types gets its own real LLM call with its own
 *   real guidance text spliced into the system prompt, even though the harness does not
 *   attempt to organically satisfy each Skill's live detect() heuristics (fact-check pattern
 *   matching, moderation tone escalation, etc.) against synthetic content — that
 *   classifier-accuracy question is out of this harness's scope; TIGHT scope here is: "does
 *   the Role node's OUTPUT stay in-contract no matter which trigger guidance it was given."
 *
 * - Citation anchor (state.argGraph, not raw `messages`): AnalyticsAgentNode's citation
 *   contract is fulfilled via `summarizeArgGraph(state.argGraph)` — ArgNode.speaker carries
 *   the real participant name (bot-context.ts) — NOT via free-form speaker-name parsing out
 *   of `ProviderMessage.content` (which has no structured speaker field in production either,
 *   apps/api/src/routes/ai.ts:222). This harness seeds a growing synthetic argGraph with
 *   named participants and checks the Analyst's response for a participant-name mention as
 *   its citation-discipline heuristic.
 *
 * - Single-file constraint (14-07-PLAN.md frontmatter: files_modified is this file only):
 *   all imports below use relative paths into apps/api/src and packages/types/src rather than
 *   the `@panelito/types` / internal package aliases, so this script needs no root-level
 *   package.json / pnpm-lock.yaml change to resolve module specifiers from scripts/ (Node's
 *   resolution algorithm only walks up from the IMPORTING file's own directory — a bare
 *   `@panelito/types` specifier written in this file would require a root-level workspace
 *   dependency declaration that is out of this plan's declared scope).
 *
 * - Checkpointer: `createGraph()` with NO checkpointer argument defaults to an in-process
 *   MemorySaver (graph.ts) — no Postgres/Supabase connection is required to run this harness,
 *   only the provider key. State (roleInvocationCounts, triggerMetadata) persists correctly
 *   across the ~100 sequential invoke() calls because they all share one fixed thread_id for
 *   the lifetime of this process, exactly mirroring how trigger-engine.ts scopes state to
 *   `${branchId}:bot`.
 */

import { randomUUID } from 'node:crypto'
import { createGraph } from '../apps/api/src/graph/graph'
import { REANCHOR_EVERY_N_INVOCATIONS } from '../apps/api/src/graph/nodes/facilitation-agent'
import { COACH_SKILLS, ANALYST_SKILLS } from '../apps/api/src/lib/skills'
import { containsSpeechArtifact } from '../packages/types/src/speech-artifacts'
import type { ProviderName, ProviderMessage } from '../packages/types/src/ai'
import type { ArgNode, ArgEdge } from '../packages/types/src/bot'
import type { Blueprint } from '../packages/types/src/blueprint'

// ---------------------------------------------------------------------------
// Config — env-driven, no hardcoded secrets, no DB/decrypt pipeline (T-14-07a/b)
// ---------------------------------------------------------------------------

const TOTAL_TURNS = Math.max(1, parseInt(process.env.SYNTHETIC_SESSION_TURNS ?? '100', 10) || 100)
const PROVIDER = (process.env.SYNTHETIC_SESSION_PROVIDER ?? 'anthropic') as ProviderName

const ENV_KEY_NAME: Record<ProviderName, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

/** Reads the provider key straight from env — never from the encrypted creator_settings DB
 *  pipeline (decryptKey/KEY_ENCRYPTION_SECRET). This is a standalone, explicit, opt-in spend
 *  (T-14-07a) — it must never silently reuse a creator's stored key. */
function resolveProviderKey(): string | null {
  const keyName = ENV_KEY_NAME[PROVIDER]
  if (!keyName) return null
  const value = process.env[keyName]
  return value && value.trim().length > 0 ? value : null
}

// ---------------------------------------------------------------------------
// Synthetic Blueprint — minimal but schema-valid (packages/types/src/blueprint.ts)
// ---------------------------------------------------------------------------

function buildSyntheticBlueprint(): Blueprint {
  return {
    id: 'synthetic-session-blueprint',
    name: 'Synthetic Session Harness Blueprint',
    canvas_view_mode: 'graph',
    node_types: [
      { id: 'claim', label: 'Claim', color: '#6366f1', description: 'A stated position or assertion.' },
      { id: 'evidence', label: 'Evidence', color: '#22c55e', description: 'Supporting data or example.' },
      { id: 'counterargument', label: 'Counter-argument', color: '#ef4444', description: 'A challenge to a prior claim.' },
      { id: 'question', label: 'Question', color: '#f59e0b', description: 'An open question raised.' },
    ],
    edge_types: [
      { id: 'supports', label: 'SUPPORTS', color: '#22c55e' },
      { id: 'contradicts', label: 'CONTRADICTS', color: '#ef4444' },
    ],
    phase_sequence: [
      {
        id: 'discussion',
        label: 'Discussion',
        llm_instructions: 'Facilitate open discussion of the debate topic.',
        allowed_node_types: ['claim', 'evidence', 'counterargument', 'question'],
        phase_readiness_gate: { min_nodes: 3, min_messages_after: 5 },
      },
    ],
    active_persona_ids: [],
    drift_reply_probability: 0.8,
    drift_detection_enabled: true,
    bot_defaults: { coach: true, analyst: true },
    role_personalities: {},
    silence_phase_readiness_coupling_enabled: false,
  }
}

// ---------------------------------------------------------------------------
// Synthetic participants + claim seed content (Spanish, informal tú — project convention)
// ---------------------------------------------------------------------------

const PARTICIPANTS = ['Ana', 'Miguel', 'Sofía', 'Diego'] as const

const CLAIM_TEMPLATES = [
  'deberíamos priorizar la sostenibilidad sobre el coste inicial',
  'la evidencia de mercado no respalda esa proyección',
  'el equipo necesita más datos antes de decidir',
  'la propuesta de expansión es demasiado arriesgada este trimestre',
  'la satisfacción del cliente ya está mejorando con los cambios actuales',
  'deberíamos posponer el lanzamiento hasta validar con más usuarios',
  'el argumento anterior ignora el riesgo regulatorio',
  'no hay suficiente evidencia para descartar la propuesta',
]

const COACH_SKILL_IDS = COACH_SKILLS.map((s) => s.id)
const ANALYST_SKILL_IDS = ANALYST_SKILLS.map((s) => s.id)

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

interface Results {
  coach: { total: number; questionMarkPass: number; questionMarkFail: number[] }
  analyst: { total: number; citationPass: number; citationFail: number[] }
  artifact: {
    total: number
    clean: number
    violations: Array<{ turn: number; role: string; skillId: string; text: string }>
  }
  reanchorFirings: Array<{ turn: number; role: string; count: number }>
  emptyOutputs: Array<{ turn: number; role: string }>
  errors: Array<{ turn: number; role: string; message: string }>
}

function newResults(): Results {
  return {
    coach: { total: 0, questionMarkPass: 0, questionMarkFail: [] },
    analyst: { total: 0, citationPass: 0, citationFail: [] },
    artifact: { total: 0, clean: 0, violations: [] },
    reanchorFirings: [],
    emptyOutputs: [],
    errors: [],
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const key = resolveProviderKey()
  if (!key) {
    console.log(
      `[synthetic-session] No provider key configured for provider "${PROVIDER}".`
    )
    console.log(
      `[synthetic-session] Set ${ENV_KEY_NAME[PROVIDER]} (or SYNTHETIC_SESSION_PROVIDER=<anthropic|openai|gemini> ` +
      'with the matching *_API_KEY) to run this harness against a real provider.'
    )
    console.log('[synthetic-session] Exiting cleanly — no API calls were made, no budget was consumed.')
    process.exitCode = 0
    return
  }

  console.log(`[synthetic-session] provider=${PROVIDER} turns=${TOTAL_TURNS}`)
  console.log(
    '[synthetic-session] COST WARNING: this run consumes real API budget on the configured key ' +
    '(Analyst turns also trigger one extra argGraph-extraction call — see file header).'
  )

  const blueprint = buildSyntheticBlueprint()
  const branchId = randomUUID()
  const botThreadId = `${branchId}:bot`
  // No checkpointer arg → in-process MemorySaver (graph.ts). No Postgres/Supabase required.
  const graph = createGraph()

  const argNodes: ArgNode[] = []
  const argEdges: ArgEdge[] = []
  let coachInvocations = 0
  let analystInvocations = 0

  const results = newResults()

  for (let turn = 1; turn <= TOTAL_TURNS; turn++) {
    const role: 'coach' | 'analyst' = turn % 2 === 1 ? 'coach' : 'analyst'
    const skillIds = role === 'coach' ? COACH_SKILL_IDS : ANALYST_SKILL_IDS
    const roleTurnIndex = role === 'coach' ? ++coachInvocations : ++analystInvocations
    const skillId = skillIds[(roleTurnIndex - 1) % skillIds.length] ?? null

    // Seed one new synthetic ArgNode (citation anchor material) + a connecting edge.
    const speaker = PARTICIPANTS[turn % PARTICIPANTS.length]
    const claim = CLAIM_TEMPLATES[turn % CLAIM_TEMPLATES.length]
    const newNode: ArgNode = {
      id: randomUUID(),
      type: 'claim',
      label: `${speaker} afirmó: ${claim}`,
      branch_id: branchId,
      message_id: randomUUID(),
      speaker,
    }
    argNodes.push(newNode)
    const previousNode = argNodes[argNodes.length - 2]
    if (previousNode) {
      const newEdge: ArgEdge = {
        id: randomUUID(),
        source_id: previousNode.id,
        target_id: newNode.id,
        relation: turn % 3 === 0 ? 'CONTRADICTS' : 'SUPPORTS',
      }
      argEdges.push(newEdge)
    }

    const newMessage: ProviderMessage = {
      role: 'user',
      content: `${speaker}: ${claim}.`,
    }

    let accumulated = ''
    const streamWriter = (text: string): void => {
      accumulated += text
    }

    try {
      await graph.invoke(
        {
          triggerType: role === 'coach' ? 'silence_gate' : 'analysis_request',
          messages: [newMessage],
          blueprintId: blueprint.id,
          currentPhaseId: blueprint.phase_sequence[0]?.id ?? 'discussion',
          // Overwrite-style channel — pass the FULL current graph each turn, capped so the
          // prompt doesn't grow unbounded across ~100 turns (mirrors summarizeArgGraph's own
          // consumer-side truncation intent, not a production behavior being tested here).
          argGraph: { nodes: argNodes.slice(-30), edges: argEdges.slice(-30) },
          firingSkillId: skillId,
        },
        {
          configurable: {
            thread_id: botThreadId,
            blueprint,
            providerName: PROVIDER,
            plaintextKey: key,
            streamWriter,
            branchId,
          },
        }
      )
    } catch (err) {
      const message = (err as Error).message
      results.errors.push({ turn, role, message })
      console.error(`[synthetic-session] turn ${turn} (${role}/${skillId}) threw:`, message)
      continue
    }

    if (accumulated.trim().length === 0) {
      results.emptyOutputs.push({ turn, role })
      console.warn(`[synthetic-session] turn ${turn} (${role}/${skillId}) produced empty output — skipping assertions`)
      continue
    }

    // (c) SPEECH-01/02/03 — no artifact string, across every trigger type exercised.
    results.artifact.total++
    if (containsSpeechArtifact(accumulated)) {
      results.artifact.violations.push({ turn, role, skillId: skillId ?? 'unknown', text: accumulated })
      console.error(`[synthetic-session] ARTIFACT VIOLATION turn ${turn} (${role}/${skillId}):`, accumulated)
    } else {
      results.artifact.clean++
    }

    if (role === 'coach') {
      results.coach.total++
      if (accumulated.trim().endsWith('?')) {
        results.coach.questionMarkPass++
      } else {
        results.coach.questionMarkFail.push(turn)
      }
    } else {
      results.analyst.total++
      const cited = PARTICIPANTS.some((p) => accumulated.includes(p))
      if (cited) {
        results.analyst.citationPass++
      } else {
        results.analyst.citationFail.push(turn)
      }
    }

    // (d) PERSONA-04 re-anchor cadence — read the AUTHORITATIVE checkpointed count (a turn
    // that throws or returns empty output above never increments the real counter, so a
    // locally-tracked counter here would drift from the truth trigger-engine.ts itself reads).
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snapshot: any = await graph.getState({ configurable: { thread_id: botThreadId } })
      const persistedCount = snapshot?.values?.roleInvocationCounts?.[role] as number | undefined
      if (persistedCount && persistedCount % REANCHOR_EVERY_N_INVOCATIONS === 0) {
        results.reanchorFirings.push({ turn, role, count: persistedCount })
        console.log(`[synthetic-session] re-anchor fired for ${role} at invocation #${persistedCount} (turn ${turn})`)
      }
    } catch (err) {
      console.warn('[synthetic-session] getState failed for re-anchor check (non-fatal)', (err as Error).message)
    }
  }

  printSummary(results)
}

function printSummary(results: Results): void {
  const coachPass = results.coach.questionMarkFail.length === 0 && results.coach.total > 0
  const analystPass = results.analyst.citationFail.length === 0 && results.analyst.total > 0
  const artifactPass = results.artifact.violations.length === 0 && results.artifact.total > 0

  console.log('')
  console.log('========================================================================')
  console.log('[synthetic-session] SUMMARY')
  console.log('========================================================================')
  console.log(
    `(a) Coach trailing "?" discipline: ${coachPass ? 'PASS' : 'FAIL'} ` +
    `(${results.coach.questionMarkPass}/${results.coach.total} passed)`
  )
  if (results.coach.questionMarkFail.length > 0) {
    console.log(`    Failing turns: ${results.coach.questionMarkFail.join(', ')}`)
  }

  console.log(
    `(b) Analyst citation discipline: ${analystPass ? 'PASS' : 'FAIL'} ` +
    `(${results.analyst.citationPass}/${results.analyst.total} passed)`
  )
  if (results.analyst.citationFail.length > 0) {
    console.log(`    Failing turns: ${results.analyst.citationFail.join(', ')}`)
  }

  console.log(
    `(c) No speech-artifact strings (all 6 trigger types): ${artifactPass ? 'PASS' : 'FAIL'} ` +
    `(${results.artifact.clean}/${results.artifact.total} clean)`
  )
  if (results.artifact.violations.length > 0) {
    for (const v of results.artifact.violations) {
      console.log(`    Turn ${v.turn} (${v.role}/${v.skillId}): "${v.text}"`)
    }
  }

  console.log(
    `(d) Re-anchor firings observed (every ${REANCHOR_EVERY_N_INVOCATIONS}th invocation, per role): ` +
    `${results.reanchorFirings.length}`
  )
  for (const f of results.reanchorFirings) {
    console.log(`    ${f.role} invocation #${f.count} (turn ${f.turn}) — cross-check against Langfuse traces`)
  }

  if (results.emptyOutputs.length > 0) {
    console.log(`Empty outputs (excluded from assertions): ${results.emptyOutputs.length}`)
    for (const e of results.emptyOutputs) {
      console.log(`    Turn ${e.turn} (${e.role})`)
    }
  }

  if (results.errors.length > 0) {
    console.log(`Errors (excluded from assertions): ${results.errors.length}`)
    for (const e of results.errors) {
      console.log(`    Turn ${e.turn} (${e.role}): ${e.message}`)
    }
  }

  console.log('========================================================================')
  const overallPass = coachPass && analystPass && artifactPass
  console.log(`[synthetic-session] OVERALL: ${overallPass ? 'PASS' : 'FAIL'}`)
  console.log('========================================================================')

  process.exitCode = overallPass ? 0 : 1
}

main().catch((err) => {
  console.error('[synthetic-session] fatal error:', err)
  process.exitCode = 1
})
