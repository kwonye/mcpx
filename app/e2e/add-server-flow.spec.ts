import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { resolve, join } from "node:path";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

const mainPath = resolve(__dirname, "../out/main/index.js");

interface Sandbox {
  env: NodeJS.ProcessEnv;
  stateHome: string;
  dirs: string[];
}

/**
 * Fresh, isolated HOME/config/data/state directories so this spec never
 * touches the developer's real ~/.config/mcpx. Mirrors cli/src/core/paths.ts,
 * which reads these env vars before falling back to the real home directory.
 */
function createSandbox(): Sandbox {
  const home = mkdtempSync(join(tmpdir(), "mcpx-e2e-home-"));
  const configHome = mkdtempSync(join(tmpdir(), "mcpx-e2e-config-"));
  const dataHome = mkdtempSync(join(tmpdir(), "mcpx-e2e-data-"));
  const stateHome = mkdtempSync(join(tmpdir(), "mcpx-e2e-state-"));

  return {
    env: {
      ...process.env,
      HOME: home,
      MCPX_CONFIG_HOME: configHome,
      MCPX_DATA_HOME: dataHome,
      MCPX_STATE_HOME: stateHome,
      MCPX_NO_UPDATE: "1"
    },
    stateHome,
    dirs: [home, configHome, dataHome, stateHome]
  };
}

/**
 * Best-effort kill of any daemon process left running against this sandbox's
 * state dir (see cli/src/core/daemon.ts's pidfile format: "pid:port"). The
 * daemon is spawned detached, so it survives the Electron app closing.
 */
function killSandboxDaemon(stateHome: string): void {
  const pidPath = join(stateHome, "mcpx", "runtime", "daemon.pid");
  if (!existsSync(pidPath)) {
    return;
  }

  try {
    const raw = readFileSync(pidPath, "utf8").trim();
    const pid = Number(raw.split(":")[0]);
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function cleanupSandbox(sandbox: Sandbox): void {
  killSandboxDaemon(sandbox.stateHome);
  for (const dir of sandbox.dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures.
    }
  }
}

/**
 * app.close() waits on a graceful-shutdown handshake that has been observed
 * to hang indefinitely when the main process still has an in-flight fetch
 * from its own daemon auto-start readiness check (gateway.autoStart
 * defaults to true; cli/src/core/daemon.ts's waitForGatewayReady retries
 * for a hardcoded 5000ms). Race the graceful close against a bounded
 * timeout and force-kill the OS process if it hasn't exited by then, so a
 * hung close never eats the whole test budget. The detached daemon child
 * survives either way (by design) and is cleaned up separately via
 * killSandboxDaemon().
 */
async function closeApp(app: ElectronApplication): Promise<void> {
  const proc = app.process();
  await Promise.race([
    app.close().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 6000))
  ]);
  if (proc.exitCode === null) {
    proc.kill("SIGKILL");
  }
}

/**
 * The app is a menu-bar app: no window exists until something opens one.
 * Emitting "activate" runs the real production openDashboard() path (with
 * preload wired up, unlike a manually-constructed BrowserWindow), the same
 * way lifecycle.spec.ts and tray.spec.ts do. We retry the emit because the
 * "activate" listener isn't registered until app startup (whenReady() +
 * lifecycle handler registration) has completed.
 *
 * This build has the "dev" flavor baked in, which auto-opens the popover
 * (hash #popover) at launch - so a window already exists before we ever
 * call activate, and app.firstWindow()/windows()[0] would return that
 * popover, not the dashboard. openDashboard() always hides the popover and
 * creates/reveals a separate #dashboard window regardless of flavor, so we
 * search app.windows() by URL hash instead of assuming index/order, the
 * same way tray.spec.ts searches for ".sidebar" among all open windows.
 */
async function openDashboardWindow(app: ElectronApplication): Promise<Page> {
  async function findDashboard(): Promise<Page | undefined> {
    return (await app.windows()).find((win) => win.url().includes("#dashboard"));
  }

  await expect
    .poll(
      async () => {
        if (await findDashboard()) {
          return true;
        }
        await app.evaluate(({ app }) => {
          app.emit("activate");
        });
        return Boolean(await findDashboard());
      },
      { timeout: 20000, intervals: [300] }
    )
    .toBe(true);

  const window = await findDashboard();
  if (!window) {
    throw new Error("Dashboard window (#dashboard) did not open after emitting 'activate'.");
  }
  await window.waitForLoadState("domcontentloaded");
  // Dashboard renders a "Loading..." placeholder (no .sidebar) until the
  // initial GET_STATUS IPC call resolves - wait past that gate.
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 15000 });
  return window;
}

test.describe("add server flow", () => {
  test("adds a server from a valid mcpx add command", async () => {
    test.setTimeout(60000);

    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });
      const window = await openDashboardWindow(app);

      await window.locator("#cli-command").fill("add e2etest -- echo hi");
      await window.locator(".cli-command-form button[type=\"submit\"]").click();

      await expect(
        window.locator(".server-card").filter({ hasText: "e2etest" })
      ).toBeVisible({ timeout: 15000 });
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });

  test("shows a parser error for an unrecognized command", async () => {
    test.setTimeout(60000);

    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });
      const window = await openDashboardWindow(app);

      await window.locator("#cli-command").fill("definitely not valid");
      await window.locator(".cli-command-form button[type=\"submit\"]").click();

      // Scoped to the CLI panel: .feedback-message.error is reused by several
      // components (DaemonControls, ProjectsTab, SettingsPanel, ...).
      await expect(
        window.locator(".cli-command-panel .feedback-message.error")
      ).toContainText("Unrecognized command", { timeout: 15000 });
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });
});
