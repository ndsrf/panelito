---
title: Bot External Tools and Scheduler Design
date: 2026-07-15
context: Socratic discussion about future bot capabilities
---

# Bot External Tools and Scheduler Design

## Summary of Decisions

This document designs the global utility toolkit and Realtime-backed video sync for bots in a future phase.

### 1. Available Tools in Global Toolkit
All bots have access to a unified toolkit to keep the initial orchestration simple:
* **`search_web(query)`**: Text-based web search for factual queries.
* **`generic_delay_scheduler(delay_seconds, prompt)`**: Enqueues a server-side callback to prompt the agent. Used to implement soft-nudge coaching timers with mid-session checkpoints.
* **`check_weather(location)`**: Returns local weather conditions.
* **`check_travel_time(origin, destination, mode)`**: Calculates transit estimates between points.
* **`get_current_time()`**: Reads absolute server time matching a configured `TIMEZONE` in `.env`. Runs only on-demand when the bot requests it.

### 2. Rich Media & Image Strategy
* **`search_images(query)`**: Search existing images on the web.
* **`generate_image(prompt)`**: Create new AI images (e.g., DALL-E/Stable Diffusion).
* **Execution Rule:** Search first to save cost/latency, and generate only if strictly necessary.
* **Temporary Storage:** Images are fetched/generated, stored temporarily in Supabase Storage, and automatically purged via an auto-expiry TTL lifecycle rule to avoid ballooning storage.

### 3. YouTube Search & Synchronized Playback
* **`search_youtube(query)`**: Search YouTube videos.
* **`VideoSyncWidget`**: If selected, the frontend renders a synced player.
* **Realtime Sync:** Uses Supabase Realtime channel broadcasts to propagate playback state (`play`, `pause`, `seek`, `timestamp`) across all participants in the session branch in real time.
