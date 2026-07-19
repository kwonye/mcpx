import { expect, type ElectronApplication, type Page } from "@playwright/test";
import { resolve, join } from "node:path";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

/**
 * Shared launch/sandbox/window helpers extracted from the proven patterns in
 * add-server-flow.spec.ts and daemon-control.spec.ts. Every spec in this
 * suite launches the same built app, so isolation and shutdown need to be
 * identical everywhere to avoid order-dependent flakiness (see each helper's
 * doc comment for the specific failure mode it prevents).
 */

export const mainPath = resolve(__dirname, "../out/main/index.js");
export const rendererIndexPath = resolve(__dirname, "../out/renderer/index.html");
export const preloadPath = resolve(__dirname, "../out/preload/index.js");

export interface Sandbox {
  env: NodeJS.ProcessEnv;
  stateHome: string;
  dirs: string[];
}

/**
 * Fresh, isolated HOME/config/data/state directories so no spec in this
 * suite ever touches the developer's real ~/.config/mcpx. Mirrors
 * cli/src/core/paths.ts, which reads these env vars before falling back to
 * the real home directory.
 */
export function createSandbox(): Sandbox {
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
 * daemon is spawned detached, so it survives the Electron app closing - a
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

export function cleanupSandbox(sandbox: Sandbox): void {
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
 * cleanupSandbox()/killSandboxDaemon().
 */
export async function closeApp(app: ElectronApplication): Promise<void> {
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
 * way the real app does on a dock click. We retry the emit because the
 * "activate" listener isn't registered until app startup (whenReady() +
 * lifecycle handler registration) has completed.
 *
 * A popover or other window can already exist before we ever call activate
 * (e.g. the dev flavor auto-opens the popover at launch), so
 * app.firstWindow()/windows()[0] cannot be trusted to be the dashboard.
 * openDashboard() always creates/reveals a window at hash "#dashboard"
 * regardless of what else is open, so we search app.windows() by URL hash
 * instead of assuming index/order.
 */
export async function openDashboardWindow(app: ElectronApplication): Promise<Page> {
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
 * Opens the popover UI directly, mirroring what src/main/popover.ts's
 * loadPopoverContent() does (same renderer bundle, same preload, hash
 * "popover" instead of "dashboard"). There is no "activate"-style app event
 * that opens the popover, and the popover is normally only reachable via a
 * real tray click (not simulable here) or the internal togglePopover()
 * function - which, since the main process is now a single bundled file
 * with no `require` available inside electronApplication.evaluate(), can no
 * longer be reached from a test. Constructing the window this way exercises
 * the real StatusPopover component end-to-end (real preload, real IPC)
 * without depending on either of those.
 */
export async function openPopoverWindow(app: ElectronApplication): Promise<Page> {
  await app.evaluate(
    async ({ BrowserWindow }, paths: { indexPath: string; preloadPath: string }) => {
      const win = new BrowserWindow({
        width: 380,
        height: 520,
        webPreferences: {
          preload: paths.preloadPath,
          sandbox: false
        }
      });
      await win.loadFile(paths.indexPath, { hash: "popover" });
    },
    { indexPath: rendererIndexPath, preloadPath }
  );

  const window = (await app.windows()).find((win) => win.url().includes("#popover"));
  if (!window) {
    throw new Error("Popover window (#popover) did not open.");
  }
  await window.waitForLoadState("domcontentloaded");
  // Popover renders "Loading..." (no .popover-header) until the initial
  // GET_STATUS IPC call resolves - wait past that gate, same as the
  // dashboard's .sidebar wait above.
  await expect(window.locator(".popover-header")).toBeVisible({ timeout: 15000 });
  return window;
}
