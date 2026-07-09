# Feature Landscape: Project Multiverse v3.0 Proactive Bot Facilitation

**Domain:** Proactive AI facilitation bots for synchronous group deliberation
**Research date:** 2026-07-09
**Milestone scope:** SUBSEQUENT MILESTONE — adds proactive bot facilitation engine to existing v2.0 NSAI workspace

---

## Existing Features (v1 + v2 baseline — already built, do NOT re-plan)

The following are NOT features to plan — they are dependencies to preserve and build on:

- Multi-user real-time chat via Supabase Realtime broadcast
- Conversation branching (fork, isolated context, color-coded timeline)
- AI analytics panel (Recharts bento/radar/scatter/pie + Universal Graph Canvas with xyflow/react)
- LangGraph JS orchestration (OrchestratorNode + domain Agent nodes)
- Domain Blueprints (JSON, Supabase-stored, Ajv runtime validation)
- Universal CanvasNode + CanvasEdge data model (committed + ghost nodes)
- Confidence-based autonomy matrix (direct >0.85 / ghost 0.5–0.85 / silent <0.5)
- Mic Check Pattern (human must explicitly release floor for bots to respond)
- Flex-Soft domain guardrails (DOMAIN_MATCH / DOMAIN_BRIDGE / DOMAIN_DRIFT)
- Langfuse observability (graph tracing, costs, latency, prompts)
- Bots respond reactively when invoked by humans in chat

---

## Table Stakes (The Proactive System Breaks Without These)

### 1. Intervention Gating and Cooldown Budget

**Why it's table stakes:** The single most-cited failure mode in facilitation bot research is over-intervention. Research on proactive AI facilitation (CHI 2025, CHI 2026) consistently identifies that bots which speak too frequently are marginalized, ignored, and ultimately damage conversation quality. A facilitation bot without rate control is worse than no bot at all — it produces "bot fatigue," erodes trust, and actively suppresses human participation.

**Required behavior:**
- Per-bot cooldown: each personality has a minimum silence window after its own last message (recommended: 60–90 seconds) before it can trigger again
- Global session cooldown: after any bot speaks, a global gate blocks all bot speech for N seconds (recommended: 30 seconds) — prevents bot pile-ons
- Maximum interventions per time window: no more than 2–3 bot messages per 5-minute window across all personalities combined
- Trigger priority queue: when multiple triggers fire simultaneously, only the highest-priority fires; others are queued or discarded
- Never interrupt a human in mid-typing: gate on Mic Check state — if `mic_check !== null`, all proactive triggers are suppressed

**Why this is non-negotiable:** Research (CHI 2026 proactive agent study) shows that peer agents that intervene every 3 minutes created disruption even when their content was helpful. The facilitator agent's contributions "became marginalized over time" once it was perceived as repetitive. The 52% proactive intervention rate cited in one study correlated with customer satisfaction decline, not improvement.

**Complexity:** MEDIUM — state machine in LangGraph or a separate intervention scheduler
**Dependencies:** Mic Check Pattern (existing), session state in Supabase, LangGraph conditional routing

---

### 2. Trigger Classification Layer (Lightweight)

**Why it's table stakes:** Proactive intervention requires continuous background evaluation of conversation state. Without a dedicated classification layer, the system has no way to know when to speak. This is the perceptual layer — it must run cheaply on every message or on a timer, not on the expensive model.

**Six trigger types required:**

| Trigger | Signal | Classification Method |
|---------|--------|----------------------|
| Silence window | N seconds since last human message (no typing indicator active) | Timer + Mic Check state polling |
| Blueprint phase signal | Conversation content matches phase-advance criteria in Blueprint | Small LLM call: "Does this conversation indicate readiness to advance from phase X to Y?" |
| Semantic drift | Embedding cosine distance from Blueprint domain description exceeds threshold | Embedding similarity (reuse existing DOMAIN_DRIFT classifier; repurpose for proactive drift alert) |
| Unlinked assertion | New human message contains a claim that relates to an existing graph node with no edge | LLM call against current graph state: "Does this claim connect to any existing canvas node?" |
| Fact-check trigger | Human message contains a clearly false or unsupported claim | Small LLM classification: "Is this claim empirically verifiable and likely incorrect?" |
| Moderation trigger | Human message contains rude, dismissive, or disruptive content | Small LLM or rule-based classifier |

**Implementation pattern:** Triggers are evaluated as a pipeline after each human message is committed to the database. The pipeline runs on the small/cheap model tier. Only if a trigger fires AND passes the intervention gate (see feature 1) does the proactive response generation begin.

**Critical design constraint:** The trigger classification call must NOT be user-visible. It runs silently in the background. No "thinking..." indicator, no skeleton loaders, no UI feedback during trigger evaluation. If no trigger fires, the user sees nothing. If a trigger fires, they see the bot message appear naturally after a deliberate short delay (1–2 seconds) — not instantly.

**Complexity:** MEDIUM — pipeline orchestration; individual classifiers are small LLM calls
**Dependencies:** Existing domain guardrail classifier (can be extended), LangGraph state for graph context, Langfuse (all trigger evaluations should be traced for tuning)

---

### 3. Bot Personality Differentiation (Distinct System Prompts and Trigger Affinity)

**Why it's table stakes:** If multiple bots are deployed but they speak in an identical voice with identical patterns, the multi-personality system provides zero value over a single bot. Research on devil's advocate AI systems (CHI 2025) and Socratic chatbot designs consistently shows that personality must be stable and legible — users need to predict how each bot will behave in order to trust its interventions.

**Three personalities required:**

**Coach (Socratic):**
- Character: empathetic, question-driven, never provides answers, guides humans to their own conclusions
- Six Socratic question classes to rotate through: clarification, challenging assumptions, evidence and reasoning, alternative viewpoints, implications and consequences, meta-questions about the question itself
- Speech template constraint: ALL Coach output must end with a question. If the output doesn't contain a "?", it fails the persona contract.
- Primary trigger affinity: silence window (fills dead air with a guiding question), Blueprint phase signal (asks "what would it mean to move forward?"), semantic drift (asks "how does this connect back to what we were exploring?")
- Avoids: statements of fact, opinions, direct recommendations, summarization

**Devil's Advocate:**
- Character: adversarial but not hostile, risk-surfacing, assumption-challenging, psychologically safe skepticism
- Speech pattern: acknowledges the position first ("I see the case for X..."), then introduces the counter ("...but what happens when Y?"). Never leads with pure negation.
- Research finding (CHI 2025 minority voice amplification study): persuasive rhetoric with empathetic framing outperforms eristic (combative) rhetoric. The devil's advocate must be a sophisticated skeptic, not a contrarian troll.
- Primary trigger affinity: unlinked assertion (challenges the assumption behind a claim), fact-check trigger (surfaces alternative evidence), Blueprint phase signal (asks "are we sure we've pressure-tested this before moving on?")
- Avoids: personal attacks, repeating the same counter-argument twice, agreeing with the group consensus

**Analyst / Fact-Checker:**
- Character: neutral, structured, data-driven, tracks the logical state of the argument graph
- Speech pattern: references the conversation record explicitly ("You've agreed on X and Y, but Z hasn't been established yet"), proposes connections between claims, flags logical gaps
- Primary trigger affinity: unlinked assertion (proposes the edge: "this sounds like it SUPPORTS your earlier hypothesis"), fact-check trigger (primary responder), semantic drift (notes "we've moved away from the evidence phase — here's what's still open")
- Avoids: emotional language, personal observations about participants, opinions on which side is right

**Multi-bot coordination rule:** When multiple bots would trigger on the same message, only the bot with the highest "enthusiasm score" for that trigger type speaks. The Analyst gets priority on fact-check and unlinked assertion. The Coach gets priority on silence window. The Devil's Advocate gets priority on phase-signal challenges. Implementation follows the "Enthusiasm" framework discovered in real multi-bot deployments: each bot evaluates its own enthusiasm score (0–9), the highest score wins, others stay silent.

**Complexity:** MEDIUM — system prompt engineering + trigger affinity routing table
**Dependencies:** Intervention gate (feature 1), trigger classification layer (feature 2), LangGraph personality routing

---

### 4. Natural Bot Speech (No System Artifact Strings)

**Why it's table stakes:** The moment a user sees "[canvas updated]" or "PHASE_SIGNAL: READY_TO_ADVANCE" in a chat bubble, the facilitation illusion collapses. The bot becomes a system, not a participant. Research on chatbot personality design confirms that legible, human-like speech patterns are required for users to engage with bots as conversational partners rather than tools.

**Required constraints:**
- All bot chat output is conversational prose only — no JSON, no bracket annotations, no status strings
- Canvas mutations triggered by a proactive intervention are NOT announced in the chat message. The graph updates silently (using existing ghost/committed node logic). The bot's words justify the update implicitly.
- If the Analyst bot adds a node connection, it says: "Your point about X actually links directly to the hypothesis we put on the canvas earlier — they're in tension." It does NOT say: "I have added an edge of type CONTRADICTS between node-a7 and node-b3."
- Bot messages include a visible bot identity badge (avatar + name) so users know which personality is speaking — but the message text itself reads as natural speech
- Distinct voice rules enforced at the prompt level: Coach ends with "?", Analyst references specific prior content, Devil's Advocate frames objections empathetically

**Complexity:** LOW — prompt engineering discipline; existing message rendering already supports bot badges
**Dependencies:** Existing bot message rendering infrastructure

---

### 5. In-Memory Per-Session User Profiles

**Why it's table stakes:** Personalized facilitation — "You said earlier X, does this contradict that?" — is what separates a generic bot from a genuine facilitator. Research on AI memory for personalization confirms that referencing prior user statements produces a significantly stronger feeling of being understood and a stronger sense of conversation coherence. Without profiles, every bot intervention treats each message as if it came from a stranger.

**Required profile fields (per participant, per session):**
- `stated_positions: string[]` — key claims a participant has made, updated on each of their messages
- `key_assertions: { claim: string, message_id: string, timestamp: number }[]` — specific verifiable assertions with the message reference
- `engagement_pattern: { message_count: number, avg_message_length: number, response_latency_avg_ms: number, silence_periods: number }` — used to calibrate whether silence trigger is actually unusual for this person
- `last_spoke_at: number` — timestamp, used for silence window calculation
- `positions_changed: { from: string, to: string, evidence: string }[]` — tracks when a participant reverses or evolves their position

**Storage:** In-memory only (Zustand store on the backend within the LangGraph thread state). Profiles are NOT persisted to the database. They are reconstructed if the session is resumed from scratch. This is intentional — session-scoped, not long-term user profiling.

**LLM access pattern:** Profiles are injected into the bot's context as a compact structured block. The LLM does not query the profile database — the profile is included in the LangGraph state that gets passed to the node on each invocation.

**Complexity:** MEDIUM — state schema design + extraction logic on each human message; the extraction itself is a cheap LLM classification call ("what position did this participant just assert?")
**Dependencies:** LangGraph state schema extension, per-participant state tracking

---

### 6. Silence Window Trigger (Timer-Based)

**Why it's table stakes:** This is the most basic form of proactive facilitation — when conversation stalls, a bot intervenes. Without it, the system can only respond to active messages, which means it fails to help groups through the most common group dynamics failure mode: dead air.

**Required behavior:**
- Default silence threshold: 45–60 seconds of no human messages (configurable per Blueprint)
- Timer resets on every human message or typing indicator event
- If `mic_check !== null` (someone is typing), do NOT fire — they're about to speak
- If the last message in the conversation was a bot message, add an additional delay (90 seconds) — prevents bot-bot loops
- Coach gets priority on silence triggers (ask a question, don't summarize)

**Implementation:** Server-side timer per branch, tracked in LangGraph state or a Supabase real-time presence channel. The timer fires a trigger event that goes through the intervention gate before any LLM call is made.

**Complexity:** LOW — timer mechanics; the routing logic is shared with the rest of the trigger system
**Dependencies:** Supabase Realtime presence or server-side timer, intervention gate (feature 1)

---

## Differentiators (What Makes This Facilitation System Stand Out)

### A. Argument-Coherent Graph Building (Typed Edges, No Isolated Nodes)

**Why it differentiates:** Most collaborative AI tools add nodes to a canvas but leave the edges to humans. The result is a graph of disconnected claims — a flat list with a visual metaphor. A graph where every new node is positioned in typed relationship to existing nodes is a genuine argument structure, not a visualization of a list.

**Required behavior:**
- Every canvas mutation triggered by a bot (proactive or reactive) includes at least one typed edge to an existing node, or a justified exception is logged
- Bot Analyst is the primary architect of edges: it detects when a new human assertion relates to an existing node and proposes the connection
- Edge types extend the existing Blueprint vocabulary: SUPPORTS, CONTRADICTS, BUILDS_ON, QUESTIONS, QUALIFIES — the Blueprint defines which are allowed per session
- The Analyst's "unlinked assertion" trigger fires specifically when it detects a new claim that should connect to an existing node but doesn't yet
- In-memory graph state is maintained in LangGraph state as a lightweight adjacency list — bots can query it during trigger evaluation

**IBIS lineage:** This follows the Issue-Based Information System (IBIS) pattern — a well-established argumentation structure where Issues, Positions, and Arguments are connected by typed edges (supports, objects-to). The v3.0 graph model is a Blueprint-flavored IBIS, where node types are domain-specific but the edge typing principle is the same.

**Complexity:** HIGH — requires bots to reason over graph state; LLM context must include the current graph in a queryable form
**Dependencies:** Existing CanvasNode/CanvasEdge model, Blueprint edge type vocabulary, LangGraph state carrying graph adjacency list

---

### B. Task-Based LLM Cost Routing (Cheap Classifier → Expensive Reasoner)

**Why it differentiates:** Proactive bots evaluate every human message for trigger conditions. Without tiered model routing, this doubles or triples per-session LLM costs. Tiered routing makes proactive facilitation economically viable.

**Routing table:**

| Task | Model Tier | Rationale |
|------|-----------|-----------|
| Trigger classification (all 6 triggers) | Small/cheap (Haiku or equivalent) | Binary classification — cheap models perform within ~3% of frontier models for this |
| Silence window timer check | No LLM needed | Pure state check |
| Moderation detection | Small model or rule-based | Short-context classification |
| Semantic drift scoring | Embedding API only | Cosine similarity, no LLM generation needed |
| Unlinked assertion edge proposal | Heavy model | Requires graph state reasoning |
| Fact-check claim evaluation | Heavy model | Requires world knowledge and nuanced judgment |
| Coach question generation | Medium or heavy model | Quality matters for Socratic questions |
| Devil's Advocate counter-argument | Heavy model | Quality and persona fidelity matter |

**Implementation:** Task type is determined before the LLM call. A routing function selects the model tier. With current (2026) pricing, a ~15–20x price difference between small and heavy models means routing 60–70% of calls to the small tier reduces per-session AI cost by 40–70%.

**Complexity:** MEDIUM — routing logic is straightforward; the mapping table is the main design artifact
**Dependencies:** Anthropic SDK model parameter selection, Langfuse tagging for cost attribution per task type

---

### C. Blueprint Phase Signal Detection (Proactive Phase Advancement Nudge)

**Why it differentiates:** The existing Human Consensus Pattern lets the LLM signal phase readiness, but only reactively (when a human message triggers it). A proactive phase signal — "I notice we've covered all the evidence phase objectives, should we move to Debate?" — models real human facilitation behavior.

**Required behavior:**
- Bot monitors the conversation against Blueprint phase objectives periodically (not on every message — use a sliding window check every 5–7 human messages)
- When the conversation content suggests phase objectives are met, the Coach or Analyst generates a phase advancement nudge in natural language
- This is a suggestion, never a command. The Human Consensus Pattern is preserved — only a human admin can advance the phase.
- The nudge message references specific evidence from the conversation: "You've proposed three distinct hypotheses and challenged two of them — the Framing phase criteria look satisfied."

**Complexity:** MEDIUM — periodic LLM evaluation against Blueprint phase criteria (medium model tier)
**Dependencies:** Blueprint `phases` definition with per-phase objective criteria, LangGraph state with conversation summary, Human Consensus Pattern (existing)

---

### D. Moderation Trigger (Non-Punitive Redirection)

**Why it differentiates:** Real human facilitators de-escalate without shaming or blocking. A bot that deletes messages or bans users feels punitive and creates resentment. A bot that reframes and redirects maintains safety while preserving conversational flow.

**Required behavior:**
- Moderation trigger fires on: personal attacks, dismissive put-downs, deliberately disruptive messages
- Response strategy: redirection to substance, NOT deletion or warnings
  - Coach: "Let's focus on the ideas rather than the people — what's the strongest case for [the opposing view]?"
  - Devil's Advocate: not the primary responder for moderation (its adversarial framing can escalate)
  - Analyst: "That's a strong reaction — what specifically in [user]'s argument prompted it?"
- Moderation trigger has the highest intervention priority — it bypasses the global cooldown gate
- The moderation message does NOT reference the specific toxic language or call out the offender by name

**Research finding:** Twitter's proactive content moderation (pre-send "Are you sure?" prompt) achieved 9% deletion rate and 22% revision rate on detected toxic content. The friction of a gentle pre-send nudge works better than post-send intervention. However, in synchronous group chat (not Twitter), pre-send friction breaks the conversation flow — post-send bot intervention is preferable.

**Complexity:** MEDIUM — classifier + routing; the hardest part is calibrating the classifier to avoid false positives on heated-but-legitimate debate language
**Dependencies:** Trigger classification layer (feature 2), moderation classifier (small model)

---

## Anti-Features (Explicitly Do NOT Build These)

| Anti-Feature | Why It Destroys Facilitation | What to Do Instead |
|---|---|---|
| **Bots that speak after every human message** | Kills human participation. Research shows bot intervention has a negative impact on participation in open collaboration when bots are too frequent. | Intervention gate with cooldown budget (45–90s per bot, 30s global) |
| **Bots that summarize what was just said** | Users find this condescending and redundant ("I was there, I said that"). Summarization bots become ignored within 10–15 messages. | Summarization goes to panel widgets, not chat. Chat bots ask, challenge, connect — not recap. |
| **Identical speech patterns across personalities** | If users can't predict which bot will say what, the personality system provides no value. The Coach and Analyst become noise. | Strict persona contracts enforced at prompt level: Coach ends with "?", Analyst cites specific prior content, Devil's Advocate frames counter-argument with acknowledgment first. |
| **Fact-check bot making confident claims about facts it cannot verify** | The LLM will hallucinate corrections. A bot that "corrects" a true statement with a confident false one is worse than no fact-checker. | Fact-check trigger frames uncertainty explicitly: "I'm not certain about that claim — can you share a source?" rather than "Actually, X is wrong." Never assert a counter-fact as certain. |
| **Bots that compete to respond to the same message simultaneously** | Multi-bot pile-ons fragment attention and make the chat look like a bot spam wall. | Enthusiasm scoring framework: each bot evaluates its own trigger affinity score; only the highest-scoring bot speaks; others stand down. |
| **Bots that reference "[User]'s profile" or "according to my records"** | Explicit profile references feel surveillance-like and creepy. Users disengage when they feel tracked. | Bots reference prior conversation content (not "your profile"): "Earlier you said X..." — natural conversation memory, not database lookup language. |
| **Silence trigger firing when there's a natural pause** | A 20-second pause in a productive conversation is not a problem. Premature silence intervention interrupts natural reflection. | 45-second minimum threshold. Factor in per-user engagement pattern (if a participant typically pauses 30 seconds before deep messages, wait longer for them). |
| **Bots that can advance the conversation phase autonomously** | Research shows LLM-controlled phase advancement feels coercive. Users disengage when AI "tells them what to do next." | Human Consensus Pattern preserved from v2: bots signal readiness, humans decide. |
| **Bots that explain what they're doing ("As your Coach bot, I will now ask a Socratic question about...")** | Meta-commentary on bot behavior breaks the facilitation illusion. Users see the mechanism instead of the facilitation. | Bots just do the thing. No preamble about what they're about to do or why. |
| **Global mute/snooze with no easy re-enable** | Users will mute bots if they feel overwhelmed, then forget to re-enable. The facilitation system becomes permanently off. | Instead: per-bot volume control (reduce intervention frequency), not mute. Make the "quiet mode" state visible in the UI so users know bots are still watching. |
| **Canvas mutations announced in chat with system strings** | "[Graph updated: node 'Evidence' added with SUPPORTS edge to 'Hypothesis']" destroys natural conversation feel. | Canvas updates are silent or referenced conversationally: "Your point about X fits naturally as evidence for the hypothesis we mapped earlier." |

---

## Bot Personality Design Patterns (Practical Speech Guidance)

### Coach — Socratic Question Rotation

The Coach uses six Socratic question classes, cycling through them rather than defaulting to the same question type:

1. **Clarification:** "When you say X, what exactly do you mean?"
2. **Assumption challenge:** "What are we taking for granted when we say X?"
3. **Evidence and reasoning:** "What makes you confident that X is true?"
4. **Alternative viewpoints:** "How would someone who disagreed with X frame this?"
5. **Implications:** "If X is true, what follows from that?"
6. **Meta:** "Is that the right question to be asking right now?"

**Anti-pattern:** Never ask two clarification questions in a row. Never ask leading questions that telegraph the "right" answer ("Don't you think X means Y?"). Never give the answer after asking the question ("What do you think? I think it's Y.").

**Trigger-to-question mapping:**
- Silence window → Class 1, 2, or 5 (gets the conversation moving without requiring new information)
- Phase signal → Class 5 or 6 (reflects on progress and readiness)
- Semantic drift → Class 6 (brings attention back to the framing)

---

### Devil's Advocate — The Empathetic Counter

The Devil's Advocate always follows the acknowledge-then-challenge pattern:

**Structure:** "[Acknowledgment of the position's strongest form] ... [Counter-question or alternative frame]"

Example (good): "The case for X is clear if we assume Y holds — but what happens in the scenarios where Y doesn't?"

Example (bad): "That's wrong. X doesn't work because Z."

**Speech pattern rules:**
- Never use "but" to introduce the counter — it signals dismissal. Use "and yet," "at the same time," "what gives me pause is"
- Never repeat the same counter-argument. If it's been made, find a new angle.
- Never concede ground unprompted — the devil's advocate must maintain its skeptical stance until humans explicitly resolve the challenge

**Trigger-to-challenge mapping:**
- Unlinked assertion → challenges the premise behind the new claim
- Fact-check trigger → presents the alternative evidence (as a question, not an assertion)
- Phase signal → "Before we close the book on this phase — have we really tested [X assumption]?"

---

### Analyst — The Argument Accountant

The Analyst's primary value is tracking the logical state of the conversation and making it legible.

**Speech pattern rules:**
- Always references specific prior content: message references, node names, agreed positions
- States logical relationships explicitly: "That supports...", "That contradicts...", "That's still open..."
- Proposes graph edges as natural observations: "This sounds like it belongs on the canvas as support for [node]"
- Tracks what's been agreed vs. what's still contested: "We've settled X, but Y is still unresolved"

**Intervention structure:**
1. State what's been established (the agreed ground)
2. Identify the gap or connection
3. Propose the resolution (edge, new node, or question to close the gap)

**Trigger-to-analysis mapping:**
- Unlinked assertion → primary responder: proposes the edge
- Fact-check trigger → primary responder: flags the claim as unverified and frames the verification question
- Phase signal → secondary responder: provides a structured summary of what phase objectives are satisfied vs. open

---

## Conversation Graph Coherence (Technical Patterns)

### The Core Problem

A graph of isolated nodes is not an argument — it's a list with a visual metaphor. Coherence requires that every node in the graph has at least one typed edge that explains its relationship to the rest of the structure.

### Achieving Coherence in Practice

**Pattern 1: Edge-First Node Creation**
When a bot creates a new node, it must specify the edge(s) simultaneously. The node and its edges are a single atomic operation, not two separate calls. If the bot cannot identify a plausible edge, it should propose the node as a "floating hypothesis" for human placement rather than committing it.

**Pattern 2: Graph State in LangGraph Context**
The current canvas state (nodes + edges as adjacency list) is included in the LangGraph state at all times. Bot nodes that perform graph reasoning receive the full adjacency list as input context. This enables the Analyst to say "claim X relates to node Y" because it has the graph in its context window.

**Pattern 3: Edge Types Mirror Argumentative Logic**
Blueprint edge vocabulary should cover the fundamental argumentative relationships:
- SUPPORTS — evidence/position that strengthens a claim
- CONTRADICTS — evidence/position that weakens or negates a claim  
- BUILDS_ON — refines, extends, or qualifies an earlier claim without contradicting it
- QUESTIONS — raises a challenge or uncertainty without asserting a counter-claim
- QUALIFIES — limits the scope or conditions of applicability of a claim
- IMPLIES — logical consequence relationship

**Pattern 4: "Unlinked Node" Scan**
After each bot intervention that adds a node, a lightweight post-pass checks the graph for any nodes with zero edges (other than the one just added). If isolated nodes exist, the Analyst's unlinked assertion trigger is armed to propose a connection on the next human message that provides context for it.

**Pattern 5: Graph Coherence as Analyst Responsibility**
The Analyst bot is the designated graph gardener. The Coach and Devil's Advocate may trigger canvas mutations, but the Analyst is the one who maintains the edge structure. If Coach adds a node without an edge (it shouldn't, but if it does), the Analyst's unlinked assertion trigger will catch it.

---

## Feature Complexity Map

| Feature | Complexity | Type | Key Dependency |
|---|---|---|---|
| Argument-coherent graph (typed edges, no isolated nodes) | HIGH | Architecture + LLM reasoning | Graph state in LangGraph, Blueprint edge vocabulary |
| Trigger classification pipeline (6 triggers) | MEDIUM | New LangGraph node | Small model routing, existing DOMAIN_DRIFT classifier |
| Bot personality system (3 personas, distinct prompts) | MEDIUM | Prompt engineering + routing | Intervention gate, trigger affinity table |
| Task-based LLM cost routing | MEDIUM | Infrastructure | Model tier selection logic, Langfuse cost attribution |
| Per-session user profiles (in-memory) | MEDIUM | State schema + extraction | LangGraph state extension, per-message classification |
| Blueprint phase signal detection | MEDIUM | Periodic evaluation | Blueprint phase objectives, conversation summarization |
| Moderation trigger | MEDIUM | Classifier + routing | Moderation classifier calibration |
| Multi-bot coordination (enthusiasm scoring) | MEDIUM | Orchestration logic | Per-bot trigger affinity table |
| Natural bot speech (no system artifacts) | LOW | Prompt discipline | Prompt engineering, message rendering |
| Silence window trigger | LOW | Timer + state | Supabase Realtime presence or server-side timer |
| Intervention gating and cooldown budget | LOW-MEDIUM | State machine | Per-bot + global cooldown tracking in LangGraph state |

---

## Feature Dependencies (Build Order Constraints)

```
Intervention gate + cooldown budget
  → All proactive triggers (gate is prerequisite for any proactive behavior)

Trigger classification pipeline
  → Silence window (simplest trigger — timer + state, no LLM)
  → Moderation trigger (small model classifier)
  → Blueprint phase signal (medium model, periodic)
  → Semantic drift (embedding similarity, reuse DOMAIN_DRIFT classifier)
  → Unlinked assertion (requires graph state)
  → Fact-check trigger (heavy model)

Bot personality system
  → Multi-bot coordination (enthusiasm scoring)
    → Natural bot speech (prompt discipline enforced per-persona)

Per-session user profiles
  → Personalized facilitation moves ("you said earlier X...")
    → More effective silence window response
    → More effective phase signal nudges

Argument-coherent graph
  → Graph state in LangGraph context
    → Unlinked assertion trigger (reads graph)
    → Edge-first node creation (bot output schema enforces edge with node)

Task-based LLM cost routing
  → Trigger classification (must route to cheap model)
  → All proactive response generation (route by task type)
```

**Critical path:** Intervention gate → Trigger classification → Bot personality routing → Natural speech + profiles. Graph coherence and cost routing can be built in parallel with the trigger/personality system.

---

## MVP Recommendation for v3.0

**Ship first (the core proactive facilitation thesis):**
1. Intervention gate + cooldown budget — without this, everything else is dangerous
2. Silence window trigger — simplest trigger, immediately visible value
3. Coach personality with Socratic question rotation — most safe, lowest risk of false positives
4. Natural bot speech constraints — zero tolerance for system artifact strings from day one

**Ship in phase 2 (adds depth and coherence):**
5. Trigger classification pipeline (moderation + phase signal + semantic drift)
6. Devil's Advocate personality
7. Analyst personality with unlinked assertion trigger
8. Per-session user profiles (lightweight extraction)

**Ship in phase 3 (full system integration):**
9. Argument-coherent graph (edge-first mutations, Analyst as graph gardener)
10. Fact-check trigger (most complex — LLM hallucination risk requires careful calibration)
11. Task-based LLM cost routing
12. Multi-bot enthusiasm scoring for conflict resolution

**Defer:**
- Embedding-based semantic drift scoring (requires embedding infrastructure; use small LLM for v3 drift detection)
- Pre-session Blueprint phase objective authoring tooling (v4+)
- Cross-session memory (long-term user profiles beyond session scope)

---

## Phase-Specific Research Flags

| Phase Topic | Likely Pitfall | Mitigation |
|---|---|---|
| Silence window threshold calibration | 45 seconds may be too short for some groups, too long for others | Make configurable per Blueprint; Langfuse logs tell you actual silence distribution per session |
| Fact-check trigger false positives | Bot challenges a correct claim because the LLM is wrong about the fact | Require explicit uncertainty framing in the prompt: "I can't verify X from my training — what's the source?" |
| Multi-bot enthusiasm scoring | Two bots with equal scores speaking at the same time | Add tiebreaker: Analyst > Coach > Devil's Advocate for trigger type priority; add a 500ms stagger as final safety net |
| Moderation classifier calibration | Flagging legitimate heated debate as toxic | Start with high confidence threshold (only fire on clear personal attacks); tune down as you observe false positive rate |
| Graph coherence for Coach/Devil's Advocate | These bots were designed for conversation, not graph maintenance — they'll try to add nodes without edges | Enforce edge-first at the output schema level (CanvasOp requires edges array, not optional); bot prompt explains why |
| Per-user profile extraction cost | Running LLM extraction on every message multiplies cost | Extract profiles lazily: only update profile when the classification result changes from the prior message |
| Bot fatigue over long sessions | Cooldown budget that works at 15 minutes may feel stifling at 60 minutes | Adaptive cooldowns: as session length increases past 30 minutes, reduce minimum intervention frequency rather than maintaining fixed budget |

---

## Sources

**Proactive AI facilitation research:**
- CHI 2026: Proactive generative AI agent roles in collaborative problem-solving — https://arxiv.org/html/2602.17864v1
- CHI 2025: AI voice agents in online collaboration, proactive intervention strategies — https://dl.acm.org/doi/10.1145/3706598.3713457
- CHI 2025: Assistance or disruption, proactive AI programming support — https://arxiv.org/html/2502.18658v3

**Devil's Advocate and Socratic patterns:**
- CHI 2025: Devil's advocate AI for minority voice amplification — https://arxiv.org/html/2502.06251v1
- CHI 2025: Conversational agents as catalysts for critical thinking — https://arxiv.org/html/2503.14263v1
- Socratic questioning chatbot patterns — https://arxiv.org/html/2601.14798v1

**Bot facilitation in group chat (CHI 2020 GroupfeedBot):**
- Bot in the Bunch: Facilitating Group Chat Discussion — https://dl.acm.org/doi/10.1145/3313831.3376785
- Real-time group dynamics with LLM facilitation — https://arxiv.org/pdf/2605.14097

**Multi-bot turn-taking coordination:**
- Multiplayer AI chat and turn-taking lessons (Interconnected, 2025) — https://interconnected.org/home/2025/05/23/turntaking

**Argument graph / IBIS:**
- IBIS (Issue-Based Information System) — https://en.wikipedia.org/wiki/Issue-based_information_system

**LLM cost routing:**
- LLM cost optimization, smart routing cuts spend 75%+ — https://gateway.orq.ai/blog/llm-cost-optimization-smart-routing
- Intelligent LLM routing, cost and quality-aware — https://www.truefoundry.com/blog/llm-routing-cost-quality-aware-model-selection

**Moderation design:**
- Proactive content moderation reducing toxicity — https://arxiv.org/html/2401.10627v1
- Real-time toxicity detection in games — https://seanfalconer.medium.com/real-time-toxicity-detection-in-games-balancing-moderation-and-player-experience-4ef81b8f47db

**Over-intervention risk:**
- Proactive intervention rate and quality tradeoffs — https://ai2roi.substack.com/p/ai-to-roi-metric-proactive-intervention
- Bots negative impact on participation — https://www.sciencedirect.com/science/article/abs/pii/S0167923621001111
