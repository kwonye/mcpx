// @vitest-environment node
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOGIN_SHELL_PATH_DEADLINE_MS, resolveLoginShellPath } from "../../src/main/shell-env";

const bash = ["/bin/bash", "/usr/bin/bash"].find((candidate) => existsSync(candidate));

function writeExecutable(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

describe("resolveLoginShellPath", () => {
  const dirs: string[] = [];

  afterEach(() => {
    vi.doUnmock("node:child_process");
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "mcpx-shell-env-"));
    dirs.push(dir);
    return dir;
  }

  it("returns null when no shell is configured", async () => {
    await expect(resolveLoginShellPath("")).resolves.toBeNull();
  });

  it("returns null quickly when the shell cannot be spawned", async () => {
    const started = Date.now();
    await expect(resolveLoginShellPath(join(tempDir(), "missing-shell"))).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(LOGIN_SHELL_PATH_DEADLINE_MS);
  });

  it.skipIf(process.platform === "win32" || !bash)("returns the printed PATH from the login shell", async () => {
    const shell = writeExecutable(
      tempDir(),
      "print-path",
      "#!/usr/bin/env bash\nprintf '%s' '/opt/mcpx-test/bin'\n"
    );

    await expect(resolveLoginShellPath(shell)).resolves.toBe("/opt/mcpx-test/bin");
  });

  it.skipIf(process.platform === "win32" || !bash)(
    "returns null by the deadline when the login shell ignores SIGTERM",
    async () => {
      const shell = writeExecutable(
        tempDir(),
        "hang",
        "#!/usr/bin/env bash\ntrap '' TERM\nread -t 30 _ || true\n"
      );
      const started = Date.now();

      await expect(resolveLoginShellPath(shell)).resolves.toBeNull();

      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(LOGIN_SHELL_PATH_DEADLINE_MS - 200);
      expect(elapsed).toBeLessThan(LOGIN_SHELL_PATH_DEADLINE_MS + 1_500);
    },
    10_000
  );

  it("settles by the deadline when the child never exits on SIGTERM", async () => {
    vi.resetModules();
    const kill = vi.fn();
    const unref = vi.fn();

    vi.doMock("node:child_process", () => ({
      execFile: (
        _file: string,
        _args: string[],
        options: { timeout?: number; killSignal?: NodeJS.Signals },
        callback: (error: Error | null, stdout: string) => void
      ) => {
        const child = new EventEmitter() as EventEmitter & {
          kill: (signal?: NodeJS.Signals) => boolean;
          unref: () => void;
        };
        child.kill = (signal?: NodeJS.Signals) => {
          kill(signal);
          if (signal === "SIGKILL") {
            callback(new Error("killed"), "");
          }
          return true;
        };
        child.unref = unref;
        if (options.timeout) {
          setTimeout(() => {
            child.kill(options.killSignal ?? "SIGTERM");
          }, options.timeout);
        }
        return child;
      }
    }));

    const loaded = await import("../../src/main/shell-env");
    const started = Date.now();
    await expect(loaded.resolveLoginShellPath("/bin/zsh")).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(loaded.LOGIN_SHELL_PATH_DEADLINE_MS + 1_500);
    expect(kill).toHaveBeenCalledWith("SIGKILL");
    expect(unref).toHaveBeenCalled();
  }, 10_000);
});
