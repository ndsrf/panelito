---
title: Silent Critic Persona Integration
trigger_condition: When initiating the next agent-quality/guardrails phase (Phase 13+)
planted_date: 2026-07-15
---

# Silent Critic Persona Integration

## Concept
Introduce a silent validator/critic agent role within LangGraph that reviews all bot messages before they are sent to the user.

## Requirements & Constraints
* **Silent Execution:** Critics run server-side within the LangGraph state execution loop. Their drafts and critique notes reside in `GraphState` and are never streamed to SSE or written to the user-facing database.
* **Scrutiny Levels:**
  * **Normal Messages:** Use fast, lightweight heuristics (defined as defaults at the bot level, overridable in the blueprint).
  * **Canvas Mutations:** Invoke a secondary LLM validation pass to check vocabulary conformance and reasoning logic.
