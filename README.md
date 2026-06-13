# Panelito — Project Multiverse

> A synchronous, multi-user collaborative workspace where groups debate and explore ideas alongside specialized AI personas.

## Deployment (Unified)

Panelito is designed to be deployed as a single Vercel project with a Supabase backend.

### 1. Supabase Setup
1. Create a new project at [supabase.com](https://supabase.com).
2. Apply the migrations in `supabase/migrations/` to your project.
3. **Crucial:** Ensure the `pg_cron` extension is enabled and the auto-freeze job is scheduled (see `0004_auto_freeze_pg_cron.sql`).

### 2. Vercel Setup (1 Project)
1. Connect your GitHub repository to Vercel.
2. Set the **Root Directory** to `apps/web`.
3. Vercel will automatically detect the Turborepo monorepo.
4. Add the following **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase Project URL.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase `anon` key.
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase `service_role` key (found in Settings -> API).
   - `KEY_ENCRYPTION_SECRET`: A 64-character hex string for API key encryption.
   - `NEXT_PUBLIC_API_URL`: `/api` (this points the frontend to the internal Hono bridge).
   - `ALLOWED_ORIGINS`: Your Vercel domain (e.g., `https://panelito.vercel.app`).

### Why Unified?
By hosting the Hono API inside Next.js Route Handlers:
- **Zero CORS:** Both live on the same domain.
- **Cost Effective:** Fits within the Vercel Hobby tier (1 project).
- **Serverless:** Uses Supabase `pg_cron` for background tasks, allowing the API to remain stateless.

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
