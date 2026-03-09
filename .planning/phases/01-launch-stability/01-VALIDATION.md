---
phase: 1
slug: launch-stability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (unit/component), Playwright 1.58.x (E2E) |
| **Config file** | `app/vitest.config.ts`, `app/playwright.config.ts` |
| **Quick run command** | `npm run test` (in app/) |
| **Full suite command** | `npm run test && npm run e2e` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test` (Vitest suite)
- **After every plan wave:** Run `npm run test && npm run e2e` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | LAUNCH-01 | E2E | `npm run e2e -- launch.spec.ts` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | LAUNCH-02 | E2E | `npm run e2e -- render.spec.ts` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | LAUNCH-03 | E2E | `npm run e2e -- lifecycle.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `app/e2e/launch.spec.ts` — stubs for LAUNCH-01 (10 consecutive launches)
- [ ] `app/e2e/render.spec.ts` — stubs for LAUNCH-02 (content visibility checks)
- [ ] `app/e2e/lifecycle.spec.ts` — stubs for LAUNCH-03 (window-close, activate)
- [ ] `app/test/main/lifecycle.test.ts` — unit tests for lifecycle handlers
- [ ] Verify Playwright Electron-specific config in `app/playwright.config.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CrashReporter captures crashes | LAUNCH-01 | Crash dumps require manual inspection | Check `~/Library/CrashReporter/` for minidumps after forced crash |
| Tray icon persists across app lifecycle | LAUNCH-03 | Visual verification needed | Run app for 10+ minutes, verify tray icon remains visible |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending 2026-03-09
