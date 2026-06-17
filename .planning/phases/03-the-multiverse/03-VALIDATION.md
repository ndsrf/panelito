---
phase: 03
slug: the-multiverse
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-17
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest / jest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm run test:quick` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:quick`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | BRANCH-01 | — | N/A | unit | `npx vitest apps/api/src/routes/branches.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | AI-09 | — | N/A | integration | `npx vitest apps/api/src/services/labeler.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | BRANCH-02 | — | N/A | integration | `npx vitest apps/api/src/lib/ancestry.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/api/src/routes/branches.test.ts` — stubs for BRANCH-01
- [ ] `apps/api/src/services/labeler.test.ts` — stubs for AI-09
- [ ] `apps/api/src/lib/ancestry.test.ts` — stubs for BRANCH-02

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Horizontal scroll & auto-center | BRANCH-05 | Visual/UX feedback | Create 5 branches, switch between them, verify auto-centering in Navigator. |
| Dimmed ancestry UI | BRANCH-04 | Visual/UX feedback | Fork from message, verify parent messages are dimmed. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
