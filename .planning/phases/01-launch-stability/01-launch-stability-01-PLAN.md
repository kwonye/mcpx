---
phase: 01-launch-stability
plan: 01
type: execute
wave: 1
depends_on: ["00"]
files_modified: [app/src/main/index.ts, app/src/main/tray.ts, app/e2e/launch.spec.ts]
autonomous: true
requirements: [LAUNCH-01, LAUNCH-02]
must_haves:
  truths:
    - "App launches 10/10 times without crashing"
    - "Main window renders full UI content (not blank screen)"
    - "Crash reporter captures diagnostic info on failure"
  artifacts:
    - path: "app/src/main/index.ts"
      provides: "App bootstrap with crashReporter and error handling"
      exports: ["startMainProcess"]
    - path: "app/e2e/launch.spec.ts"
      provides: "E2E tests for launch reliability"
      contains: "test.describe.*launch"
  key_links:
    - from: "app/src/main/index.ts"
      to: "Electron crashReporter"
      via: "initialization before app.whenReady()"
      pattern: "crashReporter\\.start"
    - from: "app/e2e/launch.spec.ts"
      to: "app/src/main/index.ts"
      via: "electron.launch()"
      pattern: "electron\\.launch.*args.*mainPath"
---

<objective>
Add crash diagnostics and launch reliability testing to ensure app starts consistently without silent failures.

Purpose: Enable crash diagnosis and verify launch succeeds 10/10 times with proper error feedback to users.
Output: CrashReporter configured, error boundaries with user dialogs, E2E test for 10 consecutive launches.
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

# Key interfaces from current codebase
From app/src/main/index.ts:
```typescript
export async function startMainProcess(): Promise<void>;
// Current: Calls app.whenReady(), creates tray, registers IPC, sets up lifecycle handlers
// Missing: crashReporter initialization, explicit error handling with user feedback
```

From app/src/main/tray.ts:
```typescript
export function createTray(): Tray;
export function updateTrayForDaemonStatus(running: boolean): void;
// Module-level tray reference already exists (prevents GC)
```
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add crashReporter and error boundaries</name>
  <files>app/src/main/index.ts</files>
  <behavior>
    - crashReporter.start() called BEFORE any Electron APIs (including app.whenReady())
    - crashReporter configured with productName: "mcpx", uploadToServer: false
    - startup errors caught and shown to user via dialog.showErrorBox()
    - App exits with code 1 on startup failure
  </behavior>
  <action>
    Import crashReporter from electron at top of file. Add crashReporter.start() call as the very first line in startMainProcess(), before app.requestSingleInstanceLock() and app.whenReady(). 

    Wrap the entire startMainProcess() async block in try/catch. In catch block:
    1. Log error with console.error("[main] startup failed:", error)
    2. Call dialog.showErrorBox("Startup Error", "mcpx failed to start: {message}")
    3. Call app.exit(1)

    Ensure all imports are at top: import { app, dialog, crashReporter } from "electron";
  </action>
  <verify>
    <automated>npm run build --prefix app</automated>
  </verify>
  <done>
    crashReporter.start() appears before any Electron API calls in index.ts. Error handler shows dialog and exits on startup failure. Build succeeds.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create E2E test for 10 consecutive launches</name>
  <files>app/e2e/launch.spec.ts</files>
  <behavior>
    - Test attempts to launch app 10 times in a loop
    - Each launch verifies app process is running (pid exists)
    - Test fails if any launch attempt crashes or fails to start
    - Each iteration properly closes app before next attempt
  </behavior>
  <action>
    Replace existing "app launch" test.describe with a loop that:
    1. Runs electron.launch({ args: [mainPath] }) 10 times
    2. For each launch: verify app.process().pid !== undefined
    3. Call await app.close() after each verification
    4. Use test.fixme() or skip for now if actual binary not built (mark as Wave 0 stub)

    Keep existing "dashboard window" test as-is for now (covers LAUNCH-02).
  </action>
  <verify>
    <automated>npm run e2e --prefix app -- launch.spec.ts</automated>
  </verify>
  <done>
    E2E test file contains loop with 10 launch attempts, each verifying pid and closing properly. Test runs without syntax errors.
  </done>
</task>

</tasks>

<verification>
- Build succeeds: `npm run build --prefix app`
- E2E test runs (may skip if binary not built): `npm run e2e --prefix app -- launch.spec.ts`
- crashReporter.start() appears before app.whenReady() in app/src/main/index.ts
- Error handling includes dialog.showErrorBox and app.exit(1)
</verification>

<success_criteria>
- LAUNCH-01 addressed: Crash diagnostics enabled, 10-launch E2E test created
- LAUNCH-02 addressed: Existing dashboard render test retained
- crashReporter configured in main process
- Error boundaries provide user-visible feedback on startup failure
</success_criteria>

<output>
After completion, create `.planning/phases/01-launch-stability/01-launch-stability-01-SUMMARY.md` with:
- crashReporter initialization code added
- Error handler implementation details
- E2E test structure (10-launch loop)
- Build output and test results
</output>
