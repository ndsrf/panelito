# Stack Research: Project Multiverse

**Domain:** Realtime collaborative AI workspace with conversation branching and live analytics panel
**Research date:** 2026-06-08

---

## Recommended Stack (2026)

### Frontend

| Layer | Choice | Version | Rationale |
|-------|--------|---------|-----------|
| Framework | **Next.js 15 (App Router)** | 15.x | SSR for session entry pages; client components for the live workspace; excellent TypeScript DX |
| UI primitives | **shadcn/ui** | latest | Copy-owned components, Radix accessibility, Tailwind-based — no vendor lock-in |
| State management | **Zustand** | 5.x | Minimal boilerplate for real-time branch state; avoid Redux overhead for solo dev |
| Charts/widgets | **Recharts** | 2.x | Composable, React-native; covers radar chart, scatter plot, pie chart out of the box |
| Animations | **Framer Motion** | 11.x | Panel transitions, branch switch animations, keyboard-slide handling |
| Forms | **React Hook Form + Zod** | latest | Type-safe form validation |

### Backend

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | **Node.js 22 LTS** | Stable, streams-native for Claude SSE |
| Framework | **Hono** | Lightweight, edge-compatible, excellent TypeScript types; better than Express for streaming endpoints |
| Real-time | **Supabase Realtime** | Postgres-backed pub/sub; eliminates custom WebSocket server |
| DB | **Supabase Postgres** | Row-level security, `pgvector` for future semantic features |
| Auth | **Supabase Auth** | OAuth (Google, GitHub, Microsoft) for creators; anon tokens for guests |

### AI Integration

| Layer | Choice | Rationale |
|-------|--------|-----------|
| SDK | **Anthropic TypeScript SDK** | `@anthropic-ai/sdk` — streaming, tool use, structured output |
| Model | **Claude 3.5 Sonnet** (claude-sonnet-4-6) | Best quality/cost for complex JSON + text dual-stream |
| Output mode | **Tool use / structured output** | Forces `text_stream` + `ui_mutation_block` separation |

### Infrastructure

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Hosting | **Vercel** (frontend) + **Railway** (backend) | Vercel for Next.js edge; Railway for persistent Node.js streaming server |
| File storage | **Supabase Storage** | QR codes, exported session summaries |
| Secrets | **Doppler** or `.env.local` | Creator API keys stored encrypted in Supabase user metadata |

---

## Key Library Versions (2026)

```json
{
  "next": "^15.0.0",
  "react": "^19.0.0",
  "typescript": "^5.7.0",
  "@supabase/supabase-js": "^2.47.0",
  "@anthropic-ai/sdk": "^0.32.0",
  "hono": "^4.6.0",
  "zustand": "^5.0.0",
  "recharts": "^2.14.0",
  "framer-motion": "^11.0.0",
  "zod": "^3.24.0",
  "qrcode": "^1.5.4"
}
```

---

## What NOT to Use

| Avoided | Reason |
|---------|--------|
| Redux / RTK | Overengineered for this state shape; Zustand simpler for branching tree |
| Socket.io | Unnecessary; Supabase Realtime covers all pub/sub needs |
| tRPC | Adds complexity; plain Hono + Zod typed endpoints is sufficient for solo dev |
| Prisma | Supabase client already covers DB access; Prisma adds migration overhead |
| D3.js | Low-level; Recharts wraps D3 with React-native API — use that |
| `100vh` layout | Known iOS/Android bug; must use Visual Viewport API + CSS custom props |

---

## Confidence Levels

| Choice | Confidence | Notes |
|--------|-----------|-------|
| Supabase Realtime for branching | High | Verified working for multi-user scenarios |
| Hono for streaming | High | Native streaming support, used in production |
| Claude structured output | High | Tool use enforces schema — prevents UI corruption |
| Recharts for all widget types | Medium | Radar chart has some known edge cases with SSR |
| Next.js App Router | High | Stable since Next 13.4, battle-tested |
