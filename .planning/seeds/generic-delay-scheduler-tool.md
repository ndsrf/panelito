---
title: Generic Delay Scheduler Tool
trigger_condition: When implementing scheduling, timers, or background cron notifications for bots
planted_date: 2026-07-15
---

# Generic Delay Scheduler Tool

## Concept
Provide a server-side scheduling tool (`generic_delay_scheduler`) that allows agents to queue callbacks.

## Requirements
* **API Signature:** `schedule_callback(delay_seconds, prompt_instructions)`.
* **Execution:** Stores the task in a queue/database, wakes up the LangGraph runtime after the delay, and injects the specified prompt instructions into the state (e.g., as a system-triggered event).
* **Persona Use-Case:** Enables Coach bots to set timers and send timed reminders (e.g., "30 seconds left") silently in the background.
