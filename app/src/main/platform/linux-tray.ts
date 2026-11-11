import { execFile } from "node:child_process";

/**
 * Electron's Linux tray is a StatusNotifierItem. Creating one never fails, but
 * nothing shows it unless a StatusNotifier host is registered on the session
 * bus (KDE, most GNOME setups with the AppIndicator extension, XFCE, ...).
 */
const WATCHER_ARGS = [
  "--session",
  "--print-reply",
  "--dest=org.kde.StatusNotifierWatcher",
  "/StatusNotifierWatcher",
  "org.freedesktop.DBus.Properties.Get",
  "string:org.kde.StatusNotifierWatcher",
  "string:IsStatusNotifierHostRegistered"
];

/** Parses `dbus-send --print-reply` output for a boolean variant. */
export function parseDbusBooleanReply(stdout: string): boolean {
  return /\bboolean\s+true\b/.test(stdout);
}

export type ExecFileFn = (
  file: string,
  args: string[],
  options: { timeout: number },
  callback: (error: Error | null, stdout: string) => void
) => unknown;

/** Resolves false when there is no host, no watcher, no session bus or no dbus-send. */
export function probeLinuxTrayHost(run: ExecFileFn = execFile as unknown as ExecFileFn): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      run("dbus-send", WATCHER_ARGS, { timeout: 1500 }, (error, stdout) => {
        resolve(!error && parseDbusBooleanReply(String(stdout)));
      });
    } catch {
      resolve(false);
    }
  });
}
