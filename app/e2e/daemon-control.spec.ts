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
 * daemon is spawned detached, so it survives the Electron app closing - this
 * spec must never leak it, even if an assertion above throws first.
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

/**
 * Click the gateway Start/Stop toggle and wait for the sidebar title to
 * reflect targetText.
 *
 * gateway.autoStart defaults to true (cli/src/core/config.ts), so on a fresh
 * sandbox the app may auto-start the daemon concurrently with this spec
 * opening the dashboard. If that background start wins the race after our
 * initial status read but before our click, the click's own daemonStart()
 * calls into an already-running daemon, the IPC call rejects, and the
 * component's onRefresh() is skipped - leaving the title stale even though
 * the real state already matches what we wanted. A window "focus" event is
 * the app's own mechanism for pulling a fresh status (see useStatus's focus
 * listener), so re-dispatching it recovers deterministically without a
 * hand-authored retry-click loop.
 */
async function toggleAndAwait(window: Page, targetText: "Gateway Running" | "Gateway Stopped"): Promise<void> {
  const title = window.locator(".daemon-panel__title");
  const toggleButton = window.locator(".daemon-panel button");

  await toggleButton.click();

  try {
    await expect(title).toHaveText(targetText, { timeout: 8000 });
    return;
  } catch {
    // Fall through to the recovery path below.
  }

  await window.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(title).toHaveText(targetText, { timeout: 15000 });
}

test.describe("daemon control", () => {
  test("toggling the gateway from the sidebar flips its running state and back", async () => {
    test.setTimeout(90000);

    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });
      const window = await openDashboardWindow(app);

      const title = window.locator(".daemon-panel__title");
      await expect(title).toHaveText(/^Gateway (Running|Stopped)$/, { timeout: 15000 });

      const initialText = (await title.textContent()) ?? "";
      const wasRunning = initialText.includes("Running");

      // Flip once, then flip back - assert on the transition, not on which
      // state autoStart happened to leave the daemon in.
      await toggleAndAwait(window, wasRunning ? "Gateway Stopped" : "Gateway Running");
      await toggleAndAwait(window, wasRunning ? "Gateway Running" : "Gateway Stopped");
    } finally {
      // No graceful IPC-based daemon stop here: closeApp() below force-kills
      // the app process if a clean close hangs, and killSandboxDaemon() (via
      // cleanupSandbox) unconditionally kills whatever the pidfile points at
      // - that guaranteed path covers this case without an extra IPC round
      // trip that could itself stall in a finally block.
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });
});
