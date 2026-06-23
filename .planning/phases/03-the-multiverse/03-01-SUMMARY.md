---
phase: 03-the-multiverse
plan: 01
subsystem: database, api
tags: [supabase, hono, ltree, branching, validation]

# Dependency graph
requires:
  - phase: 02-ai-analytics
    provides: messages.role, prompt assembly, stream adapter pattern

provides:
  - Migration 0007: public.branches table, messages.branch_id column, on_session_created trigger
  - Branch auto-labeling service: generateBranchLabel (uses active provider's flash model)
  - Branches API Router: POST /fork, GET /, PATCH /:branchId
  - Ancestry-aware message retrieval and AI context isolation

affects:
  - 03-02 (navigation-and-state: needs branch listing and switching endpoints)
  - 03-03 (branching-experience: needs message fork endpoints and ancestry messages)
  - 03-04 (management-hardening: needs branch patching and limits)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Path-based ancestry query using array membership `.in('path_id', ancestorPaths)`
    - DB trigger `on_session_created_trigger` ensuring default 'main' branch for all new sessions

key-files:
  created:
    - supabase/migrations/0007_branches_table.sql
    - apps/api/src/services/labeler.ts
    - apps/api/src/routes/branches.ts
  modified:
    - apps/api/src/index.ts
    - apps/api/src/routes/messages.ts
    - apps/api/src/routes/ai.ts

key-decisions:
  - "renamed migration to 0007_branches_table.sql since 0006 was occupied by multi_provider_keys"
  - "resolved branch ancestry query by generating the array of dot-separated ancestor path prefixes in TS and using Supabase's .in() filter"
  - "defined on_session_created database trigger to guarantee every session has a 'main' branch automatically"
