---
title: Fix Guest Join Flow and Display Name
slug: guest-join-auth-fix
date: 2026-06-18
status: complete
---

# Plan: Fix Guest Join Flow and Display Name

## Problem
1. Guests joining via an invite link were being redirected to the sign-in page after entering their name.
2. Once joined, guests were appearing as "Invitado" instead of their chosen display name.

## Approach
1. **Redirect Fix**: Update the `joinSession` server action in `apps/web/app/join/[code]/actions.ts` to set the Supabase session cookies directly on the server using `createServerClient` before redirecting.
2. **Display Name Fix (API)**:
    - Update the guest join endpoint in `apps/api/src/routes/sessions.ts` to pass the `display_name` to `signInAnonymously`, storing it in `user_metadata.full_name`.
    - Update the message insertion endpoint in `apps/api/src/routes/messages.ts` to resolve the display name from `user_metadata` as a fallback if not provided in the request body.
3. **Display Name Fix (Web)**:
    - Update `apps/web/components/workspace/InputBox.tsx` to consistently send the `display_name` in the message POST body using the correctly derived `displayName` prop.

## Verification
- Guest join flow should correctly set cookies via the server action.
- Redirect to `/sessions/[id]` should succeed without triggering the auth gate.
- Messages sent by guests should show their chosen display name.
- Typing indicators should show the chosen display name.
- Names should persist after page reload (via metadata fetch on server).
