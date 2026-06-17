# Phase 3: The Multiverse - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 03-The Multiverse
**Areas discussed:** Branch Colors, Manual Renaming, Timeline Visibility, Branch Lifecycle, Navigator Scrolling, Fork Source Type, Isolation Feedback, Auto-Label Model

---

## Branch Colors

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed Sequence | Red, Blue, Green, etc. assigned in the order branches are created. (Minimal friction) | ✓ |
| User Selection | A color picker appears when forking. (Personalized but slower) | |
| AI Assigned | The flash model picks a color that fits the branch name (e.g., "Forest" → Green). (High polish) | |

**User's choice:** Fixed Sequence
**Notes:** Users prefer minimal friction for the forking experience.

| Option | Description | Selected |
|--------|-------------|----------|
| Deep Saturation | Indigo, Emerald, Rose, Amber, Violet. (Matches the dark multiverse aesthetic) | ✓ |
| Pastel Palette | Sky, Mint, Salmon, Cream, Lavender. (Soft, readable) | |
| High Contrast | Standard high-contrast primary colors. | |

**User's choice:** Deep Saturation

| Option | Description | Selected |
|--------|-------------|----------|
| Accent Only | Navigator gradient + message bubble accent borders only. (Cleanest) | ✓ |
| Ambient Glow | Accent + a subtle background gradient/glow behind the chat. (Ambient awareness) | |

**User's choice:** Accent Only

| Option | Description | Selected |
|--------|-------------|----------|
| Main stays Indigo | Main stays Indigo; other branches use the 5-color palette. (Logical root) | ✓ |
| Main in Palette | Main is part of the palette (6 colors total). | |

**User's choice:** Main stays Indigo

---

## Manual Renaming

| Option | Description | Selected |
|--------|-------------|----------|
| Allow Editing | Tapping or long-pressing the branch chip in the Navigator allows renaming. (User control) | ✓ |
| Automatic Only | Branches are read-only. The flash model name is permanent. (AI-first focus) | |

**User's choice:** Allow Editing

| Option | Description | Selected |
|--------|-------------|----------|
| Anyone | Any participant can rename any branch. (Collaborative) | ✓ |
| Creator Only | Only the Session Creator can rename branches. (Control) | |
| Forker Only | Only the person who forked the branch can rename it. (Ownership) | |

**User's choice:** Anyone

| Option | Description | Selected |
|--------|-------------|----------|
| Human Only | The name is just a label for the Navigator. AI doesn't see it. (Simple) | ✓ |
| Update AI Context | The new name is passed to the AI as part of the branch system prompt. (Aligned) | |

**User's choice:** Human Only

| Option | Description | Selected |
|--------|-------------|----------|
| Strict Limit (~25) | Capped at ~25 characters to keep the Navigator clean. (Consistent) | ✓ |
| Truncated (~50) | Allow longer names with truncation in the chip. (Flexible) | |

**User's choice:** Strict Limit (~25)

---

## Timeline Visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Show Full Ancestry | The chat stream shows all messages from the root to the current branch tip. (Best context) | |
| Isolated View | The chat stream only shows messages created within that specific branch. (Max isolation) | |
| Show with Indicator | Show ancestors but with a faded style or behind a 'Show Context' button. (Compromise) | ✓ |

**User's choice:** Show with Indicator

| Option | Description | Selected |
|--------|-------------|----------|
| Dimmed/Faded | Parent messages are faded (lower opacity) to focus on the new branch. (Subtle) | |
| Branch Point Separator | A clear divider like '--- Bifurcado aquí: [Nombre] ---' between parents and branch. (Explicit) | |
| Both (Indicator) | Both: a separator AND faded parent messages. (High clarity) | ✓ |

**User's choice:** Both (Indicator)

| Option | Description | Selected |
|--------|-------------|----------|
| Unlimited Backscroll | Full history back to the root message is available. (Consistent) | ✓ |
| Recent Trunk Only | Only show the immediate context (last 10-20 messages) leading to the fork. (Focused) | |

**User's choice:** Unlimited Backscroll
**Notes:** User noted that in future versions we will need to limit the number of messages and load more messages asynchronously for performance.

| Option | Description | Selected |
|--------|-------------|----------|
| Original Colors | Trunk messages keep their original color (e.g. Indigo for Main). (Shows ancestry) | ✓ |
| Unified Color | All messages in the stream use the active branch color. (Visual unity) | |

**User's choice:** Original Colors

---

## Branch Lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Archive to Free Slot | Creator can archive a branch to free up a slot for a new one. (Flexible) | ✓ |
| Strict Limit (5) | Once 5 branches exist, the multiverse is 'full'. No more forks allowed. (Strict) | |

**User's choice:** Archive to Free Slot
**Notes:** User specified there should not be a limit (horizontal scroll), but we'll add a safety limit of 50.

| Option | Description | Selected |
|--------|-------------|----------|
| Cycle 5 Colors | Reuse the Indigo, Emerald, Rose, Amber, Violet sequence in order. (Simple) | |
| Cycle 10 Colors | Define a sequence of 10 distinct colors before repeating. (More variety) | ✓ |

**User's choice:** Cycle 10 Colors

| Option | Description | Selected |
|--------|-------------|----------|
| No Archive Needed | 50 slots is more than enough. No need for archive logic yet. (MVP) | |
| Keep Archive | Creator can still hide/archive branches to clean up the Navigator. (Polish) | ✓ |

**User's choice:** Keep Archive

| Option | Description | Selected |
|--------|-------------|----------|
| Permanent Hide | Archived branches are removed from the Navigator. No 'Restore' UI in v1. (Simple) | |
| Restore UI | An 'Archived' list in CreatorControls allows restoring branches. (Complete) | ✓ |

**User's choice:** Restore UI

---

## Navigator Scrolling

| Option | Description | Selected |
|--------|-------------|----------|
| Native Scroll | Users drag or swipe the bar horizontally. (Mobile-native) | |
| Auto-Center Active | The Navigator always auto-centers the active branch when switched. (Focus) | |
| Both (Smart Scroll) | Both: native swipe + auto-centering on switch. (Highest polish) | ✓ |

**User's choice:** Both (Smart Scroll)

---

## Fork Source Type

| Option | Description | Selected |
|--------|-------------|----------|
| Human + AI | Forking works for any message, including those sent by the AI personas. (Total flexibility) | |
| Human Only | Only messages sent by participants can be forked. (Human-centered) | ✓ |

**User's choice:** Human Only

---

## Isolation Feedback

| Option | Description | Selected |
|--------|-------------|----------|
| Input Label | A small label above the input field: 'Branch: [Name]'. (Direct feedback) | ✓ |
| Persona Badge Lock | A lock icon or 'Isolated' badge on the AI persona responses. (Subtle) | |

**User's choice:** Input Label

---

## Auto-Label Model

| Option | Description | Selected |
|--------|-------------|----------|
| Claude 3.5 Haiku | Consistent with the main AI provider. Fast and high quality. | |
| Gemini 1.5 Flash | Industry-leading speed for short tasks. (Requires Gemini key) | |

**User's choice:** Use the best model from the active provider.
**Notes:** The system will use the 'flash' model of the active provider configured in Phase 4.

---

## Claude's Discretion

- Visual styling of the "Branch Point" separator.
- 10-color hex codes for the Deep Saturation palette.
- UI pattern for "Archived Branches" list.
- Exact wording of branch isolation label in the input area.

## Deferred Ideas

- Branch merging (v2).
- Forking from AI messages (deferred/restricted in Phase 3).
- Time-travel scroll-spy (v2).
