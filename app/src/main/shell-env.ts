import { execFile } from "node:child_process";

export async function resolveLoginShellPath(shell = process.env.SHELL): Promise<string | null> {
  if (!shell) {
    return null;
  }

  return new Promise((resolve) => {
    const child = execFile(shell, ["-ilc", "printf '%s' \"$PATH\""], { timeout: 3000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }

      const pathValue = stdout.trim();
      resolve(pathValue.length > 0 ? pathValue : null);
    });

    child.on("error", () => resolve(null));
  });
}
