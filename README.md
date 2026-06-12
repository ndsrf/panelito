# Panelito — Project Multiverse

> A synchronous, multi-user collaborative workspace where groups debate and explore ideas alongside specialized AI personas.

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Start Supabase local stack (requires Docker)
supabase start

# 3. Copy env files and fill values from `supabase status`
cp .env.example apps/web/.env.local
cp .env.example apps/api/.env
# Fill in SUPABASE URLs, keys, and KEY_ENCRYPTION_SECRET

# 4. Start all apps
pnpm dev
```

## URLs

| Service | URL |
|---------|-----|
| Web (Next.js) | http://localhost:4000 |
| API (Hono) | http://localhost:8787 |
| Supabase Studio | http://localhost:54323 |
| Supabase API | http://localhost:54321 |

## Supabase Commands

```bash
# Start local Supabase stack
supabase start

# Apply migrations (after adding a new migration file)
supabase db reset

# Check local stack status (prints URLs and API keys)
supabase status

# Stop local stack
supabase stop
```

## Workspace Structure

```
panelito/
├── apps/
│   ├── web/          # Next.js 15 App Router (port 3000)
│   └── api/          # Hono Node.js API (port 8787)
├── packages/
│   └── types/        # Shared TypeScript types (@panelito/types)
└── supabase/
    ├── config.toml   # Local dev configuration
    └── migrations/   # SQL migrations tracked in git
```

## Tech Stack

- **Frontend:** Next.js 15 (App Router), Tailwind v4, shadcn/ui, Zustand, Framer Motion
- **Backend:** Hono 4, Node.js 22
- **Database:** Supabase Postgres, Realtime, Auth
- **AI:** Claude via Anthropic SDK (BYOK — Bring Your Own Key)
- **Monorepo:** Turborepo + pnpm workspaces

## Development

```bash
pnpm dev          # Start all apps in parallel
pnpm build        # Build all apps
pnpm typecheck    # TypeScript check all packages
pnpm lint         # Lint all packages
```
