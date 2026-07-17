---
phase: 13-user-profiles-phase-signal
plan: 06
subsystem: api
tags: [langgraph, supabase, profile-builder, gap-closure, cr-01]

# Dependency graph
requires:
  - phase: 13-user-profiles-phase-signal (plan 03)
    provides: profileBuilderNode (original per-speaker-label grouping + upsert loop)
provides:
  - profileBuilderNode refactored to group/merge argGraph nodes by RESOLVED author_id (not the freeform speaker label) before upserting
  - Regression test pinning the same-author speaker-label collision (CR-01)
affects: [phase-13-code-review, phase-13-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Resolve-then-merge: group untrusted freeform identity strings first, resolve each group to a trusted key, THEN union groups sharing that trusted key, before any write to a full-replace store."

key-files:
  created: []
  modified:
    - apps/api/src/graph/nodes/profile-builder.ts
    - apps/api/src/graph/nodes/profile-builder.test.ts

key-decisions:
  - "CR-01 fixed application-side only (merge-before-upsert in profileBuilderNode). No SQL/migration change: the existing upsert_participant_profile RPC (migration 0016, full-replace ON CONFLICT ... DO UPDATE) is respected because each resolved author_id is now upserted exactly once per invocation with the complete union of every speaker-label group that resolved to it. No migration 0017, no supabase db push, no schema-push task was needed."
  - "WR-05 collapsed as a side effect: messages_sent/reactions_used COUNT queries now run once per resolved author_id, not once per raw speaker label."

requirements-completed: [PROFILE-01]

# Metrics
duration: 12min
completed: 2026-07-17
---

# Phase 13 Plan 06: CR-01 Profile Merge Summary

**Fixed profileBuilderNode's data-loss bug where two speaker labels (e.g. "Miguel"/"miguel") resolving to the same author_id caused the second full-replace upsert to silently discard the first group's positions/assertions — now resolves identity first and unions all groups sharing an author_id before a single upsert per author, entirely application-side with zero schema changes.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-17T11:03:00Z (approx, first test run)
- **Completed:** 2026-07-17T11:04:30Z (approx, last verification)
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- Added a regression test (`profile-builder.test.ts`) that reproduces the CR-01 collision: two ArgNodes with distinct speaker labels and distinct message_ids that both resolve to `author_id: 'author-a'` — confirmed RED against the original code (rpc called twice, union not present).
- Refactored `profileBuilderNode` to a two-phase resolve-then-merge algorithm: Phase 1 groups by speaker label (existing `groupBySpeaker`), resolves each group's `author_id` via the messages lookup (role='user' filter preserved — Pitfall 1 AI-attribution skip unchanged), and unions all groups resolving to the same `author_id` into a `byAuthor: Map<string, ArgNode[]>`. Phase 2 issues exactly one `upsertParticipantProfile` call per resolved author, with positions/assertions computed from the union and capped at `MAX_ITEMS` (20) most-recent AFTER union.
- Confirmed the fix GREEN: all 8 profile-builder tests (7 pre-existing + 1 new collision regression) pass; no topology regression in `graph.test.ts`/`graph.integration.test.ts` (22 passed, 2 skipped); `tsc --noEmit` exits 0; no new migration file added (`supabase/migrations/` unchanged at 16 files).
- WR-05 (redundant per-speaker-label COUNT queries) collapsed for free: `countMessagesSent`/`countReactionsUsed` now run once per resolved author_id instead of once per raw speaker label.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add failing regression test for same-author speaker-label collision** - `c0d6cf2` (test)
2. **Task 2: Refactor profileBuilderNode to group/merge by resolved author_id (CR-01 + WR-05)** - `b1784fe` (fix)

_TDD RED/GREEN cycle: c0d6cf2 (RED, test-only) -> b1784fe (GREEN, implementation)._

## Files Created/Modified
- `apps/api/src/graph/nodes/profile-builder.ts` - Replaced the per-speaker-label upsert loop (lines ~150-185) with a two-phase `byAuthor` resolve-then-merge algorithm; `groupBySpeaker` retained as the Phase 1 pre-grouping step; `resolveAuthorId`/`countMessagesSent`/`countReactionsUsed` signatures unchanged.
- `apps/api/src/graph/nodes/profile-builder.test.ts` - Added `upserts a single merged profile row when two speaker labels resolve to the same author_id` regression test.

## Decisions Made
- **CR-01 fix locus: application-side merge-before-upsert, no SQL change.** The `upsert_participant_profile` RPC's full-replace `ON CONFLICT (branch_id, participant_id) DO UPDATE SET positions = EXCLUDED.positions, assertions = EXCLUDED.assertions` (migration 0016, unchanged) remains correct because `profileBuilderNode` now guarantees exactly one upsert per resolved author per invocation, containing that author's complete union of positions/assertions across every speaker label that cited them. Cross-invocation full-replace also remains correct: each turn, `profileBuilderNode` re-derives the complete per-author set from the accumulated `state.argGraph`, so the next invocation's single upsert still supersedes the prior one entirely (no partial-state drift). No migration 0017, no `supabase db push`, no schema-push task was required — matching the plan's `schema_push_required: false` frontmatter flag.
- **WR-05 collapse taken as a natural consequence of the CR-01 fix**, not a separate change: since COUNT queries are now issued from the Phase 2 `byAuthor` loop (keyed by resolved author, not raw speaker label), the redundant per-label COUNT calls the plan flagged as WR-05 are eliminated without any additional code.

## Deviations from Plan

None - plan executed exactly as written. The Phase 1 per-group `resolveAuthorId` call is intentionally left outside a try/catch (matching the plan's action text, which only specifies wrapping "the per-author body" in Phase 2's existing try/catch) — an I/O error in Phase 1 propagates to the outer whole-node try/catch, which still logs and returns `{}`, preserving the pre-existing "a thrown I/O error inside the loop is caught — the node still returns `{}`" test's guarantee (verified: all 8 tests pass, including that one).

## Issues Encountered
- This worktree had no `node_modules` installed (git worktrees don't carry gitignored dependency trees). Ran `pnpm install --frozen-lockfile` at the repo root before running any tests — resolved instantly from the shared pnpm content-addressable store (no lockfile changes, no new packages). Not a plan deviation; purely local environment setup, consistent with prior phase 13 plans' documented worktree environment notes (see `deferred-items.md` item 3).
- `pnpm test -- profile-builder` (the plan's literal verify command) does not actually filter to matching test files in this repo's vitest/pnpm setup (`pnpm test -- <pattern>` passes `<pattern>` as a literal extra arg after vitest's own `--`, not as a file filter) — ran the full suite instead. Used `pnpm exec vitest run profile-builder` (and `pnpm exec vitest run graph.integration graph.test`) directly to get the intended filtered runs; this is how the RED/GREEN transition and the topology-regression check were actually verified. Documenting for future plans in this phase: prefer `pnpm exec vitest run <pattern>` over `pnpm test -- <pattern>` in this repo.
- Running the unfiltered full suite (`pnpm exec vitest run` with no filter) surfaces 5 pre-existing `silence-scan.test.ts` failures unrelated to this plan's files — already documented in `deferred-items.md` item 1 (confirmed pre-existing during 13-01 execution, reproduced independently of any 13-01/13-06 diff). Not touched here; out of scope per the executor's scope-boundary rule.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CR-01 (Critical, code review) closed: Truth 1 (PROFILE-01) restored — two speaker labels resolving to the same author_id within one invocation now produce a single merged profile row retaining both groups' positions/assertions.
- WR-05 (redundant per-group COUNT queries) closed as a side effect.
- No blockers. Ready for the next gap-closure plan (13-07, WR-04) or `/gsd:transition` once all phase 13 gap-closure plans complete.

---
*Phase: 13-user-profiles-phase-signal*
*Completed: 2026-07-17*

## Self-Check: PASSED

- FOUND: apps/api/src/graph/nodes/profile-builder.ts
- FOUND: apps/api/src/graph/nodes/profile-builder.test.ts
- FOUND: .planning/phases/13-user-profiles-phase-signal/13-06-SUMMARY.md
- FOUND: commit c0d6cf2 (test)
- FOUND: commit b1784fe (fix)
