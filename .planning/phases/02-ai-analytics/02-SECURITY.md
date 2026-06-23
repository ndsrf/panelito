---
phase: 02
slug: ai-analytics
status: verified
threats_open: 0
asvs_level: L1
created: 2026-06-24
---

# Phase 02 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| client → reactions table | Guest/creator-supplied reaction INSERTs cross into Postgres | emoji value, author identity |
| AI tool output → PanelWidgetSchema | Untrusted model JSON crosses into client React state | structured widget payload |
| client → /invoke | Untrusted POST body (userMessage, anyoneTyping) crosses into AI invocation | user message text, session context |
| client → /reactions | Untrusted reaction payload crosses into Postgres + AI trigger decision | emoji, message ref |
| Anthropic key → server memory | Plaintext key decrypted server-side for the Claude call | secret credential |
| invoke SSE stream → client state | Untrusted streamed JSON (panel_update) crosses into React/panel state | widget data, text stream |
| presence channel → all clients | ai_streaming broadcast controls input lock for every participant | presence metadata |
| panelStore data → Recharts | Schema-valid-but-unexpected data could crash a chart component | chart data arrays |
| client reaction tap → /reactions | Untrusted reaction payload + AI-trigger request | emoji, rate limit scope |
| client toggle → /personas | Untrusted persona-toggle request crosses into session config gating AI | persona ID |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-02-01 | Spoofing | reactions INSERT | mitigate | RLS WITH CHECK (auth.uid() = author_id) — `0005_reactions_personas.sql:60` | closed |
| T-02-02 | Tampering | reaction emoji value | mitigate | CHECK constraint emoji IN ('🧠','🔥','📌','🎯') — `0005_reactions_personas.sql:28` | closed |
| T-02-03 | Denial of Service | duplicate reaction spam | mitigate | UNIQUE(message_id, author_id, emoji) — `0005_reactions_personas.sql:30` | closed |
| T-02-04 | Tampering | AI panel payload corruption | mitigate | PanelWidgetSchema.safeParse() server-side (`ai.ts:257`) + client-side (`use-ai-stream.ts:79`) | closed |
| T-02-SC-01 | Tampering | package installs (plan 01) | mitigate | No production packages added; vitest devDep only — excluded from bundles | closed |
| T-02-05 | Elevation of Privilege | client self-authorizing AI calls | accept | By design — see Accepted Risks Log. auto-freeze + checkCap + reactionRateLimit bound cost exposure | closed |
| T-02-06 | Information Disclosure | API key leaking via SSE | mitigate | Key decrypted server-side only; never written to SSE event or response body (`ai.ts:158`) | closed |
| T-02-07 | Denial of Service | reaction-spam → runaway AI cost | mitigate | checkCap() before invoke (`ai.ts:87`); 429 on anyoneTyping (`ai.ts:103`); reactionRateLimit 60/min (`reactions.ts:59-63`) | closed |
| T-02-08 | Tampering | path_id leakage across branches | mitigate | Both message queries enforce `.eq('path_id', 'main')` (`ai.ts:168,182`) | closed |
| T-02-09 | Spoofing | reaction INSERT as another user | mitigate | RLS WITH CHECK (auth.uid() = author_id); server sets author_id from authed user (`reactions.ts:91`) | closed |
| T-02-SC-02 | Tampering | package installs (plan 02) | accept | No new packages — verified via git; no package.json/lockfile changes in plan 02 commits | closed |
| T-02-10 | Tampering | panel_update payload corrupts UI | mitigate | PanelWidgetSchema.safeParse() gate in use-ai-stream.ts:78-85 before any panelStore update | closed |
| T-02-11 | Denial of Service | malformed SSE chunks crash consumer | mitigate | Buffer split on \n\n with remainder retention; JSON.parse wrapped in try/catch (`use-ai-stream.ts:167-196`) | closed |
| T-02-12 | Spoofing | presence payload clobbers typing indicator | mitigate | track() always sends merged payload {typing, displayName, ai_streaming} (`use-typing-presence.ts:69-70,86-89`) | closed |
| T-02-SC-03 | Tampering | package installs (plan 03) | accept | No new packages — verified via git; no package.json/lockfile changes in plan 03 commits | closed |
| T-02-13 | Denial of Service | Recharts crash on edge data | mitigate | WidgetZone wrapped in AnalyticsPanelErrorBoundary (`AnalyticsPanel.tsx:247-249`) | closed |
| T-02-14 | Tampering | oversized/looping widget data | accept | PanelWidgetSchema array bounds cap element counts; remaining edge cases are non-crashing inside error boundary | closed |
| T-02-SC-04 | Tampering | package installs (plan 04) | accept | No new packages — verified via git; no package.json/lockfile changes in plan 04 commits | closed |
| T-02-15 | Denial of Service | reaction-spam drives AI cost | mitigate | reactionRateLimit 60/min (`reactions.ts:59-63`); checkCap before invoke (`ai.ts:87`); UNIQUE constraint (`0005_reactions_personas.sql:30`) | closed |
| T-02-16 | Spoofing | reactions as another user | mitigate | RLS WITH CHECK (auth.uid() = author_id); server-side author_id assignment (`reactions.ts:91`) | closed |
| T-02-17 | Tampering | optimistic count drift | mitigate | revert() restores snapshot on POST failure (`use-reactions.ts:196-220`); ingest() dedupes own-echo (`use-reactions.ts:226-241`) | closed |
| T-02-SC-05 | Tampering | package installs (plan 05) | accept | No new packages — verified via git; no package.json/lockfile changes in plan 05 commits | closed |
| T-02-18 | Elevation of Privilege | guest toggling personas | mitigate | personas.ts:43-44 — `if (session.creator_id !== user.id) return c.json({ error: 'forbidden' }, 403)` | closed |
| T-02-19 | Tampering | invalid persona id in toggle body | mitigate | Zod z.enum(PERSONA_IDS) in PostPersonaBodySchema (`personas.ts:6,9`) | closed |
| T-02-20 | Spoofing | optimistic toggle desync hides AI-off | mitigate | active_personas gate at invoke time regardless of client state (`ai.ts:111-116`) | closed |
| T-02-SC-06 | Tampering | shadcn switch/scroll-area install | mitigate | Added from official shadcn registry (radix-ui source confirmed in generated component files) | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-02-01 | T-02-05 | Guests in a session are explicitly authorized to invoke AI by the creator's act of inviting them. The `/invoke` route intentionally does not gate on creator_id. Session auto-freeze prevents ongoing use after creator departs. checkCap (cost cap) and reactionRateLimit (60/min) bound total cost exposure. | jgarciamagna (product decision) | 2026-06-24 |
| AR-02-02 | T-02-14 | Oversized/looping widget data that passes schema bounds is non-crashing inside AnalyticsPanelErrorBoundary. Array bounds in PanelWidgetSchema cap element counts at the schema level; remaining visual edge cases are low-value and isolated to the widget zone. | plan author | 2026-06-24 |
| AR-02-03 | T-02-SC-02 | No new production packages installed in plan 02. All dependencies pre-installed and slopcheck-approved per RESEARCH Package Legitimacy Audit. | plan author | 2026-06-24 |
| AR-02-04 | T-02-SC-03 | No new production packages installed in plan 03. framer-motion/zustand/zod already installed and slopcheck-approved. | plan author | 2026-06-24 |
| AR-02-05 | T-02-SC-04 | No new production packages installed in plan 04. recharts/framer-motion already installed and slopcheck-approved. | plan author | 2026-06-24 |
| AR-02-06 | T-02-SC-05 | No new production packages installed in plan 05. All dependencies pre-installed and slopcheck-approved. | plan author | 2026-06-24 |

*Accepted risks do not resurface in future audit runs.*

---

## Audit Notes

**T-02-SC-01 documentation correction:** T-02-SC-01 in 02-01-PLAN.md states "no new packages installed." In reality, `vitest@^2.1.9` was added to `packages/types/package.json` as a devDependency. This has no production security impact (devDependencies are excluded from bundles), but the plan documentation should be updated to reflect reality.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-24 | 26 | 26 | 0 | gsd-security-auditor (agent a403c557f340e8572) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-24
