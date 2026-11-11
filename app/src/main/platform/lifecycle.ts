/**
 * Lifecycle decisions, identical on every OS: mcpx lives in the tray. When no
 * tray can be shown (Linux without a StatusNotifier/AppIndicator host) it
 * behaves like an ordinary windowed app instead.
 */

/** Core's background CLI updater re-spawns `process.execPath` with this set; in the app that is the GUI binary. */
export function isCliUpdateChildLaunch(env: NodeJS.ProcessEnv): boolean {
  return env.MCPX_UPDATE_CHILD === "1";
}

export function shouldOpenDashboardAtLaunch(opts: { hiddenLaunch: boolean; trayAvailable: boolean }): boolean {
  return !opts.trayAvailable || !opts.hiddenLaunch;
}

/** What closing the dashboard window does. */
export function dashboardCloseAction(opts: { quitting: boolean; trayAvailable: boolean }): "hide" | "close" {
  return !opts.quitting && opts.trayAvailable ? "hide" : "close";
}

/** What happens once the last window has closed. */
export function windowAllClosedAction(opts: { trayAvailable: boolean }): "stay" | "quit" {
  return opts.trayAvailable ? "stay" : "quit";
}

/** A second launch (e.g. from the Start menu or a launcher) reveals the dashboard unless it is an autostart launch. */
export function shouldRevealOnSecondInstance(argv: readonly string[]): boolean {
  return !argv.includes("--hidden");
}
