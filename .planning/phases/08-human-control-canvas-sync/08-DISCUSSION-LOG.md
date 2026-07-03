# Phase 8: Human Control + Canvas Sync - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-03
**Phase:** 08-human-control-canvas-sync
**Areas discussed:** Mic lock storage, Mic release mechanism, phase_signal delivery, Canvas broadcast scope

---

## Mic lock storage

| Option | Description | Selected |
|--------|-------------|----------|
| sessions table columns | Add mic_holder_id + mic_acquired_at to sessions table. Atomic UPDATE; expiry check as WHERE condition. | |
| Separate mic_tokens table | New table (session_id, branch_id, holder_id, acquired_at). Cleaner for branch-scoped lock. | |
| You decide | Claude picks storage based on Phase 5 schema and migration minimization. | ✓ |

**User's choice:** "I don't mind, whatever you decide. The mic is only needed for bots, right? We don't want multiple bots talking at the same time."
**Notes:** User clarified the mic lock's purpose: preventing concurrent bot (AI) invocations on the same branch, not human turn-taking. Fully delegated to Claude's discretion with the constraint that it be branch-scoped.

---

## Mic acquire timing

| Option | Description | Selected |
|--------|-------------|----------|
| At /invoke time (Recommended) | Lock acquired atomically at start of /invoke. No separate acquire endpoint. 30s timeout = server-side expiry check on lock age. | ✓ |
| At typing start (two-step) | Separate mic_acquire endpoint called when user starts typing. /invoke verifies caller holds lock. | |

**User's choice:** At /invoke time (Recommended)
**Notes:** Simplest path — one request, one lock. 30-second typing timeout becomes server-side expiry.

---

## Mic broadcast payload

| Option | Description | Selected |
|--------|-------------|----------|
| mic_acquired + mic_released on session channel | Payload: { branch_id } for acquired; { branch_id, reason } for released. | ✓ |
| You decide | Claude picks event name and payload shape. | |

**User's choice:** mic_acquired + mic_released on the session channel
**Notes:** mic_released payload includes reason: 'completed' | 'expired' | 'client_released' so frontend can differentiate normal completion from timeout.

---

## Mic release mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Orphaned locks only | 30s expiry = safety net for crashed Vercel functions. Server checks age on acquire, steals if expired. | |
| Slow LLM + client timeout | Client holds 30s timer; if no response, calls mic_release endpoint. | |
| Both (Recommended) | Server-side expiry check on acquire AND finally block always releases. | ✓ |

**User's choice:** Both
**Notes:** Server finally block handles normal completion; server-side expiry (steal if > 30s old) handles orphaned locks from crashes. No dedicated client-side release endpoint required.

---

## phase_signal delivery

| Option | Description | Selected |
|--------|-------------|----------|
| New SSE event type (Recommended) | 'phase_signal' event emitted before 'done' event. Frontend listens for this type and shows affordance. | ✓ |
| Extend 'done' event payload | done event becomes { phase_signal: true | false }. One less event type. | |

**User's choice:** New SSE event type (Recommended)
**Notes:** Clean separation — same stream, same lifetime as the AI response.

---

## Human phase advancement endpoint

| Option | Description | Selected |
|--------|-------------|----------|
| PATCH /sessions/:id/phase (Recommended) | New route. Validates creator ownership, validates next_phase_id in Blueprint sequence, writes current_phase. | ✓ |
| Extend existing sessions PATCH | Add phase advancement to existing PATCH endpoint. | |

**User's choice:** PATCH /sessions/:id/phase (Recommended)
**Notes:** Explicit ownership gate (creator only). Returns 400 if next_phase_id not in Blueprint sequence.

---

## Phase advanced Realtime broadcast

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — httpSend 'phase_advanced' on session channel | After DB write, broadcast { new_phase_id, blueprint_id }. All clients update in real time. | ✓ |
| No — rely on next /invoke | DB write is enough; next bot invocation picks up new current_phase. | |

**User's choice:** Yes — httpSend 'phase_advanced' on session channel
**Notes:** All participants see phase transition in real time without waiting for next bot message.

---

## Canvas persistence scope

| Option | Description | Selected |
|--------|-------------|----------|
| Committed only (Recommended) | Only status='committed' ops upserted. Ghost nodes ephemeral, discarded on reconnect. CANVAS-03 aligned. | ✓ |
| Committed + ghost | Both statuses persisted. Ghost nodes in DB until dismissed. Phase 9 reads them from DB. | |

**User's choice:** Committed only (Recommended)
**Notes:** Matches CANVAS-03 requirement ("ghost nodes that were pending are discarded on reconnect"). Phase 9 handles ghost nodes from a different source (Realtime, not DB fetch).

---

## Canvas broadcast payload

| Option | Description | Selected |
|--------|-------------|----------|
| Full DB rows (Recommended) | httpSend('canvas_update', { nodes: CanvasNode[], edges: CanvasEdge[] }). Full rows from .select(). | ✓ |
| Compact CanvasOp list | httpSend('canvas_update', { ops: CanvasOp[] }). Compact but requires Phase 9 to do more work. | |

**User's choice:** Full DB rows (Recommended)
**Notes:** Matches new_message pattern (broadcasts full row). Phase 9 can directly merge without re-fetch.

---

## Canvas UUID generation

| Option | Description | Selected |
|--------|-------------|----------|
| Server generates UUIDs before upsert | Stable UUID available in broadcast payload. Phase 9 uses as React key. | ✓ |
| Database generates UUIDs (gen_random_uuid() default) | INSERT without id, get UUID from .select() return. Matches messages pattern. | |

**User's choice:** Server (route) generates UUIDs before upsert
**Notes:** Server-generated UUID allows the same stable ID to appear in the Realtime broadcast payload immediately.

---

## Claude's Discretion

- Exact mic lock storage mechanism (branches table columns vs separate mic_tokens table), with branch-scoped constraint
- Error code and response shape when /invoke is blocked by an active mic lock
- Whether to use Postgres function (like increment_ai_count) or conditional UPDATE for atomic mic acquisition
- Exact canvasMutationTool schema extension for phase_signal (field position, optional vs required)
- Position of canvas upsert within post-stream cleanup sequence (relative to cap increment and Langfuse flush)

## Deferred Ideas

- Ghost node persistence to DB (Phase 9 decision — CANVAS-03 confirmed they're ephemeral)
- Human canvas editing (UI-04, v2.1)
- Branch fork canvas carry-over (CANVAS-05, v2.1)
