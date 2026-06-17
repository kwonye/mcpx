import { execFile } from "node:child_process";

export async function resolveLoginShellPath(shell = process.env.SHELL): Promise<string | null> {
  if (!shell) {
    return null;
  }

  return new Promise((resolve) => {
    // Hard deadline — if execFile hangs (e.g. inside the Electron sandbox), we
    // must not block the main process startup indefinitely.
    // Kill + unref the child on timeout so a stuck login shell doesn't leak as
    // a zombie process after the deadline fires or after Electron quits.
    let child: ReturnType<typeof execFile>;
    const hardTimeout = setTimeout(() => {
      try { child.kill(); } catch {}
      child.unref();
      resolve(null);
    }, 2000);

    child = execFile(
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
