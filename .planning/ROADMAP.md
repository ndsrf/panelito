# Roadmap: Project Multiverse

**Total phases:** 3
**Requirements covered:** 46 / 46 ✓
**Structure:** Vertical MVP — each phase delivers a demoable user capability

---

## Phase Overview

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|-----------------|
| 1 | Live Session Shell | Working multi-user session with real-time chat and mobile layout | LAYOUT-01–06, SESS-01–09, CHAT-01–06, AI-01–02 | 5 criteria |
| 2 | AI + Analytics | Full split-screen: Claude responds, panel renders widgets, reactions work | AI-03–08, PANEL-01–04, REACT-01–05, PERSONA-01–03 | 5 criteria |
| 3 | The Multiverse | Conversation branching — fork, navigate, isolate, switch timelines | BRANCH-01–06, AI-09 | 5 criteria |

---

### Phase 1: Live Session Shell

**Goal:** A fully working multi-user session — creator can authenticate, create a session, share a QR code, and have guests join and chat in real time on a mobile-resilient 40/60 layout. No AI yet; the analytics panel renders as a placeholder. This phase can be demoed to real users.

**Mode:** mvp

**Requirements:**
- LAYOUT-01, LAYOUT-02, LAYOUT-03, LAYOUT-04, LAYOUT-05, LAYOUT-06
- SESS-01, SESS-02, SESS-03, SESS-04, SESS-05, SESS-06, SESS-07, SESS-08, SESS-09
- CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06
- AI-01, AI-02 (key storage and server-side routing only — no active AI calls)

**Success Criteria:**
1. A session creator can sign in via OAuth, create a session, and view a live QR code that guests can scan to enter with only a display name
2. 3+ guests can send and receive messages simultaneously with < 200ms perceived delivery; typing indicators appear correctly
3. The 40/60 layout holds its proportions when the virtual keyboard opens on iOS Safari and Android Chrome — the analytics panel does not compress
4. The Branch Navigator sticky bar renders between panel and chat with the correct structural position; creator can freeze and manually close a session
5. Auto-freeze triggers after 15 minutes of creator inactivity; API key encrypted and never visible in network requests; blank-titled sessions auto-update their room name after 3 messages via flash model

---

### Phase 2: AI + Analytics

**Goal:** The full split-screen experience — Claude streams into the chat when invoked, the analytics panel renders the appropriate widget type (bento, radar, scatter, or pie), power reactions trigger AI instructions, and the Analyst persona is labeled on each response. The product now feels like "Project Multiverse."

**Mode:** mvp

**Requirements:**
- AI-03, AI-04, AI-05, AI-06, AI-07, AI-08
- PANEL-01, PANEL-02, PANEL-03, PANEL-04
- REACT-01, REACT-02, REACT-03, REACT-04, REACT-05
- PERSONA-01, PERSONA-02, PERSONA-03

**Success Criteria:**
1. The AI streams a response only when a participant uses `@analista` or applies 🔥📌🎯 reactions — it does not auto-respond to every message; response is withheld if a human is currently typing
2. The AI selects and renders the correct widget type for the conversation content (e.g. multi-axis topic → radar chart; key points → bento grid); widget is visible and well-formatted
3. A deliberately malformed AI panel payload is silently blocked and the last stable panel state is preserved without crashing the UI or breaking the chat stream
4. All 4 power reactions (🧠🔥📌🎯) produce the correct AI behavior; reactions apply optimistically on the local client
5. Each AI message is clearly labeled with "Analista Científico" persona badge; creator can toggle the persona off mid-session and the AI stops responding

---

### Phase 3: The Multiverse

**Goal:** Conversation branching — any participant can fork from any historical message to create a parallel timeline, navigate between branches via the Branch Navigator, and the AI context is fully isolated per branch. Switching branches instantly re-renders the analytics panel. The product's core differentiator is now complete.

**Mode:** mvp

**Requirements:**
- BRANCH-01, BRANCH-02, BRANCH-03, BRANCH-04, BRANCH-05, BRANCH-06
- AI-09 (Branch Auto-Labeling — flash model names each new branch automatically)

**Success Criteria:**
1. A participant can long-press any historical message and fork from it; within 200ms a flash model call returns a 2–3 word semantic label that automatically names the branch — no user input required for naming
2. Two parallel branches can each accumulate independent AI conversations; a Claude call in Branch B never contains any content from Branch A (verified by inspecting server-side context assembly)
3. Switching between branches in the Navigator instantly re-renders the analytics panel to the latest snapshot of the selected branch and updates the bar's gradient to the new branch color
4. Creating a 6th branch displays a clear, non-crashing error message; the 5-branch limit is enforced server-side, not just client-side
5. A full end-to-end multiverse session works: 2 branches created, AI invoked in each, panels diverge correctly, switching back and forth shows correct isolated states

---

## Milestone: v1 Complete

All 44 v1 requirements delivered. The product can be used in a real group session: multi-user chat, live AI analytics panel, conversation branching, power reactions, and mobile-resilient layout.

**Next milestone:** v2 — Time-travel UI, Devil's Advocate persona, branch merge synthesis, session export.

---
*Roadmap created: 2026-06-08*
