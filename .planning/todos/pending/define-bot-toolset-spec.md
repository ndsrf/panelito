---
title: Define Bot Toolset Specifications and Interface Schemas
date: 2026-07-15
priority: medium
---

# Define Bot Toolset Specifications and Interface Schemas

## Tasks
- [ ] Define the JSON Schema models for each of the global tools:
  - `search_web`
  - `generic_delay_scheduler`
  - `check_weather`
  - `check_travel_time`
  - `get_current_time`
  - `search_images`
  - `generate_image`
  - `search_youtube`
- [ ] Define `.env.example` update for the `TIMEZONE` setting.
- [ ] Specify the database schema or bucket TTL rules in Supabase for temporary image hosting.
- [ ] Write the frontend protocol/events for Supabase Realtime synchronized YouTube playback.
