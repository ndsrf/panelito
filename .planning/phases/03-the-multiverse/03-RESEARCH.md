# Phase 3: The Multiverse - Research

**Date:** 2026-06-17
**Phase:** 03
**Status:** Research Complete

## Executive Summary

The "Multiverse" conversation branching engine is a core differentiator for Panelito. While the initial database schema included `parent_id` and `path_id` on the `messages` table, the actual branching logic, branch metadata management, and UI components are not yet implemented. This phase will require a new `branches` table, updated API routes for ancestry-aware message retrieval, and a dynamic `BranchNavigator` component.

## Key Findings

### 1. Database & Schema
- **Missing Table:** A `branches` table is required to store branch metadata (label, color, parent, status).
- **Materialized Paths:** The `path_id` on the `messages` table should use a dot-separated string (e.g., `main.b1.b2`) to allow for efficient ancestry queries using Postgres `LIKE` or ltree-style operations.
- **Migration Needed:** A new migration (`0006_branches_table.sql`) is required.

### 2. API Refactoring
- **Hardcoded Main:** Current endpoints for messages and AI are hardcoded to the 'main' branch.
- **New Router:** A `branches.ts` router is needed to handle `/fork`, `/list`, and `/archive`.
- **Ancestry-Aware Queries:** Message retrieval must be updated to fetch all messages in the ancestry of the active branch.
- **AI Context Isolation:** The AI facilitator must filter history by `path_id` to prevent cross-branch context bleed.

### 3. State Management
- **Zustand Stores:** `session-store.ts` needs to track `activeBranchId` and the `branches` list.
- **Cross-Store Sync:** Switching branches must trigger a re-render of the `AnalyticsPanel` via hydration from the last stable snapshot.

### 4. UI & Interaction
- **BranchNavigator:** Needs to evolve from a static placeholder to a dynamic, horizontally-scrolling list with auto-centering.
- **MessageList:** Needs logic to visually dim ancestor messages and insert a "Branch Point" divider.
- **InputBox:** Needs a visual indicator of the active branch and must pass the `activeBranchId` to the API.

### 5. AI Auto-Labeling (AI-09)
- **Flash Model Implementation:** Use Claude 3 Haiku (or equivalent Flash model) to generate 2-3 word semantic labels for new branches at the moment of forking.

## Relevant Locations

- `supabase/migrations/0006_branches_table.sql` (New)
- `apps/api/src/routes/branches.ts` (New)
- `apps/api/src/routes/messages.ts` (Update)
- `apps/api/src/routes/ai.ts` (Update)
- `apps/web/store/session-store.ts` (Update)
- `apps/web/components/workspace/BranchNavigator.tsx` (Update)
- `apps/web/components/workspace/MessageList.tsx` (Update)
- `apps/web/components/workspace/InputBox.tsx` (Update)

## Validation Architecture

### Dimension 8: Verification Gaps
- **Isolation Test:** Verify that a prompt in Branch B does not include messages from Branch A.
- **Ancestry Test:** Verify that switching to a child branch correctly displays all ancestor messages back to the trunk.
- **Limit Test:** Enforce and verify the 50-branch limit at both the API and UI layers.
- **Snapshot Test:** Verify the analytics panel correctly hydrates the specific snapshot associated with the active branch's latest AI response.
