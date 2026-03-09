---
phase: 01-launch-stability
plan: 03
type: execute
wave: 2
depends_on: [01, 02]
files_modified: [app/e2e/render.spec.ts, app/test/main/lifecycle.test.ts]
autonomous: true
requirements: [LAUNCH-02]
must_haves:
  truths:
    - "Window renders full UI content (not blank/white screen)"
    - "React app mounts to #root element"
    - "Dashboard component renders with expected structure"
  artifacts:
    - path: "app/e2e/render.spec.ts"
      provides: "E2E test for content rendering verification"
      contains: "test.describe.*render"
    - path: "app/test/main/lifecycle.test.ts"
      provides: "Unit tests for lifecycle handlers"
      exports: ["window-all-closed", "activate"]
  key_links:
    - from: "app/e2e/render.spec.ts"
      to: "app/src/renderer/index.html"
      via: "loadFile() with #dashboard hash"
      pattern: "loadFile.*index.html.*hash.*dashboard"
    - from: "app/test/main/lifecycle.test.ts"
      to: "app/src/main/index.ts"
      via: "lifecycle handler mocks"
      pattern: "app\\.on.*window-all-closed"
---

<objective>
Create comprehensive render verification tests and unit tests for lifecycle handlers to ensure window renders content correctly and lifecycle behaves as expected.

Purpose: Verify UI renders fully (not blank screen) and lifecycle handlers work in isolation.
Output: E2E render test, unit tests for lifecycle handlers.
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

# Existing render test from app/e2e/app-launch.spec.ts:
```typescript
test("can open and render dashboard content", async () => {
  const app = await electron.launch({ args: [mainPath] });
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = new BrowserWindow({ /* config */ });
    await win.loadFile(indexPath, { hash: "dashboard" });
  });
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  const root = await window.locator("#root").count();
  expect(root).toBe(1);
});
```

# Current lifecycle from app/src/main/index.ts:
```typescript
app.on("window-all-closed", handler);
app.on("activate", handler);
app.on("before-quit", handler);
```
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create comprehensive E2E render test</name>
  <files>app/e2e/render.spec.ts</files>
  <behavior>
    - Test verifies #root element exists in DOM
    - Test verifies Dashboard component renders (check for expected text or element)
    - Test verifies no blank/white screen (content visible, not just root div)
    - Test waits for React to hydrate (waitForLoadState + additional wait)
  </behavior>
  <action>
    Create new file app/e2e/render.spec.ts with test.describe "render":

    Test 1 "renders dashboard content": Launch app, load dashboard, wait for DOMContentLoaded, then:
    - Verify #root element count === 1
    - Verify expected dashboard text exists (e.g., "Servers", "Browse", or similar - check actual dashboard UI)
    - Verify no blank screen (check body has content, not empty)

    Use Playwright's window.locator() to find elements. Check actual Dashboard.tsx for specific text/elements to verify.

    If dashboard not yet built, create stub test that verifies #root exists and mark as Wave 0.
  </action>
  <verify>
    <automated>npm run e2e --prefix app -- render.spec.ts</automated>
  </verify>
  <done>
    E2E render test created with verifications for #root, expected content, and no blank screen. Tests run without syntax errors.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create unit tests for lifecycle handlers</name>
  <files>app/test/main/lifecycle.test.ts</files>
  <behavior>
    - Test window-all-closed doesn't call app.quit() on macOS
    - Test window-all-closed calls app.quit() on non-macOS
    - Test activate calls openDashboard() when no windows
    - Test activate doesn't create duplicate windows
  </behavior>
  <action>
    Create new file app/test/main/lifecycle.test.ts using Vitest:

    Mock Electron's app object with vi.mock() or manual mock:
    - Mock app.on(event, handler) to capture handlers
    - Mock app.quit(), app.hide(), app.dock.show/hide
    - Mock BrowserWindow.getAllWindows() to return [] or [window]

    Import startMainProcess or manually invoke lifecycle setup. Trigger captured handlers and verify:
    1. window-all-closed on macOS: expect(app.quit).not.toHaveBeenCalled()
    2. window-all-closed on non-macOS: expect(app.quit).toHaveBeenCalled()
    3. activate with no windows: expect(openDashboard).toHaveBeenCalled()
    4. activate with existing windows: expect(openDashboard).not.toHaveBeenCalled() (or verify show/focus called)

    Use process.platform mock to test macOS vs non-macOS behavior.
  </action>
  <verify>
    <automated>npm test --prefix app -- lifecycle.test.ts</automated>
  </verify>
  <done>
    Unit tests created for lifecycle handlers. All tests pass when run with vitest. Mocks properly isolate Electron APIs.
  </done>
</task>

</tasks>

<verification>
- E2E test runs: `npm run e2e --prefix app -- render.spec.ts`
- Unit tests pass: `npm test --prefix app -- lifecycle.test.ts`
- Render test verifies #root exists and content renders
- Lifecycle tests verify macOS vs non-macOS behavior
</verification>

<success_criteria>
- LAUNCH-02 addressed: Comprehensive render test created
- E2E test verifies dashboard renders with actual content
- Unit tests verify lifecycle handlers in isolation
- All tests pass (or marked as Wave 0 stubs if UI not ready)
</success_criteria>

<output>
After completion, create `.planning/phases/01-launch-stability/01-launch-stability-03-SUMMARY.md` with:
- Render test structure and verifications
- Lifecycle unit test structure and mocks
- Test results (passing or Wave 0 status)
- Any gaps identified for future phases
</output>
