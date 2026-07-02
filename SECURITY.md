# SECURITY.md — Phase 02-ai-analytics

**Audit date:** 2026-06-23
**ASVS Level:** L1
**Phase plans audited:** 02-01 through 02-06
**Total threats registered:** 26 (21 mitigate, 5 accept)
**Threats closed:** 24 / 26
**Threats open (BLOCKER):** 1 (T-02-05)
**Unregistered flags:** 1 (vitest package addition in plan 01)

---

## OPEN THREATS — BLOCKER

### T-02-05 — Elevation of Privilege: client self-authorizing AI calls

**Declared mitigation:** Server gates invoke on `creator_id === user.id` → else 403 AND `active_personas` non-empty.

**Finding:** The `active_personas` non-empty gate IS implemented and returns 409 (`no_active_persona`). The `active_personas` half is CLOSED.

**However, the creator_id === user.id 403 check is ABSENT from the implementation.**

- File searched: `/home/jgm/dev/projects/web-projects/panelito/apps/api/src/routes/ai.ts`
- File searched: `/home/jgm/dev/projects/web-projects/panelito-sessions-list/apps/api/src/routes/ai.ts`
- The comment on line 16 declares the gate: `T-02-05: Session ownership gate (creator_id === user.id → else 403)`
- The route fetches `creator_id` in the session select (line 76) — but no `if (session.creator_id !== user.id)` comparison with a 403 response is present anywhere in the file.
- The route uses `createServiceClient()` (service role), which bypasses all Postgres RLS policies — there is no compensating database-level control.

**Impact:** Any authenticated user (including a guest with a valid anon token) who knows or guesses a session UUID can invoke the AI against that session, burning the session creator's stored API key. A guest can force AI responses, consume the cap, and incur API costs against another user's key.

**Status:** OPEN — BLOCKER. Phase must not ship until a `if (session.creator_id !== user.id) return c.json({ error: 'forbidden' }, 403)` check is inserted immediately after the session fetch in `ai.ts`.

---

## CLOSED THREATS

| Threat ID | Category | Disposition | Evidence |
|-----------|----------|-------------|----------|
| T-02-01 | Spoofing | mitigate | `supabase/migrations/0005_reactions_personas.sql` line 60: `with check (auth.uid() = author_id)` |
| T-02-02 | Tampering | mitigate | `supabase/migrations/0005_reactions_personas.sql` line 28: `check (emoji in ('🧠', '🔥', '📌', '🎯'))` |
| T-02-03 | DoS | mitigate | `supabase/migrations/0005_reactions_personas.sql` line 30: `unique (message_id, author_id, emoji)` |
| T-02-04 | Tampering | mitigate | `packages/types/src/panel.ts` line 34: `PanelWidgetSchema = z.discriminatedUnion(...)`. `apps/api/src/routes/ai.ts` line 257: `PanelWidgetSchema.safeParse(event.input)` server-side before SSE. `apps/web/hooks/use-ai-stream.ts` line 79: client-side `handlePanelUpdate` also calls `PanelWidgetSchema.safeParse` |
| T-02-SC-01 | Tampering | mitigate | No production packages added in plan 01. `vitest@^2.1.9` added as devDependency only to `packages/types/package.json` — not bundled into production output. See Unregistered Flags section |
| T-02-05 (active_personas half) | EoP | mitigate | `apps/api/src/routes/ai.ts` lines 111-116: `matchedPersonas.length === 0` returns 409 `no_active_persona` (CLOSED — this half only) |
| T-02-06 | Info Disclosure | mitigate | `apps/api/src/routes/ai.ts` lines 147-158: `plaintextKey` is passed only to `createAdapter(providerName, plaintextKey)`. All `stream.writeSSE` calls emit only `{ text }`, `parsed.data` (schema-validated widget), `{}`, or `{ message: 'stream_failed' }`. Key string never appears in any SSE write |
| T-02-07 | DoS | mitigate | `apps/api/src/routes/ai.ts` line 87: `checkCap` before every invoke; line 103: `anyoneTyping` returns 429 before any Claude call; line 299: `incrementCount` called only after stream completes. `apps/api/src/routes/reactions.ts` lines 59-63: `reactionRateLimit` at 60/min/user applied to POST handler |
| T-02-08 | Tampering | mitigate | `apps/api/src/routes/ai.ts` lines 168, 182: both recent and older message queries have `.eq('path_id', 'main')` |
| T-02-09 | Spoofing | mitigate | `supabase/migrations/0005_reactions_personas.sql` line 60: `with check (auth.uid() = author_id)` — same RLS policy as T-02-01. `apps/api/src/routes/reactions.ts` line 91: `author_id: user.id` (server sets from authed user, not client body) |
| T-02-SC-02 | Tampering | accept | No new packages in plan 02 commits (`0eaa269`, `8b64797`). Git show confirms only `apps/api/src/routes/reactions.ts`, `apps/api/src/routes/ai.ts`, `apps/api/src/index.ts` modified. No `package.json` or `pnpm-lock.yaml` changes |
| T-02-10 | Tampering | mitigate | `apps/web/hooks/use-ai-stream.ts` lines 78-85: `handlePanelUpdate` calls `PanelWidgetSchema.safeParse(raw)`; on failure logs warn and returns without calling `setWidget` |
| T-02-11 | DoS | mitigate | `apps/web/hooks/use-ai-stream.ts` lines 159-170: buffer split on `\n\n`; lines 182-188: `JSON.parse` for `text_delta` in try/catch; lines 192-196: `JSON.parse` for `panel_update` in try/catch — bad events skipped, not fatal |
| T-02-12 | Spoofing | mitigate | `apps/web/hooks/use-typing-presence.ts` lines 69-70 and 86-89: both `setTyping` and `setAIStreaming` call `track()` with full merged payload `{ typing, displayName, ai_streaming }` |
| T-02-SC-03 | Tampering | accept | No new packages in plan 03 commits (`f210dbe`, `3c1f6a3`, `a340340`). Git show confirms no `package.json` or `pnpm-lock.yaml` changes |
| T-02-13 | DoS | mitigate | `apps/web/components/workspace/AnalyticsPanel.tsx` lines 247-249: `AnalyticsPanel` renders `WidgetZone` wrapped in `AnalyticsPanelErrorBoundary`. `WidgetZone` (line 145) is where `widgetRegistry.get` and Recharts components render |
| T-02-14 | Tampering | accept | Accepted risk: `PanelWidgetSchema` enforces array bounds (bento max 6, radar 3-8, scatter max 20, pie 2-8). Remaining visual edge cases within those bounds are non-crashing inside the error boundary. Rationale is sound |
| T-02-SC-04 | Tampering | accept | No new packages in plan 04 commits (`de4ed43`, `ec13db9`). Git show confirms no `package.json` or `pnpm-lock.yaml` changes |
| T-02-15 | DoS | mitigate | `apps/api/src/routes/reactions.ts` lines 59-63: `reactionRateLimit` 60/min/user. `apps/api/src/routes/ai.ts` line 87: `checkCap` before invoke. `supabase/migrations/0005_reactions_personas.sql` line 30: UNIQUE constraint prevents DB row inflation |
| T-02-16 | Spoofing | mitigate | `supabase/migrations/0005_reactions_personas.sql` line 60: RLS WITH CHECK. `apps/api/src/routes/reactions.ts` line 91: `author_id: user.id` set server-side from auth context |
| T-02-17 | Tampering | mitigate | `apps/web/hooks/use-reactions.ts` lines 196-220: `revert()` restores `snapshotRef.current` on POST failure (silent, no toast). Lines 226-241: `ingest()` dedupes own-echo via `ownPendingRef` Set |
| T-02-SC-05 | Tampering | accept | No new packages in plan 05 commits (`5e63bc5`, `da5309b`). Git show confirms no `package.json` or `pnpm-lock.yaml` changes |
| T-02-18 | EoP | mitigate | `apps/api/src/routes/personas.ts` lines 43-44: `if (session.creator_id !== user.id)` returns 403 `forbidden` |
| T-02-19 | Tampering | mitigate | `apps/api/src/routes/personas.ts` lines 6, 9: `import { PERSONA_IDS }` and `z.enum(PERSONA_IDS)` in `PostPersonaBodySchema` |
| T-02-20 | Spoofing | mitigate | `apps/api/src/routes/ai.ts` lines 111-116: `active_personas` gate enforced at invoke time regardless of client toggle state. `apps/api/src/routes/personas.ts` line 43: failed toggle (non-creator) reverts at server |
| T-02-SC-06 | Tampering | mitigate | `apps/web/components/ui/switch.tsx` and `scroll-area.tsx` both import from `radix-ui` package (the official shadcn registry source). No third-party registries used |

---

## Unregistered Flags

| Flag | Source | Description | Assessment |
|------|--------|-------------|------------|
| vitest added as devDependency in plan 01 | `02-01-SUMMARY.md` deviation section | T-02-SC-01 declares "no new packages" but `vitest@^2.1.9` was added to `packages/types/package.json` as a devDependency. This is a documentation mismatch — the mitigation claim was inaccurate. | Low risk: `vitest` is a well-known, widely-audited test framework (Vite ecosystem). It ships only in devDependencies and is excluded from production bundles. No production security impact. Recommend updating T-02-SC-01 disposition to reflect the actual state. |

---

## Accepted Risks Log

| Threat ID | Rationale |
|-----------|-----------|
| T-02-SC-02 | No new npm packages installed in plan 02 — verified by git history |
| T-02-SC-03 | No new npm packages installed in plan 03 — verified by git history |
| T-02-SC-04 | No new npm packages installed in plan 04 — verified by git history |
| T-02-SC-05 | No new npm packages installed in plan 05 — verified by git history |
| T-02-14 | PanelWidgetSchema array bounds cap element counts; remaining visual edge cases are non-crashing inside `AnalyticsPanelErrorBoundary` |

---

## Required Fix Before Ship

**File:** `apps/api/src/routes/ai.ts`

Insert immediately after the session-not-found check (after line 82):

```typescript
if (session.creator_id !== user.id) {
  return c.json({ error: 'forbidden' }, 403)
}
```

This must be applied in both:
- `/home/jgm/dev/projects/web-projects/panelito/apps/api/src/routes/ai.ts`
- `/home/jgm/dev/projects/web-projects/panelito-sessions-list/apps/api/src/routes/ai.ts`
