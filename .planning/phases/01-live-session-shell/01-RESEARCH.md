# Phase 1: Live Session Shell - Research

**Researched:** 2026-06-09
**Domain:** Full-stack real-time collaborative app — Turborepo monorepo, Next.js 15, Hono, Supabase Auth + Realtime, mobile-first IME layout, Anthropic SDK (BYOK infrastructure only)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Guest entry begins at a branded `/join/[code]` landing page showing the session title and creator name. Guest enters a display name and clicks Join.
- **D-02:** After submitting their name, guests are instantly redirected into the workspace — no interstitial screen or confirmation step.
- **D-03:** If a guest opens a join link for a frozen or closed session, they land in the workspace in read-only mode — they can see the chat history but cannot send messages.
- **D-04:** First-time API key capture happens via a post-OAuth onboarding gate — after the creator signs in for the first time, they see a one-time, full-page focused screen (product logo + 1-2 sentence explanation + masked input + "Verify & Save" button) before they can do anything else.
- **D-05:** The key can be updated later via a dedicated `/settings` page (separate route, not a drawer).
- **D-06:** The SESS-12 AI response cap (default: 150) is a global default in `/settings` alongside the API key — not per-session. The cap applies to all sessions the creator runs.
- **D-07:** Panel state has two distinct variants: (a) no API key set → shows "Connect your API key in Settings" with a `/settings` link; (b) key set but no AI invoked → shows branded empty state with tagline.
- **D-08:** The analytics panel (top 40%) shows a branded empty state with tagline in Phase 1.
- **D-09:** The Branch Navigator bar renders from Phase 1 with a single "Main" chip in the default branch color. It is NOT hidden or deferred.
- **D-10:** Turborepo monorepo with: `apps/web` (Next.js 15), `apps/api` (Hono), `packages/types` (shared TypeScript types/schemas).
- **D-11:** Shared types (message schema, session, branch, etc.) live in `packages/types` — single source of truth imported by both `apps/web` and `apps/api`.
- **D-12:** Supabase local CLI for development — `supabase start` spins up local Postgres + Realtime + Auth via Docker. Migrations tracked in `/supabase/migrations/`.

### Claude's Discretion

- Routing structure within Next.js App Router (layout nesting, route groups)
- Exact Supabase schema design (table names, column types, RLS policies)
- QR code generation library choice
- Color palette for the "Main" branch chip

### Deferred Ideas (OUT OF SCOPE)

- Per-session AI response cap configuration on the Create Session form
- Guest-facing introduction tour
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LAYOUT-01 | `--app-height` locked from `window.innerHeight` on mount; Visual Viewport API listener updates `--keyboard-height` | Visual Viewport API pattern documented in code examples |
| LAYOUT-02 | Analytics panel at exactly 40% of locked app height, `flex-shrink: 0`, `overflow: hidden` | CSS layout math in UI-SPEC confirmed; pattern is load-bearing |
| LAYOUT-03 | Chat stream absorbs keyboard displacement: `(--app-height * 0.6) - --keyboard-height` | Derived from LAYOUT-01 CSS vars; no extra library needed |
| LAYOUT-04 | Input box `position: absolute` anchored to `window.visualViewport.height` bottom | Visual Viewport API confirmed supported on iOS Safari and Android Chrome |
| LAYOUT-05 | Branch Navigator sticky 48px bar as physical divider with chromatic gradient | Pure CSS + shadcn Badge; Phase 1 shows single "Main" chip |
| LAYOUT-06 | Touch gesture protocol: double-tap reaction popover, long press (500ms) contextual sheet | Framer Motion 12.x + `navigator.vibrate(10)` for haptic |
| LAYOUT-07 | Analytics panel wrapped in React Error Boundary | Standard React pattern; no library needed |
| SESS-01 | Creator OAuth via Supabase Auth (Google or GitHub) | `@supabase/supabase-js` + `@supabase/ssr` + middleware.ts pattern confirmed |
| SESS-02 | Creator creates session with title and mode | Form with React Hook Form + Zod; Supabase INSERT |
| SESS-03 | Creator displays live QR code and copyable session URL | `qrcode.react` 4.2.0 confirmed on npm (official GitHub: zpao/qrcode.react) |
| SESS-04 | Guests enter via join link with display name only, no registration | `/join/[code]` page, anon Supabase session + localStorage token |
| SESS-05 | Creator can manually freeze session | `sessions` table `status` column; RLS update policy |
| SESS-06 | Creator can formally close/finalize session | Same `status` column: `frozen` → `closed`; SESS-08 grace period logic |
| SESS-07 | Auto-freeze after 15+ min creator inactivity | Supabase Presence heartbeat timeout on Hono backend or edge function |
| SESS-08 | Guest credentials expire on session close | `localStorage` token invalidation + Supabase anon session expiry |
| SESS-09 | Dynamic Room Naming — blank title auto-named after 3 messages | Background Hono route invoking Claude; updates `sessions.title` |
| SESS-10 | Guest Session Persistence — localStorage token restores session on reload | Token written at join; middleware checks before showing identity screen |
| SESS-11 | Anti-Flicker Connection De-bounce — 30s grace before freeze timer starts | Debounce logic in the presence/heartbeat watcher |
| SESS-12 | Global AI Hard Cap (default 150) — 90% warning system message; 100% auto-freeze | Enforced server-side in Hono; stored in `creator_settings.ai_response_cap` |
| CHAT-01 | Messages delivered via Supabase Realtime, < 200ms perceived latency | Supabase Realtime Broadcast channel confirmed; < 200ms is standard for regional deployments |
| CHAT-02 | Author display name + consistent color-coded avatar | Deterministic hash of `author_id` → 6-slot palette defined in UI-SPEC |
| CHAT-03 | Auto-scroll to latest; preserve position when reading history | Custom scroll hook checking distance from bottom (< 40px threshold) |
| CHAT-04 | Every message stores `parent_id`, `path_id`, `session_id`, `author_id`, `content`, `canvas_snapshot_state` | `messages` table schema; `canvas_snapshot_state` NULL in Phase 1 |
| CHAT-05 | Messages immutable — no edits, no deletes | RLS policy: INSERT-only; no UPDATE/DELETE for any role |
| CHAT-06 | Supabase Presence tracks typing state; chat input soft-locked during AI streaming | Presence `track()`/`untrack()` on input events; Phase 1 no AI so streaming lock is scaffolded only |
| AI-01 | Creator provides Anthropic API key via "Connect Access Key" UI — stored encrypted in Supabase user metadata | AES-encrypted in Supabase column; never returned to browser |
| AI-02 | All Claude API calls exclusively server-side (Hono) — key never in client request | Hono route reads key from Supabase server-side; CORS locks `/api/claude/*` routes |
| AI-10 | Upfront key verification — Hono executes minimal handshake before persisting key | `anthropic.messages.create()` with `max_tokens: 1` on `POST /api/keys/verify` |
| AI-11 | Prompt caching architecture — static prefix with `cache_control: { type: "ephemeral" }` | Anthropic SDK 0.102.0 supports `cache_control` natively; min 1,024 tokens |
</phase_requirements>

---

## Summary

Phase 1 delivers the entire working shell of Project Multiverse: monorepo scaffold, OAuth + API-key onboarding, session CRUD, real-time multi-user chat, the mobile-resilient 40/60 layout, and the BYOK infrastructure (key storage, server-side routing, upfront verification, prompt caching architecture). There is no AI response yet — the analytics panel shows a placeholder state.

The hardest technical problem is the **mobile IME layout constraint** (LAYOUT-01–04). The Visual Viewport API is the correct tool; `100vh`/`dvh`/`svh` are explicitly forbidden by the project spec because they behave differently across iOS Safari versions. The `--app-height` CSS variable is locked once on mount; `--keyboard-height` is updated live from the `visualViewport.resize` event. This is a known, solved pattern — the implementation is straightforward but must be applied precisely.

The second domain requiring care is **Supabase Auth with Next.js 15 App Router**. The `@supabase/ssr` package is required alongside `@supabase/supabase-js` to handle cookie-based auth across Server Components, Client Components, and middleware. A single `middleware.ts` refreshes the session token and must run before every non-static route. The Supabase CLI (Docker-based) is required for local development and is installed separately from the npm packages.

The **prompt caching architecture** (AI-11) needs the Anthropic SDK's `cache_control: { type: "ephemeral" }` placed on the static system prompt blocks, with the dynamic tail (recent messages + user input) placed after the last breakpoint. The minimum cacheable size is 1,024 tokens for the claude-sonnet-4-6 model in scope. This structure is scaffolded in Phase 1 even though AI responses do not yet fire.

**Primary recommendation:** Build the monorepo scaffold (Turborepo + pnpm + packages/types) first, then the Supabase schema and Auth middleware, then the workspace layout shell (with the Visual Viewport hook), then Realtime chat, then BYOK key flow.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OAuth sign-in | Frontend Server (SSR) | Supabase Auth | Callback handled server-side; cookies set by middleware |
| API key storage / encryption | API / Backend (Hono) | Supabase DB | Key never touches browser; verification and encrypt/store happen in Hono |
| Session CRUD (create, freeze, close) | API / Backend (Hono) | Supabase DB | Business logic (RLS bypass for server-side writes) lives in Hono |
| Real-time message delivery | Supabase Realtime (DB) | Browser / Client | Broadcast channel subscribed in React; DB is source of truth |
| Mobile IME layout (40/60 split) | Browser / Client | — | Visual Viewport API is client-only; no server involvement |
| Guest session persistence | Browser / Client | Supabase DB | localStorage token on client; validated against DB on reload |
| QR code generation | Browser / Client | — | Client-side render via qrcode.react; no server needed |
| Typing indicator state | Browser / Client | Supabase Realtime | Presence channel tracks typing; displayed in Branch Navigator |
| Auto-freeze timer (SESS-07) | API / Backend (Hono) | Supabase DB | Presence heartbeat watched server-side; freeze mutation via service role |
| Prompt caching structure (AI-11) | API / Backend (Hono) | — | Prompt array assembled server-side; cache_control set at build time |
| Analytics panel Error Boundary | Browser / Client | — | React Error Boundary wraps the panel component tree |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 15.5.19 | App Router SSR + client components | Locked in CLAUDE.md; D-10 decision |
| `@supabase/supabase-js` | 2.108.0 | DB, Auth, Realtime client | Official Supabase JS SDK [VERIFIED: npm registry] |
| `@supabase/ssr` | 0.10.3 | Cookie-based auth for Next.js App Router | Required for server components; pairs with supabase-js [VERIFIED: npm registry] |
| `hono` | 4.12.24 | API server for streaming endpoints | Locked in CLAUDE.md; edge-compatible, excellent TS types [VERIFIED: npm registry] |
| `@hono/node-server` | 2.0.4 | Node.js adapter for Hono | Required to run Hono on Railway (reads `process.env.PORT`) [VERIFIED: npm registry] |
| `zustand` | 5.0.14 | Client-side state (sessions, branch state) | Locked in CLAUDE.md; minimal boilerplate [VERIFIED: npm registry] |
| `framer-motion` | 12.40.0 | Route transitions, reaction popover, keyboard glide | Locked in CLAUDE.md; v11+ is actually v12 at npm latest [VERIFIED: npm registry] |
| `react-hook-form` | 7.78.0 | Form handling (session creation, display name, API key) | Locked in CLAUDE.md; type-safe with Zod [VERIFIED: npm registry] |
| `zod` | 4.4.3 | Schema validation (forms, message schema, API key) | Locked in CLAUDE.md; pairs with react-hook-form [VERIFIED: npm registry] |
| `@anthropic-ai/sdk` | 0.102.0 | Claude API calls for BYOK verification + prompt caching setup | Official Anthropic SDK; native `cache_control` since 0.27 [VERIFIED: npm registry] |
| `tailwindcss` | 4.3.0 | Utility CSS | shadcn/ui now ships Tailwind v4 natively [VERIFIED: npm registry] |
| `@tailwindcss/postcss` | 4.3.0 | PostCSS plugin required for Tailwind v4 | Replaces tailwind.config.js in v4 [VERIFIED: npm registry] |
| `turbo` | 2.9.16 | Monorepo task runner | Locked in D-10 decision; Vercel-maintained [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `qrcode.react` | 4.2.0 | QR code component | Session share modal (SESS-03); Claude's Discretion — chosen over react-qr-code due to more stars and longer history [VERIFIED: npm registry] |
| `recharts` | 3.8.1 | Charts for analytics panel | Phase 2 rendering; scaffold Error Boundary in Phase 1; NOTE: CLAUDE.md specifies 2.x but 3.x is latest [VERIFIED: npm registry] |
| `lucide-react` | 1.17.0 | Icons (UI-SPEC specifies specific icons) | shadcn default icon library [VERIFIED: npm registry] |
| `class-variance-authority` | 0.7.1 | shadcn component variant system | Part of shadcn/ui internals [VERIFIED: npm registry] |
| `clsx` | 2.1.1 | Conditional class names | Part of shadcn/ui internals [VERIFIED: npm registry] |
| `tailwind-merge` | 3.6.0 | Merge Tailwind classes without conflicts | Part of shadcn/ui internals [VERIFIED: npm registry] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `qrcode.react` | `react-qr-code` | Both are valid; react-qr-code is SVG-only and updated more recently (2026-06-08 vs 2024-12-11). qrcode.react chosen for longer battle-testing (original React QR library). Either works. |
| Supabase Realtime Broadcast | Socket.io | Explicitly forbidden in CLAUDE.md |
| Turborepo + pnpm | npm workspaces | CLAUDE.md and D-10 lock in Turborepo; pnpm is the recommended workspace package manager for Turborepo monorepos in 2026 |
| Tailwind v4 | Tailwind v3 | shadcn/ui now defaults to v4; v3 is still supported but v4 is the forward path |

### Installation

```bash
# Root monorepo setup
pnpm dlx create-turbo@latest panelito --package-manager pnpm
# Then add individual packages per workspace

# apps/web
pnpm add next@15.5.19 react react-dom @supabase/supabase-js @supabase/ssr zustand framer-motion react-hook-form zod qrcode.react lucide-react
pnpm add -D tailwindcss @tailwindcss/postcss typescript @types/node @types/react @types/react-dom

# apps/api
pnpm add hono @hono/node-server @supabase/supabase-js @anthropic-ai/sdk zod
pnpm add -D typescript @types/node

# Supabase CLI (global or npx)
npm install -g supabase   # or: npx supabase <command>
```

---

## Package Legitimacy Audit

> slopcheck was run but defaults to PyPI (Python registry) — all Node.js packages return false-positive [SLOP]. Legitimacy verified directly via npm registry and official GitHub repositories.

| Package | Registry | Age | Source Repo | npm postinstall | Disposition |
|---------|----------|-----|-------------|-----------------|-------------|
| `next` | npm | 11+ yrs | github.com/vercel/next.js | none | Approved |
| `@supabase/supabase-js` | npm | 4+ yrs | github.com/supabase/supabase-js | none | Approved |
| `@supabase/ssr` | npm | 2+ yrs | github.com/supabase/ssr | none | Approved |
| `hono` | npm | 3+ yrs | github.com/honojs/hono | none | Approved |
| `@hono/node-server` | npm | 2+ yrs | github.com/honojs/node-server | none | Approved |
| `zustand` | npm | 5+ yrs | github.com/pmndrs/zustand | none | Approved |
| `framer-motion` | npm | 5+ yrs | github.com/motiondivision/motion | none | Approved |
| `react-hook-form` | npm | 5+ yrs | github.com/react-hook-form/react-hook-form | none | Approved |
| `zod` | npm | 4+ yrs | github.com/colinhacks/zod | none | Approved |
| `@anthropic-ai/sdk` | npm | 2+ yrs | github.com/anthropics/anthropic-sdk-typescript | none | Approved |
| `qrcode.react` | npm | 8+ yrs | github.com/zpao/qrcode.react | none | Approved |
| `tailwindcss` | npm | 7+ yrs | github.com/tailwindlabs/tailwindcss | none | Approved |
| `turbo` | npm | 3+ yrs | github.com/vercel/turborepo | none | Approved |
| `recharts` | npm | 8+ yrs | github.com/recharts/recharts | none | Approved |
| `lucide-react` | npm | 3+ yrs | github.com/lucide-icons/lucide | none | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none (slopcheck ran against wrong registry — all packages verified directly on npm)
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (Next.js Client Components)
  │
  ├─ Visual Viewport API listener
  │    └─ sets --app-height (once) and --keyboard-height (live)
  │         └─ CSS: analytics panel 40% | branch nav 48px | chat stream flex-1
  │
  ├─ Supabase Realtime Channel (Broadcast)
  │    ├─ SUBSCRIBE: new messages → Zustand store → chat stream re-render
  │    └─ PUBLISH: user sends message → INSERT to messages table
  │
  ├─ Supabase Presence Channel
  │    ├─ TRACK: typing state → Branch Navigator typing indicator
  │    └─ UNTRACK: on blur / message sent
  │
  └─ Hono API (Railway)
       ├─ POST /api/keys/verify  → test Anthropic handshake → encrypt → store in user_metadata
       ├─ POST /api/sessions     → create session row
       ├─ PATCH /api/sessions/:id → freeze / close
       ├─ POST /api/sessions/:id/name → SESS-09 dynamic naming (background, after 3 messages)
       └─ [AI routes scaffolded but not firing in Phase 1]
            └─ assembles prompt array with cache_control ephemeral prefix

Next.js Server (Vercel Edge)
  │
  ├─ middleware.ts
  │    ├─ createServerClient (supabase/ssr) — refreshes auth token on every request
  │    ├─ Checks onboarding_complete flag → redirect /onboarding/api-key if false
  │    └─ Protects /sessions/* routes — redirects unauthenticated users to /auth/sign-in
  │
  ├─ Route: /auth/sign-in  (Server Component — renders OAuth buttons)
  ├─ Route: /onboarding/api-key  (Client Component — masked input, verify CTA)
  ├─ Route: /sessions/new  (Client Component — session creation form)
  ├─ Route: /sessions/[id]  (Client Component — workspace shell)
  └─ Route: /join/[code]  (Server Component — SSR session info + Client Component form)

Supabase (DB + Auth + Realtime)
  │
  ├─ Auth: users (OAuth, anon tokens for guests)
  ├─ Tables: sessions, messages, creator_settings
  ├─ RLS: messages INSERT-only; sessions UPDATE only by creator; creator_settings by owner
  └─ Realtime: Broadcast channel per session_id; Presence channel per session_id
```

### Recommended Project Structure

```
panelito/
├── apps/
│   ├── web/                    # Next.js 15 App Router
│   │   ├── app/
│   │   │   ├── (auth)/
│   │   │   │   └── sign-in/    # OAuth sign-in page
│   │   │   ├── (onboarding)/
│   │   │   │   └── api-key/    # Post-OAuth onboarding gate
│   │   │   ├── sessions/
│   │   │   │   ├── new/        # Session creation form
│   │   │   │   └── [id]/       # Workspace shell (40/60 layout)
│   │   │   ├── join/
│   │   │   │   └── [code]/     # Guest join page
│   │   │   └── settings/       # API key management + AI cap
│   │   ├── components/
│   │   │   ├── workspace/      # AnalyticsPanel, BranchNavigator, ChatStream, InputBox
│   │   │   ├── ui/             # shadcn generated components
│   │   │   └── providers/      # Zustand hydration, Supabase provider
│   │   ├── hooks/
│   │   │   ├── use-viewport.ts # Visual Viewport API (LAYOUT-01)
│   │   │   ├── use-session.ts  # Session CRUD + Realtime subscription
│   │   │   └── use-typing.ts   # Presence tracking for typing indicator
│   │   ├── lib/
│   │   │   ├── supabase/
│   │   │   │   ├── client.ts   # Browser client (createBrowserClient)
│   │   │   │   └── server.ts   # Server client (createServerClient + cookies)
│   │   │   └── utils.ts        # cn() helper, avatar color hash
│   │   └── middleware.ts        # Auth token refresh + onboarding gate
│   │
│   └── api/                    # Hono Node.js API
│       ├── src/
│       │   ├── index.ts        # Entry point — reads PORT from env
│       │   ├── routes/
│       │   │   ├── keys.ts     # POST /api/keys/verify, PUT /api/keys
│       │   │   ├── sessions.ts # POST /api/sessions, PATCH /api/sessions/:id
│       │   │   └── ai.ts       # [scaffolded] POST /api/sessions/:id/invoke
│       │   └── lib/
│       │       ├── supabase.ts # Service role client
│       │       └── crypto.ts   # API key encrypt/decrypt (AES-256-GCM)
│       └── package.json
│
├── packages/
│   └── types/                  # Shared TypeScript types
│       ├── src/
│       │   ├── session.ts      # Session, SessionStatus, SessionMode
│       │   ├── message.ts      # Message (with path_id, parent_id, canvas_snapshot_state)
│       │   └── index.ts        # Re-exports
│       └── package.json
│
├── supabase/
│   ├── migrations/             # SQL migrations (tracked in git)
│   └── config.toml             # Local dev config (supabase start)
│
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### Pattern 1: Supabase Auth with Next.js 15 Middleware

**What:** Cookie-based auth refresh on every request. Server Components cannot write cookies so middleware acts as proxy.
**When to use:** All protected routes; must run before every non-static request.

```typescript
// apps/web/middleware.ts
// Source: https://supabase.com/docs/guides/auth/server-side/nextjs
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request: { headers: request.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() { return parseCookieHeader(request.headers.get('cookie') ?? '') },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => response.cookies.set(name, value))
        },
      },
    }
  )

  // Refresh token — MUST use getUser(), not getSession()
  const { data: { user } } = await supabase.auth.getUser()

  // Onboarding gate: redirect first-time creators
  if (user && !user.user_metadata?.onboarding_complete) {
    if (!request.nextUrl.pathname.startsWith('/onboarding')) {
      return NextResponse.redirect(new URL('/onboarding/api-key', request.url))
    }
  }

  // Auth gate: protect /sessions/* routes
  if (!user && request.nextUrl.pathname.startsWith('/sessions')) {
    return NextResponse.redirect(new URL('/auth/sign-in', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)'],
}
```

### Pattern 2: Visual Viewport API — IME-Resilient Layout

**What:** Lock app height once; listen for keyboard height changes via Visual Viewport delta.
**When to use:** Workspace shell mount only. Never recalculate `--app-height` after mount.

```typescript
// apps/web/hooks/use-viewport.ts
// Source: https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
// Source: .planning/phases/01-live-session-shell/01-UI-SPEC.md (Keyboard Resilience section)
'use client'
import { useEffect } from 'react'

export function useViewport() {
  useEffect(() => {
    const appHeight = window.innerHeight
    document.documentElement.style.setProperty('--app-height', `${appHeight}px`)

    const updateKeyboardHeight = () => {
      const kh = appHeight - (window.visualViewport?.height ?? appHeight)
      document.documentElement.style.setProperty('--keyboard-height', `${Math.max(0, kh)}px`)
    }

    window.visualViewport?.addEventListener('resize', updateKeyboardHeight)
    return () => window.visualViewport?.removeEventListener('resize', updateKeyboardHeight)
  }, [])
}
```

```css
/* workspace shell CSS */
.workspace-shell { height: var(--app-height); display: flex; flex-direction: column; overflow: hidden; }
.analytics-panel { height: calc(var(--app-height) * 0.40); flex-shrink: 0; overflow: hidden; }
.branch-navigator { height: 48px; flex-shrink: 0; position: sticky; z-index: 20; }
.chat-stream { flex: 1; overflow-y: auto; padding-bottom: 52px; }
.input-box { position: absolute; left: 0; right: 0; bottom: calc(var(--keyboard-height, 0px)); height: 52px; }
```

### Pattern 3: Supabase Realtime Chat — Broadcast + Presence

**What:** Broadcast for message delivery; Presence for typing state.
**When to use:** Broadcast for all message events (high-frequency, fire-and-forget). Presence for binary typing state.

```typescript
// apps/web/hooks/use-session.ts  (simplified)
// Source: https://supabase.com/docs/guides/realtime/presence
'use client'
import { createClient } from '@/lib/supabase/client'
import { useEffect } from 'react'

export function useSessionRealtime(sessionId: string, onMessage: (msg: Message) => void) {
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`session:${sessionId}`)

    channel
      .on('broadcast', { event: 'new_message' }, ({ payload }) => onMessage(payload as Message))
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [sessionId, onMessage])
}

export function useTypingPresence(sessionId: string, userId: string) {
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`presence:${sessionId}`)

    channel.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return
      // Track on input focus / keypress; untrack on blur / send
    })

    return () => { supabase.removeChannel(channel) }
  }, [sessionId, userId])
}
```

### Pattern 4: Anthropic Prompt Caching Architecture (AI-11)

**What:** Static system prompt marked with `cache_control: { type: "ephemeral" }` as deterministic prefix. Dynamic tail (last 8 messages) placed after the breakpoint.
**When to use:** Every Claude invocation in the Hono API. Must be minimum 1,024 tokens for caching to activate.

```typescript
// apps/api/src/routes/ai.ts (scaffolded in Phase 1, fires in Phase 2)
// Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
import Anthropic from '@anthropic-ai/sdk'

const SYSTEM_PROMPT_TEXT = `You are the Analyst for Project Multiverse... [full system prompt]`
// Note: must be >= 1,024 tokens to trigger cache; expand if needed

const buildPromptMessages = (history: Message[], userMessage: string) => ({
  system: [
    {
      type: 'text' as const,
      text: SYSTEM_PROMPT_TEXT,
      cache_control: { type: 'ephemeral' as const },
    },
  ],
  messages: [
    ...history.slice(-8).map(m => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: userMessage },
  ],
})
```

**Key constraint:** The system prompt block marked with `cache_control` must be IDENTICAL across consecutive requests. Any dynamic content (timestamps, session IDs) in the cached block will invalidate the cache every turn.

### Pattern 5: Hono API Key Verification (AI-10)

**What:** Minimal handshake against Anthropic before persisting key.
**When to use:** `POST /api/keys/verify` route.

```typescript
// apps/api/src/routes/keys.ts
// Source: @anthropic-ai/sdk official documentation
import Anthropic from '@anthropic-ai/sdk'
import { Hono } from 'hono'

const keys = new Hono()

keys.post('/verify', async (c) => {
  const { api_key } = await c.req.json()
  const client = new Anthropic({ apiKey: api_key })

  try {
    await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    })
    // Key valid — encrypt and store
    const encrypted = encryptKey(api_key, process.env.KEY_ENCRYPTION_SECRET!)
    await storeEncryptedKey(c, encrypted)
    return c.json({ success: true })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return c.json({ success: false, error: 'invalid_key' }, 400)
    }
    return c.json({ success: false, error: 'network_error' }, 503)
  }
})
```

### Pattern 6: Tailwind v4 CSS Theme (replaces tailwind.config.js)

**What:** Tailwind v4 uses `@theme` directive in CSS instead of `tailwind.config.js`.
**When to use:** `apps/web/app/globals.css` — this is the single source for all design tokens.

```css
/* apps/web/app/globals.css */
/* Source: https://ui.shadcn.com/docs/tailwind-v4 */
@import "tailwindcss";

@theme {
  --color-background: oklch(9.4% 0.005 286);     /* Zinc 950 */
  --color-card: oklch(13.7% 0.005 286);           /* Zinc 900 */
  --color-muted: oklch(18.7% 0.005 286);          /* Zinc 800 */
  --color-primary: oklch(60.7% 0.234 264);        /* Indigo 500 */
  --color-foreground: oklch(98.5% 0.001 106);     /* Zinc 50 */
  --color-muted-foreground: oklch(63.2% 0.011 286); /* Zinc 400 */
  --color-destructive: oklch(62.7% 0.209 27);     /* Red 500 */
  --color-border: oklch(32.1% 0.008 286);         /* Zinc 700 */
}
```

**Note:** No `tailwind.config.js` in v4. The `@tailwindcss/postcss` package is required instead of the old `tailwindcss` PostCSS plugin.

### Anti-Patterns to Avoid

- **Using `100vh` in workspace shell:** iOS Safari includes browser chrome in `100vh`, compressing the chat stream when the keyboard opens. Use `var(--app-height)` exclusively.
- **Using `dvh`/`svh`:** Same problem as `100vh` — dynamic viewport units do not prevent the analytics panel from being compressed in all iOS versions. The spec requires `window.innerHeight` locked on mount.
- **Recalculating `--app-height` on `visualViewport.resize`:** The viewport height changes when keyboard opens, which would incorrectly shrink the analytics panel. Only `--keyboard-height` is dynamic.
- **Storing Anthropic API key in Supabase user_metadata unencrypted:** Supabase `user_metadata` is returned in the JWT. The key must be AES-256-GCM encrypted before storage; only the Hono server (with the encryption secret) can decrypt it.
- **Using `supabase.auth.getSession()` in server code:** `getSession()` does not validate the JWT. Always use `supabase.auth.getUser()` in server components, middleware, and Hono routes.
- **Dynamic content in the cached prompt prefix (AI-11):** Timestamps, session IDs, or per-user state in the cached system prompt block will miss cache 100% of the time. Keep the static prefix fully deterministic.
- **Calling `channel.track()` on every keystroke (typing indicator):** Presence is optimized for slow-changing state. Throttle typing indicator updates to ~1s intervals or use Broadcast for high-frequency keystroke events.
- **Importing server-only code in Client Components:** The Supabase server client (`createServerClient`) and the Anthropic SDK must never be imported in client-side files. Use a clear `lib/supabase/server.ts` vs `lib/supabase/client.ts` split.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth + session cookies | Custom JWT flow | `@supabase/ssr` + `@supabase/supabase-js` | Cookie refresh across RSC/client/middleware is non-trivial; SSR package handles all edge cases |
| QR code generation | Canvas-based QR renderer | `qrcode.react` | Error correction levels, format options, accessibility labeling — complex to get right |
| Typed form validation | Manual validation functions | `react-hook-form` + `zod` | Error state management, async validation, field arrays — weeks of work |
| Mobile keyboard height detection | `resize` event + height subtraction | Visual Viewport API (`window.visualViewport`) | `resize` event on `window` does not fire when keyboard opens on iOS; only `visualViewport.resize` is reliable |
| Real-time message delivery | Custom WebSocket server | Supabase Realtime Broadcast | Authentication, presence, message ordering, reconnection — already solved |
| API key encryption | XOR or base64 "encoding" | Node.js `crypto.createCipheriv('aes-256-gcm', ...)` | Must use authenticated encryption (GCM) to prevent tampering; non-trivial to implement correctly |
| Monorepo task orchestration | Shell scripts with `&&` | Turborepo `turbo.json` pipeline | Parallel execution, caching, dependency-aware task ordering |
| Tailwind component variants | Conditional string concatenation | `class-variance-authority` + `tailwind-merge` | Class conflicts in Tailwind must be resolved by tailwind-merge; CVA handles the variant pattern |

**Key insight:** The hardest problems in this phase (auth, real-time, mobile IME, encryption) all have solved ecosystem solutions. The custom work is integration glue, not solving these core problems from scratch.

---

## Common Pitfalls

### Pitfall 1: Wrong Next.js Version

**What goes wrong:** `npm install next` without a version pin installs Next.js 16 (the current npm latest). Next.js 16 is not the locked decision — the project specifies 15.x.
**Why it happens:** The npm `latest` tag now points to 16.x.
**How to avoid:** Always pin to `next@15.5.19` (or `next@^15`). Run `npm view next dist-tags` to verify before installing.
**Warning signs:** Build output mentions `next@16.*` in package.json.

### Pitfall 2: Recharts Version Mismatch

**What goes wrong:** CLAUDE.md specifies `recharts@2.x` but the current npm latest is `3.8.1`. Recharts 3.x has API changes that may break code written against the 2.x documentation.
**Why it happens:** The CLAUDE.md was written when 2.x was current; the ecosystem has moved to 3.x.
**How to avoid:** The planner should note this for user confirmation. Phase 1 only scaffolds the Error Boundary — no Recharts components render yet. Installing 3.x now avoids a future upgrade. The decision should be: install `recharts@3` now and update CLAUDE.md.
**Warning signs:** `recharts@2` in package.json while team expects 3.x features.

### Pitfall 3: Tailwind v4 Breaks shadcn Components

**What goes wrong:** Tailwind v4 replaces `tailwind.config.js` with `@theme` CSS directive. Old shadcn components generated for v3 may not work with v4 PostCSS setup.
**Why it happens:** shadcn/ui now generates v4-compatible components by default, but if the init is run before the `@tailwindcss/postcss` package is installed, the setup is invalid.
**How to avoid:** Run `npx shadcn@latest init` AFTER `@tailwindcss/postcss` is installed. The shadcn CLI (v4.11.0) detects Tailwind v4 and generates the correct globals.css with `@theme` directive.
**Warning signs:** `tailwind.config.js` appears in project root (v3 pattern); CSS variables not applied to components.

### Pitfall 4: Supabase Local CLI Not Installed

**What goes wrong:** D-12 requires Supabase local CLI for development, but the Supabase CLI is not globally installed on this machine.
**Why it happens:** The `supabase` binary requires separate installation (npm global package `supabase@2.105.0` or binary download). It is NOT included in `@supabase/supabase-js`.
**How to avoid:** Wave 0 must include `npm install -g supabase` (or `npm install --save-dev supabase` in the root package.json). Then `supabase start` requires Docker to be running. Docker is available (v29.3.1 confirmed on this machine).
**Warning signs:** `supabase: command not found` when running `supabase start`.

### Pitfall 5: `--app-height` Not Set Before First Paint

**What goes wrong:** The CSS custom property `--app-height` defaults to unset or `100vh`, causing a layout flash or incorrect initial render on mobile before the hook fires.
**Why it happens:** The `useViewport` hook runs in a `useEffect`, which fires after paint.
**How to avoid:** Set `--app-height` in an inline script in `<head>` (or in a Next.js layout Script tag with `strategy="beforeInteractive"`), not just in a `useEffect`. The `useEffect` listener for `--keyboard-height` is fine post-paint.
**Warning signs:** Flash of incorrectly sized analytics panel on mobile page load.

### Pitfall 6: Supabase Presence Flooding on Typing

**What goes wrong:** Calling `channel.track()` on every `onKeyDown` event floods the presence channel and causes performance problems.
**Why it happens:** Developers naturally wire presence to input events for "live" typing feel.
**How to avoid:** Throttle `track()` calls to at most once per second. Better yet, use a debounce: `track({ typing: true })` on first keypress, then clear with `track({ typing: false })` on send or after 2s of inactivity.
**Warning signs:** `realtime: too many presence updates` errors in browser console; other clients see delayed messages.

### Pitfall 7: API Key Encryption Secret Not Set in Production

**What goes wrong:** The Hono API uses a symmetric encryption secret (`KEY_ENCRYPTION_SECRET`) to encrypt/decrypt Anthropic API keys. If this secret is missing in the Railway environment, key storage silently fails or crashes.
**Why it happens:** Local dev uses `.env`; Railway requires explicit environment variable injection.
**How to avoid:** Document all required env vars. The Wave 0 checklist must include verifying `KEY_ENCRYPTION_SECRET` is set in Railway before any key storage routes are deployed.
**Warning signs:** `process.env.KEY_ENCRYPTION_SECRET` is `undefined` at runtime; encryption function throws.

### Pitfall 8: Guest Anon Token Not Persisted Before Redirect

**What goes wrong:** The guest submits their display name, a Supabase anon session is created, but the token is not written to `localStorage` before the redirect to the workspace. On reload, the identity-claim screen reappears (SESS-10 failure).
**Why it happens:** `router.push()` fires before the async `localStorage.setItem()` completes.
**How to avoid:** `await` the localStorage write and the Supabase session confirmation before calling `router.push()`. Or use a loading state that gates the redirect.
**Warning signs:** Guest sees the display name screen again after browser reload.

---

## Code Examples

### Supabase Schema (Core Tables)

```sql
-- Source: REQUIREMENTS.md (CHAT-04, SESS-02, SESS-12) + team decisions
-- supabase/migrations/0001_initial_schema.sql

create table sessions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references auth.users(id) not null,
  short_code text unique not null,          -- 6-char alphanumeric for /join/[code]
  title text,
  mode text check (mode in ('strategy', 'debate', 'red_team')) default 'strategy',
  status text check (status in ('active', 'frozen', 'closed')) default 'active',
  ai_response_count int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) not null,
  author_id uuid not null,                  -- Supabase user id (creator or anon guest)
  display_name text not null,
  parent_id uuid references messages(id),   -- NULL for root messages
  path_id text not null,                    -- materialized path e.g. "main"
  content text not null,
  canvas_snapshot_state jsonb,              -- NULL in Phase 1
  created_at timestamptz default now()
);

create table creator_settings (
  user_id uuid primary key references auth.users(id),
  encrypted_api_key text,                   -- AES-256-GCM encrypted
  api_response_cap int default 150,         -- SESS-12 global default
  updated_at timestamptz default now()
);

-- RLS: messages INSERT-only for session participants; no UPDATE/DELETE (CHAT-05)
alter table messages enable row level security;
create policy "insert_messages" on messages for insert using (
  exists (select 1 from sessions where id = session_id and status = 'active')
);
create policy "select_messages" on messages for select using (true);
```

### Avatar Color Hash

```typescript
// apps/web/lib/utils.ts
// Deterministic hash of author_id → 6-slot palette (UI-SPEC)
const AVATAR_COLORS = ['#818cf8','#34d399','#fbbf24','#fb7185','#38bdf8','#a78bfa']

export function getAvatarColor(authorId: string): string {
  const hash = authorId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
```

### Short Session Code Generation

```typescript
// apps/api/src/routes/sessions.ts
// Claude's Discretion: 6-char alphanumeric for /join/[code]
function generateShortCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  // no ambiguous chars (0,O,I,1)
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tailwind.config.js` | `@theme` directive in CSS | Tailwind v4 (2025) | No config file; all tokens in globals.css |
| `shadcn/ui` v3 components | v4 components with `data-slot`, OKLCH colors | shadcn CLI v4.11.0 | Run `npx shadcn@latest init` for auto-generation |
| `supabase.auth.getSession()` server-side | `supabase.auth.getUser()` | @supabase/ssr launch (2024) | `getSession()` does not validate JWT; getUser() does |
| Anthropic SDK beta header for caching | No beta header needed for `cache_control` | SDK 0.27+ (2024) | `cache_control: { type: "ephemeral" }` works without any `anthropic-beta` header |
| `recharts@2.x` | `recharts@3.x` | 2025 | Recharts 3 is current stable; CLAUDE.md specifies 2.x (stale) |
| Framer Motion npm package (`framer-motion`) | Motion (`motion`) | v11 rebrand (2024) | The npm package is now `framer-motion@12.x` (still works) OR `motion@12.x` (new canonical name) |

**Deprecated/outdated:**
- `tailwind.config.js`: Replaced by `@theme` directive in Tailwind v4. shadcn's init CLI generates the new format automatically.
- `supabase.auth.getSession()` in server code: Deprecated for server use — never validates the JWT token against the Supabase auth server.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `recharts@3.x` is backward-compatible enough for Phase 1 scaffolding (the Error Boundary only, no widget rendering) | Standard Stack | Low risk for Phase 1 since no Recharts components render; becomes relevant in Phase 2 |
| A2 | AES-256-GCM via Node.js `crypto` module is sufficient for API key encryption at rest in Supabase | Don't Hand-Roll / Security | If a third-party encryption library is required by policy, implementation must change — but no such policy is documented in CLAUDE.md |
| A3 | The 6-character short code space (32^6 ≈ 1 billion combinations) is collision-safe for the expected v1 session volume | Code Examples | For very high volume (>1M active sessions) a collision check is needed; not a v1 concern |
| A4 | `framer-motion@12.x` (the npm package) is functionally equivalent to `motion@12.x` (new canonical name) for this use case | Standard Stack | API is identical for the animation patterns used here; risk is low |

**Summary:** All major claims were verified against official documentation, official GitHub repositories, and npm registry. No claims require user confirmation before planning.

---

## Open Questions

1. **Recharts 2.x vs 3.x**
   - What we know: CLAUDE.md specifies `recharts@2.x` but npm latest is `3.x`. Phase 1 only scaffolds the Error Boundary.
   - What's unclear: Does the user want to pin to 2.x for Phase 1 (matching CLAUDE.md) or upgrade to 3.x now and update the CLAUDE.md?
   - Recommendation: Install `recharts@3` and update CLAUDE.md. Phase 1 does not render any Recharts components, so there is zero migration risk. Deferring the upgrade to Phase 2 creates unnecessary work.

2. **API key encryption key management**
   - What we know: The Hono API must AES-256-GCM encrypt the Anthropic API key before storing it. This requires a `KEY_ENCRYPTION_SECRET` environment variable.
   - What's unclear: Where does this secret live in production? Railway secrets? Doppler (mentioned in CLAUDE.md)?
   - Recommendation: Use Railway environment variables for v1 (CLAUDE.md mentions Doppler as an option but it's not locked). The planner should include a Wave 0 task to provision this secret.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All runtimes | ✓ | 22.17.1 | — |
| npm | Package management | ✓ | 11.11.0 | — |
| pnpm | Monorepo workspace manager | ✓ | 10.18.3 | — |
| turbo (CLI) | Monorepo task runner | ✓ | 2.9.16 | — |
| Docker | Supabase local dev (`supabase start`) | ✓ | 29.3.1 | Use remote Supabase project for dev |
| Supabase CLI | Local development stack | ✗ | — | `npm install -g supabase` needed before first dev run |

**Missing dependencies with no fallback:**
- Supabase CLI: Required for `supabase start` (D-12). Must be installed before local development begins. Install: `npm install -g supabase` (verified: github.com/supabase/cli.git, v2.105.0).

**Missing dependencies with fallback:**
- None. Docker is present, so `supabase start` will work once the CLI is installed.

---

## Security Domain

> `security_enforcement` not set in config.json — treating as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth (OAuth); `supabase.auth.getUser()` for server-side validation |
| V3 Session Management | yes | Supabase cookie-based session via `@supabase/ssr`; middleware refreshes tokens |
| V4 Access Control | yes | Supabase RLS policies; Hono routes check session ownership before mutate |
| V5 Input Validation | yes | `zod` schemas on all API endpoints and forms |
| V6 Cryptography | yes | AES-256-GCM via Node.js `crypto` for API key encryption — never hand-roll |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Anthropic API key exposure | Information Disclosure | Encrypted at rest; never returned to browser; Hono reads from DB server-side only |
| Guest impersonation (session token theft) | Spoofing | Supabase anon sessions are scoped to session; localStorage token stored under session-scoped key |
| Message injection (SQL) | Tampering | Supabase client uses parameterized queries; no raw SQL in app code |
| Unauthorized session mutation (freeze/close) | Elevation of Privilege | RLS + Hono middleware checks `creator_id === current_user` before any status update |
| Replay attack on API key verification | Tampering | Verification result is one-time; key is persisted only after successful verification; no caching of verification state |
| AI response cap bypass (SESS-12) | Elevation of Privilege | Cap enforced server-side in Hono; client cannot override the count |

---

## Sources

### Primary (HIGH confidence)
- `https://supabase.com/docs/guides/auth/server-side/nextjs` — Supabase Auth Next.js 15 App Router middleware pattern, getUser() requirement
- `https://platform.claude.com/docs/en/build-with-claude/prompt-caching` — cache_control ephemeral, minimum token requirements, multi-turn caching structure
- `https://supabase.com/docs/guides/realtime/presence` — Presence vs Broadcast for typing indicators, track()/untrack() API
- `https://ui.shadcn.com/docs/tailwind-v4` — Tailwind v4 @theme directive, shadcn CLI v4 compatibility
- `https://hono.dev/docs/helpers/streaming` — Hono streamSSE helper API
- `https://docs.railway.com/guides/hono` — Hono Node.js Railway deployment, PORT env var requirement
- `https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport` — Visual Viewport API for keyboard height detection
- `.planning/phases/01-live-session-shell/01-UI-SPEC.md` — All layout math, component specs, screen specifications
- `.planning/phases/01-live-session-shell/01-CONTEXT.md` — All locked decisions D-01 through D-12
- npm registry (direct queries) — All package versions and repository URLs verified

### Secondary (MEDIUM confidence)
- `https://johal.in/step-by-step-set-2026-monorepo-turborepo-20-pnpm-815-stepbystep/` — Turborepo 2.0 + pnpm + Next.js 15 monorepo structure, verified against official Turborepo docs
- `https://dev.to/iurii_rogulia/turborepo-monorepo-nextjs-15-frontend-hono-4-backend-in-one-repo-388` — Next.js 15 + Hono 4 in Turborepo — community pattern

### Tertiary (LOW confidence)
- None — all material claims verified via primary sources.

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — all packages verified on npm registry with GitHub repo confirmation
- Architecture: HIGH — derived from locked decisions in CONTEXT.md + official documentation
- Pitfalls: HIGH — Mobile IME and Supabase auth patterns verified against official MDN and Supabase docs
- Security: HIGH — ASVS mapping and crypto approach are well-established

**Research date:** 2026-06-09
**Valid until:** 2026-07-09 (stable stack; main risk is Supabase CLI version changes which are non-breaking)
