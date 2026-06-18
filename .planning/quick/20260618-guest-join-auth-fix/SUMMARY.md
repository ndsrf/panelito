---
title: Fix Guest Join Flow and Display Name
slug: guest-join-auth-fix
date: 2026-06-18
status: complete
---

# Summary: Fix Guest Join Flow and Display Name

## Changes
### 1. Authentication & Redirect
- Modified `apps/web/app/join/[code]/actions.ts`:
    - Imported `createServerClient` and added `supabase.auth.setSession` call.
    - This ensures authentication cookies are set on the server before the client redirects to the protected workspace.
- Modified `apps/web/app/join/[code]/join-form.tsx`:
    - Updated to rely on server-side cookie setting while maintaining client-side hydration.

### 2. Guest Identity Persistence
- Modified `apps/api/src/routes/sessions.ts`:
    - Updated `signInAnonymously` to include `display_name` in the Supabase user metadata.
- Modified `apps/api/src/routes/messages.ts`:
    - Refactored display name resolution to prioritize request body but fall back to user metadata for both guests and creators.
- Modified `apps/web/components/workspace/InputBox.tsx`:
    - Updated to consistently send the `display_name` prop in message POSTs.

## Result
The guest join flow is now fully functional and polished. Guests are correctly authenticated without redirects to sign-in, and their chosen display names are consistently rendered across messages, typing indicators, and page reloads.
