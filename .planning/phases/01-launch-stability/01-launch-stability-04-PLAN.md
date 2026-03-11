---
phase: 01-launch-stability
plan: 04
type: execute
wave: 1
depends_on: []
files_modified: [app/src/main/index.ts, app/test/main/lifecycle.test.ts]
autonomous: true
requirements: [LAUNCH-03]
gap_closure: true

must_haves:
  truths:
    - "Closing window doesn't quit app (stays in menu bar)"
    - "Clicking dock icon reopens dashboard"
    - "Cmd+Q quits entire app (dashboard + daemon + tray)"
  artifacts:
    - path: "app/src/main/index.ts"
      provides: "Lifecycle handler registration"
      contains: "app.on.*window-all-closed"
    - path: "app/test/main/lifecycle.test.ts"
      provides: "Unit tests for lifecycle handlers"
      exports: ["window-all-closed", "activate", "before-quit"]
  key_links:
    - from: "app/test/main/lifecycle.test.ts"
      to: "app/src/main/index.ts"
      via: "ESM dynamic import"
      pattern: "await import.*main/index"
    - from: "app/src/main/index.ts"
      to: "app.dock.hide()"
      via: "window-all-closed handler"
      pattern: "app\\.on.*window-all-closed"
---

<objective>
Fix lifecycle unit tests to use ESM imports and test lifecycle handlers in isolation, addressing verification failures from 01-launch-stability-VERIFICATION.md.

Purpose: Enable isolated testing of macOS lifecycle handlers without ESM/Electron incompatibility issues.
Output: Refactored lifecycle.test.ts with working ESM imports, extracted handler registration function.
</objective>

<execution_context>
@/Users/will/.config/opencode/get-shit-done/workflows/execute-plan.md
@/Users/will/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/01-launch-stability/01-launch-stability-VERIFICATION.md
@.planning/phases/01-launch-stability/01-launch-stability-02-SUMMARY.md

# Gap source (from VERIFICATION.md):
**Root cause:** lifecycle.test.ts uses require() pattern incompatible with ESM/Electron modules
- Lines 66, 83, 102, 123, 141: require("../../src/main/index") fails
- All 6 tests fail with "Cannot find module" error

# Current lifecycle handlers (from index.ts lines 108-133):
```typescript
app.on("before-quit", (e) => {
  if (!allowQuit) {
    e.preventDefault();
    closeDashboard();
    app.hide();
    return;
  }
});

app.on("activate", () => {
  openDashboard();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
```

# Solution approach:
1. Extract lifecycle handler registration into separate function `registerLifecycleHandlers()`
2. Export the function for explicit import in tests
3. Refactor tests to use ESM dynamic imports or direct function calls
4. Set platform mock BEFORE importing to test macOS vs non-macOS behavior
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extract lifecycle handlers into testable function</name>
  <files>app/src/main/index.ts</files>
  <action>
    Refactor app/src/main/index.ts to extract lifecycle handler registration into a separate exported function:

    1. Create new exported function `registerLifecycleHandlers()` that:
       - Takes dependencies as parameters: { app, openDashboard, closeDashboard, allowQuitRef }
       - Registers all three handlers (before-quit, activate, window-all-closed)
       - Returns object with handler references for testing

    2. Keep existing inline handlers in startMainProcess() for production use (no behavior change)
       - OR call registerLifecycleHandlers() from startMainProcess() if cleaner

    3. Export allowQuit as a mutable reference object so tests can modify it:
       ```typescript
       export const lifecycleState = { allowQuit: false };
       ```

    4. Ensure function is pure enough to test without full Electron runtime:
       - Dependencies passed as parameters (not imported directly)
       - No side effects beyond handler registration

    Example structure:
    ```typescript
    export const lifecycleState = { allowQuit: false };

    export function registerLifecycleHandlers(deps: {
      app: typeof import("electron").app;
      openDashboard: () => void;
      closeDashboard: () => void;
    }) {
      deps.app.on("before-quit", (e) => {
        if (!lifecycleState.allowQuit) {
          e.preventDefault();
          deps.closeDashboard();
          deps.app.hide();
        }
      });
      // ... other handlers
    }
    ```

    This enables tests to:
    - Import registerLifecycleHandlers explicitly (no require())
    - Pass mocked dependencies
    - Control lifecycleState.allowQuit for testing before-quit behavior
  </action>
  <verify>
    <automated>npx tsc --noEmit --prefix app</automated>
  </verify>
  <done>
    registerLifecycleHandlers() exported from app/src/main/index.ts, lifecycleState exported for allowQuit control, TypeScript compiles without errors, existing behavior unchanged.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Refactor lifecycle tests to use ESM imports</name>
  <files>app/test/main/lifecycle.test.ts</files>
  <behavior>
    - Test window-all-closed doesn't call app.quit() on macOS
    - Test window-all-closed calls app.quit() on non-macOS (linux, win32)
    - Test activate calls openDashboard when activated
    - Test before-quit prevents quit when allowQuit is false
    - All tests use ESM imports (no require() calls)
  </behavior>
  <action>
    Rewrite app/test/main/lifecycle.test.ts to use ESM pattern:

    1. Remove all require("../../src/main/index") calls

    2. Use dynamic import pattern with explicit handler triggering:
       ```typescript
       import { registerLifecycleHandlers, lifecycleState } from "../../src/main/index";
       ```

    3. For each test, set up mocks BEFORE calling registerLifecycleHandlers():
       ```typescript
       const handlers: Record<string, (e?: any) => void> = {};
       const mockApp = {
         on: vi.fn((event, handler) => { handlers[event] = handler; }),
         quit: vi.fn(),
         hide: vi.fn(),
         // ... other mocks
       };

       // Set platform
       Object.defineProperty(process, "platform", { value: "darwin", configurable: true, writable: true });

       // Register handlers with mocked dependencies
       registerLifecycleHandlers({
         app: mockApp as any,
         openDashboard: mockOpenDashboard,
         closeDashboard: mockCloseDashboard,
       });
       ```

    4. Trigger handlers and verify:
       - window-all-closed on macOS: expect(mockApp.quit).not.toHaveBeenCalled()
       - window-all-closed on linux: expect(mockApp.quit).toHaveBeenCalled()
       - activate: expect(mockOpenDashboard).toHaveBeenCalled()
       - before-quit with allowQuit=false: expect(event.preventDefault).toHaveBeenCalled()

    5. For testing allowQuit behavior, modify lifecycleState before triggering:
       ```typescript
       lifecycleState.allowQuit = false; // or true
       ```

    6. Clear mocks between tests using beforeEach() hook

    Keep all 6 existing test cases, just change import/registration pattern.
  </action>
  <verify>
    <automated>npm test --prefix app -- lifecycle.test.ts</automated>
  </verify>
  <done>
    All 6 lifecycle tests pass using ESM imports, no require() calls in file, tests verify macOS vs non-macOS behavior, before-quit allowQuit logic tested.
  </done>
</task>

</tasks>

<verification>
- TypeScript compiles: `npx tsc --noEmit --prefix app`
- All lifecycle tests pass: `npm test --prefix app -- lifecycle.test.ts` (6/6 tests)
- No require() calls in lifecycle.test.ts
- Existing E2E lifecycle tests still pass: `npm run e2e --prefix app -- lifecycle.spec.ts`
</verification>

<success_criteria>
- LAUNCH-03 fully verified: Unit tests pass (were failing before)
- E2E tests continue to pass (already working)
- Lifecycle handlers testable in isolation with mocked dependencies
- Gap closure complete: VERIFICATION.md gaps addressed
</success_criteria>

<output>
After completion, create `.planning/phases/01-launch-stability/01-launch-stability-04-SUMMARY.md` with:
- Refactored lifecycle handler structure
- Test results showing all 6 tests passing
- Confirmation that E2E tests still pass
- Updated gap status for re-verification
</output>
