# Pitfalls Research: Project Multiverse

**Domain:** Real-time collaborative AI workspace with conversation branching
**Research date:** 2026-06-08

---

## Critical Pitfalls

### P1 — Mobile Layout Collapse on Keyboard Open
**Warning signs:** Panel shrinks when keyboard opens; layout breaks on iOS Safari  
**What happens:** Using `100vh` or `height: 100%` on the outer container causes the entire layout to recompress when the iOS/Android virtual keyboard appears. The analytics panel gets crushed.  
**Prevention:**
- Lock `--app-height` from `window.innerHeight` on mount (before keyboard ever appears)
- Bind `window.visualViewport.onresize` to update `--keyboard-height`
- Set `position: fixed; inset: 0` on app shell
- Never use `100dvh` as a replacement — it changes dynamically and causes repaints  
**Phase:** Phase 1 (layout foundation)

---

### P2 — Branch Context Bleeding in AI Calls
**Warning signs:** AI in Branch B references content from Branch A; merged synthesis includes wrong context  
**What happens:** If you naively pass all session messages to Claude, it sees content from sibling branches. The "multiverse" collapses into one timeline.  
**Prevention:**
- Always traverse the path tree client-side before building the AI context window
- Pass only messages where `path_id` is a prefix of or equal to the active branch path
- Never pass raw `session_id`-scoped messages to AI
- Enforce this in the backend streaming endpoint — client should NOT control what context gets sent  
**Phase:** Phase 2 (branching engine)

---

### P3 — Canvas Snapshot State Explosion
**Warning signs:** DB row sizes growing to MB; queries slowing down; Supabase row limit warnings  
**What happens:** Storing full widget state JSON in every message row bloats the database fast when sessions have hundreds of messages.  
**Prevention:**
- Store only a delta/diff snapshot, not full state, when the canvas doesn't change between messages
- Use a `NULL` snapshot to mean "same as previous message in this branch"
- Rebuild full state by forward-traversal only when needed  
**Phase:** Phase 2 (time-travel UI)

---

### P4 — Supabase Realtime Fan-out Latency Under Load
**Warning signs:** Message delivery feels laggy with 10+ concurrent users; some users miss messages  
**What happens:** Supabase Realtime uses Postgres logical replication. Under write-heavy workloads with many concurrent sessions, replication lag can cause perceived latency.  
**Prevention:**
- Use `broadcast` channel type (not `postgres_changes`) for chat messages — bypasses replication lag
- Use `postgres_changes` only for session metadata updates (status, branch list)
- Keep chat messages lightweight in the real-time payload; full content fetched from DB on demand  
**Phase:** Phase 1 (real-time foundation)

---

### P5 — Claude Tool Use Schema Validation Mismatches
**Warning signs:** Panel randomly goes blank; React hydration errors; JSON parse errors in logs  
**What happens:** Claude occasionally emits tool calls that don't match your expected schema. If you pass this directly to React state, the component crashes.  
**Prevention:**
- Validate every `ui_mutation_block` against Zod schema before touching React state
- On validation failure: log to console, preserve last known panel state, continue streaming text
- Test with intentionally malformed Claude responses in unit tests
- Use TypeScript discriminated unions for widget types so TypeScript catches mismatches at build time  
**Phase:** Phase 1 (AI integration)

---

### P6 — Intersection Observer Scroll-Spy Firing on Initial Load
**Warning signs:** Panel flickers to wrong state on page load; initial panel state is wrong  
**What happens:** When the chat component mounts, IntersectionObserver fires for every visible message simultaneously before the user has scrolled anywhere.  
**Prevention:**
- Initialize the panel from the latest message's snapshot, not from Intersection Observer
- Only activate the scroll-spy observer after the initial scroll position is set to bottom
- Add a 100ms debounce on observer callbacks during initial mount  
**Phase:** Phase 3 (time-travel UI)

---

### P7 — "Fork All the Things" UX Problem
**Warning signs:** Sessions end up with 15+ branches; users can't find their branch; panel feels chaotic  
**What happens:** Unlimited branching without visual hierarchy becomes overwhelming. The "multiverse" becomes incomprehensible.  
**Prevention:**
- Limit active open branches to a configurable max (default: 5 per session)
- Color coding is essential — pre-define a distinct palette of 5-6 branch colors
- The branch navigator must show a visual tree, not just a flat list
- Consider "archive" functionality for dormant branches rather than hard deletion  
**Phase:** Phase 2 (branching UX)

---

### P8 — Session Creator API Key Leaking to Guests
**Warning signs:** Network tab shows API key in request headers; guests can intercept key  
**What happens:** If the Claude API call is made client-side or the key is passed through to the browser, any guest can steal the creator's API key.  
**Prevention:**
- ALL Claude API calls must be made server-side (Hono backend only)
- Creator stores API key in Supabase user metadata (encrypted at rest)
- Backend fetches key from Supabase on behalf of the creator; never sends key to frontend
- Never log full API keys — log only first 6 characters for debugging  
**Phase:** Phase 1 (auth + AI integration)

---

## Quick Reference

| Pitfall | Severity | Phase to Address |
|---------|----------|-----------------|
| Mobile layout collapse | Critical | Phase 1 |
| Branch context bleeding | Critical | Phase 2 |
| API key exposure | Critical | Phase 1 |
| Canvas snapshot bloat | High | Phase 2 |
| Realtime fan-out latency | High | Phase 1 |
| Claude schema mismatches | High | Phase 1 |
| Scroll-spy initial fire | Medium | Phase 3 |
| Fork explosion UX | Medium | Phase 2 |
