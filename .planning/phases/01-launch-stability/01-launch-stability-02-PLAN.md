---
phase: 01-launch-stability
plan: 02
type: execute
wave: 1
depends_on: []
files_modified: [app/src/main/index.ts, app/src/main/dashboard.ts, app/e2e/lifecycle.spec.ts]
autonomous: true
requirements: [LAUNCH-03]
must_haves:
  truths:
    - "Closing window doesn't quit app (stays in menu bar)"
    - "Clicking dock icon reopens dashboard"
    - "Cmd+Q quits entire app (dashboard + daemon + tray)"
  artifacts:
    - path: "app/src/main/index.ts"
      provides: "macOS lifecycle event handlers"
      contains: "window-all-closed|activate|before-quit"
    - path: "app/e2e/lifecycle.spec.ts"
      provides: "E2E tests for lifecycle events"
      exports: ["window-close", "activate", "before-quit"]
  key_links:
    - from: "app/src/main/index.ts"
      to: "app.dock.hide()"
      via: "window-all-closed handler"
      pattern: "window-all-closed.*dock\\.hide"
    - from: "app/src/main/index.ts"
      to: "openDashboard()"
      via: "activate handler"
      pattern: "activate.*openDashboard"
---

<objective>
Verify and test macOS lifecycle event handling to ensure app behaves natively (stays running when window closes, reopens on dock click, quits on Cmd+Q).

Purpose: macOS users expect menu bar apps to persist after window close and respond to dock interactions.
Output: Lifecycle handlers verified, E2E tests for window-close/activate/quit flows.
</objective>

<execution_context>
@/Users/will/.config/opencode/get-shit-done/workflows/execute-plan.md
@/Users/will/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-launch-stability/01-RESEARCH.md

# Current lifecycle handlers from app/src/main/index.ts:
```typescript
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();  // Only quit on non-macOS
  }
});

app.on("activate", () => {
  openDashboard();  // Always create window on activate
});

app.on("before-quit", (e) => {
  if (!allowQuit) {
    e.preventDefault();
    closeDashboard();
    app.hide();
    return;
  }
});
```

# Current dashboard management from app/src/main/dashboard.ts:
```typescript
export function openDashboard(): BrowserWindow;
export function closeDashboard(): void;
// Dashboard window stored in module-level variable (prevents GC)
```
</context>

<tasks>

<task type="auto">
  <name>Task 1: Verify lifecycle handlers match macOS conventions</name>
  <files>app/src/main/index.ts, app/src/main/dashboard.ts</files>
  <action>
    Review current lifecycle handlers in index.ts. Verify:
    1. window-all-closed: Only quits on non-macOS (already correct per line 119-122)
    2. activate: Calls openDashboard() on every activate (already correct per line 126-128)
    3. before-quit: Prevents quit unless allowQuit=true, hides app (already correct per line 113-120)

    Check dashboard.ts for proper window management:
    1. openDashboard() shows existing window or creates new one (verify lines 6-14)
    2. BrowserWindow stored in module-level variable (verify line 4)
    3. Window 'closed' event clears reference (verify lines 37-40)

    If all correct, no code changes needed. Add comment documenting macOS lifecycle behavior.
  </action>
  <verify>
    <automated>npm run build --prefix app</automated>
  </verify>
  <done>
    Lifecycle handlers verified as macOS-compliant. Code comments added documenting behavior. Build succeeds.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create E2E test for macOS lifecycle events</name>
  <files>app/e2e/lifecycle.spec.ts</files>
  <behavior>
    - Test window close doesn't quit app (process still running)
    - Test dock click (activate) reopens window
    - Test Cmd+Q (before-quit with allowQuit) quits entire app
    - Each test verifies expected state after action
  </behavior>
  <action>
    Create new file app/e2e/lifecycle.spec.ts with three test.describe blocks:

    1. "window-all-closed": Launch app, get window, call window.close(), verify app.process().pid still exists
    2. "activate": Launch app, close window, trigger app.dock.show() or evaluate activate event, verify new window created
    3. "before-quit": Launch app, trigger app.quit() with allowQuit flag set (may need IPC or evaluate), verify app closes completely

    Use Playwright's electron API: app.evaluate() to run code in main process, app.firstWindow() to get windows, app.close() to quit.
  </action>
  <verify>
    <automated>npm run e2e --prefix app -- lifecycle.spec.ts</automated>
  </verify>
  <done>
    E2E test file created with 3 test cases for window-close, activate, and before-quit. Tests run without syntax errors.
  </done>
</task>

</tasks>

<verification>
- Build succeeds: `npm run build --prefix app`
- E2E tests run: `npm run e2e --prefix app -- lifecycle.spec.ts`
- Lifecycle handlers present in app/src/main/index.ts (window-all-closed, activate, before-quit)
- Dashboard window management verified in app/src/main/dashboard.ts
</verification>

<success_criteria>
- LAUNCH-03 addressed: macOS lifecycle handlers verified and tested
- window-all-closed keeps app running on macOS
- activate event reopens dashboard window
- before-quit allows graceful quit with Cmd+Q
- E2E tests cover all three lifecycle scenarios
</success_criteria>

<output>
After completion, create `.planning/phases/01-launch-stability/01-launch-stability-02-SUMMARY.md` with:
- Lifecycle handler verification results
- Any code comments added
- E2E test structure for lifecycle events
- Test execution results
</output>
