# Phase 2: AI + Analytics — Pattern Map

**Mapped:** 2026-06-13
**Files analyzed:** 18 new/modified files
**Analogs found:** 17 / 18

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/api/src/routes/ai.ts` | route | streaming / request-response | `apps/api/src/routes/ai.ts` (itself — replace stub) | exact |
| `apps/api/src/routes/reactions.ts` | route | CRUD | `apps/api/src/routes/messages.ts` | exact |
| `apps/api/src/lib/ai-provider.ts` | service | streaming | `apps/api/src/lib/anthropic.ts` | role-match |
| `apps/api/src/lib/anthropic.ts` (extend) | service | request-response | itself | exact |
| `apps/api/src/index.ts` (extend) | config | — | itself | exact |
| `apps/web/store/panel-store.ts` | store | event-driven | `apps/web/store/session-store.ts` | exact |
| `apps/web/components/workspace/AnalyticsPanel.tsx` (extend) | component | event-driven | itself | exact |
| `apps/web/components/workspace/widgets/widget-registry.ts` | utility | transform | `packages/types/src/index.ts` (registry export pattern) | partial |
| `apps/web/components/workspace/widgets/BentoGrid.tsx` | component | request-response | `apps/web/components/workspace/ChatStream.tsx` | partial |
| `apps/web/components/workspace/widgets/RadarWidget.tsx` | component | request-response | same as BentoGrid | partial |
| `apps/web/components/workspace/widgets/ScatterWidget.tsx` | component | request-response | same as BentoGrid | partial |
| `apps/web/components/workspace/widgets/PieWidget.tsx` | component | request-response | same as BentoGrid | partial |
| `apps/web/components/workspace/MessageBubble.tsx` (extend) | component | event-driven | itself | exact |
| `apps/web/components/workspace/QuickReactionPopover.tsx` (extend) | component | request-response | itself | exact |
| `apps/web/app/(protected)/sessions/new/new-session-form.tsx` (extend) | component | request-response | itself | exact |
| `apps/web/components/workspace/CreatorControls.tsx` (extend) | component | request-response | itself | exact |
| `apps/web/app/(protected)/sessions/[id]/workspace.tsx` (extend) | component | event-driven | itself | exact |
| `supabase/migrations/0004_reactions_personas.sql` | migration | CRUD | `supabase/migrations/0001_initial_schema.sql` | role-match |
| `packages/types/src/panel.ts` | model | transform | `packages/types/src/message.ts` | exact |
| `packages/types/src/reaction.ts` | model | CRUD | `packages/types/src/message.ts` | exact |
| `packages/types/src/persona.ts` | model | CRUD | `packages/types/src/session.ts` | role-match |

---

## Pattern Assignments

### `apps/api/src/routes/ai.ts` (route, streaming — replace stub)

**Analog:** `apps/api/src/routes/ai.ts` (itself) + `apps/api/src/routes/messages.ts`

**Imports pattern** (lines 14–19 of current ai.ts):
```typescript
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { createServiceClient } from '../lib/supabase'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { assemblePromptArray } from '../lib/anthropic'
import { checkCap, incrementCount } from '../lib/cap-guard'
import type { AnthropicAdapter } from '../lib/ai-provider'
```

**Auth pattern** (lines 40–42 of current ai.ts):
```typescript
const aiRouter = new Hono<{ Variables: AuthVariables }>()
aiRouter.use('/*', requireAuth)
```

**Core streaming pattern** (research doc Pattern 1):
```typescript
aiRouter.post('/:id/invoke', async (c) => {
  const user = c.get('user')
  const sessionId = c.req.param('id')
  const supabase = createServiceClient()

  // 1. Session ownership check (copy from existing stub lines 58–70)
  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .select('id, creator_id, active_personas')
    .eq('id', sessionId)
    .single()
  if (sessionErr || !session) return c.json({ error: 'session_not_found' }, 404)
  if (session.creator_id !== user.id) return c.json({ error: 'forbidden' }, 403)

  // 2. Cap check (copy from existing stub lines 73–76)
  const capCheck = await checkCap(supabase, sessionId)
  if (!capCheck.ok) return c.json({ error: capCheck.reason }, 429)

  // 3. Body parse
  const body = await c.req.json().catch(() => ({})) as {
    userMessage?: string
    anyoneTyping?: boolean  // D-17 client passes this
  }
  if (body.anyoneTyping) return c.json({ error: 'typing_hold' }, 429)

  // 4. Fetch last 8 messages filtered by path_id (AI-06, AI-08)
  const { data: messagesData } = await supabase
    .from('messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .eq('path_id', 'main')          // AI-06: branch path filter
    .order('created_at', { ascending: false })
    .limit(8)
  const recentMessages = (messagesData ?? []).reverse()

  // 5. streamSSE wrapper
  return streamSSE(c, async (stream) => {
    const aiStream = provider.stream(promptArray, [renderPanelTool])

    for await (const event of aiStream) {
      if (event.type === 'text_delta') {
        await stream.writeSSE({ event: 'text_delta', data: JSON.stringify({ text: event.text }) })
      } else if (event.type === 'tool_use') {
        await stream.writeSSE({ event: 'panel_update', data: JSON.stringify(event.input) })
      }
    }

    // PANEL-04: insert AI message with canvas_snapshot_state AFTER stream completes
    await supabase.from('messages').insert({ /* ... canvas_snapshot_state: lastPanelUpdate */ })
    await incrementCount(supabase, sessionId)
    await stream.writeSSE({ event: 'done', data: '{}' })
  })
})
```

**Error handling pattern** — mirror messages.ts lines 114–117:
```typescript
if (insertError || !row) {
  console.error('[ai] insert error', insertError)
  // stream already closed — log only
}
```

---

### `apps/api/src/routes/reactions.ts` (route, CRUD)

**Analog:** `apps/api/src/routes/messages.ts`

**Imports pattern** (mirror messages.ts lines 1–20):
```typescript
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { createServiceClient } from '../lib/supabase'
import type { AuthVariables } from '../middleware/auth'
import { rateLimit } from '../lib/rate-limit'
```

**Auth + router pattern** (messages.ts lines 33–43):
```typescript
const reactionsRouter = new Hono<{ Variables: AuthVariables }>()
reactionsRouter.use('*', requireAuth)

const reactionRateLimit = rateLimit({
  keyFn: (c) => `${(c.get('user') as { id: string }).id}:reactions`,
  limit: 60,
  windowMs: 60_000,
})
```

**Core CRUD pattern** (mirror messages.ts POST handler lines 49–133):
```typescript
const PostReactionBodySchema = z.object({
  messageId: z.string().uuid(),
  emoji: z.enum(['🧠', '🔥', '📌', '🎯']),
})

reactionsRouter.post('/', reactionRateLimit, async (c) => {
  const sessionId = c.req.param('id')
  const user = c.get('user')
  const supabase = createServiceClient()

  let body: z.infer<typeof PostReactionBodySchema>
  try {
    const raw = await c.req.json()
    body = PostReactionBodySchema.parse(raw)
  } catch {
    return c.json({ error: 'invalid_request' }, 400)
  }

  const { data: row, error: insertError } = await supabase
    .from('reactions')
    .upsert({
      message_id: body.messageId,
      session_id: sessionId,
      author_id: user.id,
      emoji: body.emoji,
    }, { onConflict: 'message_id,author_id,emoji', ignoreDuplicates: true })
    .select()
    .single()

  if (insertError) {
    console.error('[reactions] insert error', insertError)
    return c.json({ error: 'insert_failed', message: insertError.message }, 500)
  }

  // D-09: 🔥📌🎯 trigger AI — client will open /invoke SSE connection
  const triggersAI = ['🔥', '📌', '🎯'].includes(body.emoji)
  return c.json({ ...row, triggersAI }, 201)
})
```

---

### `apps/api/src/lib/ai-provider.ts` (service, streaming)

**Analog:** `apps/api/src/lib/anthropic.ts`

**Pattern:** This is a thin interface + adapter. No existing exact analog. Model the interface shape on the existing `VerifyResult` union type pattern (anthropic.ts lines 24–26), and model the adapter class on how `verifyApiKey` wraps `new Anthropic({ apiKey: key })`.

**Interface pattern** (informed by D-03 / research doc):
```typescript
// D-03: AIProvider interface — wraps any LLM for v2 swappability
export interface TextDeltaEvent { type: 'text_delta'; text: string }
export interface ToolUseEvent   { type: 'tool_use'; name: string; input: unknown }
export interface DoneEvent      { type: 'done' }

export type AIStreamEvent = TextDeltaEvent | ToolUseEvent | DoneEvent

export interface AIProvider {
  stream(
    messages: MessageParam[],
    tools: Anthropic.Tool[],
    options: { model: string; maxTokens: number; system?: string }
  ): AsyncIterable<AIStreamEvent>
}
```

**Anthropic adapter imports** (copy anthropic.ts lines 12–13):
```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources'
```

**Adapter core pattern** (research doc Pattern 1 — `client.messages.stream()` + event forwarding):
```typescript
export class AnthropicAdapter implements AIProvider {
  constructor(private readonly apiKey: string) {}

  async *stream(messages, tools, options): AsyncIterable<AIStreamEvent> {
    const client = new Anthropic({ apiKey: this.apiKey })
    const apiStream = client.messages.stream({
      model: options.model,
      max_tokens: options.maxTokens,
      tools,
      messages,
    })

    // Forward text deltas immediately (research Pattern 1)
    apiStream.on('text', (text) => { /* buffered via AsyncIterator */ })

    // Wait for fully-accumulated tool_use block (research Pattern 1 — contentBlock event)
    apiStream.on('contentBlock', (block) => {
      if (block.type === 'tool_use') { /* emit ToolUseEvent */ }
    })

    await apiStream.done()
  }
}
```

---

### `apps/api/src/lib/anthropic.ts` (extend, service, request-response)

**Analog:** itself

**Extension pattern** — add `path_id` parameter to `AssembleOptions` (lines 76–82):
```typescript
export interface AssembleOptions {
  systemPrompt: string
  personaInstructions: string
  historicalSummary: string          // AI-08: compressed summary of older messages
  recentMessages: Message[]          // last 8, already path-filtered
  userMessage: string
  // No new fields needed — path filtering done at DB query level in the route
}
```

The `assemblePromptArray()` function body (lines 102–140) is unchanged. Path filtering happens at the DB query in the route, not here. The historical summary compression (AI-08) is a separate async function added in this file:

```typescript
export async function compressHistory(
  client: Anthropic,
  messages: Message[]
): Promise<string> {
  // Use claude-haiku-4-5-20251001 — same model as verifyApiKey (line 44)
  const result = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: `Summarize this conversation in 3–5 sentences:\n${JSON.stringify(messages)}` }],
  })
  return result.content[0]?.type === 'text' ? result.content[0].text : ''
}
```

---

### `apps/api/src/index.ts` (extend, config)

**Analog:** itself

**Registration pattern** (lines 45–69 — copy the block structure exactly):
```typescript
// -------------------------------------------------------
// Reactions route (REACT-01 through REACT-05)
// POST /api/sessions/:id/reactions
// -------------------------------------------------------
app.route("/api/sessions/:id/reactions", reactionsRouter);

// -------------------------------------------------------
// Personas route (PERSONA-02)
// POST /api/sessions/:id/personas
// -------------------------------------------------------
app.route("/api/sessions/:id/personas", personasRouter);
```

Import block additions (copy existing import style, lines 6–10):
```typescript
import reactionsRouter from "./routes/reactions";
import personasRouter from "./routes/personas";
```

---

### `apps/web/store/panel-store.ts` (store, event-driven)

**Analog:** `apps/web/store/session-store.ts`

**Imports pattern** (session-store.ts lines 1–4):
```typescript
import { create } from 'zustand'
import type { PanelWidget } from '@panelito/types'
```

**Core store pattern** (session-store.ts lines 18–55 — copy shape exactly):
```typescript
// D-05: panelStore shape
interface PanelStoreState {
  widgetType: PanelWidget['widget_type'] | null
  widgetData: PanelWidget | null
  branchId: string
  snapshotState: PanelWidget | null   // last persisted snapshot

  setWidget: (widget: PanelWidget) => void
  clearWidget: () => void
  setBranchId: (branchId: string) => void
  hydrateFromSnapshot: (snapshot: PanelWidget | null) => void
}

export const usePanelStore = create<PanelStoreState>((set) => ({
  widgetType: null,
  widgetData: null,
  branchId: 'main',
  snapshotState: null,

  setWidget: (widget) =>
    set({ widgetType: widget.widget_type, widgetData: widget, snapshotState: widget }),

  clearWidget: () =>
    set({ widgetType: null, widgetData: null }),

  setBranchId: (branchId) => set({ branchId }),

  // D-07: hydrate from canvas_snapshot_state on branch switch
  hydrateFromSnapshot: (snapshot) =>
    set({ widgetType: snapshot?.widget_type ?? null, widgetData: snapshot }),
}))
```

---

### `apps/web/components/workspace/AnalyticsPanel.tsx` (extend, component, event-driven)

**Analog:** itself

**Existing structure to preserve** (lines 1–149 — do not touch):
- `AnalyticsPanelErrorBoundary` class component (lines 41–74)
- `StateNoKey` and `StateKeySet` inner components (lines 83–125)
- Props interface (lines 131–133)

**New additions:**

Panel header strip (PANEL-03) — insert inside `<AnalyticsPanelErrorBoundary>` before the widget zone:
```tsx
// Panel header — 36px height, flex row
<div className="flex items-center gap-2 px-4 border-b border-border flex-shrink-0" style={{ height: 36 }}>
  <Badge
    className="text-[13px]"
    style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1', color: '#a5b4fc' }}
  >
    <span className="w-1.5 h-1.5 rounded-full bg-[#6366f1] mr-1.5" />
    Main
  </Badge>
  {isStreaming && (
    <span className="text-[13px] text-muted-foreground flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
      Analizando...
    </span>
  )}
</div>
```

Widget zone with `AnimatePresence` (D-08) — copy animation values from research Pattern 4:
```tsx
import { AnimatePresence, motion } from 'framer-motion'

// Widget zone — uses panelStore
const { widgetType, widgetData, branchId } = usePanelStore()
const WidgetComponent = widgetType ? widgetRegistry.get(widgetType) : null

<div className="flex-1 overflow-hidden p-4">
  <AnimatePresence mode="wait">
    {WidgetComponent && widgetData ? (
      <motion.div
        key={`${widgetType}-${branchId}`}
        initial={{ opacity: 0, scale: 0.97, filter: 'blur(4px)' }}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, scale: 1.02, filter: 'blur(4px)' }}
        transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="h-full"
      >
        <WidgetComponent data={widgetData} />
      </motion.div>
    ) : (
      <motion.div key="empty" ...>
        {hasApiKey ? <StateKeySet /> : <StateNoKey />}
      </motion.div>
    )}
  </AnimatePresence>
</div>
```

---

### `apps/web/components/workspace/widgets/widget-registry.ts` (utility, transform)

**Analog:** `packages/types/src/index.ts` (barrel export pattern) — partial match only

**Core pattern** (D-06 extensible registry):
```typescript
'use client'

import type { ComponentType } from 'react'
import type { PanelWidget } from '@panelito/types'
import { BentoGrid } from './BentoGrid'
import { RadarWidget } from './RadarWidget'
import { ScatterWidget } from './ScatterWidget'
import { PieWidget } from './PieWidget'

export type WidgetComponent = ComponentType<{ data: PanelWidget }>

// D-06: extensible Map — future widget types register here without touching AnalyticsPanel
export const widgetRegistry = new Map<PanelWidget['widget_type'], WidgetComponent>([
  ['bento', BentoGrid as WidgetComponent],
  ['radar', RadarWidget as WidgetComponent],
  ['scatter', ScatterWidget as WidgetComponent],
  ['pie', PieWidget as WidgetComponent],
])
```

---

### `apps/web/components/workspace/widgets/BentoGrid.tsx` (component, request-response)

**Analog:** No existing Recharts component in the codebase. Use research Pattern 5 for Recharts 3.x tooltip type.

**Pattern** (from 02-UI-SPEC.md widget spec + research anti-patterns):
```tsx
'use client'

import type { PanelWidget } from '@panelito/types'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// No Recharts needed for bento grid — pure CSS grid layout
interface BentoGridProps { data: Extract<PanelWidget, { widget_type: 'bento' }> }

export function BentoGrid({ data }: BentoGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 h-full overflow-y-auto">
      {data.cards.map((card, i) => (
        <Card key={i} className="bg-muted border-border p-3 flex flex-col gap-1">
          <span className="text-[13px] text-muted-foreground truncate">{card.category}</span>
          <span className="text-[20px] font-semibold text-foreground line-clamp-2">{card.concept}</span>
          {card.relevance_score != null && (
            <span className="text-[13px] text-muted-foreground self-end bg-card rounded px-1">
              {card.relevance_score}
            </span>
          )}
        </Card>
      ))}
    </div>
  )
}
```

**SSR pitfall guard** (research Pitfall 2) — all widget files must have `'use client'` at top. Use `dynamic(() => import('./RadarWidget'), { ssr: false })` in the registry for Recharts components if SSR crash occurs.

---

### `apps/web/components/workspace/widgets/RadarWidget.tsx` (component, request-response)

**Analog:** No existing Recharts analog. Follow research Pattern 5 for Recharts 3.x types.

**Core Recharts pattern** (02-UI-SPEC.md Widget 2 spec):
```tsx
'use client'

import { RadarChart, Radar, PolarGrid, PolarAngleAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { TooltipContentProps } from 'recharts'  // Recharts 3.x — NOT TooltipProps
import type { PanelWidget } from '@panelito/types'

function CustomTooltip({ active, payload }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-md p-2 text-[15px]">
      {payload[0]?.value}
    </div>
  )
}

interface RadarWidgetProps { data: Extract<PanelWidget, { widget_type: 'radar' }> }

export function RadarWidget({ data }: RadarWidgetProps) {
  const chartData = data.axes.map(a => ({ subject: a.axis, value: a.value }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={chartData}>
        <PolarGrid stroke="#3f3f46" />
        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#a1a1aa' }} />
        {/* PolarRadiusAxis hidden per UI-SPEC */}
        <Radar dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} strokeWidth={2} />
        <Tooltip content={<CustomTooltip />} />
      </RadarChart>
    </ResponsiveContainer>
  )
}
```

---

### `apps/web/components/workspace/widgets/ScatterWidget.tsx` (component, request-response)

**Core pattern** (02-UI-SPEC.md Widget 3):
```tsx
'use client'

import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { TooltipContentProps } from 'recharts'   // Recharts 3.x

// Custom dot + tooltip follow same pattern as RadarWidget CustomTooltip above
// XAxis label "Consenso", YAxis label "Impacto", domain [0,100] on both axes
// Scatter fill: #6366f1 (Indigo 500)
```

---

### `apps/web/components/workspace/widgets/PieWidget.tsx` (component, request-response)

**Core pattern** (02-UI-SPEC.md Widget 4):
```tsx
'use client'

import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts'
import type { TooltipContentProps } from 'recharts'   // Recharts 3.x

// 5-color fill sequence: ['#6366f1', '#a78bfa', '#38bdf8', '#34d399', '#fbbf24']
// Donut: innerRadius="40%" outerRadius="70%" paddingAngle={3}
// Segment stroke: #09090b width 2 (separates on dark bg)
// Legend below chart: Label 13px muted-foreground
```

---

### `apps/web/components/workspace/MessageBubble.tsx` (extend, component, event-driven)

**Analog:** itself

**Existing props and structure to preserve** (lines 1–107 — do not modify):
- `MessageBubbleProps` interface (lines 21–24)
- `formatTime` helper (lines 26–31)
- Full render tree including gesture handlers (lines 36–107)

**New `isAI` prop extension** — add to interface:
```typescript
interface MessageBubbleProps {
  message: Message
  isOwn: boolean
  isAI?: boolean           // Phase 2 AI message variant
  isStreaming?: boolean    // Phase 2 streaming state
  streamingText?: string   // Phase 2 ephemeral token buffer
  reactions?: ReactionCount[]  // Phase 2 reaction badges
}
```

**AI avatar pattern** (02-UI-SPEC.md Surface 2 — replaces the initials avatar):
```tsx
// When isAI is true, replace the avatar div (lines 49–58):
<div
  className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
  style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' }}
  aria-hidden="true"
>
  <Bot size={16} style={{ color: '#818cf8' }} />
</div>
```

**Persona badge pattern** (02-UI-SPEC.md — inline after author name):
```tsx
// When isAI is true, add after author name span (line 64):
<Badge
  className="h-5 text-[13px] gap-1"
  style={{
    background: 'rgba(99,102,241,0.12)',
    border: '1px solid rgba(99,102,241,0.30)',
    color: '#a5b4fc',
  }}
  aria-label="Analista Científico — AI persona"
>
  <FlaskConical size={10} />
  Analista
</Badge>
```

**AI bubble content** — left border accent, wider max-width, streaming cursor:
```tsx
// Replace class string for bubble div (lines 78–83) when isAI:
className={cn(
  'rounded-lg p-3 text-[15px] text-foreground leading-relaxed break-words',
  isAI
    ? 'max-w-[90%] bg-card border-l-2 border-l-[#818cf8] pl-4'
    : isOwn ? 'bg-muted max-w-[80%]' : 'bg-card border border-border max-w-[80%]'
)}

// Streaming indicator (three bounce dots) before text appears:
{isAI && isStreaming && !streamingText && (
  <span role="status" aria-label="Analista está escribiendo..." className="flex gap-1">
    {[0,150,300].map(delay => (
      <span key={delay} className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
            style={{ animationDelay: `${delay}ms` }} />
    ))}
  </span>
)}

// Streaming cursor at end of text:
{isAI && isStreaming && streamingText && (
  <span className="text-primary animate-pulse">▋</span>
)}
```

**Reaction badges** (below the bubble content area):
```tsx
// After the bubble div, before closing content column div:
{reactions && reactions.length > 0 && (
  <div className="flex flex-wrap gap-1 mt-1">
    {reactions.map(r => (
      <span
        key={r.emoji}
        className="flex items-center gap-0.5 h-6 px-1.5 rounded-full text-[13px]"
        style={{
          background: r.isOwn ? 'rgba(99,102,241,0.10)' : '#27272a',
          border: `1px solid ${r.isOwn ? '#6366f1' : '#3f3f46'}`,
          color: r.isOwn ? '#a5b4fc' : '#a1a1aa',
        }}
        aria-label={`${r.emoji} reaction, ${r.count} times`}
      >
        <span className="text-[14px]">{r.emoji}</span>
        <span>{r.count}</span>
      </span>
    ))}
  </div>
)}
```

---

### `apps/web/components/workspace/QuickReactionPopover.tsx` (extend, component, request-response)

**Analog:** itself

**Existing structure to preserve** (lines 1–68 — keep all):
- `REACTION_EMOJIS` constant (line 17)
- Popover shell with invisible trigger (lines 41–67)

**Replace `handleReact` body** (line 33–37 — replace `console.log`):
```typescript
const handleReact = async (emoji: string) => {
  onOpenChange(false)

  // D-10: Optimistic UI — badge appears before server confirmation
  onOptimisticReaction?.(emoji)      // prop added in Phase 2

  try {
    await apiFetch(`/api/sessions/${sessionId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ messageId, emoji }),
    })
  } catch {
    // D-10 / Pitfall 6: revert on server error — silent, no toast
    onRevertReaction?.(emoji)
  }
}
```

New props needed:
```typescript
interface QuickReactionPopoverProps {
  messageId: string
  sessionId: string                           // added Phase 2
  open: boolean
  onOpenChange: (open: boolean) => void
  onOptimisticReaction?: (emoji: string) => void  // added Phase 2
  onRevertReaction?: (emoji: string) => void      // added Phase 2
}
```

---

### `apps/web/app/(protected)/sessions/new/new-session-form.tsx` (extend, component, request-response)

**Analog:** itself

**Existing structure to preserve** (lines 1–164 — keep all):
- `useForm` with `zodResolver(SessionCreateInputSchema)` pattern (lines 52–64)
- Mode card selector pattern (lines 112–136) — persona picker copies this exactly
- Submit + error handling (lines 140–163)

**New persona picker section** — insert after mode selector, before server error div (after line 137):
```tsx
{/* Persona section — D-12, PERSONA-01 */}
<div className="space-y-2">
  <label className="text-[13px] text-muted-foreground">Analista IA</label>
  <div className="space-y-2">
    {/* Copy mode card button pattern exactly (lines 116–135) for persona card */}
    <button
      type="button"
      onClick={() => setPersonaActive(!personaActive)}
      className={cn(
        'w-full rounded-md border p-4 text-left transition-colors',
        'bg-card hover:bg-muted flex items-center gap-3',
        personaActive
          ? 'border-primary ring-2 ring-primary ring-offset-0'
          : 'border-border'
      )}
    >
      {/* Persona avatar — Indigo tinted, FlaskConical icon */}
      <div className="w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0"
           style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.30)' }}>
        <FlaskConical size={20} style={{ color: '#818cf8' }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] text-foreground">Analista Científico</div>
        <div className="text-[13px] text-muted-foreground mt-0.5 line-clamp-2">
          Analiza datos, detecta falacias y estructura la información cuantitativa.
        </div>
      </div>
      {/* Switch component (shadcn) or checkmark */}
    </button>
  </div>
  <p className="text-[13px] text-muted-foreground">
    Puedes activar o desactivar los analistas durante la sesión.
  </p>
</div>
```

**Form schema extension** — `active_personas` field alongside `SessionCreateInputSchema`:
```typescript
// Extend form values locally (not changing the shared schema yet)
const defaultValues = { title: null, mode: 'strategy', active_personas: ['analista_cientifico'] }
```

---

### `apps/web/components/workspace/CreatorControls.tsx` (extend, component, request-response)

**Analog:** itself

**Existing structure to preserve** (lines 1–258 — keep all):
- `FreezeButton`, `UnfreezeButton`, `CloseButton` sub-components (lines 55–203)
- Desktop/mobile dual layout with `Sheet` (lines 216–258)
- `apiFetch` + `ApiError` error handling pattern used in each button

**New Analistas button pattern** — add alongside existing buttons in `actionButtons` div (line 221):
```tsx
<Button variant="outline" size="sm" className="h-9 gap-2" onClick={() => setAnalystasOpen(true)}>
  <Users className="h-4 w-4" />
  Analistas
</Button>
```

**Persona management drawer** (right Sheet on desktop, inline section on mobile — copy Sheet pattern from lines 237–254):
```tsx
{/* Desktop: Sheet side="right" width 320px */}
<Sheet open={analystasOpen} onOpenChange={setAnalystasOpen}>
  <SheetContent side="right" className="w-80" aria-describedby={undefined}>
    <SheetHeader>
      <SheetTitle>Analistas activos</SheetTitle>
    </SheetHeader>
    <div className="px-4 pt-6 space-y-4">
      {/* Persona card — same pattern as session creation form but with Switch */}
      <div className="flex items-center gap-3 p-4 rounded-md border bg-card">
        {/* avatar same as session form */}
        <Switch
          checked={personaActive}
          onCheckedChange={handlePersonaToggle}
          aria-label={personaActive ? 'Desactivar Analista Científico' : 'Activar Analista Científico'}
          disabled={isToggling}
        />
      </div>
    </div>
    <p className="text-[13px] text-muted-foreground px-4">
      Los cambios se aplican de inmediato a los mensajes siguientes.
    </p>
  </SheetContent>
</Sheet>
```

**Persona toggle handler** — mirror `handleFreeze` (lines 61–72) with toast on error:
```typescript
const handlePersonaToggle = async (active: boolean) => {
  setPersonaActive(active)   // optimistic
  setIsToggling(true)
  try {
    await apiFetch(`/api/sessions/${session.id}/personas`, {
      method: 'POST',
      body: JSON.stringify({ personaId: 'analista_cientifico', active }),
    })
  } catch (err) {
    setPersonaActive(!active)  // revert (Pitfall 7)
    // toast: "No se pudo cambiar el analista. Inténtalo de nuevo."
    toast.error('No se pudo cambiar el analista. Inténtalo de nuevo.')
  } finally {
    setIsToggling(false)
  }
}
```

---

### `apps/web/app/(protected)/sessions/[id]/workspace.tsx` (extend, component, event-driven)

**Analog:** itself

**Existing structure to preserve** (lines 1–113 — keep all except AnalyticsPanel prop passing and SSE wiring).

**New SSE consumer hook integration** — add alongside `useSessionStatus` (lines 66–67):
```typescript
// Phase 2: open SSE stream when AI is invoked
// AI lock broadcast via existing presence channel (Pitfall 3 guard — merge payload)
const { isAIStreaming, streamingText, openAIStream } = useAIStream(session.id)
```

**AI lock presence broadcast** — extend existing `useTypingPresence` channel (research Pitfall 3):
```typescript
// When AI stream starts, broadcast merged presence payload:
channel.track({
  typing: false,          // explicitly clear typing
  ai_streaming: true,
  streaming_started_at: Date.now(),
}).catch(() => {})

// Read lock state from presenceState in useTypingPresence:
const isAIStreaming = Object.values(state).some(
  payloads => payloads.some(p => p.ai_streaming === true)
)
```

**Pass new props to AnalyticsPanel**:
```tsx
<AnalyticsPanel hasApiKey={hasApiKey} isStreaming={isAIStreaming} />
```

---

### `packages/types/src/panel.ts` (model, transform)

**Analog:** `packages/types/src/message.ts`

**Imports pattern** (message.ts line 1):
```typescript
import { z } from 'zod'
```

**Core Zod schema pattern** (message.ts lines 10–25 — use `z.discriminatedUnion` from research Pattern 3):
```typescript
// Sub-schemas (Claude's Discretion — field names from research doc Code Examples)
const BentoCardSchema = z.object({
  category: z.string().max(60),
  concept: z.string().max(120),
  relevance_score: z.number().min(0).max(100).optional(),
})
const RadarAxisSchema = z.object({ axis: z.string().max(60), value: z.number().min(0).max(100) })
const ScatterPointSchema = z.object({
  concept: z.string().max(80),
  consensus: z.number().min(0).max(100),
  impact: z.number().min(0).max(100),
})
const PieSegmentSchema = z.object({ label: z.string().max(60), value: z.number().min(0) })

export const PanelWidgetSchema = z.discriminatedUnion('widget_type', [
  z.object({ widget_type: z.literal('bento'),   title: z.string().optional(), cards:    z.array(BentoCardSchema).min(1).max(6) }),
  z.object({ widget_type: z.literal('radar'),   title: z.string().optional(), axes:     z.array(RadarAxisSchema).min(3).max(8) }),
  z.object({ widget_type: z.literal('scatter'), title: z.string().optional(), points:   z.array(ScatterPointSchema).min(1).max(20) }),
  z.object({ widget_type: z.literal('pie'),     title: z.string().optional(), segments: z.array(PieSegmentSchema).min(2).max(8) }),
])

export type PanelWidget = z.infer<typeof PanelWidgetSchema>
```

**Export pattern** (message.ts lines 30–42):
```typescript
// AIStreamEvent types (also lives here per D-03 shared types)
export type AIStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'panel_update'; payload: PanelWidget }
  | { type: 'done' }
```

---

### `packages/types/src/reaction.ts` (model, CRUD)

**Analog:** `packages/types/src/message.ts`

**Pattern** (message.ts lines 10–25):
```typescript
import { z } from 'zod'

export const ReactionSchema = z.object({
  id: z.string().uuid(),
  message_id: z.string().uuid(),
  session_id: z.string().uuid(),
  author_id: z.string().uuid(),
  emoji: z.enum(['🧠', '🔥', '📌', '🎯']),
  created_at: z.string(),
})
export type Reaction = z.infer<typeof ReactionSchema>

// ReactionCount — aggregated for display in MessageBubble
export const ReactionCountSchema = z.object({
  emoji: z.enum(['🧠', '🔥', '📌', '🎯']),
  count: z.number().int().nonnegative(),
  isOwn: z.boolean(),  // whether current user applied this reaction
})
export type ReactionCount = z.infer<typeof ReactionCountSchema>
```

---

### `packages/types/src/persona.ts` (model, CRUD)

**Analog:** `packages/types/src/session.ts` (enum + object pattern)

**Pattern** (session.ts lines 6–30):
```typescript
import { z } from 'zod'

export const PERSONA_IDS = ['analista_cientifico'] as const
export type PersonaId = typeof PERSONA_IDS[number]

export const PersonaConfigSchema = z.object({
  id: z.enum(PERSONA_IDS),
  displayName: z.string(),
  description: z.string(),
  systemPromptAddition: z.string(),
  icon: z.string(),          // Lucide icon name
  active: z.boolean(),
})
export type PersonaConfig = z.infer<typeof PersonaConfigSchema>

// Hardcoded library — Phase 2 has 1 entry; Phase 3 adds more
export const PERSONA_LIBRARY: PersonaConfig[] = [
  {
    id: 'analista_cientifico',
    displayName: 'Analista Científico',
    description: 'Analiza datos, detecta falacias y estructura la información cuantitativa.',
    systemPromptAddition: 'You are the Analista Científico...',
    icon: 'FlaskConical',
    active: true,
  },
]
```

---

### `supabase/migrations/0004_reactions_personas.sql` (migration, CRUD)

**Analog:** `supabase/migrations/0001_initial_schema.sql`

**Header comment pattern** (migration 0001 lines 1–15 — copy format):
```sql
-- =============================================================================
-- Migration: 0004_reactions_personas
-- Project:   Project Multiverse (Panelito)
-- Created:   2026-06-13
-- Creates:   reactions table, adds active_personas to sessions
-- =============================================================================
```

**Table + RLS pattern** (migration 0001 lines 44–130 — copy structure):
```sql
-- Reactions table (REACT-01 through REACT-05)
CREATE TABLE public.reactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid        NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  session_id  uuid        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  author_id   uuid        NOT NULL,
  emoji       text        NOT NULL CHECK (emoji IN ('🧠', '🔥', '📌', '🎯')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, author_id, emoji)
);

CREATE INDEX reactions_message_idx ON public.reactions (message_id);

-- RLS (copy pattern from messages RLS in migration 0001)
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
-- SELECT: participants can read all reactions in the session
-- INSERT: auth.uid() = author_id

-- Active personas column (PERSONA-01, PERSONA-02)
ALTER TABLE public.sessions
  ADD COLUMN active_personas text[] NOT NULL DEFAULT '{analista_cientifico}';
```

---

## Shared Patterns

### Authentication (apply to all new Hono routes)

**Source:** `apps/api/src/middleware/auth.ts`

Apply to: `reactions.ts`, `personas.ts` routes.

```typescript
// Line 29-47 of auth.ts — copy requireAuth middleware reference exactly
const router = new Hono<{ Variables: AuthVariables }>()
router.use('*', requireAuth)
// Then in handler: const user = c.get('user')
```

### Error Handling (apply to all Hono route handlers)

**Source:** `apps/api/src/routes/messages.ts` lines 58–62 and 114–117

```typescript
// Zod validation failure:
try {
  body = PostBodySchema.parse(raw)
} catch {
  return c.json({ error: 'invalid_request', message: 'Description.' }, 400)
}

// Supabase insert failure:
if (insertError || !row) {
  console.error('[route-name] insert error', insertError)
  return c.json({ error: 'insert_failed', message: insertError?.message ?? 'Unknown error' }, 500)
}
```

### API Fetch + Error Handling (apply to all frontend POST callers)

**Source:** `apps/web/lib/api.ts` + `apps/web/components/workspace/CreatorControls.tsx` lines 61–72

```typescript
// Standard pattern: apiFetch + ApiError catch + optimistic revert
try {
  await apiFetch(`/api/sessions/${sessionId}/endpoint`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
} catch (err) {
  if (err instanceof ApiError) {
    console.error('[Component] action failed:', err.status)
  }
  // revert optimistic state here
}
```

### Supabase Realtime Broadcast (apply to new route that needs to notify all clients)

**Source:** `apps/api/src/routes/messages.ts` lines 121–124

```typescript
// Fire-and-forget broadcast after successful INSERT
supabase
  .channel(`session:${sessionId}`)
  .httpSend('new_reaction', row)
  .catch((err) => console.error('[reactions] broadcast failed', err))
```

### Zustand Store Shape (apply to panel-store.ts)

**Source:** `apps/web/store/session-store.ts` lines 38–55

```typescript
// create<State>((set) => ({ ...initialState, actionName: (arg) => set(...) }))
// Action functions use set() with return value, never mutate state directly
export const useStore = create<State>((set) => ({
  field: initialValue,
  actionName: (arg) => set((state) => ({ field: computeNewValue(state, arg) })),
}))
```

### Presence Channel Extension (apply to AI lock broadcast)

**Source:** `apps/web/hooks/use-typing-presence.ts` lines 36–47

```typescript
// Extend existing track() payload — NEVER replace it (research Pitfall 3)
// Read current typing state before track() call
const currentTyping = /* read from store */
channelRef.current?.track({
  typing: currentTyping,      // preserve existing field
  displayName,                // preserve existing field
  ai_streaming: true,         // add new field
  streaming_started_at: Date.now(),
}).catch(() => {})
```

### Zod safeParse Validation Gate (apply before any panelStore update)

**Source:** research Pattern 3 (AI-05 requirement)

```typescript
// Apply to every panel_update SSE event handler in the frontend
function handlePanelUpdate(raw: unknown) {
  const result = PanelWidgetSchema.safeParse(raw)
  if (!result.success) {
    console.warn('[panel] schema invalid — discarded:', result.error.issues)
    return  // silent discard — AI-05
  }
  usePanelStore.getState().setWidget(result.data)
}
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/web/hooks/use-ai-stream.ts` | hook | streaming | No fetch-based SSE consumer hook exists in the codebase. Must build fresh from research Pattern 2. Key: use `ReadableStream` + buffer SSE on `\n\n` boundary (research Pitfall 1). |

---

## Metadata

**Analog search scope:** `apps/api/src/` (all), `apps/web/` (all), `packages/types/src/` (all), `supabase/migrations/` (all)
**Files scanned:** 31 source files + 3 migration files
**Pattern extraction date:** 2026-06-13
