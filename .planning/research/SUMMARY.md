# Research Summary: Project Multiverse

**Synthesized:** 2026-06-08

---

## Stack

**Frontend:** Next.js 15 + React 19 + TypeScript + Zustand + Recharts + Framer Motion + shadcn/ui  
**Backend:** Hono (Node.js) on Railway — handles all Claude API calls server-side  
**Database/Realtime:** Supabase Postgres + Supabase Realtime (broadcast channels for chat)  
**AI:** Anthropic Claude claude-sonnet-4-6 with tool use for dual-channel output (text + UI mutations)  
**Charts:** Recharts covers radar, scatter, bento grid (custom), pie chart natively

Key constraint: creator API key **must never touch the browser** — backend-only Claude calls.

---

## Table Stakes

- Sub-200ms chat delivery via Supabase broadcast (not postgres_changes)
- IME-proof 40/60 layout using `--app-height` + Visual Viewport API — non-negotiable from day one
- Guest entry < 30 seconds: QR → display name → live
- AI stream separates text (chat) from JSON mutations (panel) — validated by Zod before React renders

---

## Watch Out For

1. **Mobile layout collapse** — `100vh` on iOS breaks the panel. Use `window.innerHeight` → CSS custom property on mount. This must be solved in Phase 1 or it poisons every demo.
2. **Branch context bleeding** — AI must only receive messages on the active path. Enforce in backend, not client. A bug here breaks the entire "multiverse" concept.
3. **API key exposure** — all Claude calls server-side. Creator key stored encrypted in Supabase user metadata.
4. **Canvas snapshot bloat** — store NULL for unchanged snapshots; only write delta when panel mutates.
5. **Scroll-spy initial fire** — initialize panel from latest message's snapshot, enable observer only after first scroll to bottom.

---

## Architecture Decisions That Must Be Right From The Start

| Decision | Impact If Wrong |
|----------|----------------|
| Adjacency list tree (`parent_id` + `path_id`) | Branching is impossible to retrofit; schema is the foundation |
| Supabase broadcast for chat realtime | Switching post-launch is a full rewrite of the sync layer |
| Server-side Claude calls only | API key exposure is permanent damage |
| `canvas_snapshot_state` per message | Time-travel UI cannot exist without it; add later = DB migration on live data |

---

## Build Order

1. DB schema + Supabase setup (adjacency list, branches, sessions)
2. Auth + session creation + QR guest onboarding
3. Real-time multi-user flat chat (single branch, Supabase broadcast)
4. 40/60 split layout + IME handling (lock this before adding any complexity)
5. Claude integration (dual-stream: text + tool use for panel mutations)
6. Analytics panel + widget rendering (Recharts components + snapshot state)
7. Branching engine (fork, branch navigator, path traversal)
8. Power reactions (optimistic updates + AI instruction dispatch)
9. Time-travel UI (scroll-spy + anchor jump)
10. Branch merge synthesis
