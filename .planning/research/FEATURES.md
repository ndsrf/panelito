# Features Research: Project Multiverse

**Domain:** Real-time collaborative AI workspace with conversation branching
**Research date:** 2026-06-08

---

## Table Stakes (Must Have — Users Leave Without These)

### Session Management
- Instant guest entry: QR code → display name → live session (< 30 seconds)
- Session state persistence: reconnect without losing context
- Session creator controls: freeze, close, kick
- Mobile-optimized: sessions used on phones at dinner tables, in meeting rooms

### Chat Interface
- Real-time message delivery (< 200ms perceived latency)
- Message authorship (display names + color coding per user)
- Scroll-to-latest + scroll-to-history without jarring jumps
- AI response streaming (token-by-token, not bulk delivery)

### AI Integration
- AI responds in context of the active conversation branch
- Structured AI output: text to chat, data to panel (separate channels)
- Error recovery: AI failure should not crash the panel

### Analytics Panel
- Panel stays stable during chat scrolling (no layout reflow)
- Panel updates are animated, not jarring flips
- Panel reflects the active branch, not the main timeline

---

## Differentiators (Competitive Advantage)

### Branching Engine
- Fork from any historical message (not just the latest)
- Color-coded parallel tracks visible simultaneously
- Branch isolation: AI context never bleeds between branches
- Branch navigator: timeline view of all open branches

### Time-Travel UI
- Scroll-spy: chat scroll position → panel renders historical state at that moment
- Anchor jump: click panel widget → jump to the message that created it
- `canvas_snapshot_state` embedded per message for instant client-side recall

### Multi-Agent Persona Orchestra
- Multiple AI personalities in the same session (Analyst, Devil's Advocate)
- Each persona has distinct tone and analytical lens
- Personas can contradict each other — productive tension by design

### Power Reactions
- Reactions are AI instructions (🔥 = attack this, 📌 = pin to panel, 🎯 = simplify)
- Reactions work on both human messages and AI responses
- 🧠 Insight marks content for session summary extraction

### Branch Merge (Admin)
- Admin can synthesize two branches into a new unified timeline
- AI performs the synthesis, not a simple concatenation

---

## Anti-Features (Deliberately NOT Building)

| Feature | Why NOT |
|---------|---------|
| Persistent user profiles/social graph | Complexity + privacy; ephemeral sessions are the model |
| In-session private DMs | Would fragment the group consciousness; all chat is shared |
| Video/audio | Bandwidth, complexity; this is a text+visual tool |
| Export to Notion/Confluence natively | Nice-to-have v2; v1 exports markdown |
| AI that edits existing messages | Historical immutability is a core invariant |
| Branch "locking" by admin | Over-control; the creative chaos is the point |

---

## Feature Complexity Notes

| Feature | Complexity | Dependencies |
|---------|-----------|--------------|
| 40/60 split with IME lock | High | Visual Viewport API, CSS custom properties |
| Branching engine (adjacency list) | High | DB schema design must be right from the start |
| Time-travel scroll-spy | High | Intersection Observer + `canvas_snapshot_state` per message |
| Branch merge via AI synthesis | High | Multi-turn context assembly for Claude |
| Multi-agent personas | Medium | System prompt management, persona routing |
| Power reactions | Medium | Optimistic updates + AI instruction dispatch |
| QR code onboarding | Low | `qrcode` library + Supabase anon auth |
| Session freeze/close | Low | Simple status field in session table |
