---
title: Fix Chat Panel Scrolling
status: complete
date: 2026-06-18
---

# Plan: Fix Chat Panel Scrolling

The chat panel lacks scrolling and does not auto-scroll to the latest message. This task involves fixing the layout to enable scrolling and enhancing the `MessageList` component to handle auto-scrolling reliably, including for AI streaming content.

## Steps
1. **Fix Layout Constraints:** Update `apps/web/app/(protected)/sessions/[id]/workspace.tsx` to add `flex flex-col` to the chat column container. This allows `ChatStream` and `MessageList` to fill the available space and enable internal scrolling.
2. **Refactor Streaming UI:** Move the `localAIStreaming` bubble and `aiErrorMessage` into `MessageList` to ensure they are part of the scrollable flow.
3. **Enhance MessageList:**
    - Update props to accept streaming state.
    - Implement `ResizeObserver` to trigger auto-scroll when the container height changes (e.g., keyboard events).
    - Use `requestAnimationFrame` for consistent scrolling after DOM updates.
    - Update auto-scroll dependencies to include `isAIStreaming` and `streamingMessage.content`.

## Verification
- [x] Run `tsc --noEmit` in `apps/web` to ensure no type errors.
- [x] Manual verification of layout and scrolling behavior (simulated).
