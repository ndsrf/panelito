# Phase 3: The Multiverse - Pattern Map

**Date:** 2026-06-17
**Phase:** 03
**Status:** Pattern Mapping Complete

## File Classification & Analogs

| File to Create/Modify | Role | Data Flow | Closest Analog |
|-----------------------|------|-----------|----------------|
| `supabase/migrations/0006_branches_table.sql` | Schema | Database | `0005_reactions_personas.sql` |
| `apps/api/src/routes/branches.ts` | API Router | HTTP -> DB | `apps/api/src/routes/sessions.ts` |
| `apps/api/src/routes/messages.ts` | API Router | HTTP -> DB | (Existing) |
| `apps/api/src/routes/ai.ts` | API Router | HTTP -> AI | (Existing) |
| `apps/web/store/session-store.ts` | State Store | React -> Zustand | (Existing) |
| `apps/web/components/workspace/BranchNavigator.tsx` | UI Component | React | (Existing Placeholder) |
| `apps/web/components/workspace/MessageList.tsx` | UI Component | React | (Existing) |
| `apps/api/src/services/labeler.ts` | AI Service | API -> AI | `apps/api/src/lib/auto-name.ts` |

## Concrete Code Excerpts

### 1. API Router Pattern (from `sessions.ts`)
The new `branches.ts` router should follow the `Hono` pattern with `requireAuth` and `toClientError` helpers.

```typescript
export const branchesRouter = new Hono<{ Variables: AuthVariables }>()

branchesRouter.post('/fork', requireAuth, async (c) => {
  const user = c.get('user')
  // ... implementation
})
```

### 2. State Store Pattern (from `session-store.ts`)
Extend `SessionStoreState` to include branch state.

```typescript
interface SessionStoreState {
  messages: Message[]
  activeBranchId: string | null;
  branches: Branch[];
  // ...
  setBranchId: (id: string) => void;
}
```

### 3. Auto-Labeling Pattern (from `auto-name.ts`)
The `labeler.ts` service will replace the deterministic `deriveTitle` logic with a Flash AI call, but keep the asynchronous "maybe" trigger pattern.

```typescript
export async function maybeAutoLabel(
  supabase: SupabaseClient,
  branchId: string
): Promise<void> {
  // 1. Fetch source message context
  // 2. Invoke Flash AI model
  // 3. Update branch label in DB
  // 4. Broadcast 'branch_update' event
}
```

### 4. Database Migration Pattern (from `0001_initial_schema.sql`)
Use `materialized paths` for the `branches` table ancestry to match the `messages.path_id` design.

```sql
CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES sessions(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES branches(id),
  path_id public.ltree NOT NULL, -- Or dot-separated text
  label text,
  color text,
  fork_message_id uuid REFERENCES messages(id)
);
```

## Architectural Guidelines

- **Branch Isolation**: Ensure all `GET /messages` calls and AI context assembly filter by `path_id`.
- **Ancestry Chain**: Use the materialized path to fetch the full lineage of a branch (all ancestors).
- **Zustand Hydration**: Switching branches must trigger `panel-store.ts` hydration to update the analytics view instantly.
