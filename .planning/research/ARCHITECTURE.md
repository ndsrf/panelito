# Architecture Research: Project Multiverse

**Domain:** Real-time collaborative AI workspace with conversation branching
**Research date:** 2026-06-08

---

## Component Map

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser Client (Next.js + React)                                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ [TOP_CANVAS] — Analytics Panel (40%, flex-shrink:0)      │   │
│  │   ├── WidgetRenderer (selects Radar/Bento/Scatter/Pie)   │   │
│  │   ├── AnchorIcon (per widget → scroll jump)              │   │
│  │   └── BranchColorBadge                                   │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ [CHAT_STREAM] — Chat Feed (60%, absorbs keyboard)        │   │
│  │   ├── MessageList (virtual scroll, Intersection Observer)│   │
│  │   ├── BranchNavigator (timeline selector)                │   │
│  │   ├── ReactionBar (🧠🔥📌🎯)                             │   │
│  │   └── InputBox (position:absolute, viewport-anchored)    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  State: Zustand                                                  │
│   ├── sessionStore (session metadata, guest list)                │
│   ├── branchStore (active path_id, branch tree)                  │
│   ├── canvasStore (current widget state, snapshot recall)        │
│   └── reactionStore (optimistic local state)                     │
└─────────────────────────────────────────────────────────────────┘
                │                           │
         Supabase Realtime              Hono API Server
         (pub/sub channels)             (Node.js / Railway)
                │                           │
┌───────────────┴───────────┐   ┌───────────┴─────────────────┐
│ Supabase Postgres          │   │ Claude Streaming Endpoint    │
│                            │   │                              │
│  sessions                  │   │  POST /api/ai/stream         │
│  messages (adj. list tree) │   │   └── SSE response:          │
│  canvas_snapshots          │   │       ├── event: text_delta  │
│  branches                  │   │       └── event: ui_mutation │
│  reactions                 │   │                              │
│  guest_profiles            │   │  Tool: update_canvas_panel   │
│  session_members           │   │  Tool: pin_to_panel          │
└────────────────────────────┘   └──────────────────────────────┘
```

---

## Data Model — Adjacency List Tree

```sql
-- Core message tree
CREATE TABLE messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES sessions(id),
  parent_id   UUID REFERENCES messages(id),  -- NULL = root message
  path_id     TEXT NOT NULL,                 -- e.g. "main", "main.fork-a", "main.fork-a.fork-b"
  author_id   UUID,                          -- NULL = AI message
  persona_id  TEXT,                          -- "analyst" | "devil_advocate" | NULL
  content     TEXT NOT NULL,
  canvas_snapshot_state JSONB,              -- panel state at time of message
  reactions   JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Branch metadata
CREATE TABLE branches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES sessions(id),
  path_id     TEXT NOT NULL UNIQUE,
  parent_path_id TEXT,
  label       TEXT,
  color       TEXT,
  fork_message_id UUID REFERENCES messages(id),
  created_by  UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions
CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  UUID NOT NULL,
  title       TEXT,
  status      TEXT DEFAULT 'active',   -- active | frozen | finalized
  mode        TEXT DEFAULT 'strategy', -- strategy | debate | redteam
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  frozen_at   TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ
);
```

---

## Data Flow: Message → Panel Update

```
User types message
       │
       ▼
Supabase INSERT (messages table)
       │
       ├──► Supabase Realtime broadcast to all session members
       │         └── Each client: append to MessageList
       │
       └──► Hono API: POST /api/ai/stream
                │
                ▼
         Claude API (streaming)
                │
         ┌──────┴─────────┐
         │                │
    text_delta      tool_use: update_canvas_panel
         │                │
    chat bubble     validate JSON schema
                          │
                    ┌─────┴──────┐
                    │ VALID      │ INVALID
                    ▼            ▼
              update canvas  block + log
              + save snapshot  (last state preserved)
```

---

## Time-Travel Implementation

```
Intersection Observer
  monitors: MessageList children
  threshold: 0.5 (message occupies center viewport)

  onIntersect(messageEl):
    snapshot = messageEl.dataset.canvasSnapshot
    if snapshot:
      canvasStore.setFromSnapshot(JSON.parse(snapshot))
    
    // Anchor jump (reverse direction)
  
  anchorIcon.onClick(widgetId):
    messageId = canvasStore.getLastModifiedBy(widgetId)
    MessageList.scrollTo(messageId)
```

---

## Branch Path Traversal

```typescript
// Client-side: derive ordered message list for active branch
function getActiveBranchMessages(
  allMessages: Message[],
  activePath: string
): Message[] {
  // Build index
  const byId = new Map(allMessages.map(m => [m.id, m]));
  
  // Filter: keep messages whose path_id is a prefix of activePath
  // "main" matches "main", "main.fork-a", "main.fork-a.fork-b"
  return allMessages
    .filter(m => activePath.startsWith(m.path_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
```

---

## Mobile Layout Architecture

```css
/* Lock height on mount via JS: */
/* document.documentElement.style.setProperty('--app-height', window.innerHeight + 'px') */

.app-shell {
  height: var(--app-height);
  overflow: hidden;
  position: fixed;
  inset: 0;
}

.top-canvas {
  height: calc(var(--app-height) * 0.4);
  flex-shrink: 0;
  overflow: hidden;
}

.chat-stream {
  height: calc((var(--app-height) * 0.6) - var(--keyboard-height, 0px));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.input-box {
  position: absolute;
  bottom: calc(var(--keyboard-height, 0px));
  left: 0;
  right: 0;
}
```

---

## Build Order Implications

1. **DB schema + Supabase setup** — everything else depends on this
2. **Auth + session creation + QR onboarding** — needed before any multi-user testing
3. **Real-time chat (flat, single branch)** — validate Supabase Realtime integration
4. **40/60 split layout + IME handling** — must be rock-solid before adding complexity
5. **Claude integration (dual-stream)** — add AI after base chat works
6. **Analytics panel + widget rendering** — add after AI stream is stable
7. **Branching engine** — add after all above is working on main timeline
8. **Power reactions** — overlay on top of working messages
9. **Time-travel (scroll-spy + anchors)** — requires all prior pieces
10. **Branch merge** — complex synthesis operation, last to add
