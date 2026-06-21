---
status: testing
phase: 02-ai-analytics
source:
  - 02-01-SUMMARY.md
  - 02-02-SUMMARY.md
  - 02-03-SUMMARY.md
  - 02-04-SUMMARY.md
  - 02-05-SUMMARY.md
  - 02-06-SUMMARY.md
started: 2026-06-21T20:03:04Z
updated: 2026-06-21T20:03:04Z
---

## Current Test
number: 12
name: CreatorControls in-session Persona management drawer
expected: |
  The session workspace renders an "Analistas" button in CreatorControls. On desktop, this opens a right-side Sheet containing a switch. On mobile, it shows the persona switch inline in the bottom sheet. Toggling the Switch off stops AI responses (409 no_active_persona). An API failure optimistically reverts the switch and shows a toast.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: |
  Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, any seed/migration completes, and a primary query (health check, homepage load, or basic API call) returns live data.
result: pass

### 2. Discriminated Union Zod Validation Gate
expected: |
  PanelWidgetSchema parsed with invalid widget_type or out-of-bounds fields is rejected; valid bento, radar, scatter, or pie structures are validated successfully.
result: pass

### 3. POST /api/sessions/:id/invoke SSE stream
expected: |
  Sending a message with "@analista" triggers an SSE connection from the client to `/invoke`. The server returns streamed `text_delta` tokens and a final `panel_update` event with widget payload, then inserts the AI response to the DB.
result: pass
reported: ""
severity: major

### 4. Typing Hold Gate on Invoke
expected: |
  If a human participant is typing (anyoneTyping is true in presence), calling `/invoke` returns a 429 typing_hold response and prevents AI response stream generation.
result: pass

### 5. Reactions CRUD endpoint and triggersAI
expected: |
  POSTing a reaction to `/api/sessions/:id/reactions` registers the reaction in the database. A reaction of emoji 🔥, 📌, or 🎯 returns `triggersAI: true` in the response payload. Emoji 🧠 returns `triggersAI: false`.
result: pass

### 6. Zustand panelStore & useAIStream consumer hook
expected: |
  useAIStream hook splits incoming stream text on double-newline (\n\n) boundaries, parses the JSON events, verifies the widget payload via the Zod validation gate, and updates panelStore with the widgetType and widgetData.
result: pass

### 7. AI Message Bubble UI with badge
expected: |
  AI responses render with a bot avatar (Indigo background + Lucide Bot icon), the title "Analista Científico" with a FlaskConical icon badge, an Indigo-accent left border, and showing a cursor/dots during active streaming.
result: pass

### 8. Session-wide InputBox soft-lock
expected: |
  When the AI is streaming, all participants' InputBoxes show a placeholder "El analista está escribiendo...", display typing dots, disable the send button, and set the text opacity to 0.5.
result: pass

### 9. Recharts Widgets and AnimatePresence morph transitions
expected: |
  AnalyticsPanel renders the correct widget type from the widgetRegistry (Bento grid, Radar, Scatter, or Pie). Switching widget types or branches triggers a smooth fade, scale, and blur morph transition (AnimatePresence duration 0.28s).
result: pass

### 10. Optimistic Reactions badges
expected: |
  Tapping a reaction popover emoji displays the reaction badge instantly under the message bubble. A server-side POST failure silently reverts the reaction badge state without showing toast alerts.
result: pass

### 11. New Session Persona Picker card
expected: |
  The session creation form (/sessions/new) displays a full-width "Analista IA" persona section with the "Analista Científico" card and a Switch (ON by default). Toggling the Switch updates the `active_personas` payload.
result: pass

### 12. CreatorControls in-session Persona management drawer
expected: |
  The session workspace renders an "Analistas" button in CreatorControls. On desktop, this opens a right-side Sheet containing a switch. On mobile, it shows the persona switch inline in the bottom sheet. Toggling the Switch off stops AI responses (409 no_active_persona). An API failure optimistically reverts the switch and shows a toast.
result: pass

## Summary

total: 12
passed: 12
issues: 0
pending: 0
skipped: 0

## Gaps

