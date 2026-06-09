# Phase 1: Live Session Shell - Pattern Map

**Mapped:** 2026-06-09
**Files analyzed:** 30 (new files — greenfield project)
**Analogs found:** 0 / 30 (no source code exists yet)

> This is a greenfield project. No existing source files are present in the repository.
> Every section below documents the **intended pattern** drawn from RESEARCH.md code examples,
> CONTEXT.md decisions, UI-SPEC.md, and CLAUDE.md stack conventions. The planner should treat
> these patterns as the canonical starting point for each file.

---

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `turbo.json` | config | — | none | new — no analog |
| `pnpm-workspace.yaml` | config | — | none | new — no analog |
| `packages/types/src/session.ts` | model | — | none | new — no analog |
| `packages/types/src/message.ts` | model | — | none | new — no analog |
| `packages/types/src/index.ts` | config | — | none | new — no analog |
| `supabase/migrations/0001_initial_schema.sql` | migration | CRUD | none | new — no analog |
| `apps/web/middleware.ts` | middleware | request-response | none | new — no analog |
| `apps/web/app/globals.css` | config | — | none | new — no analog |
| `apps/web/app/layout.tsx` | component | — | none | new — no analog |
| `apps/web/app/(auth)/sign-in/page.tsx` | component | request-response | none | new — no analog |
| `apps/web/app/(onboarding)/api-key/page.tsx` | component | request-response | none | new — no analog |
| `apps/web/app/sessions/new/page.tsx` | component | CRUD | none | new — no analog |
| `apps/web/app/sessions/[id]/page.tsx` | component | event-driven | none | new — no analog |
| `apps/web/app/join/[code]/page.tsx` | component | request-response | none | new — no analog |
| `apps/web/app/settings/page.tsx` | component | CRUD | none | new — no analog |
| `apps/web/components/workspace/AnalyticsPanel.tsx` | component | — | none | new — no analog |
| `apps/web/components/workspace/BranchNavigator.tsx` | component | event-driven | none | new — no analog |
| `apps/web/components/workspace/ChatStream.tsx` | component | event-driven | none | new — no analog |
| `apps/web/components/workspace/InputBox.tsx` | component | event-driven | none | new — no analog |
| `apps/web/components/providers/SupabaseProvider.tsx` | provider | — | none | new — no analog |
| `apps/web/hooks/use-viewport.ts` | hook | event-driven | none | new — no analog |
| `apps/web/hooks/use-session.ts` | hook | event-driven | none | new — no analog |
| `apps/web/hooks/use-typing.ts` | hook | event-driven | none | new — no analog |
| `apps/web/lib/supabase/client.ts` | utility | request-response | none | new — no analog |
| `apps/web/lib/supabase/server.ts` | utility | request-response | none | new — no analog |
| `apps/web/lib/utils.ts` | utility | — | none | new — no analog |
| `apps/api/src/index.ts` | config | — | none | new — no analog |
| `apps/api/src/routes/keys.ts` | route | request-response | none | new — no analog |
| `apps/api/src/routes/sessions.ts` | route | CRUD | none | new — no analog |
| `apps/api/src/routes/ai.ts` | route | request-response | none | new — no analog |
| `apps/api/src/lib/supabase.ts` | utility | request-response | none | new — no analog |
| `apps/api/src/lib/crypto.ts` | utility | — | none | new — no analog |

---

## Pattern Assignments

### `turbo.json` + `pnpm-workspace.yaml` + root `package.json` (monorepo config)

**Pattern source:** RESEARCH.md Architecture Patterns — Recommended Project Structure; D-10 decision.

**Intended turbo.json pattern:**
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": { "dependsOn": ["^lint"] },
    "typecheck": { "dependsOn": ["^typecheck"] }
  }
}
```

**Intended pnpm-workspace.yaml pattern:**
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**Key constraints:**
- `turbo` version: `2.9.16` (verified npm, D-10)
- Package manager: `pnpm` with workspace protocol (`workspace:*`) for internal deps
- `packages/types` is consumed by both `apps/web` and `apps/api` via `"@panelito/types": "workspace:*"`

---

### `packages/types/src/session.ts` (model)

**Pattern source:** RESEARCH.md Code Examples — Supabase Schema; CONTEXT.md D-11.

**Intended pattern:**
```typescript
// packages/types/src/session.ts
export type SessionStatus = 'active' | 'frozen' | 'closed'
export type SessionMode = 'strategy' | 'debate' | 'red_team'

export interface Session {
  id: string                // UUID
  creator_id: string        // Supabase auth user id
  short_code: string        // 6-char alphanumeric, URL-safe
  title: string | null
  mode: SessionMode
  status: SessionStatus
  ai_response_count: number
  created_at: string        // ISO 8601
  updated_at: string
}

export interface CreatorSettings {
  user_id: string
  encrypted_api_key: string | null
  api_response_cap: number   // default 150 (SESS-12)
  updated_at: string
}
```

**Key constraints:**
- Pure TypeScript types only — no runtime code, no Zod schemas here (Zod lives in the consuming app)
- Exported from `packages/types/src/index.ts` as barrel re-export
- `short_code` must exclude ambiguous characters (0, O, I, 1) — see crypto.ts for generation

---

### `packages/types/src/message.ts` (model)

**Pattern source:** RESEARCH.md Phase Requirements — CHAT-04; RESEARCH.md Code Examples.

**Intended pattern:**
```typescript
// packages/types/src/message.ts
export interface Message {
  id: string
  session_id: string
  author_id: string           // Supabase user id (creator or anon guest)
  display_name: string
  parent_id: string | null    // NULL for root messages (Phase 3 branching)
  path_id: string             // Materialized path, e.g. "main" in Phase 1
  content: string
  canvas_snapshot_state: Record<string, unknown> | null  // NULL in Phase 1
  created_at: string
}

// Realtime broadcast payload — same shape as Message
export type NewMessagePayload = Message
```

**Key constraints:**
- `canvas_snapshot_state` is nullable — always `null` in Phase 1, typed for Phase 2+
- `path_id` defaults to `"main"` in Phase 1; Phase 3 will introduce non-main paths
- `parent_id` nullable — always `null` in Phase 1; CHAT-04 requirement stored for schema stability

---

### `supabase/migrations/0001_initial_schema.sql` (migration)

**Pattern source:** RESEARCH.md Code Examples — Supabase Schema (complete SQL provided).

**Intended pattern (exact from RESEARCH.md):**
```sql
-- supabase/migrations/0001_initial_schema.sql

create table sessions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references auth.users(id) not null,
  short_code text unique not null,
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
  author_id uuid not null,
  display_name text not null,
  parent_id uuid references messages(id),
  path_id text not null,
  content text not null,
  canvas_snapshot_state jsonb,
  created_at timestamptz default now()
);

create table creator_settings (
  user_id uuid primary key references auth.users(id),
  encrypted_api_key text,
  api_response_cap int default 150,
  updated_at timestamptz default now()
);

-- RLS: messages INSERT-only (CHAT-05)
alter table messages enable row level security;
create policy "insert_messages" on messages for insert using (
  exists (select 1 from sessions where id = session_id and status = 'active')
);
create policy "select_messages" on messages for select using (true);
```

**Additional RLS needed (beyond RESEARCH.md example):**
```sql
-- sessions: creator can update their own sessions only
alter table sessions enable row level security;
create policy "select_sessions" on sessions for select using (true);
create policy "insert_sessions" on sessions for insert with check (creator_id = auth.uid());
create policy "update_sessions" on sessions for update using (creator_id = auth.uid());

-- creator_settings: owner only
alter table creator_settings enable row level security;
create policy "own_settings" on creator_settings using (user_id = auth.uid());
```

**Key constraints:**
- Supabase service role (used by Hono API) bypasses RLS — service role can do any mutation
- `short_code` generation: 6-char from `'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'` (no ambiguous chars)
- Migration tracked in git under `supabase/migrations/` (D-12)

---

### `apps/web/middleware.ts` (middleware, request-response)

**Pattern source:** RESEARCH.md Pattern 1 — Supabase Auth with Next.js 15 Middleware (complete implementation provided).

**Intended pattern (exact from RESEARCH.md):**
```typescript
// apps/web/middleware.ts
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

  // MUST use getUser(), never getSession() — getSession() does not validate JWT
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

**Critical anti-pattern to avoid:**
- Never use `supabase.auth.getSession()` in middleware — it does not validate the JWT
- The `config.matcher` regex must exclude static assets to avoid running auth on every image

---

### `apps/web/app/globals.css` (config)

**Pattern source:** RESEARCH.md Pattern 6 — Tailwind v4 CSS Theme; UI-SPEC.md Color table and Layout Mathematics.

**Intended pattern:**
```css
/* apps/web/app/globals.css */
@import "tailwindcss";

@theme {
  /* Colors (OKLCH — Tailwind v4 native) */
  --color-background: oklch(9.4% 0.005 286);       /* Zinc 950 — #09090b */
  --color-card: oklch(13.7% 0.005 286);             /* Zinc 900 — #18181b */
  --color-muted: oklch(18.7% 0.005 286);            /* Zinc 800 — #27272a */
  --color-primary: oklch(60.7% 0.234 264);          /* Indigo 500 — #6366f1 */
  --color-foreground: oklch(98.5% 0.001 106);       /* Zinc 50 — #fafafa */
  --color-muted-foreground: oklch(63.2% 0.011 286); /* Zinc 400 — #a1a1aa */
  --color-destructive: oklch(62.7% 0.209 27);       /* Red 500 — #ef4444 */
  --color-border: oklch(32.1% 0.008 286);           /* Zinc 700 — #3f3f46 */

  /* Layout custom properties (set dynamically by useViewport hook) */
  /* --app-height and --keyboard-height are set via JS, not here */
}

/* Workspace layout shell (LAYOUT-01 through LAYOUT-04) */
.workspace-shell {
  height: var(--app-height);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.analytics-panel {
  height: calc(var(--app-height) * 0.40);
  flex-shrink: 0;
  overflow: hidden;
}
.branch-navigator {
  height: 48px;
  flex-shrink: 0;
  position: sticky;
  z-index: 20;
}
.chat-stream {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 52px;
}
.input-box {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(var(--keyboard-height, 0px));
  height: 52px;
}
```

**Key constraints:**
- NO `tailwind.config.js` — v4 uses `@theme` CSS directive only
- `@tailwindcss/postcss` package required in `apps/web` (replaces old PostCSS plugin)
- `--app-height` is NOT set here — set once by `useViewport` hook on mount via inline `<script>` in `<head>` BEFORE first paint (Pitfall 5)
- `100vh`, `dvh`, `svh` are CONTRACT VIOLATIONS in workspace shell CSS

---

### `apps/web/app/layout.tsx` (component — root layout)

**Pattern source:** Next.js 15 App Router conventions; UI-SPEC.md Typography (Inter font).

**Intended pattern:**
```typescript
// apps/web/app/layout.tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'Multiverse',
  description: 'Structured thinking. Live.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Set --app-height BEFORE first paint to prevent layout flash (Pitfall 5) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.style.setProperty('--app-height', window.innerHeight + 'px')`,
          }}
        />
      </head>
      <body className="bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  )
}
```

**Key constraints:**
- The inline `<script>` that sets `--app-height` is MANDATORY for preventing layout flash (Pitfall 5)
- Font variable (`--font-inter`) feeds into Tailwind v4 `@theme` if custom font tokens are added
- Dark theme only in Phase 1 — no `light`/`dark` class toggling needed

---

### `apps/web/app/(auth)/sign-in/page.tsx` (component, request-response)

**Pattern source:** UI-SPEC.md Screen 1; RESEARCH.md Architecture Patterns (OAuth via Supabase Auth).

**Intended pattern:**
```typescript
// apps/web/app/(auth)/sign-in/page.tsx
'use client'
import { createClient } from '@/lib/supabase/client'

export default function SignInPage() {
  const supabase = createClient()

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  const signInWithGitHub = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-[360px] flex flex-col items-center gap-6 px-4">
        {/* Display: 28px Semibold (UI-SPEC Typography) */}
        <h1 className="text-[28px] font-semibold text-foreground">Multiverse</h1>
        <p className="text-[15px] text-muted-foreground">Structured thinking. Live.</p>
        <div className="w-full flex flex-col gap-2">
          <button onClick={signInWithGoogle} className="...">Continue with Google</button>
          <button onClick={signInWithGitHub} className="...">Continue with GitHub</button>
        </div>
        <p className="text-[13px] text-muted-foreground text-center">
          By signing in you accept the terms of use.
        </p>
      </div>
    </main>
  )
}
```

Also requires: `apps/web/app/auth/callback/route.ts` — exchanges auth code for session cookie:
```typescript
// apps/web/app/auth/callback/route.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: (cs) => cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } }
    )
    await supabase.auth.exchangeCodeForSession(code)
  }
  return NextResponse.redirect(new URL('/', origin))
}
```

---

### `apps/web/app/(onboarding)/api-key/page.tsx` (component, request-response)

**Pattern source:** UI-SPEC.md Screen 2; RESEARCH.md Pattern 5 (key verification); D-04.

**Intended pattern:**
```typescript
// apps/web/app/(onboarding)/api-key/page.tsx
'use client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState } from 'react'

const schema = z.object({
  api_key: z.string().min(1, 'Required').startsWith('sk-ant-', 'Must start with sk-ant-'),
})

export default function ApiKeyOnboardingPage() {
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { isSubmitting } } = useForm({
    resolver: zodResolver(schema),
  })

  const onSubmit = async ({ api_key }: { api_key: string }) => {
    setError(null)
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/keys/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key }),
      credentials: 'include',
    })
    const data = await res.json()
    if (data.success) {
      // Toast + redirect to /
    } else {
      setError(data.error === 'invalid_key'
        ? "That key didn't verify. Check it's active and try again."
        : "Couldn't reach Anthropic. Check your connection and retry.")
    }
  }

  return (
    // Focused full-page layout, max-width 440px centered
    // Eye toggle: aria-label="Show API key" (masked) / "Hide API key" (revealed)
    // "Verify & Save" button: Accent fill, shows Loader2 spinner during isSubmitting
    <form onSubmit={handleSubmit(onSubmit)}>
      <input
        {...register('api_key')}
        type={showKey ? 'text' : 'password'}
        placeholder="sk-ant-..."
      />
      {/* Eye toggle button */}
      <button type="button" aria-label={showKey ? 'Hide API key' : 'Show API key'}
        onClick={() => setShowKey(s => !s)} />
      {error && <p className="text-destructive text-[13px]">{error}</p>}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : 'Verify & Save'}
      </button>
    </form>
  )
}
```

**Key constraints:**
- This page is reached via middleware redirect when `user.user_metadata.onboarding_complete` is falsy
- After success: must call Supabase to update `user_metadata.onboarding_complete = true`, then redirect to `/`
- Never POST the API key directly to Supabase — always route through Hono `/api/keys/verify`

---

### `apps/web/app/sessions/new/page.tsx` (component, CRUD)

**Pattern source:** UI-SPEC.md Screen 3; React Hook Form + Zod pattern from CLAUDE.md.

**Intended pattern:**
```typescript
// apps/web/app/sessions/new/page.tsx
'use client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'

const schema = z.object({
  title: z.string().optional(),
  mode: z.enum(['strategy', 'debate', 'red_team']),
})

export default function NewSessionPage() {
  const router = useRouter()
  const { register, handleSubmit, watch, setValue, formState: { isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { mode: 'strategy' },
  })

  const onSubmit = async (data: z.infer<typeof schema>) => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'include',
    })
    const { session } = await res.json()
    router.push(`/sessions/${session.id}`)
  }

  return (
    // Centered card (max-width 480px), Secondary surface
    // Mode selector: 3 radio-style cards (Strategy / Debate / Red Team)
    // Selected mode: Accent border ring (2px Indigo 500) on card
    // CTA: "Start session" button, Accent fill, full-width, 48px height
    <form onSubmit={handleSubmit(onSubmit)}>...</form>
  )
}
```

---

### `apps/web/app/sessions/[id]/page.tsx` (component, event-driven)

**Pattern source:** UI-SPEC.md Screen 4 (all subsections 4a–4d); RESEARCH.md Pattern 2 (Visual Viewport) + Pattern 3 (Realtime).

**Intended pattern:**
```typescript
// apps/web/app/sessions/[id]/page.tsx
'use client'
import { useViewport } from '@/hooks/use-viewport'
import { useSessionRealtime } from '@/hooks/use-session'
import { AnalyticsPanel } from '@/components/workspace/AnalyticsPanel'
import { BranchNavigator } from '@/components/workspace/BranchNavigator'
import { ChatStream } from '@/components/workspace/ChatStream'
import { InputBox } from '@/components/workspace/InputBox'

export default function WorkspacePage({ params }: { params: { id: string } }) {
  useViewport() // Sets --app-height and --keyboard-height CSS vars

  return (
    <div className="workspace-shell">
      <AnalyticsPanel sessionId={params.id} />
      <BranchNavigator sessionId={params.id} />
      <div className="relative flex-1 overflow-hidden">
        <ChatStream sessionId={params.id} />
        <InputBox sessionId={params.id} />
      </div>
    </div>
  )
}
```

**Key constraints:**
- `useViewport()` must be called at this level (workspace root) to set CSS vars before children render
- `AnalyticsPanel` is wrapped in a React Error Boundary (LAYOUT-07) — see AnalyticsPanel.tsx
- The workspace shell MUST use `.workspace-shell` CSS class (not inline `height: 100vh`)

---

### `apps/web/app/join/[code]/page.tsx` (component, request-response)

**Pattern source:** UI-SPEC.md Screen 6; D-01, D-02, D-03; RESEARCH.md SESS-04, SESS-08, SESS-10.

**Intended pattern:**
```typescript
// apps/web/app/join/[code]/page.tsx
// Server Component to SSR session info; client sub-component for the join form

import { createServerClient } from '@/lib/supabase/server'

export default async function JoinPage({ params }: { params: { code: string } }) {
  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('id, title, status, creator_id')
    .eq('short_code', params.code)
    .single()

  if (!session) {
    return <SessionNotFound /> // Error state: SearchX icon + "Session not found"
  }

  return <JoinForm session={session} />
  // JoinForm is 'use client' — handles display name input + Supabase anon sign-in
  // On submit: await localStorage.setItem() + await Supabase session → router.push (Pitfall 8)
}
```

**Client JoinForm pattern:**
```typescript
// 'use client' sub-component
// 1. supabase.auth.signInAnonymously() to get anon session
// 2. localStorage.setItem(`session_token_${sessionId}`, token) — MUST await before redirect
// 3. Insert guest row to session participants
// 4. router.push(`/sessions/${session.id}`)
// For frozen/closed sessions (D-03): redirect to workspace in read-only mode
// Button label: "Join session" (active) or "View session (read only)" (frozen/closed)
```

---

### `apps/web/app/settings/page.tsx` (component, CRUD)

**Pattern source:** UI-SPEC.md Screen 7; D-05, D-06.

**Intended pattern:**
```typescript
// apps/web/app/settings/page.tsx
// Two card sections:
// 1. "AI Connection" — masked API key input + "Update key" outline button + status indicator
// 2. "AI Response Limits" — number input (default 150) + "Save limits" Accent button

// Eye toggle: aria-label="Show API key" (masked) / "Hide API key" (revealed)
// Key status: Lucide CheckCircle2 (14px, Emerald #34d399) + "Key verified" label
// On "Update key": same verification flow as onboarding (POST /api/keys/verify)
// On "Save limits": PATCH /api/sessions creator_settings.api_response_cap
// Toast on success: "Settings saved."
```

---

### `apps/web/components/workspace/AnalyticsPanel.tsx` (component)

**Pattern source:** UI-SPEC.md Screen 4a (State A and State B); LAYOUT-07; D-07, D-08.

**Intended pattern:**
```typescript
// apps/web/components/workspace/AnalyticsPanel.tsx
'use client'
import { Component, type ReactNode } from 'react'
import { KeyRound, AlertTriangle } from 'lucide-react'

// Error Boundary wrapper (LAYOUT-07)
class AnalyticsPanelBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) {
      return (
        <div className="analytics-panel flex items-center justify-center bg-card">
          <AlertTriangle className="text-destructive" size={24} />
          <h2 className="text-[20px] font-semibold text-destructive">Visualization error</h2>
          <p className="text-[15px] text-muted-foreground">
            The Analyst is recalculating. Your chat is unaffected.
          </p>
        </div>
      )
    }
    return this.state.hasError ? null : this.props.children
  }
}

export function AnalyticsPanel({ hasApiKey }: { hasApiKey: boolean }) {
  return (
    <AnalyticsPanelBoundary>
      <div className="analytics-panel bg-card flex items-center justify-center">
        {!hasApiKey ? (
          // State A (D-07a): KeyRound icon + "Connect your API key" + "Go to Settings" link
          <StateNoKey />
        ) : (
          // State B (D-07b / D-08): logo monogram + "The AI will analyze your conversation here."
          <StateKeySet />
        )}
      </div>
    </AnalyticsPanelBoundary>
  )
}
```

**Key constraints:**
- Error Boundary MUST be a class component (React requirement — no hook-based boundaries)
- `analytics-panel` CSS class provides the 40% height via `--app-height` (not inline styles)
- `flex-shrink: 0` enforced by CSS class — never override inline

---

### `apps/web/components/workspace/BranchNavigator.tsx` (component, event-driven)

**Pattern source:** UI-SPEC.md Screen 4b; LAYOUT-05; D-09; RESEARCH.md CHAT-06.

**Intended pattern:**
```typescript
// apps/web/components/workspace/BranchNavigator.tsx
'use client'
// Phase 1: single "Main" chip + typing indicator

// Branch Navigator bar (48px, sticky, z-20)
// Background: linear-gradient(90deg, #312e81 0%, #09090b 60%) — Indigo 900 → Zinc 950
//
// Left: "Main" chip (Badge variant pill):
//   - Background: Indigo 500 at 20% opacity (#6366f1 / 0.2)
//   - Border: 1px solid #6366f1 (Indigo 500)
//   - Text: "Main" in 13px Regular, Indigo 300 (#a5b4fc)
//   - Left dot: 6px circle filled #6366f1 (Indigo 500)
//   - Touch target: 44px tall (hit area extended beyond visual chip height)
//
// Right: Typing indicator (Presence-driven, CHAT-06)
//   - Shows: "[Name] está escribiendo..." with Lucide PenLine 14px
//   - Hidden when no one is typing
//   - Max 1 line, truncate with ellipsis
//   - Throttle Presence track() to ~1s intervals (Pitfall 6)

export function BranchNavigator({ sessionId, typingUser }: {
  sessionId: string
  typingUser: string | null
}) {
  return (
    <div
      className="branch-navigator flex items-center px-4 gap-2"
      style={{ background: 'linear-gradient(90deg, #312e81 0%, #09090b 60%)' }}
    >
      <MainChip />
      {typingUser && <TypingIndicator name={typingUser} />}
    </div>
  )
}
```

---

### `apps/web/components/workspace/ChatStream.tsx` (component, event-driven)

**Pattern source:** UI-SPEC.md Screen 4c; RESEARCH.md CHAT-02, CHAT-03; Pattern 3 (Realtime).

**Intended pattern:**
```typescript
// apps/web/components/workspace/ChatStream.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import type { Message } from '@panelito/types'

// Auto-scroll logic (CHAT-03):
// - User is "at bottom" when scrollTop + clientHeight >= scrollHeight - 40
// - New message received AND user is at bottom → auto-scroll
// - User scrolled up → show "↓ New messages" float badge (Accent color)
// - Badge dismisses when user scrolls back to bottom

// Message bubble anatomy (UI-SPEC 4c):
// - Avatar: 32px circle, initial letter, color from getAvatarColor(author_id)
// - Author row: name (13px Regular) + timestamp (13px Regular, muted)
// - Message text: 15px Regular, line-height 1.5
// - Left border accent: 2px solid, author palette color

// Touch gestures (LAYOUT-06):
// - Double-tap: ephemeral reaction popover (4 emoji, 44px each, auto-dismiss 3s)
// - Long press (500ms): bottom sheet, "Fork" + "Pin to Panel" (both disabled in Phase 1)
// - Haptic on long press: navigator.vibrate(10)

export function ChatStream({ sessionId, messages }: {
  sessionId: string
  messages: Message[]
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showNewBadge, setShowNewBadge] = useState(false)

  // Subscribe to Realtime via useSessionRealtime hook
  // Auto-scroll logic driven by scroll position check

  return (
    <div ref={scrollRef} className="chat-stream">
      {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
      {showNewBadge && <NewMessagesBadge />}
    </div>
  )
}
```

---

### `apps/web/components/workspace/InputBox.tsx` (component, event-driven)

**Pattern source:** UI-SPEC.md Screen 4d; LAYOUT-04; CHAT-06.

**Intended pattern:**
```typescript
// apps/web/components/workspace/InputBox.tsx
'use client'
// Position: absolute, bottom anchored to window.visualViewport.height (LAYOUT-04)
// Height: 52px minimum (can expand for multiline)
// Background: --muted (Zinc 800), top border: 1px --border
//
// Send button: 44×44px, border-radius 8px
//   - Accent fill when input non-empty
//   - --muted fill when empty
//   - aria-label="Send message" (REQUIRED — UI-SPEC Accessibility table)
//   - Icon: Lucide ArrowUp 18px
//
// Locked state (CHAT-06 scaffold):
//   - Input opacity 0.5, placeholder "Waiting for AI response..."
//   - Send button disabled
//
// Frozen/Closed state (D-03):
//   - Input fully disabled, placeholder "Session is paused — input disabled." / "Session has ended."
//   - Full-width banner above input (height 36px, Destructive at 10% opacity)

export function InputBox({ sessionId, isLocked, sessionStatus }: {
  sessionId: string
  isLocked: boolean
  sessionStatus: 'active' | 'frozen' | 'closed'
}) {
  const [value, setValue] = useState('')
  // Typing presence: throttle track() to 1s (Pitfall 6 — never call on every keystroke)
  // On send: await INSERT to messages table via Supabase client, then broadcast via Realtime
  return (
    <div className="input-box flex items-center gap-2 px-2 bg-muted border-t border-border">
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={isLocked ? 'Waiting for AI response...' : 'Message...'}
        disabled={isLocked || sessionStatus !== 'active'}
        className="flex-1 bg-transparent outline-none text-[15px]"
      />
      <button
        type="button"
        aria-label="Send message"
        disabled={!value.trim() || isLocked || sessionStatus !== 'active'}
        className="w-11 h-11 rounded-lg flex items-center justify-center
                   disabled:bg-muted enabled:bg-primary"
      >
        <ArrowUp size={18} />
      </button>
    </div>
  )
}
```

---

### `apps/web/hooks/use-viewport.ts` (hook, event-driven)

**Pattern source:** RESEARCH.md Pattern 2 — Visual Viewport API (complete implementation provided).

**Intended pattern (exact from RESEARCH.md):**
```typescript
// apps/web/hooks/use-viewport.ts
'use client'
import { useEffect } from 'react'

export function useViewport() {
  useEffect(() => {
    // --app-height already set by inline <script> in layout.tsx head
    // This hook only manages --keyboard-height updates
    const appHeight = window.innerHeight

    const updateKeyboardHeight = () => {
      const kh = appHeight - (window.visualViewport?.height ?? appHeight)
      document.documentElement.style.setProperty('--keyboard-height', `${Math.max(0, kh)}px`)
    }

    window.visualViewport?.addEventListener('resize', updateKeyboardHeight)
    return () => window.visualViewport?.removeEventListener('resize', updateKeyboardHeight)
  }, [])
}
```

**Critical anti-patterns to avoid:**
- Do NOT recalculate `--app-height` inside this hook's `visualViewport.resize` handler — only `--keyboard-height` is dynamic
- Do NOT use `window.resize` event — it does not fire on iOS when keyboard opens
- Do NOT use `100vh`, `dvh`, or `svh` anywhere in the workspace shell

---

### `apps/web/hooks/use-session.ts` (hook, event-driven)

**Pattern source:** RESEARCH.md Pattern 3 — Supabase Realtime Chat (complete implementation provided).

**Intended pattern (from RESEARCH.md):**
```typescript
// apps/web/hooks/use-session.ts
'use client'
import { createClient } from '@/lib/supabase/client'
import { useEffect } from 'react'
import type { Message } from '@panelito/types'

export function useSessionRealtime(
  sessionId: string,
  onMessage: (msg: Message) => void
) {
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`session:${sessionId}`)

    channel
      .on('broadcast', { event: 'new_message' }, ({ payload }) => {
        onMessage(payload as Message)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [sessionId, onMessage])
}
```

---

### `apps/web/hooks/use-typing.ts` (hook, event-driven)

**Pattern source:** RESEARCH.md Pattern 3 — Supabase Presence; Pitfall 6 (throttle warning).

**Intended pattern:**
```typescript
// apps/web/hooks/use-typing.ts
'use client'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useCallback, useRef } from 'react'

export function useTypingPresence(sessionId: string, userId: string) {
  const supabase = createClient()
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const lastTrackRef = useRef<number>(0)

  useEffect(() => {
    const channel = supabase.channel(`presence:${sessionId}`, {
      config: { presence: { key: userId } },
    })
    channelRef.current = channel
    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [sessionId, userId])

  // Throttled: track at most once per second (Pitfall 6)
  const trackTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastTrackRef.current < 1000) return
    lastTrackRef.current = now
    channelRef.current?.track({ typing: true })
  }, [])

  const clearTyping = useCallback(() => {
    channelRef.current?.track({ typing: false })
  }, [])

  return { trackTyping, clearTyping }
}
```

---

### `apps/web/lib/supabase/client.ts` (utility, request-response)

**Pattern source:** RESEARCH.md Architecture Patterns; Supabase SSR docs.

**Intended pattern:**
```typescript
// apps/web/lib/supabase/client.ts
// Browser-only client — use in Client Components and hooks
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}
```

---

### `apps/web/lib/supabase/server.ts` (utility, request-response)

**Pattern source:** RESEARCH.md Architecture Patterns; Supabase SSR docs.

**Intended pattern:**
```typescript
// apps/web/lib/supabase/server.ts
// Server-only client — use in Server Components and Route Handlers ONLY
// NEVER import this in a Client Component
import { createServerClient as createSSRClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerClient() {
  const cookieStore = await cookies()
  return createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cs) => cs.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        ),
      },
    }
  )
}
```

**Critical constraint:** Never call `supabase.auth.getSession()` — always use `supabase.auth.getUser()` for server-side auth checks.

---

### `apps/web/lib/utils.ts` (utility)

**Pattern source:** RESEARCH.md Code Examples — Avatar Color Hash; shadcn/ui `cn()` convention.

**Intended pattern (exact from RESEARCH.md):**
```typescript
// apps/web/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// shadcn standard cn() helper
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Deterministic hash of author_id → 6-slot avatar color palette (UI-SPEC + CHAT-02)
const AVATAR_COLORS = ['#818cf8', '#34d399', '#fbbf24', '#fb7185', '#38bdf8', '#a78bfa']

export function getAvatarColor(authorId: string): string {
  const hash = authorId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
```

---

### `apps/api/src/index.ts` (config — Hono entry point)

**Pattern source:** RESEARCH.md Standard Stack (`@hono/node-server` for Railway); CLAUDE.md Hono choice.

**Intended pattern:**
```typescript
// apps/api/src/index.ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { keys } from './routes/keys'
import { sessions } from './routes/sessions'
import { ai } from './routes/ai'

const app = new Hono()

// CORS: lock to web app origin (AI-02 security requirement)
app.use('/api/*', cors({
  origin: process.env.WEB_URL ?? 'http://localhost:3000',
  credentials: true,
}))

app.route('/api/keys', keys)
app.route('/api/sessions', sessions)
app.route('/api/sessions', ai)  // handles /api/sessions/:id/invoke

// Railway requires reading PORT from env (RESEARCH.md)
const port = parseInt(process.env.PORT ?? '3001', 10)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API running on http://localhost:${info.port}`)
})
```

---

### `apps/api/src/routes/keys.ts` (route, request-response)

**Pattern source:** RESEARCH.md Pattern 5 — Hono API Key Verification (complete implementation provided).

**Intended pattern (exact from RESEARCH.md):**
```typescript
// apps/api/src/routes/keys.ts
import Anthropic from '@anthropic-ai/sdk'
import { Hono } from 'hono'
import { z } from 'zod'
import { encryptKey, decryptKey } from '../lib/crypto'
import { createServiceClient } from '../lib/supabase'

const keys = new Hono()

const verifySchema = z.object({ api_key: z.string().min(1) })

keys.post('/verify', async (c) => {
  const body = await c.req.json()
  const parsed = verifySchema.safeParse(body)
  if (!parsed.success) return c.json({ success: false, error: 'invalid_request' }, 400)

  const { api_key } = parsed.data
  const client = new Anthropic({ apiKey: api_key })

  try {
    await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    })
    const encrypted = encryptKey(api_key, process.env.KEY_ENCRYPTION_SECRET!)
    const supabase = createServiceClient()
    // Upsert into creator_settings, update user_metadata.onboarding_complete
    await supabase.from('creator_settings').upsert({ user_id: userId, encrypted_api_key: encrypted })
    return c.json({ success: true })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return c.json({ success: false, error: 'invalid_key' }, 400)
    }
    return c.json({ success: false, error: 'network_error' }, 503)
  }
})

export { keys }
```

**Key constraints:**
- `KEY_ENCRYPTION_SECRET` env var MUST be set in Railway before deployment (Pitfall 7)
- Use `Anthropic.AuthenticationError` for typed error checking — not generic catch
- Never return the API key or encrypted form to the browser

---

### `apps/api/src/routes/sessions.ts` (route, CRUD)

**Pattern source:** RESEARCH.md Architecture Patterns; Code Examples — Short Session Code Generation.

**Intended pattern:**
```typescript
// apps/api/src/routes/sessions.ts
import { Hono } from 'hono'
import { z } from 'zod'
import { createServiceClient } from '../lib/supabase'

const sessions = new Hono()

// 6-char short code generator (from RESEARCH.md Code Examples)
function generateShortCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  // no ambiguous chars (0, O, I, 1)
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('')
}

const createSchema = z.object({
  title: z.string().optional(),
  mode: z.enum(['strategy', 'debate', 'red_team']).default('strategy'),
})

// POST /api/sessions — create new session
sessions.post('/', async (c) => {
  const body = await c.req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'invalid_request' }, 400)

  const supabase = createServiceClient()
  const shortCode = generateShortCode()
  const { data, error } = await supabase
    .from('sessions')
    .insert({ ...parsed.data, short_code: shortCode, creator_id: userId })
    .select()
    .single()

  if (error) return c.json({ error: 'db_error' }, 500)
  return c.json({ session: data }, 201)
})

// PATCH /api/sessions/:id — freeze or close
sessions.patch('/:id', async (c) => {
  const sessionId = c.req.param('id')
  const { status } = await c.req.json()
  // Verify creator_id === current user before mutating
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('sessions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('creator_id', userId)  // RLS + explicit check (V4 Access Control)

  if (error) return c.json({ error: 'unauthorized_or_not_found' }, 403)
  return c.json({ success: true })
})

export { sessions }
```

---

### `apps/api/src/routes/ai.ts` (route, request-response — scaffolded only)

**Pattern source:** RESEARCH.md Pattern 4 — Anthropic Prompt Caching Architecture.

**Intended pattern (scaffolded structure, fires in Phase 2):**
```typescript
// apps/api/src/routes/ai.ts
// PHASE 1: Route exists but returns 501 Not Implemented
// PHASE 2: Will stream Claude responses via SSE
import { Hono } from 'hono'
import Anthropic from '@anthropic-ai/sdk'
import type { Message } from '@panelito/types'

const ai = new Hono()

// Static system prompt (must be >= 1,024 tokens to activate caching — AI-11)
const SYSTEM_PROMPT_TEXT = `You are the Analyst for Project Multiverse...
[Full system prompt — expand to >= 1,024 tokens before Phase 2]`

// Prompt builder with cache_control on static prefix (AI-11 architecture)
export const buildPromptMessages = (history: Message[], userMessage: string) => ({
  system: [
    {
      type: 'text' as const,
      text: SYSTEM_PROMPT_TEXT,
      cache_control: { type: 'ephemeral' as const },
      // CRITICAL: No dynamic content (timestamps, session IDs) in this block — cache miss every call
    },
  ],
  messages: [
    ...history.slice(-8).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: userMessage },
  ],
})

// POST /api/sessions/:id/invoke — Phase 1: scaffolded, not active
ai.post('/:id/invoke', async (c) => {
  return c.json({ error: 'not_implemented' }, 501)
})

export { ai }
```

---

### `apps/api/src/lib/supabase.ts` (utility, request-response)

**Pattern source:** RESEARCH.md Architecture Patterns; Security domain (service role bypasses RLS).

**Intended pattern:**
```typescript
// apps/api/src/lib/supabase.ts
// Service role client — bypasses RLS for server-side mutations
// NEVER expose service role key to browser
import { createClient } from '@supabase/supabase-js'

export function createServiceClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,  // service role — server only
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
```

**Critical constraint:** Service role key must NEVER be in any `NEXT_PUBLIC_*` env var — it goes only in Hono's server-side `.env`.

---

### `apps/api/src/lib/crypto.ts` (utility)

**Pattern source:** RESEARCH.md Security Domain — AES-256-GCM; "Don't Hand-Roll" table.

**Intended pattern:**
```typescript
// apps/api/src/lib/crypto.ts
// AES-256-GCM via Node.js native crypto — no third-party encryption library (RESEARCH.md)
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

export function encryptKey(plaintext: string, secret: string): string {
  // secret must be exactly 32 bytes (256-bit) — derive with SHA-256 if needed
  const key = Buffer.from(secret.padEnd(32).slice(0, 32))
  const iv = randomBytes(12)  // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Store: iv(24 hex) + authTag(32 hex) + ciphertext(hex)
  return iv.toString('hex') + authTag.toString('hex') + encrypted.toString('hex')
}

export function decryptKey(ciphertext: string, secret: string): string {
  const key = Buffer.from(secret.padEnd(32).slice(0, 32))
  const iv = Buffer.from(ciphertext.slice(0, 24), 'hex')
  const authTag = Buffer.from(ciphertext.slice(24, 56), 'hex')
  const encrypted = Buffer.from(ciphertext.slice(56), 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted) + decipher.final('utf8')
}
```

**Key constraints:**
- GCM mode provides authenticated encryption — prevents tampering (RESEARCH.md ASVS V6)
- IV must be random per encryption — never reuse IV with same key
- `KEY_ENCRYPTION_SECRET` env var: must be 32+ chars (padded/sliced to 32 bytes here)
- Production: rotate this key annually; re-encrypt stored API keys on rotation

---

## Shared Patterns

### Authentication — `supabase.auth.getUser()` (never `getSession()`)
**Source:** RESEARCH.md Anti-Patterns; Supabase SSR docs
**Apply to:** `apps/web/middleware.ts`, `apps/web/lib/supabase/server.ts`, all Hono routes that check user identity
```typescript
// CORRECT — validates JWT
const { data: { user } } = await supabase.auth.getUser()

// WRONG — does NOT validate JWT
const { data: { session } } = await supabase.auth.getSession() // NEVER in server code
```

### Zod Input Validation
**Source:** RESEARCH.md Standard Stack; CLAUDE.md "React Hook Form + Zod"
**Apply to:** All Hono route handlers (server-side), all React Hook Form pages (client-side)
```typescript
// Server (Hono): validate before any DB operation
const schema = z.object({ ... })
const parsed = schema.safeParse(body)
if (!parsed.success) return c.json({ error: 'invalid_request' }, 400)

// Client (React Hook Form): zodResolver wires Zod into form validation
const { register, handleSubmit } = useForm({ resolver: zodResolver(schema) })
```

### Error Handling — Hono Routes
**Source:** RESEARCH.md Pattern 5 (keys.ts); CLAUDE.md Hono choice
**Apply to:** All `apps/api/src/routes/*.ts` files
```typescript
try {
  // ... operation
  return c.json({ success: true })
} catch (e) {
  if (e instanceof SpecificError) {
    return c.json({ error: 'typed_error_code' }, 4xx)
  }
  console.error('[route-name]', e)
  return c.json({ error: 'internal_error' }, 500)
}
```

### Supabase Client Split (server vs client)
**Source:** RESEARCH.md Anti-Patterns; Architecture Patterns
**Apply to:** Every file that imports Supabase
- Client Components + hooks → import from `@/lib/supabase/client` (uses `createBrowserClient`)
- Server Components + Route Handlers → import from `@/lib/supabase/server` (uses `createServerClient`)
- Hono API routes → import from `../lib/supabase` (uses service role `createClient`)
- **NEVER** import `server.ts` in a `'use client'` file

### Typing Indicator Throttle
**Source:** RESEARCH.md Pitfall 6
**Apply to:** `apps/web/hooks/use-typing.ts`, any component that calls Presence `track()`
```typescript
// Throttle to at most 1 call per second
const THROTTLE_MS = 1000
if (Date.now() - lastTrack.current < THROTTLE_MS) return
lastTrack.current = Date.now()
channel.track({ typing: true })
```

### Touch Target Minimum Size
**Source:** UI-SPEC.md Spacing Scale; iOS HIG
**Apply to:** All interactive elements in workspace components
- Minimum touch target: **44px × 44px** — use padding or explicit min-height/min-width
- Input box minimum height: 52px
- Branch Navigator bar: 48px

### CSS Variable Workspace Layout (never `100vh`)
**Source:** RESEARCH.md Pattern 2 Anti-patterns; UI-SPEC.md Layout Mathematics
**Apply to:** `apps/web/app/sessions/[id]/page.tsx`, all workspace CSS classes
```css
/* CORRECT */
height: var(--app-height);
height: calc(var(--app-height) * 0.40);

/* CONTRACT VIOLATIONS */
height: 100vh;   /* iOS bug */
height: dvh;     /* broken in older iOS */
height: svh;     /* same problem */
```

---

## No Analog Found

All 30+ files in this phase are new — no analog exists in the codebase. All patterns documented above derive from:

| Pattern Source | Applies To |
|---------------|-----------|
| RESEARCH.md Pattern 1 (Supabase middleware) | `middleware.ts` |
| RESEARCH.md Pattern 2 (Visual Viewport) | `use-viewport.ts`, `globals.css` workspace classes |
| RESEARCH.md Pattern 3 (Realtime chat) | `use-session.ts`, `use-typing.ts`, `ChatStream.tsx` |
| RESEARCH.md Pattern 4 (Prompt caching) | `apps/api/src/routes/ai.ts` |
| RESEARCH.md Pattern 5 (Key verification) | `apps/api/src/routes/keys.ts` |
| RESEARCH.md Pattern 6 (Tailwind v4 CSS) | `globals.css` |
| RESEARCH.md Code Examples (SQL schema) | `supabase/migrations/0001_initial_schema.sql` |
| RESEARCH.md Code Examples (avatar hash) | `apps/web/lib/utils.ts` |
| RESEARCH.md Code Examples (short code) | `apps/api/src/routes/sessions.ts` |
| UI-SPEC.md all screens | All `apps/web/components/workspace/*.tsx` |
| CLAUDE.md stack conventions | All files (library choices, versions) |

---

## Metadata

**Analog search scope:** Entire `/home/jgm/dev/projects/web-projects/panelito` repository (excluding `.planning/` and `.claude/`)
**Source files found:** 0 (greenfield — no TypeScript, JavaScript, CSS, or SQL application files exist)
**Pattern extraction date:** 2026-06-09
**All patterns are prescriptive** — drawn from research documents, not extracted from existing code
