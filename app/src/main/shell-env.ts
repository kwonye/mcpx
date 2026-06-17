import { execFile } from "node:child_process";

export async function resolveLoginShellPath(shell = process.env.SHELL): Promise<string | null> {
  if (!shell) {
    return null;
  }

  return new Promise((resolve) => {
    // Hard deadline — if execFile hangs (e.g. inside the Electron sandbox), we
    // must not block the main process startup indefinitely.
    const hardTimeout = setTimeout(() => resolve(null), 2000);

    const child = execFile(
      shell,
      ["-ilc", "printf '%s' \"$PATH\""],
      { timeout: 1500, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        clearTimeout(hardTimeout);
        if (error) {
          resolve(null);
          return;
        }

        const pathValue = stdout.trim();
        resolve(pathValue.length > 0 ? pathValue : null);
      }
    );

    child.on("error", () => {
      clearTimeout(hardTimeout);
      resolve(null);
    });
  });
}
