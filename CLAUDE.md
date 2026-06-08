<!-- GSD:project-start source:PROJECT.md -->
## Project

**Project Multiverse**

Project Multiverse is a synchronous, multi-user collaborative workspace where groups debate and explore ideas alongside specialized AI personas. A persistent split-screen interface keeps a live analytics panel (top 40%) synchronized with a real-time group chat (bottom 60%). Participants can fork any message into a parallel conversation branch, creating an explorable "multiverse" of alternative scenarios that the group can later compare and merge into a consensus pathway.

**Core Value:** The live analytics panel stays perfectly synchronized with the active conversation branch in real time — transforming passive group chat into structured, visual collective thinking. Without the panel sync, it's just another group chat; without the branching engine, the panel is just a dashboard.

### Constraints

- **Solo:** Each phase must be scoped for one developer to complete independently
- **AI coupling:** Claude API is the only AI provider in v1; abstraction layer should be clean to allow v2 swap-in
- **Supabase-first:** Real-time subscriptions, auth, and storage handled by Supabase to minimize backend complexity
- **Mobile-first:** The 40/60 split must hold on iOS/Android with virtual keyboard open — the IME handling is a hard constraint, not polish
- **Budget:** BYOK means zero AI compute cost to the platform; creator's API key is the cost surface
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

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
## Key Library Versions (2026)
## What NOT to Use
| Avoided | Reason |
|---------|--------|
| Redux / RTK | Overengineered for this state shape; Zustand simpler for branching tree |
| Socket.io | Unnecessary; Supabase Realtime covers all pub/sub needs |
| tRPC | Adds complexity; plain Hono + Zod typed endpoints is sufficient for solo dev |
| Prisma | Supabase client already covers DB access; Prisma adds migration overhead |
| D3.js | Low-level; Recharts wraps D3 with React-native API — use that |
| `100vh` layout | Known iOS/Android bug; must use Visual Viewport API + CSS custom props |
## Confidence Levels
| Choice | Confidence | Notes |
|--------|-----------|-------|
| Supabase Realtime for branching | High | Verified working for multi-user scenarios |
| Hono for streaming | High | Native streaming support, used in production |
| Claude structured output | High | Tool use enforces schema — prevents UI corruption |
| Recharts for all widget types | Medium | Radar chart has some known edge cases with SSR |
| Next.js App Router | High | Stable since Next 13.4, battle-tested |
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
