# Testing Patterns

**Analysis Date:** 2026-03-09

## Test Framework

**Runner:**
- Vitest v4.x (both CLI and app packages)
- CLI config: none (uses Vitest defaults with `"type": "module"`)
- App config: `app/vitest.config.ts`

**Assertion Library:**
- Vitest built-in `expect` (Chai-compatible matchers)
- `@testing-library/jest-dom` available in app for DOM assertions

**E2E Framework:**
- Playwright v1.58.x for Electron E2E tests
- Config: `app/playwright.config.ts`

**Run Commands:**
```bash
# CLI tests
cd cli
npm test                # Run all CLI tests (vitest run)
npm run test:watch      # Watch mode (vitest)

# App unit/component tests
cd app
npm test                # Run all app tests (vitest run)
npm run test:watch      # Watch mode (vitest)

# App E2E tests
cd app
npm run e2e             # Run Playwright E2E tests
```

## Test File Organization

**Location:**
- CLI tests: `cli/test/` (separate from source)
- App component tests: `app/test/components/`
- App main-process tests: `app/test/main/`
- App general tests: `app/test/` (root level for registry, server-mapper)
- App E2E tests: `app/e2e/`
- Test helpers: `cli/test/helpers.ts`

**Naming:**
- CLI tests: `{module-name}.test.ts` (e.g., `sync.test.ts`, `gateway.test.ts`)
- App component tests: `{ComponentName}.test.tsx` (e.g., `Dashboard.test.tsx`, `ServerCard.test.tsx`)
- App main process tests: `{module-name}.test.ts` (e.g., `settings-store.test.ts`)
- E2E tests: `{feature}.spec.ts` (e.g., `app-launch.spec.ts`)

**Structure:**
```
cli/
  test/
    helpers.ts                   # Shared test utilities (setupTempEnv)
    fixtures/                    # Test fixtures (mock-stdio-mcp-server.cjs)
    sync.test.ts                 # Sync engine tests
    gateway.test.ts              # Gateway server integration tests
    daemon.test.ts               # Daemon utility tests
    server-auth.test.ts          # Auth helper unit tests
    status.test.ts               # Status report tests
    compat.test.ts               # Compatibility layer tests
    auth-probe.test.ts           # HTTP auth probe tests

app/
  test/
    components/
      Dashboard.test.tsx         # Dashboard component tests
      ServerCard.test.tsx        # ServerCard component tests
      BrowseTab.test.tsx         # Browse tab tests
      AddServerForm.test.tsx     # Add server form tests
      SettingsPanel.test.tsx     # Settings panel tests
      StatusPopover.test.tsx     # Status popover tests
    main/
      daemon-child-mode.test.ts  # Daemon child process tests
      settings-store.test.ts     # Settings persistence tests
      update-manager.test.ts     # Auto-update manager tests
    registry-client.test.ts      # Registry API client tests
    server-mapper.test.ts        # Server mapping logic tests
  e2e/
    app-launch.spec.ts           # Electron launch E2E test
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

describe("feature name", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  it("describes expected behavior", async () => {
    // Setup
    const env = setupTempEnv("mcpx-test-prefix-");
    cleanups.push(env.restore);

    // Execute
    const result = doSomething();

    // Assert
    expect(result).toBe(expected);
  });
});
```

**Patterns:**

**Setup pattern - Manual cleanup array:**
The codebase uses a cleanup array pattern instead of `beforeEach`/`afterEach` for resource management. Each test pushes its own cleanup function.
```typescript
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) await fn();
  }
});

it("test case", () => {
  const env = setupTempEnv("prefix-");
  cleanups.push(env.restore);     // Env cleanup
  cleanups.push(() => closeServer(server));  // Server cleanup
});
```

**Setup pattern - beforeEach for mocks (app tests):**
```typescript
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "mcpx", {
    value: mockMcpx,
    writable: true
  });
});
```

**Assertion pattern - Structured result checks:**
```typescript
expect(summary.hasErrors).toBe(false);
expect(summary.results.some((result) => result.clientId === "vscode" && result.status === "SYNCED")).toBe(true);
```

**Assertion pattern - Partial matching:**
```typescript
expect(kiro).toMatchObject({
  managed: true,
  status: "SYNCED",
  configPath: "/Users/test/.kiro/mcp.json"
});
```

## Environment Isolation

**Temp Environment Helper (`cli/test/helpers.ts`):**
The primary test isolation mechanism for CLI tests. Creates a temp directory and overrides environment variables to redirect all config/data/state paths.

```typescript
import { setupTempEnv } from "./helpers.js";

const env = setupTempEnv("mcpx-sync-");
cleanups.push(env.restore);
// env.root is the temp directory
// process.env.HOME, MCPX_CONFIG_HOME, MCPX_DATA_HOME, MCPX_STATE_HOME all point to temp dir
// MCPX_SECRET_local_gateway_token set to "test-local-token"
```

**Key principle:** Every CLI test that touches the filesystem MUST use `setupTempEnv()` to avoid reading/writing real user config.

**Vitest environment override (app main process tests):**
```typescript
// @vitest-environment node
```
This comment at file top overrides the default jsdom environment for tests that need Node.js APIs (settings-store, daemon-child, update-manager).

## Mocking

**Framework:** Vitest built-in `vi.fn()`, `vi.mock()`, `vi.doMock()`, `vi.stubGlobal()`

**Pattern 1 - Window API mock for renderer tests:**
```typescript
const mockMcpx = {
  getStatus: vi.fn().mockResolvedValue({ /* status data */ }),
  syncAll: vi.fn(),
  addServer: vi.fn(),
  removeServer: vi.fn().mockResolvedValue({}),
  registryList: vi.fn().mockResolvedValue({ servers: [], metadata: {} }),
  // ... all IPC methods
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "mcpx", {
    value: mockMcpx,
    writable: true
  });
});
```

**Pattern 2 - Electron module mock for main process tests:**
```typescript
vi.mock("electron", () => ({
  app: {
    getPath: getPathMock,
    isPackaged: true
  },
  dialog: {
    showMessageBox: showMessageBoxMock
  }
}));
```

**Pattern 3 - Dynamic mock with `vi.doMock()` for module re-import:**
Used when tests need different mock implementations per test case, requiring `vi.resetModules()`:
```typescript
beforeEach(() => {
  vi.resetModules();
});

it("test case", async () => {
  vi.doMock("@mcpx/core", () => ({
    loadConfig: vi.fn().mockReturnValue(config),
    runDaemonForeground: vi.fn().mockResolvedValue(undefined),
    SecretsManager: MockSecretsManager
  }));

  const { runDaemonChildIfRequested } = await import("../../src/main/daemon-child");
  // ... test
});
```

**Pattern 4 - Global fetch mock:**
```typescript
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

mockFetch.mockResolvedValueOnce({
  ok: true,
  json: async () => ({ servers: [], metadata: {} })
});
```

**Pattern 5 - Real HTTP servers for integration tests:**
CLI gateway and auth-probe tests spin up real HTTP servers on random ports:
```typescript
async function startServer(handler: http.RequestListener): Promise<StartedServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

// Usage in test:
const upstream = await startServer(async (req, res) => {
  // Custom handler for test scenario
});
cleanups.push(() => closeServer(upstream.server));
```

**What to Mock:**
- `window.mcpx` API in renderer component tests
- Electron APIs (`app`, `dialog`, `ipcMain`) in main process tests
- `electron-updater` module in update manager tests
- Global `fetch` for registry client tests

**What NOT to Mock:**
- Core business logic in CLI tests (tested directly with real code)
- File system operations in CLI tests (use `setupTempEnv()` for real temp dirs)
- HTTP gateway server in integration tests (use real servers)
- Zod schemas (tested through the functions that use them)

## Fixtures and Factories

**Mock Data Factories:**
Test data is constructed inline. No shared factory files. Common patterns:

```typescript
// Config factories
const config = defaultConfig();
config.servers.vercel = {
  transport: "http",
  url: "https://mcp.vercel.com"
};

// ManagedIndex test data
const managedIndex: ManagedIndex = {
  schemaVersion: 1,
  managed: {
    claude: {
      configPath: "/Users/test/.claude.json",
      entries: {
        "vercel (mcpx)": {
          fingerprint: "sha",
          lastSyncedAt: "2026-02-15T00:00:00.000Z"
        }
      }
    }
  }
};

// Daemon status mock
function mockDaemonStatus(): DaemonStatus {
  return {
    running: false,
    pidFile: "/tmp/mcpx.pid",
    logFile: "/tmp/mcpx.log",
    port: 37373
  };
}
```

**File Fixtures:**
- `cli/test/fixtures/mock-stdio-mcp-server.cjs` - Mock MCP server for stdio transport testing

**Location:**
- Fixtures in `cli/test/fixtures/`
- Test helpers in `cli/test/helpers.ts`

## Coverage

**Requirements:** No coverage targets enforced. No coverage configuration in either package.

**View Coverage:**
```bash
cd cli && npx vitest run --coverage
cd app && npx vitest run --coverage
```

## Test Types

**Unit Tests:**
- Pure function testing: `server-auth.test.ts`, `compat.test.ts`, `status.test.ts`, `server-mapper.test.ts`
- No external dependencies; fast to run
- Test input/output directly

**Integration Tests:**
- Gateway server tests (`cli/test/gateway.test.ts`): Spin up real HTTP servers, create real gateway instances, make real HTTP requests
- Sync engine tests (`cli/test/sync.test.ts`): Write real config files to temp directories, verify file contents
- Auth probe tests (`cli/test/auth-probe.test.ts`): Real HTTP servers for auth challenge scenarios
- Registry client tests (`app/test/registry-client.test.ts`): Mock fetch but test real client logic

**Component Tests (App):**
- React Testing Library with jsdom environment
- Render components, interact via `fireEvent`, assert via `screen` queries
- Mock `window.mcpx` IPC bridge
- Files: `app/test/components/*.test.tsx`

**E2E Tests:**
- Playwright with Electron support
- `app/e2e/app-launch.spec.ts`: Verifies app launches, dashboard renders
- Requires built app (`npm run build` in app/ first)
- Timeout: 30 seconds per test
- Trace: on-first-retry

## Common Patterns

**Async Testing:**
```typescript
it("handles async operations", async () => {
  const env = setupTempEnv("mcpx-test-");
  cleanups.push(env.restore);

  const gateway = createGatewayServer({ port: 0, expectedToken: "token", secrets: new SecretsManager() });
  await waitForListening(gateway);
  cleanups.push(() => closeServer(gateway));

  const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: "Bearer token" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
  });

  expect(response.status).toBe(200);
  const payload = (await response.json()) as { result: { tools: Array<{ name: string }> } };
  expect(payload.result.tools).toHaveLength(0);
});
```

**Error Testing:**
```typescript
it("throws on invalid input", () => {
  expect(() => resolveAuthTarget(spec)).toThrow("Env var name");
});

it("rejects unsupported features", () => {
  const result = parseClaudeArgs(["my-server", "--transport", "sse", "https://example.com/mcp"]);
  expect(result.error).toContain("--transport sse");
  expect(result.error).toContain("not supported");
});
```

**React Component Testing:**
```typescript
it("renders and handles interaction", async () => {
  render(<Dashboard />);

  // Wait for async data load
  expect(await screen.findByText("vercel")).toBeDefined();

  // Interact
  fireEvent.click(screen.getByText("Settings"));

  // Assert async results
  expect(await screen.findByLabelText("Auto-update")).toBeDefined();
  expect(mockMcpx.getDesktopSettings).toHaveBeenCalledTimes(1);
});
```

**Race Condition Testing (BrowseTab):**
```typescript
it("keeps latest search results when earlier requests resolve later", async () => {
  const initialResolvers: Array<(value: typeof defaultRegistryResponse) => void> = [];
  let searchResolver: ((value: typeof defaultRegistryResponse) => void) | undefined;

  mockMcpx.registryList.mockImplementation((_cursor?: string, query?: string) => {
    return new Promise((resolve) => {
      if (query === "context") {
        searchResolver = resolve;
        return;
      }
      initialResolvers.push(resolve);
    });
  });

  render(<BrowseTab onServerAdded={() => {}} status={mockStatus} />);
  // Trigger search, then resolve in wrong order, verify correct state
});
```

**Timer Testing (Update Manager):**
```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("schedules periodic checks", async () => {
  setAutoUpdateEnabled(true);
  expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
  expect(checkForUpdatesMock).toHaveBeenCalledTimes(2);
});
```

## Adding New Tests

**New CLI core logic:**
1. Create `cli/test/{module}.test.ts`
2. Import from `../src/core/{module}.js`
3. Use `setupTempEnv()` if test touches filesystem
4. Push cleanup functions to `cleanups` array

**New app component:**
1. Create `app/test/components/{ComponentName}.test.tsx`
2. Mock `window.mcpx` with relevant IPC methods
3. Use `render()`, `screen`, `fireEvent` from `@testing-library/react`
4. Use `findByText` / `findByRole` for async-rendered content

**New app main process module:**
1. Create `app/test/main/{module}.test.ts`
2. Add `// @vitest-environment node` at top of file
3. Mock Electron APIs with `vi.mock("electron", ...)`
4. Use `vi.doMock()` and dynamic `import()` if tests need different mocks per case

**New E2E test:**
1. Create `app/e2e/{feature}.spec.ts`
2. Use `@playwright/test` imports
3. Launch with `_electron.launch({ args: [mainPath] })`
4. Build app first: `npm run build` in `app/`

---

*Testing analysis: 2026-03-09*
