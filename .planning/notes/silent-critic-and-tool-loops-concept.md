---
title: Silent Critic and Tool-Calling Loops Concept
date: 2026-07-15
context: Socratic discussion during Phase 12 development
---

# Silent Critic and Tool-Calling Loops Concept

## Summary of Decisions

During Phase 12 development, we explored the viability of introducing two agent patterns in a future phase:

### 1. Silent Critic/Validator Role
* **Scrutiny Tiers:** Rather than applying uniform heavy checking, we differentiate by complexity:
  * Simple heuristic checks (e.g., regex, structure, character limits) for standard chat output.
  * LLM-driven verification for graph-altering operations (mutations).
* **Configuration:** Defined by default at the bot/persona level, with overrides configurable within individual domain Blueprints.
* **Visibility:** Executes entirely in-memory within the server-side LangGraph state cycle to avoid cluttering user chat streams with drafts and corrections.

### 2. Goal-Oriented Tool-Calling Loops
* **Interaction Model:** ReAct cycle (Agent Node -> Decision Edge -> Tools Node -> Agent Node).
* **Cost Controls:**
  * Iteration budget is enforced to prevent runaway cost loops.
  * Entire cycle is bundled as one logical action for user-facing API quotas.
