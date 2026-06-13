---
phase: 02-ai-analytics
plan: 02
subsystem: api
tags: [hono, sse, streaming, anthropic, supabase, zod, reactions, ai-streaming]

# Dependency graph
requires:
  - phase: 02-ai-analytics
    plan: 01
    provides: AnthropicAdapter + renderPanelTool (ai-provider.ts), compressHistory (anthropic.ts), reactions table + active_personas column (migration 0005)

provides:
  - Real streamSSE invoke route — POST /api/sessions/:id/invoke streaming text_delta + panel_update SSE events
  - Reactions CRUD route — POST /api/sessions/:id/reactions with dedup upsert and triggersAI flag
  - reactionsRouter registered in index.ts under /sessions/:id/reactions

affects:
  - 02-03 (panel-widgets: consumes panel_update SSE events from this invoke route)
  - 02-04 (reactions-frontend: calls POST /reactions, reads triggersAI to open invoke stream)
  - 02-05 (personas: active_personas already gated server-side; toggle route enables/disables AI)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "streamSSE(c, async (stream) => { for await (event of provider.stream(...)) }): Hono SSE streaming pattern"
    - "for await loop over AsyncIterable<AIStreamEvent> — AnthropicAdapter bridges SDK callbacks to AsyncIterable"
    - "Canvas snapshot collected in lastPanelUpdate variable; inserted after stream completes (not during)"
    - "upsert with onConflict + ignoreDuplicates: true — deduplication at DB level for reactions"
    - "triggersAI = ['fire','pin','target'].includes(emoji) — computed in route, never at DB level"

key-files:
  created:
    - apps/api/src/routes/reactions.ts
  modified:
    - apps/api/src/routes/ai.ts
    - apps/api/src/index.ts

key-decisions:
  - "incrementCount called AFTER stream iterator completes — not on typing_hold path, not during streaming (T-02-07)"
  - "AI message insert happens inside streamSSE callback after for-await loop, before done SSE event"
  - "compressHistory failure is non-fatal — log error and proceed without historical summary"
  - "PERSONA-02 gate: return 409 no_active_persona when active_personas is empty, blocking AI call"
  - "AI rows attributed to session.creator_id (not the requesting user) to support guest-initiated streams"

patterns-established:
  - "Canvas snapshot collected in lastPanelUpdate; assigned in tool_use branch; inserted post-stream (PANEL-04)"
  - "triggersAI boolean returned in reactions POST — client decides whether to open /invoke stream"
  - "Reactions upsert ignoreDuplicates: true — silent no-op on repeat emoji tap, not an error"

requirements-completed: [AI-03, AI-04, AI-06, AI-07, AI-08, PANEL-04, REACT-01, REACT-02, REACT-03, REACT-04]

# Metrics
duration: 4min
completed: 2026-06-14
---

# Phase 2 Plan 02: AI Streaming Route + Reactions CRUD Summary

**Hono streamSSE invoke route calling AnthropicAdapter with branch-isolated context, typing-hold gate, and post-stream message persistence (canvas_snapshot_state); plus reactions upsert route with fire/pin/target AI-trigger flag**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-13T22:11:38Z
- **Completed:** 2026-06-13T22:15:46Z
- **Tasks:** 2 (both auto)
- **Files modified:** 3

## Accomplishments

- Replaced 501 scaffold in ai.ts with real streamSSE route: anyoneTyping gate (429), persona resolution, key decrypt, branch-isolated message context (path_id='main'), compressHistory for older messages, AnthropicAdapter streaming with text_delta + panel_update SSE events, post-stream message insert with canvas_snapshot_state, cap increment after completion
- Created reactions.ts: requireAuth + reactionRateLimit (60/min), PostReactionBodySchema (UUID + 4-emoji enum), upsert with onConflict dedup, triggersAI=true for fire/pin/target, false for brain
- Registered reactionsRouter in index.ts under /sessions/:id/reactions

## Task Commits

1. **Task 1: Reactions route POST /api/sessions/:id/reactions** - `0eaa269` (feat)
2. **Task 2: Real SSE invoke route — streaming, branch context, bot-activation, snapshot persist** - `8b64797` (feat)

## Files Created/Modified

- `apps/api/src/routes/reactions.ts` — Hono router: upsert reactions with dedup, compute triggersAI, requireAuth + rateLimit
- `apps/api/src/routes/ai.ts` — Replaced 501 stub with real streamSSE route: persona gate, key decrypt, branch-isolated context, AnthropicAdapter stream loop, post-stream insert
- `apps/api/src/index.ts` — Added reactionsRouter import + app.route() registration

## Decisions Made

- `incrementCount` is called AFTER the `for await` loop exits (after `done` event) — never on the typing_hold path and never mid-stream, satisfying T-02-07.
- The AI message insert happens inside the `streamSSE` callback after the iterator completes, before the final `done` SSE event. This ensures canvas_snapshot_state is always written even if the insert takes time.
- `compressHistory` failure is handled non-fatally: log and proceed with empty historical summary rather than aborting the whole invoke.
- PERSONA-02 server gate: if `active_personas` is empty after matching against PERSONA_LIBRARY, return 409 `no_active_persona` before any Claude call.
- AI message rows use `author_id = session.creator_id` (not the requesting user) — this is correct because the AI speaks on behalf of the session's analysis context, not an individual participant.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- `pnpm typecheck` failed initially due to missing `node_modules` in the worktree (worktrees don't inherit node_modules from the main checkout). Fixed by running `pnpm install --frozen-lockfile` in the worktree root; resolved in ~2 seconds from cache.
- Pre-existing TypeScript errors in `messages.test.ts` and `sessions.test.ts` (TS18046 `unknown` type issues) are unchanged from Phase 1. Documented in Phase 1 summary as out-of-scope. Confirmed no new errors introduced by this plan.

## User Setup Required

None — all changes are server-side route implementations using existing infra.

## Next Phase Readiness

- `POST /api/sessions/:id/invoke` streams `text_delta` + `panel_update` SSE events — ready for frontend SSE consumer hook (Plan 02-03)
- `POST /api/sessions/:id/reactions` returns `triggersAI` — ready for frontend reaction popover wiring (Plan 02-04)
- Branch isolation (`path_id='main'`) and cap protection are enforced server-side

## Threat Surface Scan

All threats in the plan's threat register are fully mitigated:

| Threat | Mitigation | Location |
|--------|------------|----------|
| T-02-05: Elevation of Privilege | 403 on creator_id !== user.id; 409 on no_active_persona | ai.ts lines 67-80, 97-100 |
| T-02-06: Key leakage via SSE | Key used only inside AnthropicAdapter constructor; never written to SSE events | ai.ts: plaintextKey never reaches writeSSE |
| T-02-07: Reaction spam → AI cost | checkCap 429 before every invoke; reactionRateLimit 60/min; incrementCount only after completed stream | ai.ts + reactions.ts |
| T-02-08: path_id leakage | .eq('path_id', 'main') on both recent and older message queries | ai.ts lines 141, 153 |
| T-02-09: Reaction INSERT as another user | RLS WITH CHECK (auth.uid() = author_id) from migration 0005 | DB-level; no code change needed |

No new threat surface introduced beyond what the plan's threat register covers.

---

## Self-Check: PASSED

Files verified:
- apps/api/src/routes/reactions.ts — FOUND
- apps/api/src/routes/ai.ts — FOUND (streamSSE, path_id, renderPanelTool, typing_hold, canvas_snapshot_state)
- apps/api/src/index.ts — FOUND (reactionsRouter registered)

Commits verified:
- 0eaa269 feat(02-02): add reactions route — FOUND
- 8b64797 feat(02-02): replace 501 stub with real streamSSE invoke route — FOUND

*Phase: 02-ai-analytics*
*Completed: 2026-06-14*
