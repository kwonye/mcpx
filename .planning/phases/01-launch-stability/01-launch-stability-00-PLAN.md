---
phase: 01-launch-stability
plan: 00
type: execute
wave: 0
depends_on: []
files_modified: [app/e2e/launch.spec.ts, app/e2e/lifecycle.spec.ts, app/e2e/render.spec.ts, app/test/main/lifecycle.test.ts]
autonomous: true
requirements: [LAUNCH-01, LAUNCH-02, LAUNCH-03]
must_haves:
  truths:
    - "Test infrastructure files exist with stubs"
    - "Test commands run without syntax errors"
    - "Wave 1-2 tasks have test files to verify against"
  artifacts:
    - path: "app/e2e/launch.spec.ts"
      provides: "E2E test stub for 10-launch reliability test"
      contains: "test.describe"
    - path: "app/e2e/lifecycle.spec.ts"
      provides: "E2E test stub for lifecycle events"
      contains: "test.describe"
    - path: "app/e2e/render.spec.ts"
      provides: "E2E test stub for render verification"
      contains: "test.describe"
    - path: "app/test/main/lifecycle.test.ts"
      provides: "Unit test stub for lifecycle handlers"
      exports: ["test", "describe", "expect"]
  key_links:
    - from: "app/e2e/launch.spec.ts"
      to: "app/src/main/index.ts"
      via: "electron.launch() with mainPath"
      pattern: "electron\\.launch"
    - from: "app/test/main/lifecycle.test.ts"
      to: "app/src/main/index.ts"
      via: "import lifecycle handlers"
      pattern: "import.*from.*main"
---

<objective>
Scaffold test infrastructure files with stubs to enable Wave 1-2 implementation and satisfy Nyquist sampling requirements.

Purpose: Create test file structure before implementation tasks so every task has automated verification. Enables Wave 1-2 tasks to implement against existing test contracts.
Output: Four test files with stubs that Wave 1-2 tasks will populate with real implementations.
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
@.planning/phases/01-launch-stability/01-VALIDATION.md

# Test framework setup from validation strategy:
- Unit tests: Vitest 4.x, config at app/vitest.config.ts
- E2E tests: Playwright 1.58.x, config at app/playwright.config.ts
- Quick run: npm run test (in app/)
- Full suite: npm run test && npm run e2e

# Test file locations per VALIDATION.md Wave 0 Requirements:
- app/e2e/launch.spec.ts — LAUNCH-01 (10 consecutive launches)
- app/e2e/render.spec.ts — LAUNCH-02 (content visibility)
- app/e2e/lifecycle.spec.ts — LAUNCH-03 (window-close, activate)
- app/test/main/lifecycle.test.ts — unit tests for lifecycle handlers
</context>

<tasks>

<task type="auto">
  <name>Task 1: Scaffold E2E test files with describe blocks</name>
  <files>app/e2e/launch.spec.ts, app/e2e/lifecycle.spec.ts, app/e2e/render.spec.ts</files>
  <action>
    Create three E2E test files with proper Playwright structure:

    1. app/e2e/launch.spec.ts:
    ```typescript
    import { test, expect, _electron as electron } from "@playwright/test";
    import path from "path";

    const mainPath = path.join(__dirname, "../src/main/index.ts");

    test.describe("launch reliability", () => {
      test("should launch 10 times consecutively", async () => {
        // Wave 0 stub: implement in Wave 1
        // TODO: Loop 10x: launch app, verify pid, close app
      });
    });
    ```

    2. app/e2e/lifecycle.spec.ts:
    ```typescript
    import { test, expect, _electron as electron } from "@playwright/test";
    import path from "path";

    const mainPath = path.join(__dirname, "../src/main/index.ts");

    test.describe("window-all-closed", () => {
      test("should keep app running after window close", async () => {
        // Wave 0 stub: implement in Wave 2
      });
    });

    test.describe("activate", () => {
      test("should reopen window on dock click", async () => {
        // Wave 0 stub: implement in Wave 2
      });
    });

    test.describe("before-quit", () => {
      test("should quit entirely on Cmd+Q", async () => {
        // Wave 0 stub: implement in Wave 2
      });
    });
    ```

    3. app/e2e/render.spec.ts:
    ```typescript
    import { test, expect, _electron as electron } from "@playwright/test";
    import path from "path";

    const mainPath = path.join(__dirname, "../src/main/index.ts");

    test.describe("render", () => {
      test("should render dashboard content", async () => {
        // Wave 0 stub: implement in Wave 2
        // TODO: Verify #root exists, Dashboard renders, no blank screen
      });
    });
    ```

    Use Write tool for each file. Preserve existing app/e2e/app-launch.spec.ts if it exists.
  </action>
  <verify>
    <automated>ls app/e2e/launch.spec.ts app/e2e/lifecycle.spec.ts app/e2e/render.spec.ts</automated>
  </verify>
  <done>
    Three E2E test files created with test.describe blocks and stub implementations. Files exist and contain valid TypeScript.
  </done>
</task>

<task type="auto">
  <name>Task 2: Scaffold unit test file for lifecycle handlers</name>
  <files>app/test/main/lifecycle.test.ts</files>
  <action>
    Create app/test/main/lifecycle.test.ts with Vitest structure:

    ```typescript
    import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

    // Mock Electron app object
    const mockApp = {
      on: vi.fn(),
      quit: vi.fn(),
      hide: vi.fn(),
      exit: vi.fn(),
      dock: {
        show: vi.fn(),
        hide: vi.fn(),
      },
      whenReady: vi.fn(),
      requestSingleInstanceLock: vi.fn(),
    };

    vi.mock("electron", () => ({
      app: mockApp,
      crashReporter: { start: vi.fn() },
      dialog: { showErrorBox: vi.fn() },
    }));

    describe("lifecycle handlers", () => {
      beforeEach(() => {
        vi.clearAllMocks();
        // Wave 0 stub: will import and trigger lifecycle setup in Wave 2
      });

      describe("window-all-closed", () => {
        it("should not quit on macOS", () => {
          // TODO: Trigger handler, expect app.quit not called
        });

        it("should quit on non-macOS", () => {
          // TODO: Trigger handler, expect app.quit called
        });
      });

      describe("activate", () => {
        it("should call openDashboard when no windows", () => {
          // TODO: Trigger handler, expect openDashboard called
        });

        it("should not create duplicate windows", () => {
          // TODO: Verify window management logic
        });
      });

      describe("before-quit", () => {
        it("should prevent quit unless allowQuit=true", () => {
          // TODO: Test e.preventDefault() behavior
        });
      });
    });
    ```

    File provides test structure for Wave 2 implementation.
  </action>
  <verify>
    <automated>ls app/test/main/lifecycle.test.ts</automated>
  </verify>
  <done>
    Unit test file created with Vitest describe/it blocks and Electron mocks. File exists and contains valid TypeScript.
  </done>
</task>

<task type="auto">
  <name>Task 3: Verify test infrastructure syntax</name>
  <files>app/e2e/launch.spec.ts, app/e2e/lifecycle.spec.ts, app/e2e/render.spec.ts, app/test/main/lifecycle.test.ts</files>
  <action>
    Run TypeScript compilation checks on all test files:

    1. Build app to verify E2E test syntax: npm run build --prefix app
    2. Run Vitest check on unit test: npm run test --prefix app -- lifecycle.test.ts --run

    If build fails, fix TypeScript syntax errors in test files. Ensure imports are correct and types match Playwright/Vitest APIs.

    Note: Tests are Wave 0 stubs - they may be empty or use test.fixme() but must compile without errors.
  </action>
  <verify>
    <automated>npm run build --prefix app && npm run test --prefix app -- lifecycle.test.ts --run</automated>
  </verify>
  <done>
    All test files compile without syntax errors. Build succeeds and Vitest runs lifecycle.test.ts without crashing.
  </done>
</task>

</tasks>

<verification>
- Build succeeds: npm run build --prefix app
- All four test files exist: ls app/e2e/*.spec.ts app/test/main/lifecycle.test.ts
- Test files contain valid TypeScript with proper imports
- Vitest can load lifecycle.test.ts without errors
</verification>

<success_criteria>
- LAUNCH-01, LAUNCH-02, LAUNCH-03 addressed: Test infrastructure created
- Wave 0 complete: All test stubs exist before Wave 1-2 implementation
- Nyquist compliance restored: Every Wave 1-2 task has test file to verify against
- Sampling continuity: No gaps between implementation and verification
</success_criteria>

<output>
After completion, create `.planning/phases/01-launch-stability/01-launch-stability-00-SUMMARY.md` with:
- Test files created (launch.spec.ts, lifecycle.spec.ts, render.spec.ts, lifecycle.test.ts)
- Stub structure documented
- Build output showing successful compilation
- Wave 1-2 readiness confirmation
</output>
