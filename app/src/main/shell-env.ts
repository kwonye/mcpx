import { execFile, type ChildProcess } from "node:child_process";

/** Bound for the login-shell PATH lookup during desktop startup. */
export const LOGIN_SHELL_PATH_DEADLINE_MS = 2000;

/**
 * Read PATH from a login shell.
 *
 * `execFile`'s `timeout` only sends SIGTERM and settles its callback after the
 * child actually exits. Inside the packaged app a login shell has no TTY and
 * can ignore that signal, which used to block startup before the tray existed.
 * The deadline below always settles the lookup and SIGKILLs the child.
 */
export async function resolveLoginShellPath(shell = process.env.SHELL): Promise<string | null> {
  if (!shell) {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcess | undefined;
    let hardTimeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (value: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (hardTimeout) {
        clearTimeout(hardTimeout);
      }
      resolve(value);
    };

    hardTimeout = setTimeout(() => {
      if (child) {
        try {
          child.kill("SIGKILL");
        } catch {
          // The login shell already exited.
        }
        try {
          child.unref();
        } catch {
          // The child is already detached from the event loop.
        }
      }
      finish(null);
    }, LOGIN_SHELL_PATH_DEADLINE_MS);

    try {
      child = execFile(
        shell,
        ["-ilc", "printf '%s' \"$PATH\""],
        { timeout: 1500, maxBuffer: 64 * 1024 },
        (error, stdout) => {
          if (error) {
            finish(null);
            return;
          }

          const pathValue = stdout.trim();
          finish(pathValue.length > 0 ? pathValue : null);
        }
      );
    } catch {
      finish(null);
      return;
    }

    child.on("error", () => finish(null));
  });
}
